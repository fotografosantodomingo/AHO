# Database — Supabase migrations for email-campaigns

Three migrations, applied in order. All idempotent (re-runnable).

| File                                          | What it creates                                                           | Depends on                            |
| --------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| `01_email_marketing.sql`                      | `email_contacts`, `email_campaigns`, `email_logs` + `is_admin()` + RLS    | `public.users(role)` (your auth table) |
| `02_newsletter_mirror_to_email_contacts.sql`  | Trigger: `newsletter_subscribers` INSERT → mirror into `email_contacts`. Backfills existing rows. | `newsletter_subscribers` table        |
| `03_email_templates_table.sql`                | `email_templates` (per-type per-lang editable copy for order emails)      | `is_admin()` (from #1)                |

## Apply

```bash
# From project root with supabase CLI authed and linked:
supabase db push
```

If you're in an existing project that already has email tables, the migrations
use `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING`, so re-running
is safe. RLS policies are `DROP IF EXISTS` then `CREATE` — safe to re-apply.

## Prerequisites

### `public.users(id uuid, role text)`

Migration #1 references `public.users` for the admin check:

```sql
SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
```

If your project doesn't have this table, either:

1. **Create it** (one row per admin):
   ```sql
   CREATE TABLE public.users (
     id   UUID PRIMARY KEY REFERENCES auth.users(id),
     role TEXT NOT NULL DEFAULT 'user'
   );
   ```
2. **Or replace the second branch of `is_admin()`** with whatever your admin
   model is (e.g. a hardcoded email list, a Postgres function you already
   have, etc.).

### `public.newsletter_subscribers`

Migration #2 attaches a trigger to this table. If you don't have a public
newsletter signup, **skip migration #2 entirely** — campaigns will still work,
just no auto-mirror from form signups.

Minimum schema the trigger expects:

```sql
CREATE TABLE public.newsletter_subscribers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  first_name  TEXT,
  source      TEXT,
  tags        TEXT,     -- or JSONB, the trigger only reads `source` + `email` + `first_name`
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon can insert" ON public.newsletter_subscribers
  FOR INSERT TO anon WITH CHECK (true);
```

## Tables at a glance

### `email_contacts`

Master contact list. One row per email address.

- `segment`: `b2b` or `individual` (CHECK constraint enforced)
- `subtype_tags`: TEXT[] — free-form, used by segment filters (`['hotel','wholesale']`)
- `merge_vars`: JSONB — per-contact mustache vars (`{discount_code: 'HOTEL10'}`)
- `status`: `active` / `unsubscribed` / `bounced` (CHECK)
- `source`: tracking string ('seed' / 'newsletter_form' / 'manual_admin' / etc.)

### `email_campaigns`

Composed broadcasts.

- `segment_filter`: JSONB — `{ segments: ['b2b'], tags: ['wholesale'], status: 'active' }`.
  Worker reads this at send time to resolve recipients.
- `status`: `draft` → `sending` → `sent` / `failed` (CHECK + immutable once `sent`)
- `recipients_count` is updated post-send by the Worker, not at draft time.

### `email_logs`

One row per recipient per campaign. Created on send, mutated by Brevo webhook.

- `message_id` — Brevo's `messageId` from `/v3/smtp/email`. Webhook events
  match rows by this.
- `campaign_type` — denormalized copy of contact.segment for fast charting
  (avoids a join in the dashboard).
- `status` covers the full lifecycle: `queued` / `sent` / `delivered` /
  `opened` / `clicked` / `bounced` / `soft_bounced` / `spam` / `unsubscribed`
  / `blocked` / `deferred` / `failed`.
- `raw_event`: JSONB of the last Brevo event — invaluable when debugging.

### `email_templates`

Per-type, per-lang editable copy for **transactional** order emails
(not campaigns).

- `type` ∈ `confirmation`, `tracking`, `refund`, `abandoned_cart`,
  `admin_new_order`, `admin_refunded`.
- `lang` ∈ `es`, `en`. Admin templates are `en` only.
- The `send-order-email` Edge Function reads from this table at send time;
  if a row is missing (or query fails), it falls back to hardcoded defaults
  baked into its source. HTML chrome (wordmark, gold rule, footer, socials,
  copyright) stays in code — admins can only edit per-type copy here.
- Subject supports `{{order_number}}` substitution.

## Why these tables and not Brevo's native lists?

Brevo's contact list is the source-of-truth for **delivery**; this schema is
the source-of-truth for **segmentation, history, and audit**. Specifically:

- Segments are stored as your-database-shaped data, not as Brevo list IDs
  you'd otherwise have to manage in the Brevo UI.
- `email_logs` gives you per-recipient analytics joined to your own
  `email_contacts` table — you can run any SQL you want.
- The unsubscribe flow writes to both your `email_contacts.status` AND
  Brevo's blocklist — belt and suspenders. If Brevo goes down you still
  honour unsubscribes; if your DB goes down, Brevo still honours them.

## Seed data

Migration #1 seeds 2 example contacts so the admin UI isn't empty on first
load. Safe to delete (`DELETE FROM public.email_contacts WHERE source = 'seed'`)
once you have real contacts.

Migration #3 seeds 10 rows of `email_templates` — the exact defaults
hardcoded in `send-order-email/index.ts`. After applying, admins can edit
these via `/admin/email/templates` and the Edge Function will pick up the
new copy on the next send.
