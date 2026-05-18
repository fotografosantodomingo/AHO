# aho-listing-expiry

Daily Cloudflare Worker that drives the $5 private-owner listing lifecycle on AHO.

**Schedule:** `0 4 * * *` (UTC) — 04:00 UTC daily.
30 minutes after `aho-audit-prune` (03:30 UTC) and 2 hours before `ai-daily-rollup` (06:00 UTC), so the night-time DB jobs don't pile up on Brevo / Stripe headroom.

## What it does

The worker is a thin proxy. The actual work runs in the Pages app at `GET /api/cron/listing-expiry` (`src/app/api/cron/listing-expiry/route.ts`), which executes three independent passes in sequence:

1. **Day-55 renewal reminders** — `listing_purchases` rows where the linked property is `status='active'` and `expires_at` is within the next 5 days, and `renewal_reminder_sent_at IS NULL`. Sends the bilingual "Your AHO listing expires in 5 days — renew for $5" email and stamps the column.
2. **Day-60 expiry** — bulk-updates active `private_purchase` properties whose `expires_at` is in the past to `status='expired'`, then per linked purchase row with `expired_email_sent_at IS NULL` sends the "Your AHO listing has expired" email and stamps the column.
3. **Orphan nudges** — `listing_purchases` rows where `property_id IS NULL`, `paid_at` is between 5 and 60 days ago, and `unpublished_reminder_sent_at IS NULL`. Sends the "Finish your listing — you've already paid" email and stamps the column.

Each pass is independent — one bad pass doesn't kill the others. The three idempotency columns on `listing_purchases` (added in migration 0074) act as the dedup keys, so the cron is safe to run repeatedly without re-sending emails.

## Secrets

Set per environment via `wrangler secret put`:

- `CRON_SECRET` — matches the Pages env `CRON_SECRET`; the Pages route validates with the shared `checkCronAuth` helper.
- `AHO_PAGES_URL` — production `https://advertisehomes.online`, preview the `*.aho-web.pages.dev` subdomain.

## Manual trigger

For local testing or post-deploy smoke:

```
GET https://aho-listing-expiry.<account>.workers.dev/run?secret=<CRON_SECRET>
```

Returns the Pages route's JSON response inline so `wrangler tail` shows the per-pass counts (`reminded`, `expired`, `orphans`).

## Deploy

```
cd workers/listing-expiry
wrangler deploy
```

## Reference

- Plan: `docs/SELL_FUNNEL_PLAN.md` Track E
- Pages route: `src/app/api/cron/listing-expiry/route.ts`
- Migration: `src/db/migrations/0074_private_owner_listings.sql` (idempotency columns appended to `listing_purchases`)
- Email templates: `src/lib/email/templates/listing-{renewal-reminder,expired,unpublished-reminder}.ts`
- Renewal endpoint: `src/app/api/sell/private/renew/[propertyId]/route.ts`
