# Admin Email Marketing System (Kibay-style)

## Skill

Drop a complete admin-side email marketing stack into a
**Vite/React + Supabase + Cloudflare Worker** project: contacts, campaigns,
composer, dashboard, templates, transactional order emails, newsletter
signup, HMAC-signed unsubscribes, and Brevo event webhooks — all wired into
one Supabase schema and one Worker.

## Problem this solves

Solo operators and small commerce sites need to:

1. Build and segment a mailing list (B2B / Individual + tags + merge vars).
2. Compose and send campaigns from an admin UI with a test-send safety step.
3. See delivery / open / click / bounce rates per campaign.
4. Send transactional emails (order confirmation, tracking, refund,
   abandoned-cart, admin notifications) automatically from a Stripe webhook.
5. Edit transactional copy without redeploying code.
6. Auto-mirror public newsletter signups into the marketing list.
7. Honour unsubscribes both in their own DB and at the ESP.

Off-the-shelf ESPs (Mailchimp, ConvertKit) handle 1-3 but charge per contact
and put your transactional flow on a different surface. Brevo solves the
delivery cost (300/day free + cheap tiers) but doesn't give you a custom
admin UI integrated with your product DB. **This skill is the glue.**

## Tech stack

| Layer            | Choice                              | Why                                                                 |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------- |
| Persistence      | Supabase (Postgres + Auth + RLS)    | Free tier; admin-only RLS via `is_admin()`; service role for Worker |
| Marketing send   | Cloudflare Worker → Brevo `/v3/smtp/email` | Pay-per-send, no SDK, edge-fast, free tier covers ~10k/mo     |
| Transactional    | Supabase Edge Function → Brevo      | One network hop from Stripe webhook → email                         |
| Event ingest     | Brevo dashboard webhook → Worker `/webhooks/brevo` | Open/click/bounce → `email_logs`                             |
| Admin UI         | React + react-i18next + recharts    | Lazy-loaded admin routes, ES + EN copy, charts on dashboard         |
| Auth on send     | Supabase JWT verified by Worker     | Admin sends pass user's session token; Worker checks `auth.users`    |
| Unsubscribe      | HMAC-signed link → Worker `GET /unsubscribe` | Account-less; tamper-proof; double-writes contact + Brevo blocklist |

## Capabilities

- **Brand and vertical portable** — full body copy lives in a single
  config file (`content-template.json`) plus two const blocks in source
  (`BRAND`/`CONTENT` in the Worker, `BRAND_DEFAULTS` in the Edge Function).
  Order-email copy is additionally editable live at `/admin/email/templates`
  with no redeploy. Wine-themed by default; see `examples/real-estate/`
  for a complete non-wine reference install.

What the skill gives you, route by route:

- `POST /email/send` — send campaign by ID (with stored segment_filter), or
  inline ad-hoc HTML, or test-to-one. Inserts per-recipient `email_logs` row
  with Brevo's `message_id` for later webhook correlation.
- `GET /unsubscribe?email=&sig=` — verifies HMAC, sets
  `email_contacts.status='unsubscribed'`, also pushes to Brevo blocklist
  (best-effort). Returns a styled HTML confirmation page.
- `POST /webhooks/brevo?secret=` — accepts Brevo's JSON event payload
  (single or batch), maps each event type to an `email_logs` patch:
  `delivered_at`, `opened_at`, `clicked_at`, `bounced_at`, `bounce_reason`.
  Won't downgrade `clicked → opened`; won't overwrite terminal states with
  late `sent` events.
- `POST /newsletter/welcome` — fires after public signup. Verifies the
  address is in `newsletter_subscribers`, sends a brand-templated welcome
  to the subscriber + a short admin notice to the operator. Auto-mirrored
  to `email_contacts` by DB trigger so they're segment-reachable.
- `GET /calendar/order/:id.ics?sig=` — for projects with reservation
  products. Returns a valid VCALENDAR with one VEVENT per reservation item.
- Edge Function `send-order-email` — types: `confirmation`, `tracking`,
  `refund`, `abandoned_cart`, `admin_new_order`, `admin_refunded`. Reads
  copy from `email_templates` table; falls back to hardcoded defaults if
  table is empty.

## What this skill does NOT include

- **The Stripe webhook itself** — too project-specific. The skill assumes
  your webhook fires `send-order-email` on `payment_intent.succeeded` and
  `charge.refunded`. A minimal calling pattern is shown in
  `edge-function/README.md`.
- **A WYSIWYG editor** — the composer is a rich `<textarea>` with a live
  HTML preview pane. Use it with sane HTML templates; for full WYSIWYG
  bring TipTap or similar.
- **AB testing / send-time optimization** — campaigns are single-shot. The
  table can be extended (`variant_of_id`, `winner_metric`) without breaking
  the existing flow.
- **Drip/automation flows** — there's no scheduler beyond "send now". For
  scheduled sends add a `scheduled_at` column on `email_campaigns` + a
  Worker cron polling for due rows.
- **A bulk-import wizard** — the contacts page has a row-by-row create
  form. Bulk import is a future enhancement.
- **Hard-coded brand styling** — the welcome email and admin notice have a
  `BRAND` constant block in `worker/index.ts`; the per-type editable copy
  lives in `email_templates`; HTML chrome (wordmark / footer / socials) is
  Kibay-styled and **must be edited** per brand. See `replication-guide.md`
  step 8.
- **Multi-brand multi-tenancy in one Worker** — one Worker, one brand.
  Stand up another Worker for another brand.

## Dependencies the consumer must already have

- A Supabase project with `auth.users` and a `public.users(id, role)` table
  (or an alternate admin-check you wire into `is_admin()`).
- A Cloudflare account with Workers enabled + `wrangler` installed.
- A Brevo account with a verified sender (address or domain).
- An admin auth wrapper in their SPA (`ProtectedAdminRoute` equivalent).
- shadcn/ui or equivalent `<Button>` / `<Input>` / `useToast` primitives.

## When to reach for this skill

- You have or are building a Vite/React SPA with Supabase + a Worker.
- You want admin-driven marketing + transactional emails on one Brevo account.
- You want the operator to edit transactional copy without redeploys.
- You want unsubscribes to work without account / login.
- You want analytics joined to your own DB (not gated by Brevo's UI).

## Non-goals

- A drop-in for non-Supabase backends (Firebase, Convex, custom Postgres
  with different auth).
- An ESP-agnostic abstraction. The skill is Brevo-shaped: SendGrid, Postmark,
  Resend would each need ~3 fetch calls rewritten and the webhook event-name
  map (`brevo:delivered → ours:delivered`) updated.

## Performance envelope

- Worker free tier (10ms CPU): one Brevo POST per recipient ≈ 50-200ms each;
  100-recipient campaign completes in ~10-30s. For sends >500 recipients,
  either go Workers Paid (50ms CPU) or batch by chunking the loop with
  `ctx.waitUntil` continuations (not implemented in MVP).
- Brevo free plan: 300 sends/day. Marketing campaigns hit this ceiling
  fastest; transactional + newsletter welcomes rarely do.
- Webhook event ingest: Brevo POSTs in batches of ~50, Worker processes
  serially in ~1s. No queueing needed at typical (Kibay-scale) volume.
