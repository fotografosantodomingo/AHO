-- ============================================================================
-- Email marketing module: contact lists, campaigns, per-recipient logs.
-- Owner: admin (defaults to info@kibay.com.do — REPLACE for your vertical).
-- Worker uses service role and bypasses RLS.
--
-- _consumer_note: the literal 'info@kibay.com.do' below is the brand owner's
-- email. Search-and-replace it before applying the migration, OR after install
-- run:  ALTER FUNCTION public.is_admin() ... and re-define with your address.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: is_admin() — used by RLS policies on the new tables.
-- Returns true when JWT email matches the hardcoded admin OR when the user
-- has role='admin' in public.users (mirrors ProtectedAdminRoute logic).
-- REPLACE 'info@kibay.com.do' with your brand's admin email.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    (auth.jwt() ->> 'email') = 'info@kibay.com.do'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    );
$$;

-- updated_at touch trigger (idempotent — safe to re-create)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- email_contacts: the master contact list (B2B / Individual segmentation).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  first_name      TEXT,
  last_name       TEXT,
  company_name    TEXT,
  segment         TEXT NOT NULL CHECK (segment IN ('b2b', 'individual')),
  subtype_tags    TEXT[] DEFAULT '{}',
  merge_vars      JSONB DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'unsubscribed', 'bounced')),
  notes           TEXT,
  source          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_contacts_segment_idx ON public.email_contacts(segment);
CREATE INDEX IF NOT EXISTS email_contacts_status_idx ON public.email_contacts(status);
CREATE INDEX IF NOT EXISTS email_contacts_tags_gin ON public.email_contacts USING GIN(subtype_tags);

DROP TRIGGER IF EXISTS email_contacts_touch ON public.email_contacts;
CREATE TRIGGER email_contacts_touch BEFORE UPDATE ON public.email_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.email_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_contacts_admin_all ON public.email_contacts;
CREATE POLICY email_contacts_admin_all ON public.email_contacts
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- email_campaigns: composed broadcasts (draft → sending → sent / failed).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  subject           TEXT NOT NULL,
  html_content      TEXT NOT NULL,
  from_name         TEXT DEFAULT 'Kibay',
  from_email        TEXT DEFAULT 'info@kibay.com.do',
  reply_to          TEXT,
  segment_filter    JSONB DEFAULT '{}'::jsonb,  -- { segments: ['b2b'], tags: ['wholesale'], status: 'active' }
  recipients_count  INT DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  sent_at           TIMESTAMPTZ,
  sent_by           TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_campaigns_status_idx ON public.email_campaigns(status);
CREATE INDEX IF NOT EXISTS email_campaigns_sent_at_idx ON public.email_campaigns(sent_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS email_campaigns_touch ON public.email_campaigns;
CREATE TRIGGER email_campaigns_touch BEFORE UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_campaigns_admin_all ON public.email_campaigns;
CREATE POLICY email_campaigns_admin_all ON public.email_campaigns
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- email_logs: one row per recipient per campaign — populated on send,
-- updated by Brevo webhook events (delivered / opened / clicked / bounced).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  recipient       TEXT NOT NULL,
  contact_id      UUID REFERENCES public.email_contacts(id) ON DELETE SET NULL,
  message_id      TEXT,  -- Brevo "messageId" returned by /v3/smtp/email
  campaign_type   TEXT,  -- denormalized 'b2b' / 'individual' for fast charting
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sent','delivered','opened','clicked',
                                      'bounced','soft_bounced','spam','unsubscribed',
                                      'blocked','deferred','failed')),
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  bounced_at      TIMESTAMPTZ,
  bounce_reason   TEXT,
  raw_event       JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_logs_campaign_idx ON public.email_logs(campaign_id);
CREATE INDEX IF NOT EXISTS email_logs_recipient_idx ON public.email_logs(recipient);
CREATE INDEX IF NOT EXISTS email_logs_message_id_idx ON public.email_logs(message_id);
CREATE INDEX IF NOT EXISTS email_logs_status_idx ON public.email_logs(status);
CREATE INDEX IF NOT EXISTS email_logs_sent_at_idx ON public.email_logs(sent_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS email_logs_campaign_type_idx ON public.email_logs(campaign_type);

DROP TRIGGER IF EXISTS email_logs_touch ON public.email_logs;
CREATE TRIGGER email_logs_touch BEFORE UPDATE ON public.email_logs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_logs_admin_all ON public.email_logs;
CREATE POLICY email_logs_admin_all ON public.email_logs
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed: a couple example contacts so the admin UI isn't empty on first load.
-- (Safe-skip if already present.)
-- ---------------------------------------------------------------------------
-- _consumer_note: example seed rows. Two contacts so dashboards/segments show
-- non-empty data on first install. Edit to match your vertical or DELETE before
-- applying — they're safe to remove (ON CONFLICT DO NOTHING covers re-runs).
INSERT INTO public.email_contacts (email, first_name, last_name, company_name, segment, subtype_tags, merge_vars, source)
VALUES
  ('partner@example.com', 'Sample', 'Partner', 'Example Partner Co.', 'b2b',
   ARRAY['wholesale'],
   '{"discount_code":"PARTNER10","wholesale_tier":"silver"}'::jsonb,
   'seed'),
  ('lead@example.com', 'Sample', 'Lead', NULL, 'individual',
   ARRAY['new_signup','online_shopper'],
   '{"first_visit_offer":"10% off first order"}'::jsonb,
   'seed')
ON CONFLICT (email) DO NOTHING;
