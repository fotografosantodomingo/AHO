-- ============================================================================
-- 1) Auto-mirror newsletter_subscribers → email_contacts on insert
-- SECURITY DEFINER bypasses email_contacts admin-only RLS so anon signup
-- via the public newsletter form also lands in the marketing list.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mirror_newsletter_to_email_contacts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.email_contacts (email, first_name, segment, subtype_tags, source, status)
  VALUES (
    NEW.email,
    NEW.first_name,
    'individual',
    ARRAY['newsletter', COALESCE(NEW.source, 'signup')],
    COALESCE(NEW.source, 'newsletter_form'),
    'active'
  )
  ON CONFLICT (email) DO UPDATE
    SET
      first_name = COALESCE(public.email_contacts.first_name, EXCLUDED.first_name),
      subtype_tags = ARRAY(
        SELECT DISTINCT unnest(public.email_contacts.subtype_tags || EXCLUDED.subtype_tags)
      )
    WHERE public.email_contacts.status = 'active';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS newsletter_to_email_contacts ON public.newsletter_subscribers;
CREATE TRIGGER newsletter_to_email_contacts
  AFTER INSERT ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.mirror_newsletter_to_email_contacts();

-- ============================================================================
-- 2) Backfill: sync existing newsletter subscribers into email_contacts
-- ============================================================================
INSERT INTO public.email_contacts (email, first_name, segment, subtype_tags, source, status)
SELECT
  ns.email,
  ns.first_name,
  'individual',
  ARRAY['newsletter', COALESCE(ns.source, 'signup')],
  COALESCE(ns.source, 'newsletter_form_backfill'),
  'active'
FROM public.newsletter_subscribers ns
WHERE ns.email IS NOT NULL
ON CONFLICT (email) DO UPDATE
  SET subtype_tags = ARRAY(
    SELECT DISTINCT unnest(public.email_contacts.subtype_tags || EXCLUDED.subtype_tags)
  )
  WHERE public.email_contacts.status = 'active';
