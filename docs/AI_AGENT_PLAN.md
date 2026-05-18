# AI Customer-Service Agent — Plan for Review

> **Status:** DRAFT awaiting PO acceptance. Authored 2026-05-18 by Claude after parallel research across 4 agents (voice stack, WhatsApp Business Platform, inbound email architecture, AHO codebase audit).
>
> **Acceptance ritual:** read this end-to-end → answer the 9 decisions in §2 (one line each, like `D1=A, D2=B`) → I update STATUS.md + start Phase 1. No code lands until the decisions are in.

---

## 1. Executive summary

### The wedge

Every real-estate agent has the same after-hours problem: leads come in 24/7 (web chat, email, WhatsApp, missed calls), and the agent loses 60-80% of them by being asleep / driving / showing another property. Existing CRM-bolted AI tools (Ylopo rAIya, Lofty Virtual ISA, Structurely) assume the agent already pays $300-700/mo for a CRM and bolt onto it. **AHO's wedge is that we ARE the platform** — the AI agent has first-party RLS-protected access to listings, agent profiles, saved searches, market comps, and review history without an integration layer. That structural advantage compounds: every listing edit, every new review, every market metric we already compute is automatically available to the agent's AI without an ETL.

### The 4 channels

We ship **one AI persona per agent** that answers across 4 channels with shared memory, shared knowledge, shared compliance, shared audit:

| Channel | First mover | Bottleneck | v1 latency target |
|---|---|---|---|
| **Web chat** | Anonymous buyer on `/properties/[slug]` or `/agents/[slug]` | Replaces Tawk; needs lead capture | <2 s response |
| **Email** | Buyer emails the listing's reply-to address | Threading; inbound parsing; spam | First reply <60 s |
| **WhatsApp** | Buyer taps `wa.me` on a listing | Per-agent phone number; Meta opt-in window | <30 s in service window |
| **Voice call** | Buyer calls the agent's published phone (or AHO routes via missed-call) | Real-time STT/LLM/TTS orchestration | <725 ms p95 |

All four feed one shared `ai_conversations` thread per (lead, listing, agent) tuple so the AI sees that "this buyer asked about price on chat at 14:02, then asked the same on WhatsApp at 14:11" and responds coherently.

### The tier model (proposed; D5 below confirms)

| Tier | Web chat | Email AI | WhatsApp AI | Voice AI | Notes |
|---|---|---|---|---|---|
| **Free / Agent** | ✗ | ✗ | ✗ | ✗ | Tawk widget stays for human-only chat |
| **Pro Automation ($99/mo)** | ✓ HITL | ✓ HITL | per-conv add-on | per-min add-on | Auto-publishes social today; gains AI inbox tomorrow |
| **Super Pro ($199-299/mo, TBD)** | ✓ auto | ✓ auto | ✓ included | ✓ included | Full agent replacement; soft cap by usage |
| **Agency / Expert** | ✓ + per-seat | ✓ + per-seat | ✓ + agency dashboard | ✓ + agency dashboard | Cross-seat routing, supervisor review |

"HITL" = human-in-the-loop (AI drafts, agent approves before send). "Auto" = AI sends directly when confidence + intent + risk-flags all pass.

### The timeline

5 phases, each independently shippable. End-to-end from `D1 = approve` to all 4 channels live = **~10 weeks**. Web chat alone (Phase 1+2) ships in **~3 weeks** and replaces Tawk. Email lands at week 5. WhatsApp at week 7. Voice at week 10. Detailed phasing in §7.

### The cost story

At low usage (the long tail), variable cost per active agent is **~$0.20-$1.50/month for inference + ~$5/month for phone/WhatsApp infra when those channels are enabled**. We pass Meta and Twilio channel costs through (per-conversation cap + overage); we absorb the inference cost inside the subscription. Math in §8.

---

## 2. PO decisions needed before code starts

Answer in chat as `D1=A, D2=B, …`. Defaults shown so you can punt items you don't want to think about — `D1=default` works.

### D1 — Scope of v1
- **A.** Chat-only (Phase 1+2; ships in 3 weeks; replaces Tawk; minimum viable to validate the wedge) **(default; recommended)**
- **B.** Chat + email (Phase 1-4; ships in 5 weeks; covers ~70% of after-hours volume)
- **C.** All four channels (Phase 1-5; ships in 10 weeks; complete agent replacement)

Why default A: we get the user-research signal faster, the schema for conversation/knowledge is the same shape for all 4 channels, and email/WhatsApp/voice can be added one at a time once the foundation is real.

### D2 — Auto-send policy on email + WhatsApp
- **A.** Always human-in-the-loop (AI drafts, agent taps "Send"; safer for v1) **(default)**
- **B.** Confidence-gated auto-send (>0.85 confidence + safe intent + no risk flags); HITL otherwise **(recommended after 4-week soft-launch)**
- **C.** Full auto (only escalates on explicit risk flag); fastest agent UX, highest liability

Why default A: real-estate liability around price/financing/discrimination is real and varies by market. Start safe; relax after the soft-launch tells us the AI's drift rate.

### D3 — WhatsApp BSP
- **A.** 360dialog (zero markup on Meta rates, €49/mo per number, EU-friendly account managers) **(default; recommended)**
- **B.** Twilio for WhatsApp (+$0.005/msg flat markup, but unified with our voice stack)
- **C.** Meta Cloud API direct (cheapest at scale, but we own a Meta App Review cycle per market — slice-5 problem)

Why default A: cleanest cost math for our 3 most expensive launch markets (DE €0.12, FR €0.095, IT €0.057 marketing-message rates). Twilio remains the documented fallback if 360dialog onboarding slips.

### D4 — WhatsApp WABA model
- **A.** Shared AHO WABA with per-agent verified numbers (1 Meta approval covers all agents; raisable from 25 to thousands of numbers) **(default; recommended; only practical option at scale)**
- **B.** Per-agent WABA (each agent owns their Meta business, 1000 separate approvals; impossible at onboarding speed)

Why default A: the only multi-tenant pattern that scales. Each agent's display name ("Maria Lopez — AHO") is verified per-number; the buyer sees the agent, not AHO. Embedded Signup gets the agent through in <5 min.

### D5 — Tier mapping
- **A.** AI inbox bundled into Pro Automation ($99/mo gets chat+email; WhatsApp+voice are add-ons) **(default)**
- **B.** AI inbox is a new "Super Pro" tier at $199-249/mo (decoupled from social automation)
- **C.** Standalone AI-Agent product at $49/mo on top of any tier

Why default A: we already have the Pro Automation surface, the Stripe products, and the gating helper. Adding "AI inbox" to the Pro feature set is the lowest-friction monetization. Sliding to B becomes attractive once we know the AI inbox alone justifies a higher price.

### D6 — Voice stack
- **A.** Twilio Programmable Voice + ConversationRelay + Claude Sonnet 4.5 + Deepgram Nova-3 + ElevenLabs Flash v2.5 (built directly on our existing CF Worker layer; ~$0.13/min talk; <725 ms p95) **(default; recommended)**
- **B.** Vapi or Retell AI (managed; ~$0.13-0.33/min; +$0.05-0.08/min orchestration tax; faster to ship by ~1 week)
- **C.** OpenAI Realtime API via Twilio (~200 ms latency floor but locks us off Claude; ~$0.32-0.45/min)

Why default A: we already have the Worker layer + Anthropic posture; the 1-week build savings on B doesn't pay for the $0.05-0.08/min margin tax over a 24-month horizon at 1000+ agents. C trades our Claude posture for latency we don't actually need.

### D7 — Inbound email architecture
- **A.** Cloudflare Email Routing → Email Worker → `postal-mime` parse → POST to our existing Edge route (~$0; same trust boundary as our app; DKIM/SPF/DMARC verification one header check) **(default; recommended)**
- **B.** Brevo Inbound Parsing (single-vendor outbound+inbound; included in Business tier)
- **C.** SendGrid Inbound Parse (mature, but adds a vendor + monthly fee)

Why default A: free at our volumes, same security boundary as the rest of our stack. B is the documented fallback if Cloudflare's filtering proves too coarse at real volume.

### D8 — Per-agent email address scheme
- **A.** Hybrid — human-facing `<agent-slug>@reply.advertisehomes.online` for display + opaque token `leads+<hmac>@reply.advertisehomes.online` for AI `Reply-To` (unguessable, revocable per-conversation) **(default; recommended)**
- **B.** Subdomain catch-all only (`<agent-slug>@reply…`) — pretty but spam-magnet
- **C.** Token-only — secure but ugly on agent business cards

Why default A: the best of both. Human-visible address looks professional; machine-only `Reply-To` makes spam targeting harder and lets us scope-revoke a conversation if a buyer turns abusive.

### D9 — Knowledge base seeding policy
- **A.** Each agent's AI sees ONLY that agent's own active listings + their org's published FAQ + their bio/specialties/languages (org-isolated by RLS) **(default; recommended)**
- **B.** Each agent's AI ALSO sees market-wide aggregate signals (avg price/sqm in city, days-on-market trend) — risk: an agent's AI cites another agent's listing
- **C.** Each agent's AI sees everything AHO indexes (cross-org listings, all reviews, all FAQs) — maximum context, maximum data-leak risk

Why default A: the RLS pattern we already enforce on `properties`, `agent_faqs`, `reviews` extends naturally. Each agent's AI is a closed-world expert on THEIR practice; never accidentally markets a competitor's listing.

---

## 3. Architecture overview

```
                ┌────────────────────────────────────────────────────┐
                │            One AHO AI persona per agent             │
                │      (org-isolated; speaks 7 languages natively)     │
                └────────────────────────────────────────────────────┘
                                       ▲
                                       │
       ┌───────────────────┬───────────┼───────────┬───────────────┐
       │                   │           │           │               │
       ▼                   ▼           ▼           ▼               ▼
  Web chat            Email AI    WhatsApp AI   Voice AI    Dashboard inbox
  (replaces Tawk)     (CF Email   (360dialog    (Twilio +   (per-agent + per-org;
                       Routing →   BSP +        Convers.    HITL approval UI)
                       Worker)     shared       Relay +
                                   WABA)        Claude)
       │                   │           │           │               │
       └───────────────────┴───────────┴───────────┴───────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────┐
                │  ai_conversations + ai_conversation_messages │
                │  shared thread per (lead, listing, agent)   │
                └────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────┐
                │           Knowledge base (real-time)         │
                │   Agent's active listings (RLS)              │
                │   Agent profile (bio, specialties, langs)    │
                │   Org FAQs (agent_faqs table)                │
                │   Reviews + aggregate rating                 │
                │   Saved searches that match the buyer        │
                │   Market comp signals (price/sqm, DoM)       │
                └────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────┐
                │      Per-market system prompt engine          │
                │   us / es / pl / pt / de / fr / it            │
                │   (extends existing market-prompts.ts)       │
                └────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────┐
                │          Claude Sonnet 4.5 (default)         │
                │   Haiku 4.5 for short turns + classification │
                │   Logged to ai_generation_log (cost + lat)   │
                └────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────┐
                │  Audit trail: audit_log (every send,        │
                │  approval, escalation, transfer); admin     │
                │  + agency review dashboards downstream      │
                └────────────────────────────────────────────┘
```

### Shared primitives (all 4 channels use these)

1. **Conversation schema** (`ai_conversations` header + `ai_conversation_messages` turns) — channel-agnostic. A WhatsApp message and a chat message land in the same thread when they're the same (lead, listing, agent).
2. **Knowledge fetcher** (`src/lib/ai/knowledge.ts`) — pure function: given `(agent_id, listing_id?, query)`, returns the grounded context block (listings, agent bio, FAQs, reviews) RLS-filtered to the agent's org.
3. **System prompt engine** (`src/lib/ai/agent-prompts.ts`) — extends `src/lib/social/market-prompts.ts` with a customer-service variant per market that bakes in: agent's name, languages spoken, specialties, the listing(s) being discussed, escalation rules, and the agent-tone tier.
4. **Claude orchestrator** (`src/lib/ai/converse.ts`) — wraps the Anthropic SDK with: tool-use schema (lookup_listing, find_comparable, get_agent_availability, book_viewing, escalate_to_human), token streaming, per-call logging via the existing `logAiCall`, error normalization.
5. **Confidence + risk gate** (`src/lib/ai/gating.ts`) — classifier that decides per turn: auto-send | human-approval-required | escalate. Inputs: classifier confidence, intent label (viewing-request | price-question | availability | discrimination-risk | legal-risk | financial-pre-approval), tier (Free | Pro | Super Pro | Agency), per-agent override.
6. **Audit writer** (`audit_log` extension) — every AI action (draft, send, escalate, transfer) writes a row. Agency tier gets a supervisor dashboard reading from this.

### What stays per-channel

- **Inbound adapter** — parses the channel's native format (HTTP webhook for chat, RFC822 for email, WhatsApp webhook payload, Twilio `<Stream>` WebSocket for voice) → normalizes to a `ConversationTurn` and inserts into `ai_conversation_messages`.
- **Outbound adapter** — takes the AI's reply text + (optional) tool-call outputs → renders in the channel's native format (HTML email with threading headers, WhatsApp text+media, TTS-streamed voice).
- **Compliance footer** — locale-aware GDPR/CCPA boilerplate inserted automatically on email + WhatsApp template messages.

---

## 4. Per-channel deep-dive

### 4a. Web chat (replaces Tawk)

**Stack:** Next.js client component + Server-Sent Events from a Cloudflare Worker streaming Claude tokens. No new vendor.

**MVP scope:**
- Floating widget bottom-right of every public surface (loads on `/properties/[slug]`, `/agents/[slug]`, `/properties-in/[country]/[city]`, homepage)
- Anonymous start (no login required); converts to a lead when buyer leaves email/phone
- Shows agent's avatar + name; the AI introduces itself as "AHO assistant on behalf of [agent name]"
- Streaming responses (<800 ms TTFT)
- "Schedule viewing" tool → checks agent availability → books → notifies agent via Brevo email
- "Connect me to [agent]" escalation → AI hands off, the widget shows "Maria has been notified and will reply within X hours"

**New schema:**
```sql
-- migration 0066_ai_conversations.sql
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  agent_id uuid references public.profiles(id),   -- the human owner; nullable for org-level chat
  property_id uuid references public.properties(id),
  lead_id uuid references public.leads(id),       -- backfilled when buyer leaves contact info
  channel text not null check (channel in ('web_chat', 'email', 'whatsapp', 'voice')),
  status text not null default 'open',            -- open | escalated | resolved | abandoned
  buyer_locale text not null default 'en',
  buyer_session_token text,                       -- anonymous web-chat fingerprint
  buyer_phone text,
  buyer_email text,
  first_message_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ai_conv_org on public.ai_conversations(org_id);
create index idx_ai_conv_lead on public.ai_conversations(lead_id);
create index idx_ai_conv_agent on public.ai_conversations(agent_id);
create index idx_ai_conv_last on public.ai_conversations(last_message_at desc);

create table public.ai_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  channel text not null,                          -- denormalized from conversation for query speed
  body text not null,
  attachments jsonb,                              -- channel-specific (whatsapp media ids, email attachment R2 keys)
  tool_call jsonb,                                -- when assistant invokes a tool
  tool_result jsonb,                              -- when a tool returns
  ai_generation_log_id uuid references public.ai_generation_log(id),
  confidence numeric(3,2),                        -- 0.00-1.00; classifier output
  intent text,                                    -- viewing-request | price-question | etc
  risk_flags text[] default '{}',                 -- discrimination | financial | legal | none
  approval_status text,                           -- null | pending | approved | rejected | auto-sent
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_ai_msg_conv on public.ai_conversation_messages(conversation_id, created_at);
create index idx_ai_msg_approval on public.ai_conversation_messages(approval_status) where approval_status = 'pending';

-- RLS: agents see only their own org's threads. Service-role bypasses for the worker.
alter table public.ai_conversations enable row level security;
alter table public.ai_conversation_messages enable row level security;
create policy "org_members_read_conv" on public.ai_conversations for select to authenticated
  using (exists (select 1 from public.organization_members om
                 where om.org_id = ai_conversations.org_id and om.user_id = auth.uid()));
create policy "org_members_read_msg" on public.ai_conversation_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c
                 join public.organization_members om on om.org_id = c.org_id
                 where c.id = ai_conversation_messages.conversation_id and om.user_id = auth.uid()));
revoke insert, update, delete on public.ai_conversations, public.ai_conversation_messages from anon, authenticated;
```

**Build:** Phase 1 + Phase 2 (3 weeks total).

**Cost:** ~$0.001 per turn on Haiku 4.5 classifier + ~$0.01 per turn on Sonnet 4.5 generation. At 50 turns/agent/month = $0.55/agent/month. Trivial.

**Risk:** Tawk removal day-one breaks the human-chat surface — need feature flag to roll forward/back per locale.

---

### 4b. Email AI

**Stack:** Cloudflare Email Routing → Email Worker → `postal-mime` parse → POST to `/api/inbound/email` → conversation router → Claude → reply via Brevo (existing).

**Per-agent address:** `<agent-slug>@reply.advertisehomes.online` (catch-all on the `reply.` subdomain), with `Reply-To` on AI sends set to `leads+<hmac(lead_id,listing_id,agent_id)>@reply.advertisehomes.online`. The HMAC is the routing key — the Worker can dispatch by local-part without a DB lookup.

**MVP scope:**
- Inbound: every email lands as a `user` turn in the right `ai_conversations` thread (matched by `In-Reply-To` → fall back to `References` walk → fall back to subject+participants).
- AI drafts a reply with proper `In-Reply-To` + `References` chain so Gmail/Outlook thread it.
- HITL approval UX in `/dashboard/ai-inbox`: AI draft + the buyer's original + agent taps Send/Edit/Reject.
- Tier policy per D2: Free=approve all, Pro=auto when confidence>0.85 + safe intent, Super Pro=full auto.
- GDPR footer per locale (`messages/{locale}.json` under `email.compliance.*`) — controller-of-record, basis Art 6(1)(b), one-click unsubscribe (`List-Unsubscribe` header).

**New schema:**
```sql
-- migration 0067_email_threads.sql
create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  root_message_id text not null,                  -- the buyer's very first Message-ID
  subject_normalized text not null,               -- "Re:" stripped, whitespace collapsed
  created_at timestamptz not null default now()
);
create unique index idx_email_thread_root on public.email_threads(root_message_id);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads(id) on delete cascade,
  conversation_message_id uuid not null references public.ai_conversation_messages(id),
  message_id text not null,                       -- this email's Message-ID
  in_reply_to text,
  references_chain text[],                        -- ordered ancestors
  direction text not null check (direction in ('inbound', 'outbound')),
  from_addr text not null,
  to_addr text[] not null,
  cc_addr text[] default '{}',
  raw_headers jsonb not null,
  dkim_pass boolean,
  spf_pass boolean,
  dmarc_pass boolean,
  spam_score numeric(4,2),
  created_at timestamptz not null default now()
);
create index idx_email_msg_message_id on public.email_messages(message_id);
create index idx_email_msg_thread on public.email_messages(thread_id, created_at);
```

**Cloudflare Email Worker** at `workers/inbound-email/`:
```ts
// Pseudocode — full impl in Phase 3
export default {
  async email(message: ForwardableEmailMessage, env: Env) {
    const raw = await new Response(message.raw).text();
    const parsed = await postalMime.parse(raw);

    // Auth checks: reject DMARC failures immediately
    const authResults = message.headers.get('Authentication-Results') ?? '';
    if (!authResults.includes('dmarc=pass')) {
      console.warn('[inbound-email] dmarc fail; drop', { from: parsed.from });
      return;
    }

    // Route by local-part: opaque token → direct conversation lookup;
    // slug → look up agent → newest open conversation OR new one.
    const localPart = parsed.to[0].address.split('@')[0];
    const route = localPart.startsWith('leads+')
      ? routeByToken(localPart.slice(6), env)
      : routeByAgentSlug(localPart, parsed, env);

    await fetch(`${env.AHO_API}/api/inbound/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-inbound-secret': env.INBOUND_SECRET },
      body: JSON.stringify({ parsed, route }),
    });
  },
};
```

**Build:** Phase 3 (week 4-5).

**Cost:** $0 inbound (CF Email Routing free + Workers Paid we already have). Outbound via existing Brevo. Inference ~$0.02/reply on Sonnet = ~$2/agent/month at 100 emails/month.

**Risk:** Spam abuse on the catch-all. Mitigation: token-bound `Reply-To`, DMARC verify, per-from-address rate limit in the Worker (Durable Object counter ~10/min/sender), MailChannels Inbound Shield in front for Pro+ tiers if open-catch-all proves leaky.

---

### 4c. WhatsApp AI

**Stack:** 360dialog as BSP (Meta Cloud API wrapper, zero msg markup, €49/mo/number) + shared AHO WABA + per-agent verified phone numbers + Embedded Signup onboarding.

**MVP scope:**
- Agent connects via Embedded Signup (Meta-hosted popup; <5 min flow).
- Buyer taps `wa.me/<agent_number>?text=Interested%20in%20listing%20AHO-1234` from a listing page; AHO parses the listing ID server-side, binds the conversation to the right thread.
- AI replies inside the 24-hour service window for free (text + listing photos + brochure PDF all free).
- After 24h closes, AI must use a pre-approved Utility template ("you asked about 123 Calle X — here's the update") to reopen. Marketing templates ("3 new listings in your saved search") gated to explicit opt-in.
- Compliance: opt-in is the wa.me click; out-of-window contact requires explicit opt-in confirmation captured during the first conversation.

**New schema:**
```sql
-- migration 0068_whatsapp_integration.sql
create table public.whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  phone_e164 text not null,                       -- +14155551212
  waba_id text not null,                          -- Meta WABA id (shared AHO WABA)
  display_name text not null,                     -- "Maria Lopez — AHO"
  verified_at timestamptz,                        -- Meta number-cert pass
  bsp_provider text not null default '360dialog',
  bsp_account_id text not null,
  monthly_template_budget_cents integer default 1000,  -- $10/mo cap before agent confirms overage
  marketing_opt_in_count integer default 0,
  status text not null default 'pending',         -- pending | active | suspended
  created_at timestamptz not null default now()
);
create unique index idx_wa_phone on public.whatsapp_numbers(phone_e164);

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,                             -- e.g. "viewing_reminder_v1"
  language text not null,                         -- es | en | pl | pt | de | fr | it
  category text not null check (category in ('marketing', 'utility', 'authentication', 'service')),
  body_template text not null,                    -- "Hi {{1}}, your viewing of {{2}} is confirmed for {{3}}."
  meta_template_id text,                          -- assigned by Meta on approval
  approval_status text not null default 'pending',
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_message_id uuid not null references public.ai_conversation_messages(id),
  wa_number_id uuid not null references public.whatsapp_numbers(id),
  wa_message_id text not null,                    -- Meta's id (for delivery callbacks)
  direction text not null check (direction in ('inbound', 'outbound')),
  template_id uuid references public.whatsapp_templates(id),  -- null = service-window free message
  in_service_window boolean not null,
  cost_cents integer default 0,                   -- 0 for service-window
  delivery_status text default 'sent',            -- sent | delivered | read | failed
  created_at timestamptz not null default now()
);
create index idx_wa_msg_wa_message_id on public.whatsapp_messages(wa_message_id);
create index idx_wa_msg_conv on public.whatsapp_messages(conversation_message_id);
```

**Per-agent setup flow:**
1. Agent at `/dashboard/ai-inbox/whatsapp` clicks "Connect WhatsApp"
2. 360dialog Embedded Signup popup → Meta business verification → number ownership cert
3. AHO captures the access token + WABA id → inserts `whatsapp_numbers` row (status='active')
4. Auto-publishes the 7-language utility template pack to Meta for approval
5. Agent's profile page + listing pages now show the WhatsApp button

**Cost model (per agent):**
- Fixed: €49/mo per number (360dialog channel fee) → ~$53/mo
- Variable: $0 inbound + $0 service-window outbound; templates ~$0.01-0.12/msg pass-through
- AI inference: ~$0.005/turn on Haiku for routing + ~$0.01/turn on Sonnet for substantive replies; 200 turns/mo = ~$3/agent

**Retail:** Bundle 200 conversations/month into Super Pro ($199-249/mo), pass through template costs above that. The €49 channel fee is absorbed into the tier price.

**Build:** Phase 4 (week 6-7).

**Risk:** Template approval is async (15min - 48h). Meta auto-recategorizes from Service → Marketing if our utility templates drift. Mitigation: keep templates strictly transactional ("your viewing is confirmed", "the listing you asked about has a new photo"); marketing-style nudges require explicit opt-in capture.

---

### 4d. Voice AI

**Stack:** Twilio Programmable Voice + ConversationRelay (the Twilio×Anthropic-co-designed primitive) + Claude Sonnet 4.5 + Deepgram Nova-3 STT + ElevenLabs Flash v2.5 TTS, orchestrated from a Cloudflare Worker.

**MVP scope:**
- Each agent gets a Twilio phone number (US local $1.15/mo; per-market pricing in §8).
- Inbound: Twilio `<Connect><ConversationRelay url="..."/>` → our Worker receives token-streamed turns → forwards to Claude with the listings/profile/availability tool-set → ElevenLabs synthesizes the reply → back to Twilio → caller hears it within <725 ms p95.
- Warm transfer when AI can't help: Twilio `<Dial><Conference>` adds caller to a conference room, simultaneously dials the agent's mobile with a whisper-prompt summarizing the lead, drops the AI leg on agent-accept. If the agent doesn't pick up in 20s: AI returns, says "Maria is with another buyer, I'll have her call you back," collects callback window, hangs up. SMS the lead + create CRM task with the full transcript.
- Recording (with consent banner): "This call may be recorded for quality. Reply 'no' to opt out." Recordings stored in R2 + linked to `ai_conversation_messages.attachments`.

**New schema:**
```sql
-- migration 0069_voice_integration.sql
create table public.agent_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  phone_e164 text not null,
  twilio_sid text not null,                       -- Twilio's PNxxx id
  monthly_minute_budget integer default 60,       -- soft cap; overage requires confirmation
  forward_to_phone text,                          -- agent's mobile for warm-transfer
  voicemail_recording_url text,                   -- R2 URL for after-hours fallback
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create unique index idx_voice_phone on public.agent_phone_numbers(phone_e164);

create table public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  agent_phone_id uuid not null references public.agent_phone_numbers(id),
  twilio_call_sid text not null unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_phone text not null,
  duration_seconds integer,
  recording_r2_key text,
  recording_consent boolean default true,         -- false if caller opted out
  warm_transfer_attempted boolean default false,
  warm_transfer_succeeded boolean default false,
  cost_cents integer default 0,                   -- twilio + LLM + STT + TTS
  created_at timestamptz not null default now()
);
create index idx_voice_call_conv on public.voice_calls(conversation_id);
create index idx_voice_call_sid on public.voice_calls(twilio_call_sid);
```

**Per-agent cost** (30 min/month baseline):
- US local number: $1.15/mo
- Twilio talk: 30 min × $0.014 = $0.42
- Inference + STT + TTS: 30 min × $0.13 = $3.90
- **Total: ~$5.50/agent/month variable**

**Retail:** Bundle 60 voice-minutes/month into Super Pro; overage at $0.20/min.

**Build:** Phase 5 (week 8-10).

**Risk:** Hallucinated promises (commission misquote, "the seller will accept $X", financing pre-approval) create real legal liability. Mitigation: hard-constrain the agent prompt to read-only listing facts; explicit refusal templates for price negotiation / commission / financing / legal questions; classifier risk-flag → forced HITL or human transfer; recording-on by default for the agent's protection.

---

## 5. Cross-cutting concerns

### 5.1 Knowledge ingestion

Pure-function fetcher in `src/lib/ai/knowledge.ts` returns a context block:

```ts
type KnowledgeContext = {
  agent: { name: string; languages: string[]; specialties: string[]; bio: string };
  org: { name: string; faqs: Array<{ q: string; a: string }> };
  listings: Array<PropertyDetail>;          // RLS-filtered active+published only
  market: { city: string; medianPricePerSqm: number; medianDoM: number } | null;
  reviews: { count: number; avg: number; recentTopReview: string | null };
  buyer: { savedSearches: Array<SavedSearch> | null };  // when lead is recognized
};

export async function fetchKnowledge(args: {
  supabase: SupabaseClient;
  agentId: string;
  listingId?: string;
  leadId?: string;
  buyerLocale: Locale;
}): Promise<KnowledgeContext>;
```

**Real-data rule (CLAUDE.md hard rule #8) compliance:** the fetcher inherits RLS — it only sees active+published rows, only the agent's own org, never test fixtures (`aho-test-org-%` filter is already in `src/app/api/properties/by-bbox`). Soft-beta phase produces empty knowledge for un-claimed agents; the AI gracefully says "I'm Maria's assistant — she hasn't published any listings on AHO yet, but I can take your contact info and have her reach out."

No vector DB v1. Listings + FAQs are small enough (typically <20 listings per active agent) to fit in the context window directly. Vector search becomes relevant when an agent has >50 listings; v2.

### 5.2 Multilingual system prompts

Extend `src/lib/social/market-prompts.ts` with `src/lib/ai/agent-prompts.ts`:

```ts
// Per (market, channel) variant. Generates the system prompt by
// composing:
//   1. Brand voice ("You are an AHO AI assistant on behalf of {agentName}")
//   2. Market voice (Polish drafts use Polish jargon: metraż, stan deweloperski)
//   3. Channel constraints (voice = no markdown; email = include footer; chat = streaming-friendly short turns; whatsapp = 1024 char cap)
//   4. Tool catalog (lookup_listing, find_comparable, book_viewing, escalate_to_human)
//   5. Refusal templates (price negotiation, commission, financing, legal)
//   6. Locale-aware compliance footer (when applicable)

export function buildAgentSystemPrompt(args: {
  agent: KnowledgeContext['agent'];
  org: KnowledgeContext['org'];
  market: Market;                            // us | es | pl | pt | de | fr | it
  channel: 'web_chat' | 'email' | 'whatsapp' | 'voice';
  tier: 'free' | 'pro_automation' | 'super_pro' | 'agency';
}): string;
```

### 5.3 Confidence + risk gating (HITL)

`src/lib/ai/gating.ts` classifies each AI response BEFORE send:

| Confidence | Safe intent | Risk flag | Tier | Action |
|---|---|---|---|---|
| >0.85 | ✓ | none | Pro+ | auto-send |
| >0.85 | ✓ | none | Free | draft (HITL) |
| 0.6-0.85 | ✓ | none | any | draft (HITL) |
| any | ✓ | discrimination/legal/financial | any | draft + flag for human |
| any | escalation | any | any | route to human; AI sends "Maria will follow up within X hrs" |
| <0.6 | any | any | any | "let me have Maria reply with the specifics" |

Risk flags computed by a Haiku classifier on the AI's own draft before send:
- `discrimination` (Fair Housing Act / EU equivalent — protected class language)
- `legal` (questions about contracts, contingencies, disclosures)
- `financial` (mortgage pre-approval, financing, escrow specifics)
- `commission` (any mention of agent commission)
- `price_negotiation` (offers, counteroffers — AI must defer)

### 5.4 Compliance + audit trail

Every AI action writes to `audit_log` with `kind` prefixed `ai_agent.*`:
- `ai_agent.draft` — AI produced a draft
- `ai_agent.auto_send` — auto-sent under tier policy
- `ai_agent.approved` — agent reviewed + sent
- `ai_agent.rejected` — agent rejected; rewrites
- `ai_agent.escalated` — flagged for human
- `ai_agent.transferred` — voice warm transfer attempted
- `ai_agent.opted_out` — buyer requested human-only

Agency tier gets `/dashboard/admin/ai-supervision` reading this for cross-seat oversight.

### 5.5 RLS pattern (critical for multi-tenant)

The AI's context fetch MUST go through the user's session (anon for web-chat, service-role-with-org-binding for inbound webhooks). For inbound (email/WhatsApp/voice), the Worker uses service-role but EXPLICITLY scopes to the agent's org_id at every query (no `.eq('org_id', null)` slipups). The conversation insert always carries `org_id` from the routing key — never derived from buyer-supplied input.

CLAUDE.md gotcha: `supabase-js` doesn't throw on row-level errors. Every insert destructures `{ error }` and logs explicitly.

CLAUDE.md gotcha: Edge runtime kills unawaited promises. Every `logAiCall` + audit-log insert + conversation-message insert is `await`ed.

### 5.6 Cost containment

Per-org soft caps (overridable):
- Free / Pro: 100 AI turns/month included; further turns require Pro Automation tier
- Pro Automation: 1000 turns/month included; overage at $0.01/turn billed monthly via Stripe usage
- Super Pro: 5000 turns/month + 60 voice minutes + 200 WhatsApp conversations
- Agency: per-seat aggregation; supervisor caps individual agents

Per-call hard limits enforced in `src/lib/ai/converse.ts`:
- Max tokens out: 1500 (capped at the channel's reasonable reply length)
- Max tool calls per turn: 3 (prevents runaway tool-loop)
- Max conversation turns per session: 50 (forced escalation after; cost shield)

### 5.7 Reuse existing AHO primitives

- `src/lib/ai/cost.ts` + `src/lib/ai/log.ts` — per-call cost + usage logging (already production)
- `src/lib/rate-limit/kv.ts` — per-IP rate limiter (already production); extend with per-conversation + per-agent counters
- `src/lib/billing/plan-gating.ts` — `requireProAutomation()`, `isOrgOnProAutomation()` — extend with `isOrgOnSuperPro()`
- `src/lib/email/brevo.ts` — outbound email (already production)
- `src/components/chat/tawk-widget.tsx` — feature-flag to swap for our AI widget per locale during rollout
- `audit_log` table — already exists, ready to extend
- `agent_faqs` table — already exists, immediately ingestible

---

## 6. What's explicitly OUT of v1

Stating non-goals so we don't slide into a 6-month build:

- **No voice cloning** of the actual agent. AI speaks in a generic agent-locale voice ("Maria's English-Spanish bilingual receptionist"). Per-agent voice cloning is a Phase 6 add-on.
- **No outbound dial campaigns.** AI does not cold-call buyers; only answers inbound + does warm transfer.
- **No marketing-tier WhatsApp broadcasts** at launch. Service replies + utility templates only.
- **No multi-listing comparison shopping** ("show me your 3 villas under $500k"). AI answers about the listing(s) the buyer asked about; broader search stays a /search task.
- **No automated price negotiation.** Hard refusal template, mandatory escalation.
- **No automated viewing-confirmation with the seller.** AI books the BUYER'S side (collects their availability); agent confirms with the seller out-of-band.
- **No SMS auto-reply.** SMS lives in a side-by-side queue but isn't AI-replied at v1 (Twilio SMS = +$0.0075/msg, agent-tier overhead not worth the complexity yet).
- **No CRM integrations** (Salesforce, HubSpot, Follow Up Boss). AHO IS the CRM for these agents at v1.
- **No vector DB / embedding-based retrieval.** Context fits in Claude's 200k window directly for any agent's catalog.

---

## 7. Phasing (10 weeks end-to-end; D1 determines which subset)

### Phase 1 — Foundation (Week 1)
- Migration `0066_ai_conversations.sql` + `ai_conversation_messages` + RLS
- `src/lib/ai/converse.ts` — Claude orchestrator with tool schema + streaming + logging
- `src/lib/ai/knowledge.ts` — context fetcher
- `src/lib/ai/agent-prompts.ts` — per-(market, channel) system prompts
- `src/lib/ai/gating.ts` — confidence + risk classifier
- Unit tests for all of the above

### Phase 2 — Web chat (Week 2-3)
- `/api/ai-chat` Edge route with SSE streaming
- `<AiChatWidget>` client component
- Feature flag `aho:ai_chat_enabled` per org (Tawk fallback)
- `/dashboard/ai-inbox` minimal view: list of open chat threads + manual takeover button
- Lead capture: when buyer leaves contact info, AI inserts into `leads` table (reusing existing `/api/leads` write path)
- TEST_PLAN entry + soft-beta with PO's own account
- **Ship gate:** PO uses chat as a buyer for 3 listings, confirms qualitative quality

### Phase 3 — Email (Week 4-5)
- `workers/inbound-email/` Cloudflare Email Worker
- DNS: `reply.advertisehomes.online` MX → Cloudflare; SPF + DKIM + DMARC verified
- `/api/inbound/email` Edge route — receives parsed payload, routes to conversation, kicks off AI draft
- Migration `0067_email_threads.sql`
- `/dashboard/ai-inbox` extended with email tab: draft preview, edit-before-send, send via Brevo
- HITL gating per D2; default human-approval
- TEST_PLAN entry: PO emails the address from a private inbox

### Phase 4 — WhatsApp (Week 6-7)
- 360dialog account setup + Meta business verification (parallel; ~3 days CF-side)
- Embedded Signup flow at `/dashboard/ai-inbox/whatsapp`
- Migration `0068_whatsapp_integration.sql`
- `workers/whatsapp-webhook/` Cloudflare Worker for inbound messages + delivery callbacks
- 7-language utility template pack submitted for approval
- `wa.me` link template updated on listing pages to encode `listing_id` in `?text=`
- TEST_PLAN entry: PO connects their own WhatsApp number, sends a test message from another device

### Phase 5 — Voice (Week 8-10)
- Twilio account setup + sub-accounts per agent for billing isolation
- `workers/voice-conversationrelay/` — handles the `<ConversationRelay>` WebSocket
- Migration `0069_voice_integration.sql`
- ElevenLabs voice library: one per (market, gender) pair (4-6 voices total)
- Twilio Conference warm-transfer + agent whisper-prompt
- Voicemail fallback: after 30s no-pickup, record buyer message into R2, ai-summarize, deliver to agent inbox + SMS
- Recording-consent banner (English + Spanish at launch; rest of locales added incrementally)
- TEST_PLAN entry: PO calls their own number, verifies hold music + AI greet + transfer

---

## 8. Cost model

### Per-agent variable cost (active month, baseline usage)

| Channel | Fixed | Variable @ baseline | Total at baseline |
|---|---|---|---|
| Web chat | $0 | 50 turns × $0.011 = $0.55 | $0.55 |
| Email | $0 | 100 emails × $0.020 = $2.00 | $2.00 |
| WhatsApp | $53/mo (360dialog €49 + ~$3 buffer) | 200 service-window turns × $0.015 = $3.00; templates $0-$5 pass-through | $56-$61 |
| Voice | $1.15/mo (US number) | 30 min × $0.144 = $4.32 | $5.47 |

### Per-tier retail price + bundled usage (D5 confirms)

| Tier | Price | Bundled | Overage |
|---|---|---|---|
| Pro Automation | $99/mo | Chat unlimited, 100 emails | Email $0.05/extra reply |
| Super Pro | $249/mo (TBD) | Chat unlimited, 500 emails, 200 WA conversations, 60 voice min | WA $0.08/conv, voice $0.20/min |
| Agency | $599/mo + $49/seat | Per-seat aggregation, supervisor dashboard | Same overage rates |

### Aggregate margin sanity-check at 1000 active Super Pro agents

- Inference: $0.55 + $2 + $3 + $4.32 = ~$10/agent/mo Claude+STT+TTS → $10k/mo
- Telephony + WhatsApp: ~$58/agent/mo → $58k/mo
- Stripe fees + Brevo: ~$3/agent/mo → $3k/mo
- Total variable: ~$71/agent/mo
- Retail: $249/mo
- Gross margin per active agent: ~$178/mo (71%)

At 1000 active Super Pro agents: $178k/mo gross margin contribution. This is the unit-economics number to defend in the fundraise pitch (`docs/PITCH_OUTLINE.md`).

---

## 9. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Hallucinated price/commission/legal promises → real liability | High | Hard-constrained prompts; classifier risk-flag → forced HITL; refusal templates per language; recording-on by default on voice |
| R2 | EU GDPR violation in inbound email (forwarded PII outside processor agreement) | High | Brevo + Cloudflare both have DPAs; per-locale compliance footer; explicit purpose-limitation in system prompt; 24-month retention auto-purge |
| R3 | Meta auto-recategorizes our utility templates to marketing → cost explosion | Medium | Templates strictly transactional ("your viewing is at X"); monthly review of Meta's template-category report; budget alert when monthly template spend >$10/agent |
| R4 | Twilio number costs at 1000+ agents become non-trivial ($1.15 × 1000 = $1,150/mo) | Low | Pass-through to agent (number is part of their Super Pro entitlement); bulk-pricing negotiation with Twilio at 100+ numbers |
| R5 | 360dialog onboarding slips beyond Week 7 | Medium | Twilio for WhatsApp is the documented fallback; same shared-WABA model works there at +$0.005/msg markup |
| R6 | Cloudflare Email Routing spam filtering too coarse → AI spends time replying to spam | Medium | Per-from rate-limit; DMARC verification mandatory; tier into MailChannels Inbound Shield ($) for Pro+ agents; track AI-time-per-spam-conv metric |
| R7 | Agent unhappy that "their" AI sounds generic; reputation harm | Medium | Tone selector per agent (4 presets: warm, professional, brief, conversational); per-agent voice clone in Phase 6 add-on |
| R8 | Edge runtime kills unawaited promises → silent drop of conversation-message inserts | High | Code review checklist enforces `await` on every supabase write; lint rule when feasible; integration tests assert row counts |
| R9 | RLS leak: an agent's AI accidentally markets another agent's listing | High | Knowledge fetcher RLS-scopes to agent's org; integration test asserts cross-org isolation; supervisor audit dashboard flags cross-org references |
| R10 | Buyer asks AI a question it answers wrong; buyer trusts AI; deal sours | Medium | Confidence threshold rejects low-conf auto-sends; transcript review by agent within 24h required for low-tier; "always include 'verify with Maria' prefix" prompt for un-confidently-answered questions |
| R11 | Voice transfer fails (agent doesn't pick up, conference setup race) | Low | 20s pickup timeout → AI fallback ("Maria's with another buyer, callback scheduled"); SMS sent automatically; conversation logged for next-business-day review |
| R12 | Cost overrun on a single agent's chatty buyer (rate-limit bypass via multiple conversations) | Low | Per-conversation hard cap of 50 turns; per-agent monthly soft cap; admin dashboard flags top-10-cost agents weekly |
| R13 | Tawk removal breaks human-chat in markets where Tawk performed well | Low | Feature flag per locale; rollback to Tawk if AHO chat NPS < Tawk NPS at 30 days |

---

## 10. References

This plan synthesized from 4 parallel research agents (full reports in chat history) plus a codebase audit. Key external sources by topic:

**Voice (Twilio + ConversationRelay + Claude):**
- [Twilio + Claude ConversationRelay launch](https://www.twilio.com/en-us/blog/integrate-anthropic-twilio-voice-using-conversationrelay)
- [Twilio voice AI latency guide](https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents)
- [Twilio warm transfer pattern](https://www.twilio.com/en-us/blog/developers/tutorials/product/warm-transfer-openai-realtime-programmable-sip)
- [Real-estate voice agent landscape](https://www.plivo.com/blog/ai-voice-agents-real-estate-tools-compared/) (Ylopo, Lofty, Structurely benchmarks)

**WhatsApp:**
- [Meta WABA pricing 2026](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (post-Jan 2026 restructure)
- [360dialog pricing](https://360dialog.com/pricing)
- [Embedded Signup integration](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [WhatsApp 24-hour service window](https://help.saysimple.com/the-24-hour-customer-care-window)

**Email:**
- [Cloudflare Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)
- [postal-mime on Workers](https://deepwiki.com/postalsys/postal-mime/4.5-cloudflare-workers)
- [RFC 5322 + In-Reply-To threading](https://datatracker.ietf.org/doc/html/rfc5322)
- [List-Unsubscribe one-click (RFC 8058)](https://datatracker.ietf.org/doc/html/rfc8058)

**Codebase audit:** see existing files under `src/lib/ai/`, `src/lib/listings/seo.ts`, `src/lib/email/`, `src/lib/billing/plan-gating.ts`, `src/db/migrations/0009_leads.sql`, `0012_profile_extensions.sql`, `0032_agent_faqs.sql`, `0061_ai_generation_log.sql`.

---

## How to accept

Reply with your 9 decisions inline:

```
D1=A, D2=A, D3=A, D4=A, D5=A, D6=A, D7=A, D8=A, D9=A
```

(or any mix). I'll then:
1. Move this plan from DRAFT to ACCEPTED in §0 header
2. Update STATUS.md 🟡 Next 5 to put Phase 1 in flight
3. Add a `PROGRESS.md` entry recording the acceptance
4. Open the first slice (`Phase 1 — Foundation`) and start writing code
