-- 0062_audit_funnel_events.sql
--
-- Free Audit funnel instrumentation — for the investor pitch's
-- conversion numbers + for our own product analytics.
--
-- Two events that matter:
--   - 'preview_view'  — anonymous visitor lands on /preview/[id]
--                       (signed-in or not). Counts attention.
--   - 'preview_claim' — viewer signs in (or signs up) and the audit
--                       gets claimed. Counts conversion.
--
-- Conversion rate = preview_claim / preview_view (over a window). The
-- existing ai_audits row already records `created_at` (proxy for
-- audit_start) and `claimed_at` (set the moment a logged-in viewer
-- lands), so we already know the start + the claim per audit. What
-- we DON'T have today: the number of preview_view events between
-- those two (a single audit can be viewed many times before being
-- claimed; each view counts toward attention). This table closes
-- that gap.
--
-- Access model: service-role only writes. RLS enabled with no
-- policies → anon + authenticated get nothing.

create table public.audit_funnel_events (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.ai_audits(id) on delete cascade,
  event text not null check (event in ('preview_view', 'preview_claim')),
  -- Anonymized SHA-256 hex of client IP. Lets us de-duplicate views
  -- from the same network (same agent reloading) without storing
  -- raw IPs. NULL when the request couldn't get an IP header.
  ip_hash text,
  -- Optional user id for claim events (and authenticated views).
  -- NULL on anonymous views.
  user_id uuid references auth.users(id) on delete set null,
  -- Locale at the time of the event (en/es/pl/pt/de/fr/it). Useful
  -- for per-market funnel analysis ("DE audits convert at X%,
  -- ES at Y%").
  locale text,
  -- User agent string, truncated. Lets us segment by mobile vs
  -- desktop without a separate dim table.
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table public.audit_funnel_events is
  'Free Audit conversion funnel: preview_view + preview_claim events. Per row = one event. Used for /admin funnel rollup + investor metric "X% of preview views convert to signup". Per docs/PITCH_OUTLINE.md.';

-- Most common queries:
--   - "Conversion rate last 30 days"
--     → with views as (...), claims as (...) select claims.n / views.n
--   - "Funnel per locale" → GROUP BY locale, event
--   - "Has this specific audit had any views"
--     → WHERE audit_id = X
create index audit_funnel_events_audit_id_idx
  on public.audit_funnel_events (audit_id);
create index audit_funnel_events_event_created_at_idx
  on public.audit_funnel_events (event, created_at desc);
create index audit_funnel_events_locale_event_idx
  on public.audit_funnel_events (locale, event)
  where locale is not null;

alter table public.audit_funnel_events enable row level security;

-- No policies = deny-all to anon + authenticated.
-- Service-role client writes (preview page server component logs
-- view + claim events).
