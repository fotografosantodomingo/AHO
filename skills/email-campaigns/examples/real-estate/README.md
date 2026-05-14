# Real estate install — `email-campaigns`

Reference content config for installing the `email-campaigns` skill on a
residential brokerage or property-listings platform. The default install
ships with wine-themed copy (Kibay) — for any non-wine vertical, replace
the body copy with values that make sense for what your customers actually
buy or do.

See `./content-template.json` for the full set of vertical-appropriate
values: "new listings in saved areas", "open house weekends", "market
reports", "off-market opportunities", "offer received", "closing update",
"deposit returned" — every place the wine install said "harvest /
vintage / winery" gets a real-estate counterpart.

## Three-place install checklist

After copying the skill into your repo, edit exactly three things:

### 1. `worker/index.ts` BRAND + CONTENT consts (top of file)

Open the file and replace the two const blocks (`BRAND`, `CONTENT`) with
values from `./content-template.json`. Approximate mapping:

| `content-template.json` path              | `worker/index.ts` const                       |
| ----------------------------------------- | --------------------------------------------- |
| `brand.name`                              | `BRAND.name`                                  |
| `brand.domain`                            | `BRAND.domain`                                |
| `brand.site_url`                          | `BRAND.siteUrl`                               |
| `brand.tagline_es` / `tagline_en`         | `BRAND.tagline` / `BRAND.taglineEn`           |
| `brand.address`                           | `BRAND.address`                               |
| `brand.copyright_es`                      | `BRAND.copyright`                             |
| `brand.socials`                           | `BRAND.socials`                               |
| `newsletter_welcome.subject_template_es`  | `CONTENT.newsletter_welcome.subjectEs` (with `{{brand_name}}` already filled) |
| `newsletter_welcome.intro_es`             | `CONTENT.newsletter_welcome.introEs`          |
| `newsletter_welcome.cta_label_es`         | `CONTENT.newsletter_welcome.ctaLabelEs`       |
| `newsletter_admin_notice.heading_es`      | `CONTENT.newsletter_admin_notice.heading`     |
| `unsubscribe_page.success_message_template_es` | `CONTENT.unsubscribe_page.successMessage` (with `{{brand_name}}` filled) |

`{{brand_name}}` and `{{email}}` templating in the JSON is informational —
in the worker TS, the same values are interpolated with `${BRAND.name}` /
`${email}` directly.

### 2. `database/03_email_templates_table.sql` seed rows

Open the file and edit the 10 `INSERT` rows so the subjects / headings /
intros / outros / button labels reflect your vertical's transactions
(offer → confirmation, closing → tracking, etc — see
`order_emails.*` in `./content-template.json` for the real-estate phrasing).

Then re-run the migration on your Supabase project:

```bash
cp skills/email-campaigns/database/03_email_templates_table.sql supabase/migrations/
supabase db push
```

Or — if the migration was already applied — edit live at
`/admin/email/templates` after first deploy. No SQL or redeploy required
after that point.

### 3. `edge-function/send-order-email/index.ts` BRAND_DEFAULTS const

Same idea as step 1 but for the Edge Function. Open the file, replace the
`BRAND_DEFAULTS` const block at the top with your real-estate values from
`./content-template.json` → `brand`. The function reads editable copy from
`email_templates` first; this const is the fallback when a row is missing.

Redeploy:

```bash
supabase functions deploy send-order-email
```

## Optional fourth: frontend i18n + sender defaults

If you want the admin composer "From name" / "From email" to default to
your brand without forking the JSX, set Vite env vars at build time:

```
VITE_EMAIL_DEFAULT_FROM_NAME="Casa Caribe"
VITE_EMAIL_DEFAULT_FROM_EMAIL="hello@casacaribe.com"
```

Also edit `frontend/src/i18n/locales/{es,en}/newsletter.json` if you want
the toast/success message to reflect your brand name — the default after
this refactor is generic ("Welcome to our list!"), but most consumers
should pass a `successMessage` prop from the parent component instead so
the value comes from i18n you already maintain.

## What you do NOT need to touch

- HTML chrome (table layouts, colors, font choices) — already covered by
  `brand.accent_color` and the `BRAND` const palette.
- Worker routes, signing keys, JWT verification, RLS policies, the Brevo
  webhook mapper, the `.ics` generator — pure logic, brand-agnostic.
- The 6 admin pages (`/admin/email/*`) and their i18n namespaces — all
  surfaces in those use generic English/Spanish strings that already work
  for any vertical.

## Verification after install

```bash
# 1. Worker health
curl https://<your-worker>/health
# 2. Subscribe via the form on your site → welcome email matches brand
# 3. Inspect /admin/email/templates → the 10 seed rows reflect your vertical
# 4. Submit a test offer → confirmation email mentions "offer", not "order"
```

If welcome + transactional emails read like real estate (not wine), you're
done.

## Sample contact import file

`./contacts-template.csv` — 15 realistic real-estate-agent rows across
DR / LATAM / EU / NA. Header row: `name,country,email`.

Used as the **Download template ↓** payload behind the in-app audience
uploader (`/admin/email/audiences/new` in the AHO reference install).
Country codes are ISO 3166-1 alpha-2; emails on `@example.com` per RFC
2606 — the placeholder TLD that cannot deliver, so re-uploading the
template as-is never hits a real inbox.

Stress-tests the parser with diacritics + an embedded apostrophe
(`O'Connor`) — verifies UTF-8 + quoted-field handling.
