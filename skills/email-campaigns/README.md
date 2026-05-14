# email-campaigns — Admin Email Marketing System

> Originally requested as "email companes" (typo for "campaigns"). Folder is
> named `email-campaigns` for clarity.

> **Default content is Kibay-themed (wine / winery).** For other verticals,
> see [`examples/`](./examples/) and edit [`content-template.json`](./content-template.json)
> after install. All body copy is decoupled from chrome — for a new vertical
> you edit ONE config file (or use the live `/admin/email/templates` editor),
> not 80+ scattered strings. The real-estate example at
> `examples/real-estate/` shows exactly which values change.

A drop-in admin email marketing stack for **Vite/React + Supabase + Cloudflare
Worker** projects. Bundles every piece that makes Kibay's email system work:
contact list management, campaign composer, dashboard analytics, transactional
order emails, public newsletter signup, HMAC-signed unsubscribes, and Brevo
event ingestion — all wired into one Supabase schema and one Worker.

## What you get

After applying this skill, your project will have:

| Surface                              | What's there                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `/admin/email` (dashboard)           | KPI tiles (delivered / opened / clicked / bounced) + 14-day chart                       |
| `/admin/email/contacts`              | Full CRUD on `email_contacts`. Segment by B2B/Individual + tags + merge vars.           |
| `/admin/email/campaigns`             | List of campaigns. Duplicate, edit, delete. Status badges.                              |
| `/admin/email/compose`               | Composer with HTML preview pane, segment picker, test-send button.                      |
| `/admin/email/templates`             | Per-type/lang editor for transactional copy (confirmation, tracking, refund, etc).      |
| `NewsletterSignup` component         | Drop in any page. 3 variants: hero / default / footer.                                  |
| Cloudflare Worker                    | `/email/send`, `/unsubscribe`, `/webhooks/brevo`, `/newsletter/welcome`, `/calendar/order/:id.ics` |
| Supabase Edge Function               | `send-order-email` — confirmation / tracking / refund / abandoned_cart / admin_*       |
| Supabase tables                      | `email_contacts`, `email_campaigns`, `email_logs`, `email_templates` + admin RLS         |
| DB trigger                           | `newsletter_subscribers` INSERT → auto-mirrors into `email_contacts`                    |

## Fastest path — 5-step quickstart

```bash
# 1. Apply DB migrations
cp skills/email-campaigns/database/*.sql supabase/migrations/
supabase db push

# 2. Deploy Edge Function
cp -r skills/email-campaigns/edge-function/send-order-email supabase/functions/
supabase functions deploy send-order-email
supabase secrets set BREVO_API_KEY=... ORDER_EMAIL_FROM=... EMAIL_LINK_SECRET=... WORKER_BASE_URL=...

# 3. Deploy Worker (greenfield)
cp -r skills/email-campaigns/worker workers/email-campaigns
# Edit workers/email-campaigns/wrangler.toml + src/index.ts BRAND block
cd workers/email-campaigns && wrangler deploy
wrangler secret put SUPABASE_SERVICE_ROLE_KEY     # also: BREVO_API_KEY, EMAIL_LINK_SECRET, BREVO_WEBHOOK_SECRET

# 4. Configure Brevo webhook
# → app.brevo.com → Webhooks → URL: https://<worker>/webhooks/brevo?secret=$BREVO_WEBHOOK_SECRET

# 5. Wire frontend
cp -r skills/email-campaigns/frontend/src/* src/
# Edit src/config/emailWorker.js → set EMAIL_WORKER_BASE_URL
# Edit src/App.jsx → add 5 routes
# Edit src/i18n/index.js → add 6 namespaces
npm install recharts framer-motion lucide-react sonner react-helmet
```

Full walk-through in `replication-guide.md` (30 min from zero to live send).

## Documentation map

| File                                   | Read when                                                              |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `README.md` (this file)                | First-time overview                                                    |
| `skill-definition.md`                  | Deciding if the skill fits your project; capabilities + non-features   |
| `process-blueprint.md`                 | Understanding the 4 data flows + Brevo event state machine             |
| `replication-guide.md`                 | Doing the install. Step-by-step, ~30 min.                              |
| `configuration-template.json`          | Filling in env vars / secrets. Grouped by service.                     |
| `database/README.md`                   | What each migration does + prerequisites                               |
| `worker/README.md`                     | Greenfield vs bolt-on install + brand-genericization                   |
| `worker/routes-snippet.md`             | Copy-paste blocks to add routes to an existing Worker                  |
| `edge-function/README.md`              | Required secrets + Stripe-webhook calling pattern                      |
| `frontend/README.md`                   | Wiring routes / i18n / nav links into your App.jsx                     |

## Source files map

```
skills/email-campaigns/
├── database/
│   ├── 01_email_marketing.sql                 (3 tables + is_admin + RLS + seed)
│   ├── 02_newsletter_mirror_to_email_contacts.sql (trigger + backfill)
│   ├── 03_email_templates_table.sql           (editable transactional copy + 10-row seed)
│   └── README.md
├── worker/
│   ├── index.ts                                (standalone Worker, BRAND const block)
│   ├── email.ts                                (sendBrevoEmail, signUnsubscribeUrl, etc)
│   ├── wrangler-template.toml                  (rename to wrangler.toml after filling in)
│   ├── routes-snippet.md                       (bolt-on guide)
│   └── README.md
├── edge-function/
│   ├── send-order-email/
│   │   └── index.ts                            (Deno; transactional dispatcher)
│   └── README.md
├── frontend/
│   ├── src/
│   │   ├── pages/admin/email/  (5 .jsx pages: Dashboard, Contacts, Campaigns, Composer, Templates)
│   │   ├── services/           (EmailMarketingService.js, NewsletterService.js)
│   │   ├── config/             (emailWorker.js — Worker URL constant)
│   │   ├── components/         (NewsletterSignup.jsx)
│   │   └── i18n/locales/       (6 namespaces × 2 langs = 12 JSON files)
│   └── README.md
├── examples/
│   └── real-estate/
│       ├── content-template.json    (real-estate vertical reference values)
│       └── README.md                (3-place install checklist for non-wine verticals)
├── README.md                    (this file)
├── skill-definition.md
├── process-blueprint.md
├── replication-guide.md
├── configuration-template.json
└── content-template.json        (single source of truth for all body copy + chrome)
```

## What it does NOT do

Quick reality check (full list in `skill-definition.md` → "What this skill
does NOT include"):

- No Stripe webhook bundled (project-specific).
- No WYSIWYG editor — composer is a rich textarea + HTML preview.
- No drip / scheduled campaigns — single-shot only.
- No bulk-import wizard for contacts — row-by-row create.
- No multi-tenancy — one Worker per brand.

## Brand-genericization

This skill is Kibay-shaped by default but fully vertical-portable. All body
copy lives in `content-template.json` at the skill root. See
`examples/real-estate/` for a full non-wine reference install.

To rebrand, edit exactly three places:

1. **Worker `BRAND` + `CONTENT` consts** (top of `worker/index.ts`) — chrome
   + welcome / admin-notice body copy.
2. **Edge Function `BRAND_DEFAULTS` const** (top of
   `edge-function/send-order-email/index.ts`) — chrome + order-email
   fallback copy. Editable rows in `/admin/email/templates` take precedence
   at runtime, so this is only a redeploy-time concern.
3. **`content-template.json`** at the skill root — the canonical source of
   truth. Copy values from here into 1 and 2 (or, in a fork, generate them
   at build time).

After install, admins edit transactional copy live at `/admin/email/templates`
with no redeploy. The 10 starter rows seeded by migration #3 are intentionally
brand-neutral so they're usable as-is until you customize.

See `replication-guide.md` step 8 for the full vertical-port checklist.

## Stack assumptions

- **Vite/React SPA** with `react-router-dom@7`, `react-i18next@15`.
- **Supabase** with `auth.users` + a `public.users(id, role)` table (or your
  own admin-check wired into `is_admin()`).
- **Cloudflare Workers** with `wrangler` installed.
- **Brevo** account with a verified sender (single-address or full domain DKIM).
- **shadcn/ui** primitives (`<Button>`, `<Input>`, `useToast`) — or your own
  matching components.

## Adjacent skill

`skills/content-automation-system/` — sibling skill for the Drive → blog →
social pipeline. Both can run in the same Worker (Kibay's
`drive-pipeline` Worker does exactly that). If you're forking both for a new
brand, follow each skill's `replication-guide.md` independently and combine
the route blocks into one `index.ts`.
