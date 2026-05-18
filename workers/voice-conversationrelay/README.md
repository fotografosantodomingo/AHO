# aho-voice-conversationrelay

Cloudflare Worker that terminates the Twilio ConversationRelay WebSocket for the AHO AI customer-service voice channel. Phase 5 of `docs/AI_AGENT_PLAN.md` (§4d).

This Worker is the entry-point for inbound voice calls to the AI assistant. Twilio terminates the PSTN call, handles STT and TTS internally, and proxies the transcribed conversation over a WebSocket to this Worker. The Worker bridges into the shared Claude orchestrator (`src/lib/ai/converse.ts`), persists each turn to the shared `ai_conversations` thread, and emits text replies back to Twilio for TTS playback.

## Status

**v1 scaffold — NOT YET LIVE.** Twilio account, phone-number purchase, and ConversationRelay onboarding are PO-side actions (see "PO-side gating steps" below). The Worker code is wired so that the moment those land, integration is a config flip:

1. Set the 5 secrets listed below.
2. Deploy this Worker (`pnpm deploy` in this directory).
3. Point the Twilio number's "When a call comes in" URL at the Pages app's `/api/voice/twiml` route.

The `converse()` bridge into `src/lib/ai/converse.ts` is currently a TODO comment in `src/index.ts:handlePrompt()`. The Worker echoes back a canned acknowledgement so local testing without the Pages route doesn't dead-end. Full bridge wiring lands in the slice that adds `/api/ai-chat-internal/voice` to the Pages app.

## Architecture

```
   Caller (PSTN)
       │
       │  inbound call to agent's AHO number
       ▼
┌─────────────────┐
│  Twilio Voice   │ ── fetches TwiML from /api/voice/twiml
│  (handles SIP,  │
│   STT, TTS)     │ ── upgrades to WS via <Connect><ConversationRelay/>
└─────────────────┘
       │
       │  WebSocket: setup → prompt → prompt → ... → end
       ▼
┌──────────────────────────────────────────────┐
│  aho-voice-conversationrelay (this Worker)   │
│  • parses Twilio events                      │
│  • looks up agent_phone_numbers              │
│  • inserts voice_calls + ai_conversations    │
│  • emits text replies (Twilio synthesizes)   │
└──────────────────────────────────────────────┘
       │
       │  HTTPS POST (INBOUND_SECRET bearer)
       ▼
┌──────────────────────────────────────────────┐
│  Pages app: /api/ai-chat-internal/voice      │
│  • runs converse() — Claude + tools          │
│  • returns assistant text + escalate hint    │
└──────────────────────────────────────────────┘
```

## Secrets

Set per-environment via `wrangler secret put <NAME>`:

| Secret | Source | Purpose |
|---|---|---|
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account → API keys & tokens | Verifies the `X-Twilio-Signature` on WebSocket upgrade requests so a third party can't open a WS to us pretending to be Twilio |
| `INBOUND_SECRET` | Generate (`openssl rand -hex 32`); also set on the Pages env | Shared secret on the `/api/ai-chat-internal/voice` bridge call. Same shape as `workers/inbound-email/` |
| `AHO_PAGES_URL` | Hardcoded per env | `https://advertisehomes.online` for prod; the `*.aho-web.pages.dev` preview URL for staging |
| `SUPABASE_URL` | Supabase project settings | Direct DB writes during the call. Worker doesn't bundle supabase-js (raw REST calls) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → API → service_role | Service-role bypass for the per-call writes. Scoped to the agent's `org_id` at every query per `AI_AGENT_PLAN` §5.5 |

`AHO_VOICE_BRIDGE_PATH` is a non-secret var; defaults to `/api/ai-chat-internal/voice` in `wrangler.toml`.

## PO-side gating steps

These are NOT my responsibility — they are PO actions on third-party consoles. The Worker doesn't go live until all four land.

### 1. Twilio account

- Sign up at https://www.twilio.com/try-twilio
- Note the Account SID + Auth Token from the console root
- Buy a phone number: Phone Numbers → Buy a number. Filter by capability `Voice`. Local numbers run $1.15/mo in the US; per-market pricing varies (see `AI_AGENT_PLAN` §8)
- Assign the number to the agent: insert a row into `agent_phone_numbers` with `status='active'`, the agent's `agent_id` + `org_id`, the E.164 `phone_e164`, and Twilio's `PNxxx` SID

### 2. ConversationRelay onboarding

Twilio's ConversationRelay is opt-in per account. Request access via the [ConversationRelay docs](https://www.twilio.com/docs/voice/conversationrelay) → "Get access" form. Approval is typically <48h. Without this, the `<ConversationRelay>` TwiML element returns a 400.

### 3. Configure the number's voice URL

In the Twilio Console:
- Phone Numbers → Manage → Active numbers → click the number
- Voice & Fax → "A call comes in" → Webhook → set to `https://advertisehomes.online/api/voice/twiml`
- HTTP method: `GET`
- "Primary handler fails" → optional voicemail fallback URL (v2)
- Save

The `/api/voice/twiml` route (in `src/app/api/voice/twiml/route.ts`) returns the TwiML that opens the WebSocket against this Worker. The dialed number is encoded in the query string so the Worker can match the right `agent_phone_numbers` row.

### 4. Worker secrets

Set the 5 secrets above via `wrangler secret put` in this directory, then deploy:

```bash
cd workers/voice-conversationrelay
pnpm install
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put INBOUND_SECRET
wrangler secret put AHO_PAGES_URL
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
pnpm deploy
```

Wrangler will print the Worker URL (typically `https://aho-voice-conversationrelay.<account>.workers.dev`). That URL becomes the `wss://...` target in the TwiML returned by `/api/voice/twiml` — already wired in code; no manual step needed.

### 5. Test with a real call

Dial the configured Twilio number from any phone. Expected behavior:

- **First second:** Twilio answers, opens WebSocket to this Worker
- **Within 2 seconds:** AI greets: "Hi, this is the AHO AI assistant. How can I help you today?"
- **You speak:** Twilio transcribes; Worker logs the transcript to `wrangler tail`
- **AI responds:** v1 = canned acknowledgement; v2 = real Claude reply via the converse() bridge
- **You hang up:** `voice_calls.duration_seconds` populated; `ai_conversations.status='open'`

To watch live:
```bash
cd workers/voice-conversationrelay
pnpm tail
```

## Local development

```bash
pnpm install
pnpm dev   # starts wrangler dev on ws://localhost:8787
```

You can poke the WebSocket directly with `wscat`:

```bash
wscat -c ws://localhost:8787
> {"type":"setup","callSid":"CA_test","from":"+15551234567","to":"+15559999999"}
> {"type":"prompt","voicePrompt":"Hi I want to ask about the villa"}
> {"type":"end"}
```

The Worker will print the transcript via `console.error` (visible in `wrangler tail`; `console.log` is unreliable per `CLAUDE.md`).

## Cost model

Per-agent variable cost at 30 min/month baseline (per `AI_AGENT_PLAN` §8):

| Component | Cost |
|---|---|
| US local number (fixed) | $1.15/mo |
| Twilio talk: 30 min × $0.014 | $0.42 |
| Inference + STT + TTS: 30 min × $0.13 | $3.90 |
| **Total** | **~$5.50/agent/month** |

Computed per-call by `src/lib/voice/pricing.ts:estimateVoiceCostCents()`. Bundled into the Super Pro tier; overage at $0.20/min.

## What's deferred to v2

- Real `converse()` bridge — currently a TODO in `handlePrompt()`
- Twilio signature verification on the WebSocket upgrade (TODO in `fetch()`)
- Recording upload to R2 (column reserved in `voice_calls.recording_r2_key`; no upload pipeline yet)
- Per-turn cost attribution to `ai_generation_log`
- Warm-transfer Conference orchestration (lib/voice/warm-transfer.ts ships the TwiML builder; this Worker emits the `transfer-to-agent` hint but doesn't dial the conference yet)
- Locale-aware greeting (currently English-only; `lib/voice/voice-prompts.ts` ships the multi-locale builder)

## Related files

- `src/db/migrations/0070_voice_integration.sql` — schema for `agent_phone_numbers` + `voice_calls`
- `src/app/api/voice/twiml/route.ts` — TwiML endpoint Twilio fetches per call
- `src/lib/voice/pricing.ts` — per-call cost computation
- `src/lib/voice/voice-prompts.ts` — locale-aware greeting builder
- `src/lib/voice/warm-transfer.ts` — TwiML for the Conference-based warm transfer
- `src/lib/ai/converse.ts` — the Claude orchestrator the bridge will call into
- `docs/AI_AGENT_PLAN.md` §4d — full design rationale
