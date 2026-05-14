# Bolt-on routes snippet — patch existing Worker `index.ts`

Use this when you already have a deployed Worker (e.g. `<brand>-drive-pipeline`)
and want to add the email-campaigns routes to it instead of standing up a
second Worker. This is how Kibay actually runs in production: the same Worker
hosts the drive→blog pipeline AND the email-campaigns routes.

## What you need

1. Copy `worker/email.ts` to your existing Worker (e.g. `src/email.ts`).
2. Add the routes + helper functions below to your existing `src/index.ts`.
3. Push the new secrets (`BREVO_API_KEY`, `EMAIL_LINK_SECRET`,
   `BREVO_WEBHOOK_SECRET`) via `wrangler secret put`.
4. Make sure your `Env` interface extends `EmailEnv` (see below).

---

## 1. Imports — add to the top of `index.ts`

```ts
import {
  sendBrevoEmail,
  signUnsubscribeUrl,
  verifyUnsubscribeToken,
  unsubscribeResultPage,
  verifyCalendarToken,
  escapeHtml,
  EmailEnv,
} from './email';
```

If your existing `Env` interface didn't already extend `EmailEnv`, do that:

```ts
interface Env extends SupabaseEnv, EmailEnv /* , your other Envs */ {
  BREVO_WEBHOOK_SECRET?: string;
}
```

`EmailEnv` (defined in `email.ts`) requires:
`BREVO_API_KEY`, `REVIEW_EMAIL_TO`, `REVIEW_EMAIL_FROM`, `EMAIL_LINK_SECRET`,
`SITE_URL`, `WORKER_BASE_URL`.

## 2. CORS (if you don't have it already)

```ts
const ALLOWED_ORIGINS = new Set([
  'https://<brand>.com',
  'https://www.<brand>.com',
  'http://localhost:5173',
  'http://localhost:4173',
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function withCors(res: Response, req: Request): Response {
  const ch = corsHeaders(req);
  if (!Object.keys(ch).length) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(ch)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
```

## 3. Route blocks — drop into the existing `fetch()` handler

Put **before** the final `return new Response('not found', { status: 404 })`.

```ts
// CORS preflight for browser-called email endpoints.
if (req.method === 'OPTIONS' && url.pathname.startsWith('/email/')) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

// GET /calendar/order/:id.ics?sig=<hmac>
{
  const m = url.pathname.match(/^\/calendar\/order\/([0-9a-f-]+)\.ics$/i);
  if (m && req.method === 'GET') {
    return handleCalendarIcs(env, m[1], url.searchParams.get('sig') || '');
  }
}

if (url.pathname === '/newsletter/welcome' && req.method === 'POST') {
  // ...full handler body — copy from worker/index.ts lines ~111–161
}

if (url.pathname === '/email/send' && req.method === 'POST') {
  const auth = await verifyAdminAuth(env, req);
  if (!auth.ok) return withCors(new Response(auth.body, { status: auth.status }), req);
  try {
    return withCors(await handleEmailSend(env, req, auth.email), req);
  } catch (e) {
    console.error('/email/send error:', e);
    return withCors(jsonResp({ ok: false, error: (e as Error).message }, 500), req);
  }
}

if (url.pathname === '/unsubscribe' && req.method === 'GET') {
  // ...full handler body — copy from worker/index.ts lines ~178–211
}

if (url.pathname === '/webhooks/brevo' && req.method === 'POST') {
  // ...full handler body — copy from worker/index.ts lines ~213–238
}
```

## 4. Helpers — append to the bottom of `index.ts`

Copy these blocks verbatim from `worker/index.ts`:

| Section                                          | Approx lines in `worker/index.ts` |
| ------------------------------------------------ | --------------------------------- |
| `verifyAdminAuth`                                | 248–267                           |
| `handleEmailSend` + supporting interfaces        | 273–423                           |
| `injectUnsubscribeFooter`                        | 425–445                           |
| `emailHeaders`, `loadCampaign`, `patchCampaign`, | 449–530                           |
| `loadContactsByEmails`, `loadContactsBySegment`, |                                   |
| `insertEmailLog`, `patchContactStatusByEmail`    |                                   |
| `handleBrevoEvent` + `BrevoEvent`                | 535–636                           |
| `handleCalendarIcs` + ICS helpers                | 640–793                           |
| `renderWelcomeEmail`, `renderNewsletterAdminNotice` | 797–874                        |
| `BRAND` constants block                          | 30–53 (paste near top instead)    |

## 5. Brand constants

Paste the `BRAND` object from `worker/index.ts` lines 30–53 near the top of
your existing `index.ts`, **before** the routes. Replace every field with your
brand's values. All references to `Kibay` / `kibay.com.do` in the welcome
template, admin notice, and ICS file flow from there.

## 6. Deploy

```bash
wrangler secret put BREVO_API_KEY
wrangler secret put EMAIL_LINK_SECRET
wrangler secret put BREVO_WEBHOOK_SECRET
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY likely already pushed by your existing worker

wrangler deploy
```

## 7. Smoke test

```bash
curl https://<your-worker>/health        # → "ok"
curl "https://<your-worker>/unsubscribe?email=test@example.com&sig=bogus"  # → invalid signature page
```

For a full send test, see `replication-guide.md` step 9.

---

## Why two installation modes?

The original Kibay `workers/drive-pipeline/src/index.ts` is 1,647 lines and
mixes Drive ingestion, Claude generation, FB/IG/LinkedIn cross-posting,
LinkedIn OAuth, AND email campaigns. Anyone forking *just* the email feature
should use the **greenfield** mode (`worker/index.ts` + `wrangler-template.toml`)
and get a clean 800-line standalone Worker. Anyone who already owns a Worker
and wants to add email routes to it should use the **bolt-on** path above.
