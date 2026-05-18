# aho-whatsapp-webhook

Phase 4 of `docs/AI_AGENT_PLAN.md` (PO-accepted 2026-05-18).

The public HTTPS endpoint that 360dialog (D3=A) — or Twilio for
WhatsApp (R5 documented fallback) — calls with inbound WhatsApp
messages and outbound delivery callbacks. This Worker is the trust
boundary for Meta's `X-Hub-Signature-256` HMAC; it forwards verified
payloads to the AHO Pages app via a separate shared-secret bearer.

## Layout

```
workers/whatsapp-webhook/
├── package.json
├── tsconfig.json
├── wrangler.toml
├── README.md
└── src/
    └── index.ts          # GET verify-handshake + POST signed webhook
```

Mirrors the proxy pattern in `workers/audit-prune/`.

## Behavior

### `GET /` — Meta verification handshake

When 360dialog / Meta first registers the webhook URL it does a
`GET` with `hub.mode=subscribe`, `hub.verify_token=<shared>`, and
`hub.challenge=<random>`. We echo `hub.challenge` back if the token
matches `WHATSAPP_WEBHOOK_SECRET`. Required once per environment.

### `POST /` — Signed webhook from 360dialog / Meta

1. Read the raw request body before parsing JSON (signature is over
   the exact bytes Meta sent).
2. Verify `X-Hub-Signature-256: sha256=<hex>` against
   `HMAC-SHA256(rawBody, WHATSAPP_WEBHOOK_SECRET)`. Mismatch → log +
   200 (we don't 401 to avoid Meta's 7-day retry storm).
3. Parse the Meta webhook payload shape
   (`object` / `entry[].changes[].value.{messages,statuses}`).
4. For each inbound message: `POST` to
   `${AHO_API_BASE}/api/inbound/whatsapp` with the buyer phone
   (E.164), the parsed Meta message envelope, the WABA id, and the
   Meta `phone_number_id` (the Pages route resolves that to a
   `whatsapp_numbers.wa_number_id`).
5. For each status callback: `POST` to
   `${AHO_API_BASE}/api/inbound/whatsapp/status` with the
   `wa_message_id` + new status + any error code.
6. Both forwards carry `Authorization: Bearer ${INBOUND_SECRET}`
   so the Pages app can authenticate the Worker without user
   sessions.
7. Always return `200`. Meta retries aggressively (every 30s for
   up to 7 days) on non-2xx — failure mode is "log + drop", not
   "fail loud and create a retry storm".

The `phone_number_id` → `wa_number_id` DB lookup happens INSIDE the
Pages app — this Worker stays stateless so we don't duplicate
Supabase wiring across the trust boundary.

## Per-environment setup (PO-side gating items)

The code is ready. Going live requires:

1. **360dialog account.** PO-side. After account approval, do their
   Embedded Signup (Meta-hosted; <5 min/agent) OR use Meta Cloud
   API direct if the PO decides 360dialog onboarding will slip
   (R5 in `docs/RISKS.md`).
2. **Meta Business Verification.** PO-side. AHO already has a Meta
   App for the social-distribution flow (Phase-2 deliverable);
   WABA-number certification piggybacks on that App.
3. **WABA-number certification** for the first agent's phone line.
   PO-side; happens inside 360dialog's flow.
4. **Configure 360dialog webhook** → this Worker's deployed URL.
   `wrangler deploy` outputs a `*.workers.dev` URL for each
   environment; production uses the custom subdomain (TBD).
5. **Set Worker secrets** (per environment via `wrangler secret put`):
   - `WHATSAPP_WEBHOOK_SECRET` — shared with 360dialog at webhook
     registration time. Used for both the `GET` verify-token AND
     the `X-Hub-Signature-256` HMAC. The 360dialog dashboard
     calls this the "App Secret" or "Webhook Secret".
   - `INBOUND_SECRET` — shared with the AHO Pages app. Bearer
     token on every forwarded `POST` to
     `/api/inbound/whatsapp(/status)`. Generate a fresh
     cryptographically random value per environment.
   - `AHO_API_BASE` — set as a `[vars]` default
     (`https://advertisehomes.online`) but overridable per env.
6. **Submit the 7-language utility template pack to Meta for
   approval.** See `src/lib/whatsapp/templates/index.ts` for the v1
   `viewing_reminder` template across en / es / pl / pt / de / fr /
   it. Approval is async (15 min – 48 h per Meta docs); status
   tracked in `public.whatsapp_templates.approval_status`.

## Smoke test

After deploying and registering the webhook with 360dialog:

1. From your phone, open the listing page on
   `https://advertisehomes.online/properties/<slug>` and tap the
   WhatsApp button (or directly `https://wa.me/<phone>?text=Test`).
2. Send a message.
3. `wrangler tail aho-whatsapp-webhook` should show:
   - the signed `POST` arriving
   - successful signature verification (no `signature mismatch` log)
   - a successful forward to `/api/inbound/whatsapp` (no `non-2xx` log)
4. Supabase should now have:
   - a `leads` row with `source='whatsapp_click'` and your buyer phone
   - an `ai_conversations` row with `channel='whatsapp'`
   - an `ai_conversation_messages` row with `role='user'` carrying your text
   - a `whatsapp_messages` row with `direction='inbound'`,
     `in_service_window=true`

If any of those four rows are missing, the inbound forward failed —
check the Pages-app logs at `wrangler pages deployment tail` and
read the `[whatsapp inbound]` lines.
