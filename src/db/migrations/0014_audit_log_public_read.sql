-- 0014_audit_log_public_read.sql
-- Phase 1B follow-up to 0013. The audit_log table currently allows reads
-- only to the row's actor or to admins. The price-history block on
-- /properties/[slug] needs anonymous + authenticated visitors to read a
-- narrow slice of audit events (price changes, sold/rented closings) for
-- properties that are already public-visible.
--
-- This policy is additive; the existing audit_log_admin_select and
-- audit_log_self_select policies stand. The new policy is intentionally
-- limited to (a) public-safe kinds and (b) target_id pointing at an
-- active/sold/rented + published property — NOT drafts, NOT archived,
-- NOT internal admin events. RLS policies OR together, so a row visible
-- to admins via the existing policy stays visible.

drop policy if exists audit_log_public_read_listing_events on public.audit_log;
create policy audit_log_public_read_listing_events
  on public.audit_log for select
  to anon, authenticated
  using (
    kind in (
      'listing.price_changed',
      'listing.marked_sold',
      'listing.marked_rented'
    )
    and exists (
      select 1 from public.properties p
      where p.id = audit_log.target_id
        and p.status in ('active', 'sold', 'rented')
        and p.published_at is not null
    )
  );
