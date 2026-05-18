# aho-inbound-email

AHO inbound-email **Cloudflare Email Worker**. Phase 3 of
`docs/AI_AGENT_PLAN.md`. Parses incoming buyer email, verifies
DKIM / SPF / DMARC, routes by local-part (agent slug or HMAC-signed
`leads+<token>` opaque address), and forwards a parsed payload to
`/api/inbound/email` on the AHO Pages app.

## Architecture

```
Buyer                                 Cloudflare Email Routing
  │                                            │
  │  send email to                             ▼
  │  agent-slug@reply.advertisehomes.online    Email Worker (this)
  │  leads+abc@reply.advertisehomes.online     │
  │                                            │  postal-mime parse +
  └────────────────────────────────────────────│  DKIM/SPF/DMARC verify +
                                               │  local-part routing
                                               │
                                               │  POST /api/inbound/email
                                               ▼  Bearer ${INBOUND_SECRET}
                                       AHO Pages app
                                       (DB writes; async AI draft handoff)
```

## PO action — wiring this up (post-deploy)

The DNS + Cloudflare Email Routing config below is **PO-side**.
The Worker code in this directory deploys without it; the Worker
just sits idle until the catch-all rule is in place.

### 1. Deploy the Worker

```bash
cd workers/inbound-email
npm install
wrangler deploy
```

### 2. DNS — point `reply.advertisehomes.online` at Cloudflare Email

In Cloudflare DNS for `advertisehomes.online`, add:

| Type | Name | Content | TTL |
|------|------|---------|-----|
| MX   | `reply` | `route1.mx.cloudflare.net` | priority 10, auto |
| MX   | `reply` | `route2.mx.cloudflare.net` | priority 20, auto |
| MX   | `reply` | `route3.mx.cloudflare.net` | priority 30, auto |
| TXT  | `reply` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | auto |
| TXT  | `_dmarc.reply` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@advertisehomes.online` | auto |

DKIM is auto-managed by Cloudflare Email Routing once the zone is
onboarded.

### 3. Enable Email Routing on `reply.advertisehomes.online`

Cloudflare Dashboard → the AHO zone → **Email** → **Email Routing**
→ **Enable**. Then under **Custom address rules** add a **catch-all**:

- Matcher: `Catch-all` for `reply.advertisehomes.online`
- Action: **Send to a Worker** → `aho-inbound-email`

### 4. Set the Worker secrets

```bash
cd workers/inbound-email
wrangler secret put INBOUND_SECRET       # match the AHO Pages INBOUND_EMAIL_SECRET
wrangler secret put AHO_API_BASE         # https://advertisehomes.online
wrangler secret put LEADS_TOKEN_SECRET   # match the AHO Pages AHO_LEADS_TOKEN_SECRET
```

Also set the matching server env vars on the AHO Pages project
(`Settings → Environment variables → Production`):

- `INBOUND_EMAIL_SECRET` — same value as the Worker's `INBOUND_SECRET`.
- `AHO_LEADS_TOKEN_SECRET` — same value as the Worker's `LEADS_TOKEN_SECRET`.

### 5. Smoke test

From a personal inbox, send an email to:

```
leads+test@reply.advertisehomes.online
```

Expected:
1. The Worker logs `[aho-inbound-email] ok` (visible in
   `wrangler tail`) — though for an invalid token it will log
   `[aho-inbound-email] unknown_local_part drop`. To get an `ok`
   you need a real token issued by
   `encodeLeadsToken()` in `src/lib/email/inbound-routing.ts`.
2. A new row appears in `ai_conversations` + `email_threads` +
   `email_messages` + `ai_conversation_messages` on Supabase.

To test the slug route, send to a real agent slug, e.g.:

```
maria-lopez@reply.advertisehomes.online
```

(That agent must exist in `profiles.slug` for the AHO route to
resolve it; otherwise the Pages route will 404 the routing and the
Worker logs `[aho-inbound-email] api_non_2xx`.)

## Local development

The Worker can't be triggered locally by a real email — Cloudflare's
Email Routing requires the live deployment. For unit-level testing
of the routing decoder, use the AHO Pages test suite
(`tests/unit/inbound-email-routing.test.ts`) which exercises the
canonical implementation at `src/lib/email/inbound-routing.ts`.

For end-to-end smoke after a Worker code change:

```bash
wrangler deploy
wrangler tail            # in one terminal
# send a test email from a real inbox; watch the tail
```

## Why a standalone Worker, not Pages Functions

Cloudflare Pages Functions don't surface the `email()` handler — only
the Worker runtime accepts `ForwardableEmailMessage`. The split is
the same as `workers/audit-prune/` — minimal trust-boundary parser
in the Worker, all DB / orchestration work in a Pages route.
