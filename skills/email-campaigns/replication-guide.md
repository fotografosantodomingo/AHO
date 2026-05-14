# Replication Guide — New brand in ~30 minutes

This goes step-by-step. If you already have CLIs authed
(`wrangler`, `supabase`), you're at the 30-minute mark; otherwise budget
another 10 minutes for one-time logins.

## 0. Prerequisites (one-time per machine)

```bash
npm i -g wrangler && wrangler login
brew install supabase/tap/supabase && supabase login
```

Verify:

```bash
wrangler whoami    # should print your Cloudflare email
supabase projects list
```

## 1. Apply database migrations (3 min)

```bash
cd <your-project>
mkdir -p supabase/migrations
cp skills/email-campaigns/database/01_email_marketing.sql           supabase/migrations/
cp skills/email-campaigns/database/02_newsletter_mirror_to_email_contacts.sql supabase/migrations/
cp skills/email-campaigns/database/03_email_templates_table.sql     supabase/migrations/

# Link if you haven't already
supabase link --project-ref <your-project-ref>

supabase db push
```

**If migration #1 fails** with "relation public.users does not exist": that's
the admin-check dependency. Either create the table (see
`database/README.md`) or open the migration and change the `is_admin()`
function body to your project's admin rule.

**If migration #2 fails** with "relation public.newsletter_subscribers does
not exist": you don't have a public newsletter form. Either create the
table (schema in `database/README.md`) or skip migration #2 — campaigns
will still work, you just lose the auto-mirror trigger.

## 2. Deploy the Edge Function (3 min)

```bash
mkdir -p supabase/functions/send-order-email
cp skills/email-campaigns/edge-function/send-order-email/index.ts \
   supabase/functions/send-order-email/index.ts

supabase functions deploy send-order-email
```

Then push the function's secrets:

```bash
supabase secrets set BREVO_API_KEY="<xkeysib-...>"             # from app.brevo.com/settings/keys/api
supabase secrets set ORDER_EMAIL_FROM='<Brand> <orders@<brand>.com>'  # must be Brevo-verified
supabase secrets set ADMIN_NOTIFY_EMAIL='info@<brand>.com'     # or "" to disable BCC
supabase secrets set EMAIL_LINK_SECRET='<openssl rand -base64 32>'   # paste output of `openssl rand -base64 32`
supabase secrets set WORKER_BASE_URL='https://<brand>-email-campaigns.<your-subdomain>.workers.dev'
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` are
auto-injected by Supabase — don't push these manually.

> **Critical:** save the `EMAIL_LINK_SECRET` value somewhere — you must push
> the same value to the Worker in step 4. If they differ, calendar `.ics`
> links won't verify.

## 3. Deploy the Worker (5 min)

### Path A — Greenfield (recommended for new projects)

```bash
mkdir -p workers/email-campaigns/src
cp skills/email-campaigns/worker/index.ts             workers/email-campaigns/src/
cp skills/email-campaigns/worker/email.ts             workers/email-campaigns/src/
cp skills/email-campaigns/worker/wrangler-template.toml workers/email-campaigns/wrangler.toml

cd workers/email-campaigns
# Edit wrangler.toml: replace <brand>, <project-ref>, etc.
# Edit src/index.ts: set the BRAND const block (top of file) for your brand.

wrangler deploy
# → note the deployed URL, e.g. https://acme-email-campaigns.acme.workers.dev
```

### Path B — Bolt-on to existing Worker

If you already deploy a Worker (e.g. for a different feature) and want to
add these routes to it instead of running two Workers, follow
`worker/routes-snippet.md`. The end-state is functionally identical.

## 4. Push Worker secrets (2 min)

```bash
cd workers/email-campaigns

wrangler secret put SUPABASE_SERVICE_ROLE_KEY    # from Supabase → Settings → API
wrangler secret put BREVO_API_KEY                # same value as Edge Function used
wrangler secret put EMAIL_LINK_SECRET            # SAME VALUE as Edge Function
wrangler secret put BREVO_WEBHOOK_SECRET         # any random string; goes in Brevo URL next
```

## 5. Configure the Brevo webhook (3 min)

1. <https://app.brevo.com/transactional/webhooks> (or Settings → Webhooks)
2. Click "Add a new webhook" → "Transactional".
3. **URL**: `https://<your-worker>/webhooks/brevo?secret=<BREVO_WEBHOOK_SECRET>`
4. **Events**: select all of: sent, delivered, opened, clicked, hard_bounce,
   soft_bounce, spam, unsubscribed, blocked, deferred.
5. **Save**. Brevo will send a test event — Worker should return 200 OK.

Verify the webhook is firing:

```bash
wrangler tail <brand>-email-campaigns --format pretty
# Then send any test email and watch for the event POST.
```

## 6. Wire the frontend (8 min)

```bash
cp skills/email-campaigns/frontend/src/pages/admin/email/*.jsx       src/pages/admin/email/
cp skills/email-campaigns/frontend/src/services/EmailMarketingService.js src/services/
cp skills/email-campaigns/frontend/src/services/NewsletterService.js  src/services/
cp skills/email-campaigns/frontend/src/config/emailWorker.js          src/config/
cp skills/email-campaigns/frontend/src/components/NewsletterSignup.jsx src/components/

# i18n locales
cp skills/email-campaigns/frontend/src/i18n/locales/es/*.json src/i18n/locales/es/
cp skills/email-campaigns/frontend/src/i18n/locales/en/*.json src/i18n/locales/en/
```

Then:

1. **Set the Worker URL.** Edit `src/config/emailWorker.js` and replace
   the URL with your deployed Worker host.

2. **Add the 5 routes** to `src/App.jsx`. See `frontend/README.md` →
   "Wiring routes" for the exact snippet (lazy + ProtectedAdminRoute).

3. **Add the 6 i18n namespaces** to `src/i18n/index.js`. See
   `frontend/README.md` → "Wiring i18n" for the exact import+resources block.

4. **Add nav links** to your admin shell (`Navigation.jsx` or equivalent).
   See `frontend/README.md` → "Wiring Navigation".

5. **Verify deps** are installed. Required: `recharts`, `framer-motion`,
   `lucide-react`, `sonner`, `react-helmet`, plus the standard React +
   react-router + react-i18next + supabase-js you already have.

   ```bash
   npm install recharts framer-motion lucide-react sonner react-helmet
   ```

6. **Wire your auth wrapper.** The pages assume `<ProtectedAdminRoute>` —
   that's project-specific. Quick version:

   ```jsx
   // src/components/ProtectedAdminRoute.jsx
   import { useEffect, useState } from 'react';
   import { Navigate } from 'react-router-dom';
   import { supabase } from '@/lib/customSupabaseClient';

   export default function ProtectedAdminRoute({ children }) {
     const [state, setState] = useState('loading');
     useEffect(() => {
       (async () => {
         const { data: { user } } = await supabase.auth.getUser();
         if (!user) { setState('redirect'); return; }
         const { data } = await supabase.from('users')
           .select('role').eq('id', user.id).single();
         setState(data?.role === 'admin' ? 'ok' : 'redirect');
       })();
     }, []);
     if (state === 'loading') return null;
     if (state === 'redirect') return <Navigate to="/login" />;
     return children;
   }
   ```

## 7. Hook the Stripe webhook (varies)

This skill **doesn't ship the Stripe webhook itself** — too project-specific.
Whatever webhook you already have, add these two calls inside the
`payment_intent.succeeded` handler:

```ts
await fetch(`${SUPABASE_URL}/functions/v1/send-order-email`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ order_id: order.id, type: 'confirmation' }),
});
await fetch(`${SUPABASE_URL}/functions/v1/send-order-email`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ order_id: order.id, type: 'admin_new_order' }),
});
```

For refunds, fire `refund` to customer + `admin_refunded` to admin.

## 8. Replace content for your vertical (5 min)

The default install is **Kibay-themed** (wine / sparkling wine / winery /
Bahía de Ocoa). For any other vertical — real estate, hospitality, B2B
SaaS, retail — body copy needs to change. After this skill's refactor,
that's a **single config file plus two const blocks**, NOT a grep-and-replace
of dozens of files.

### The single source of truth

[`content-template.json`](./content-template.json) at the skill root holds
every brand-specific string the skill emits at runtime — wordmark, tagline,
address, socials, copyright, welcome-email bullets, order-email fallbacks,
unsubscribe page copy. Everything.

A complete non-wine reference is at
[`examples/real-estate/content-template.json`](./examples/real-estate/content-template.json)
with vertical-appropriate values:

- "New listings in your saved areas"
- "Open house weekend roundups"
- "Local market reports + pricing trends"
- "Off-market opportunities"
- "Offer received" instead of "Order confirmed"
- "Closing update" instead of "Tracking number"
- "Deposit returned" instead of "Refund processed"

### Three places to edit (per-install)

| #   | File                                                      | What                                                                                 |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `workers/email-campaigns/src/index.ts`                    | Top-of-file `BRAND` + `CONTENT` const blocks. Replace values from `content-template.json`. |
| 2   | `supabase/functions/send-order-email/index.ts`            | Top-of-file `BRAND_DEFAULTS` const. Same pattern.                                    |
| 3   | `supabase/migrations/03_email_templates_table.sql`        | Edit the 10 seed INSERTs OR apply as-is and edit live at `/admin/email/templates`.   |

Optional fourth: pass `successMessage` prop to `<NewsletterSignup>` from
your parent (or edit `frontend/src/i18n/locales/{es,en}/newsletter.json`
to set the default toast text — already brand-neutral after this refactor).

### Optional: env-var override for sender defaults

If you fork the frontend and want admin-composer defaults from build env
instead of touching JSX:

```
VITE_EMAIL_DEFAULT_FROM_NAME="Casa Caribe"
VITE_EMAIL_DEFAULT_FROM_EMAIL="hello@casacaribe.com"
```

Set these in your `.env` / Vercel / Netlify build config and
`EmailComposerPage.jsx` picks them up.

### After install: edit live, no redeploy

Once installed, **all order-email body copy is editable** at
`/admin/email/templates` — no SQL, no code changes, no redeploy needed.
The `BRAND_DEFAULTS` const in the Edge Function is only a fallback for
rows that don't exist yet. See step 10 below.

For a deeper walkthrough of the real-estate install specifically, see
[`examples/real-estate/README.md`](./examples/real-estate/README.md).

### Two acceptable patterns for the `BRAND` block in the Worker

- **Constants (the default in `worker/index.ts`)** — `BRAND.name`,
  `BRAND.domain`, etc. One file, fully readable. Recommended.
- **Env vars** — read `env.BRAND_NAME`, `env.BRAND_DOMAIN` from
  `wrangler.toml [vars]`. Useful if the same code runs for multiple brands
  (rare; cleaner to fork the Worker per brand).

## 9. Smoke test (3 min)

The verification path that exercises the whole stack:

```bash
# A. Worker health
curl https://<your-worker>/health
# Expect: ok

# B. Subscribe to the newsletter via the form on your site
# → Welcome email arrives at the address you used
# → Admin notice arrives at info@<brand>.com

# C. Inspect the row
psql $DATABASE_URL -c "SELECT email, status, subtype_tags FROM email_contacts ORDER BY created_at DESC LIMIT 3;"

# D. Click the unsubscribe link in the welcome email
# → confirmation page renders
# → email_contacts.status flips to 'unsubscribed'

# E. From the admin SPA, /admin/email/compose → write a 1-line test
# → "Send test" to your address → arrives within seconds
# → email_logs has a row with status='sent' and a Brevo message_id

# F. Open the test email in Gmail/Apple Mail
# → Watch wrangler tail; you should see a webhook POST with event='opened'
# → email_logs row patches to status='opened', opened_at filled in

# G. (If you have orders + a Stripe webhook) — complete a checkout
# → 'confirmation' email arrives at customer, 'admin_new_order' at admin
# → If order had reservation items, "Add to calendar" button works,
#   .ics downloads, opens in your calendar app
```

If all 7 work, you're done.

## 10. Edit transactional copy without a redeploy

This is the operator's payoff for migration #3. Once the system is live:

1. Log in to `/admin/email/templates`.
2. Pick a type (e.g. "abandoned_cart") and a language.
3. Edit subject / heading / intro / outro / labels.
4. Save. The next `send-order-email` invocation for that type+lang reads the
   new copy. No redeploy needed.

## Troubleshooting cheat sheet

| Symptom                                                | Cause                                                                    | Fix                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `/email/send` returns 403 forbidden                    | The signed-in user's email doesn't match `REVIEW_EMAIL_TO`               | Push `REVIEW_EMAIL_TO` as a var in `wrangler.toml`, redeploy                          |
| Welcome email sends but admin notice doesn't           | Brevo sender not verified                                                | Verify the `REVIEW_EMAIL_FROM` address at app.brevo.com/senders/list                  |
| Webhook events arrive but `email_logs` row not updated | message_id mismatch                                                      | Check Brevo dashboard log → match the `messageId` field; tail Worker for warning      |
| Calendar `.ics` button gives "invalid signature"       | `EMAIL_LINK_SECRET` differs between Worker and Edge Function             | Push the same value to both                                                            |
| Migrations fail on `is_admin()` reference              | No `public.users(role)` table in your project                            | Create the table OR rewrite the `is_admin()` function body — see `database/README.md` |
| Newsletter form INSERT fails with RLS error            | `newsletter_subscribers` table doesn't allow anon INSERT                 | Add the RLS policy shown in `database/README.md`                                       |
| Brevo returns 401 from Worker                          | API key invalid or revoked                                               | Regenerate at app.brevo.com/settings/keys/api → `wrangler secret put BREVO_API_KEY`   |
| Composer "Send test" fires but log row is `failed`     | Sender not verified at Brevo                                             | Same fix as the welcome-email-no-admin case                                            |
| Unsubscribe link works but Brevo still emails them     | Brevo blocklist sync is best-effort; check `wrangler tail` for errors    | Brevo dashboard → Contacts → search the address → manually blocklist                  |

## Files modified vs files created

This skill **never modifies** files in your project. Everything is copy-in:

- Migrations are NEW files in `supabase/migrations/`.
- The Edge Function is a NEW folder under `supabase/functions/`.
- The Worker is a NEW folder under `workers/`.
- Admin pages, services, config, and i18n are NEW files under `src/`.
- `src/App.jsx`, `src/i18n/index.js`, `Navigation.jsx` are the only **edits**
  you make — adding routes / namespaces / nav links — and the snippets are
  in `frontend/README.md`.
When you're ready to install on the real estate site: clone the skill folder, replace those 3 const blocks with the real estate config, apply migrations, deploy worker + Edge Function, wire frontend. Should be ~30 minutes of mechanical work.