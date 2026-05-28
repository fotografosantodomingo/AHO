# PO Decisions — open queue

> Decisions I need from you to proceed. Batch through them when you have 10 minutes — sitting down to answer 5 in one go is cheaper than being interrupted mid-task by them.
>
> Each item: **what** I need, **why** I'm stuck, **my recommendation**, **deadline**. Reply with the option letter (or "other: ..." with your direction) — I'll go execute and remove the item from this list.
>
> I (Claude) keep this file accurate. When a new decision pops up during work, it lands here instead of breaking your flow with a mid-task question.

---

## 🔴 Blocking active work

### 7. Apply migrations 0078 + 0079 to prod Supabase

**Question:** Run `pnpm db:migrate` against prod, or authorize me to do it?

**Why I'm stuck:** Both migrations are committed to `main` but the migration runner only fires when explicitly invoked. Without them:
- **0078** (`organizations_manual_plan_override.sql`) — the new `/admin/orgs/[id]/plan` page **500s at runtime** because the `manual_plan_id` / `manual_plan_expires_at` etc. columns don't exist. Plan-gating's `resolveEffectivePlanId()` silently falls back to Stripe state, which is the intended graceful degradation BUT means the override feature is non-functional.
- **0079** (`revoke_service_role_only_tables.sql`) — defense-in-depth REVOKE on `stripe_events_processed`, `founder_rate_counter`, `auth_login_challenges`, `tawk_events_processed`. RLS-without-policies already blocks anon reads in practice, but the explicit REVOKE removes the default grant. Without this applied, the belt-and-suspenders isn't engaged. **Not actively breaking anything.**

**Options:**
- **A — You run it** (~3 min): `set -a && source .env.local && set +a && corepack pnpm@9.12.3 db:migrate` from repo root. Migrations are idempotent (skip on duplicate).
- **B — You authorize me to run it.** Same command from this session. Need `SUPABASE_POOLER_URL` (or `DATABASE_URL`) to be valid in `.env.local`; I'll re-verify before firing.

**My recommendation:** B. The migrations are mechanical INSERT/REVOKE statements with no destructive ops; I'll inspect the SQL and post the apply log immediately after.

**Deadline:** Before you actually need to comp/extend an agent's plan manually. Today if you're recruiting Founding 50 agents this week and want to offer "free for 30 days" terms.

---

### 8. Stripe LIVE flip — when?

**Question:** Flip the Stripe TEST → LIVE keys when?

**Why I'm stuck:** Cannot collect a dollar in TEST mode. CLAUDE.md hard rule #9 requires explicit chat authorization PLUS a `docs/DECISIONS.md` entry before any LIVE creation. Today's blockers:
- LIVE products + prices were archived 2026-04-29 (the early process gap). All current products + IDs are `sk_test_*`.
- `scripts/setup-stripe-products.ts` has a guardrail that **refuses live keys** — needs to be flipped intentionally with a DECISIONS entry.
- LIVE `WELCOME5` coupon doesn't exist (TEST-only).

**Options:**
- **A — Flip now** (15 min): you swap `STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in CF Pages env to `sk_live_*` / `pk_live_*`; I run `pnpm stripe:setup` against LIVE (drops the guardrail temporarily per CLAUDE.md #9 explicit-confirmation rule); I write the DECISIONS entry; I create the LIVE `WELCOME5` coupon via dashboard or API. **Risk: TEST-mode subscriptions today don't move; only future signups go LIVE. Zero churn risk because zero paying customers in TEST.**
- **B — Wait until Founding 50 has the first applicant ready to pay.** Tighter coupling between LIVE-flip event and first-dollar event; less "live but empty" infra time.
- **C — Wait until Meta App Review approves** (4-8 weeks). The full Pro Automation ($99/mo) value prop requires Meta-approved IG/FB publishing, so charging $99/mo before Meta approval is selling something the platform can't deliver.

**My recommendation:** A, but only if you can recruit a real applicant within ~14 days. Otherwise B — LIVE-without-customers just sits there.

**Deadline:** Coupled to Founding 50 recruitment cadence. Honest: ask me again after you finish the first 3 outreach conversations.

---

### 9. CF Pages Cache Rule — same as #6 but it's been open for a week

**Question:** Did you already apply the rule per #6 below? If not, just bumping it because homepage rendering at ~1.9s is a real conversion drag.

**Why I'm asking again:** I checked prod 2026-05-27 — `cf-cache-status: DYNAMIC` on `/en` homepage; 1.9s server-render. This is the #6 issue still unresolved.

**Action you take if you haven't:** Cloudflare dashboard → advertisehomes.online → Caching → Cache Rules → Create. Match: hostname=advertisehomes.online, URI Path matches regex `^/[a-z]{2}/?(blog|properties|propiedades|agents|properties-in)?(/.*)?$`. Setting: Eligible for cache, Edge TTL: respect origin.

**Deadline:** Highest-leverage 5 minutes available.

---

## 🟡 Coming up — answer when convenient

### 2. Super Pro tier price point (locks in before Phase 6)

**Question:** $199, $249, or $299/mo for the Super Pro tier? Annual discount %? Featured at hero on /pricing or quieter cross-sell?

**Why I'm stuck:** The pricing presence on /pricing changes the comparison framing (Pro Automation $99 vs Super Pro $X). The bigger the gap, the more I need to justify Super Pro with feature-density on the marketing page.

**Options:**
- **A — $199/mo, 17% annual discount, hero feature.** Aggressive, captures more conversions, lower margin.
- **B — $249/mo, 17% annual discount, hero feature.** **My recommendation.** Anchors above the perceived "premium" threshold; pairs naturally with auto-video being the value-multiplier.
- **C — $299/mo, 20% annual discount, quieter cross-sell on /pricing.** Highest margin but smaller addressable market; relies on Pro Automation $99 being the funnel entry.

**Deadline:** Before Phase 4 ships (need pricing for the /pricing page).

---

### 3. Pricing tier paywall structure (Phases 3-4)

**Question:** Captions free for anon, graphics gated on signup, video gated on Super Pro? Or everything free in preview, paywall only on publish?

**Why I'm stuck:** Today everyone sees all 9 captions + 3 graphics in the preview for free, with the publish CTA being the conversion. Phase 4 video changes the value-density of the preview significantly.

**Options:**
- **A — Captions free anon, graphics + video gated on signup.** Lower-friction signup pull; signup unlocks the visual stuff.
- **B — Everything visible in preview, paywall only on publish.** **My recommendation.** Reads as "we built you an entire campaign in 60s; pay $99 to push it live." Stronger psychological close.
- **C — Captions + graphics free anon, video gated on Super Pro tier.** Tiers the upgrade path: anon → see captions + graphics → sign up Pro → publish → upgrade Super Pro → unlock video.

**Deadline:** Before Phase 4 ships.

---

### 6. CF Pages edge cache — dashboard rule (A) or Cache API in middleware (B)?

**Question:** After today's Set-Cookie strip (`c441514`), `cf-cache-status` still reads DYNAMIC on `/blog/*` + `/properties/*`. Root cause: CF Pages Functions don't auto-respect `Cache-Control` headers — they need either a dashboard Cache Rule OR explicit Cache API usage in the function. Which approach?

**Why I'm stuck:** A real ROI block. Lighthouse Perf on `/en/properties/<slug>` is 53/100 because every request is server-rendered (~1.5s). Edge caching would put this at 90+ (sub-100ms). The Set-Cookie blocker is now off; only the cache-trigger step remains.

**Options:**
- **A — Cloudflare dashboard Cache Rule.** **My recommendation.** ~5 min in CF dashboard: add a Cache Rule matching `/{locale}/blog/*` + `/{locale}/properties/*` + `/{locale}/agents/*` + `/{locale}/properties-in/*` (anon — no Cookie header containing `sb-`). Cache for 5 min. Reversible in one click; zero code risk. The Cache-Control header we ship already encodes the right TTL; the dashboard rule just tells CF to honor it.
- **B — Claude implements Cache API pattern in middleware.** ~1-2 hours careful work: middleware calls `caches.default.match(req)` upstream, returns hit if present; downstream of the Next.js handler, `caches.default.put(req, res.clone())` if anon + has Cache-Control. Same outcome, but harder to revert if it bites + risks introducing subtle bugs in the middleware critical path.

**Deadline:** Block the Lighthouse Perf 90+ goal — needed for the Super Pro pitch deck (publish-rate analytics + investor narrative both reference real Lighthouse scores).

**Action you take if (A):** Cloudflare dashboard → advertisehomes.online → Caching → Cache Rules → Create. Match: hostname=advertisehomes.online, URI Path matches regex `^/[a-z]{2}/(blog|properties|propiedades|agents|properties-in)(/|$)`. Setting: Eligible for cache, Edge TTL: respect origin (which is the Cache-Control we already ship). Paste me the rule ID when done so I can document it in DECISIONS.md.

---

### 5. Google Ads OAuth + dev token (Phase 6 pre-req)

**Question:** Open a Google Ads Manager account + start the dev-token approval flow now, or defer until Phase 6 sprint?

**Why I'm stuck:** Google Ads dev-token approval takes 2-3 weeks. If we want Phase 6 to ship on its target week, the application has to start ~3 weeks before.

**My recommendation:** Start it now even though Phase 6 is several weeks out. Application is free; the clock just runs in the background.

**Action you take:**
1. Sign in to a Google account at https://ads.google.com/
2. Create a "Manager account" (top-right "Tools & Settings → Setup")
3. Apply for developer token (https://developers.google.com/google-ads/api/docs/get-started/dev-token)
4. List me as a co-applicant or paste me the credentials when granted

**Deadline:** Whenever you can spare 20 min in the dashboard.

---

## ✅ Recently answered

| Date | Decision | You chose |
|---|---|---|
| 2026-05-17 | Auto-video render engine — Remotion (A) vs FFmpeg-WASM (B) vs Creatomate (C)? | **A — Remotion in Cloudflare Containers** (~$0.05/video, predictable infra). Phase 4 building now in slices 4a-4d. |
| 2026-05-17 | Brand mark on every generated creative — bold footer vs subtle watermark vs per-agent toggle? | **Bold "Powered by AHO" footer bar** (recorded in `docs/DECISIONS.md`) |
| 2026-05-17 | Path A (finish Stage 1 Phase 3 first) vs Path B (start AI agent now)? | **Path A** — Phase 3 shipped same day as `c385f93` |
| 2026-05-18 | AI Customer-Service Agent — 9 design decisions (D1-D9) | **All defaults (A)** — chat-only v1, always-HITL, 360dialog BSP, shared AHO WABA, AI bundled into Pro Automation, Twilio+ConversationRelay+Claude voice stack, Cloudflare Email Routing inbound, hybrid email address scheme, org-isolated knowledge per agent. Plan accepted in full. |
| 2026-05-19 | Auto-video music library (Phase 4) — royalty-free (A) vs Epidemic Sound (B)? | **A — Royalty-free only** (Pixabay + YouTube Audio Library). Recorded in `docs/DECISIONS.md`. |

---

## How to use this file

- **Look here when I say "blocked on PO decision in #N."**
- **Batch answers.** Sit down with this file once a day or once every couple of days; answer 1-5 items at a time.
- **Reply format:** "PO decisions #1=A, #2=B, #4=A" — short. I'll execute and remove.
- **I keep this current.** When you answer, I move the item to "Recently answered" with a one-line summary and the date.
- **New decisions** that surface during work go straight here, not into chat as mid-task interruptions.
