-- 0041_review_request_log.sql
--
-- Daily review-request cron support: track which sold listings have
-- already had a review-request email sent so the cron is idempotent.
--
-- Background. The reviews flow (`/reviews/verify/[token]`,
-- `lib/reviews/token.ts`, `email/templates/review-verification.ts`,
-- `POST /api/reviews/verify`) was shipped in 0016_reviews.sql, but
-- there was no automated trigger to actually send the request to the
-- buyer after a sale closed. That left the agent to manually nudge the
-- buyer for a review — which in practice never happens, which kills
-- the cold-start review-volume problem. The cron at
-- `/api/cron/review-requests` (added in the same PR as this migration)
-- closes that gap by sweeping recently-sold listings daily and
-- emailing the captured buyer the existing magic-link verification
-- flow.
--
-- Schema choice — column on `properties` over a new `review_requests`
-- table:
--
--   * AHO's v1 schema has at most one buyer per sold listing — there
--     is no `sale_buyers` join table, no multi-buyer support in the
--     `properties` columns. A separate `review_requests` table with
--     `(listing_id, recipient_email)` would just shadow the same
--     1:1 cardinality.
--
--   * The cron's "have we already sent for this sale?" check is
--     naturally idempotent against a single timestamp column —
--     `review_request_sent_at IS NOT NULL`. No JOIN needed; the
--     SELECT for eligibility stays a single-table scan with a partial
--     index.
--
--   * If v1.1 ever adds multi-buyer (separate buyer-side and
--     seller-side reviews per closing), upgrade path is to introduce
--     a `review_requests` table at that point and backfill from this
--     column. The column gives us the today-correct semantics with
--     zero forward-compat tax.
--
-- Two columns are added (both nullable, no default):
--
--   * `review_request_sent_at timestamptz` — set when the cron
--     successfully dispatches the email. Re-clearing requires admin
--     SQL — there's no user-facing surface for it.
--
--   * `review_request_recipient_email citext` — audit trail of who
--     we sent to. Lets a support engineer answer "did we send a
--     review request to this buyer?" without grepping email logs,
--     and pairs with the `review_request_sent_at` timestamp so a
--     single SELECT on the `properties` row tells the full story.
--     Captured at send-time from the leads table; immutable once set.
--
-- RLS posture. Both columns live on `properties`, which already has
-- the right RLS policies (org members can read; the cron uses the
-- service-role admin client which bypasses RLS as designed). The
-- column-level write protection added by the existing trigger
-- (`protect_listing_publish_columns`) does NOT cover these new
-- columns by name, so we do NOT need to amend it — those columns are
-- already write-restricted to org members + admins by the row-level
-- policies, and the cron uses the service-role bypass.
--
-- Forwards-only — no DROP COLUMN. Future columns extend; a rewrite
-- of the cron's "already sent" semantics ships its own migration.

alter table public.properties
  add column if not exists review_request_sent_at timestamptz,
  add column if not exists review_request_recipient_email citext;

-- Eligibility-query index. The cron's hot SELECT is:
--
--   from properties
--   where status = 'sold'
--     and sold_date between (now() - interval '90 days')
--                       and (now() - interval '14 days')
--     and review_request_sent_at is null
--
-- The partial index narrows to "candidate sales we still might
-- email about", which stays a small working set even after years of
-- accumulated sold inventory (since flipped rows fall out of the
-- partial as soon as `review_request_sent_at` is stamped).
create index if not exists idx_properties_review_request_pending
  on public.properties(sold_date)
  where status = 'sold'
    and review_request_sent_at is null;

comment on column public.properties.review_request_sent_at is
  'Set by /api/cron/review-requests when the post-sale review-request email is dispatched. NULL = no email sent yet (eligible for the cron); non-NULL = already requested (idempotent skip).';
comment on column public.properties.review_request_recipient_email is
  'Audit trail of who the post-sale review-request email was sent to. Captured at send-time from the matching lead row; immutable once set.';
