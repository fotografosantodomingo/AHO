# Worker — Cloudflare Worker routes for email-campaigns

This folder ships the Worker layer of the skill. Two ways to install:

| Mode          | Files                                          | When to use                                              |
| ------------- | ---------------------------------------------- | -------------------------------------------------------- |
| **Greenfield** | `index.ts` + `email.ts` + `wrangler-template.toml` | New project, no existing Worker.                       |
| **Bolt-on**   | `email.ts` + `routes-snippet.md`               | You already have a Worker (e.g. for a different feature). |

## Routes shipped

| Method + path                | Auth                       | Purpose                                                 |
| ---------------------------- | -------------------------- | ------------------------------------------------------- |
| `POST /email/send`           | Supabase JWT (admin only)  | Send campaign / inline / test from the admin SPA        |
| `GET  /unsubscribe?email=&sig=` | HMAC signature          | Recipient self-suppression — sets contact + Brevo blocklist |
| `POST /webhooks/brevo?secret=` | URL secret              | Ingest Brevo events → patch `email_logs`                |
| `POST /newsletter/welcome`   | None — body must be a real subscriber | Fires welcome email + admin notice after signup |
| `GET  /calendar/order/:id.ics?sig=` | HMAC signature       | Reservation .ics download (used by send-order-email "Add to calendar" button) |
| `GET  /health`               | None                       | Liveness                                                |

## Greenfield install

```bash
mkdir -p workers/email-campaigns/src
cp skills/email-campaigns/worker/index.ts workers/email-campaigns/src/
cp skills/email-campaigns/worker/email.ts workers/email-campaigns/src/
cp skills/email-campaigns/worker/wrangler-template.toml workers/email-campaigns/wrangler.toml

cd workers/email-campaigns
# Edit wrangler.toml — replace <brand>, project-ref, etc.
# Edit src/index.ts — set the BRAND constant block (top of file).

wrangler login                            # one-time per machine
wrangler deploy
```

Then push secrets:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY     # from Supabase → Settings → API
wrangler secret put BREVO_API_KEY                 # from app.brevo.com/settings/keys/api
wrangler secret put EMAIL_LINK_SECRET             # openssl rand -base64 32
wrangler secret put BREVO_WEBHOOK_SECRET          # any random string; goes in Brevo dashboard URL
```

## Bolt-on install

See `routes-snippet.md`. The short version:

1. Copy `email.ts` into your Worker's `src/`.
2. Add the route blocks to your existing `index.ts` (snippet shows where).
3. Make sure your `Env` interface extends `EmailEnv` from `email.ts`.
4. Push the same secrets as above.

## Brand-genericization

The default greenfield `index.ts` has a `BRAND` object near the top:

```ts
const BRAND = {
  name: 'Kibay',
  domain: 'kibay.com.do',
  siteUrl: 'https://kibay.com.do',
  // ...
};
```

Replace the values. Two acceptable patterns:

- **Constants (chosen here)** — readable, brand never leaks into env, one
  place to change. Used in welcome email, admin notice, .ics output, footer.
- **Env vars** — push `BRAND_NAME`, `BRAND_DOMAIN`, etc as Worker vars and
  read `env.BRAND_NAME` instead. Useful if one Worker codebase serves multiple
  brands (rare; the worker is small enough to fork).

If you switch to env-var lookup, replace `BRAND.x` references in `index.ts`
with `env.BRAND_X` and add the vars block in `wrangler.toml`. `email.ts`
itself still has a few `Kibay` mentions inside `unsubscribeResultPage` and
`sendReviewEmail`/`sendResultsEmail` — those last two aren't used by this
skill (they're from the content-automation skill) but they're left in
because `verifyCalendarToken` lives in the same file and the import surface
stays predictable.

## Verifying

```bash
curl https://<your-worker>/health
# → ok

# Unsubscribe link with a bad signature should render the error page
open "https://<your-worker>/unsubscribe?email=test@example.com&sig=bad"

# Brevo webhook should refuse without secret
curl -X POST https://<your-worker>/webhooks/brevo -d '[]'
# → 401 unauthorized

# Send endpoint should refuse without JWT
curl -X POST https://<your-worker>/email/send -d '{}'
# → 401 missing auth
```

End-to-end smoke test is in `../replication-guide.md` step 9.
