# STATUS — where we are right now

> The single place to look for "what's happening." Read this first when you start a session. Type **`status`** to me at the start and I'll read this, propose the next action, and either get your sign-off or redirect.
>
> I (Claude) keep this file accurate. Last update: 2026-05-17.

---

## 🟢 Now — actively in flight

**Phase 4 — Auto-video Reels/TikTok engine.** Render path locked 2026-05-17: **A = Remotion in Cloudflare Containers**. PO greenlit + asked for OAuth UX simplification alongside. Slicing into 4 shippable units:

| Slice | What ships | Effort | Status |
|---|---|---|---|
| **4d** — Inline connection state on the preview's approval grid + "Connect X →" buttons per row when token is missing | OAuth simplification benefits the EXISTING flow too, not just Phase 4. Ships first because S effort + immediate value. | S | **Building now** |
| **4a** — Remotion composition + Cloudflare Containers worker | The video render itself: photos → Ken Burns → title card + price card → music bed → 15-30s 9:16 MP4 stored in R2 | L | Queued |
| **4b** — IG Reels + FB Reels publish primitives in `lib/social/publish.ts` (extends today's IG Feed / FB Page primitives — same tokens, different Graph endpoints) | New publish targets enabled for the approval grid | M | Queued |
| **4c** — Approval grid expansion: 3×3 → 3×5 with IG Reel + FB Reel rows | UI tie-together: agent picks which cells → atomic publish with video too | S | Queued |

---

## 🟡 Next 5 — priority queue

Effort: S = same-session, M = 1-3 days, L = ≥4 days. Owner: who's blocking.

| # | Item | Why now | Effort | Owner |
|---|---|---|---|---|
| 1 | **Soft-beta recruitment + first end-to-end test** of the Free Audit → Approval Grid → Publish loop on your own account. | The wedge is BUILT but UN-VALIDATED. Nothing else matters until we know it works for one real agent. | S | **You** |
| 2 | **PO_DECISIONS #2-4 batch** — Super Pro price ($199/$249/$299) + paywall structure + music library. Needed before Phase 4 fully lands but not before slice 4a starts. | Unblocks the pricing page + the marketing positioning around Phase 4. | S (PO action) | **You** |
| 3 | **AI Customer Service Agent MVP** — knowledge ingestion (19a) → web chat replaces Tawk (19b) → confidence gating (19f). | ~7-day shippable slice; not blocked on Meta. Replaces Tawk + becomes the on-site sales engine. | L | Me (waiting on PO greenlight to commit to the 7-day window) |
| 4 | **Cost alerting on `ai_generation_log`** — if daily cost crosses $50 OR avg-per-audit crosses $1, email the operator. Sits on top of the admin dashboard data we already have. | Catches Anthropic invoice surprises before they happen; complements the `/admin/audit-costs` page. | S | Me |
| 5 | **Phase 3.5 — Multi-account publish picker on the approval grid.** Agents with multiple FB Pages today land on whichever one the OAuth callback ranked first; let them pick. | Onboarding friction for any agent with > 1 Page (most agency users); cheap to ship. | M | Me |

---

## 🔴 Blocked

| What | Blocker | ETA / Action |
|---|---|---|
| **Instagram publishing** for any agent | Meta Business Verification in review | Meta, ~3-5 business days from 2026-05-17 |
| **Live IG/FB publishing for non-PO agents** | Meta App Review submission | **You**, PO_ACTIONS §2 |
| **Stripe LIVE mode** | DECISIONS.md entry required per CLAUDE.md hard rule #9 | **You**, ~15 min |
| **Stripe LIVE `WELCOME5` coupon** | Only exists in TEST today; recreate after live flip | **You**, ~5 min via dashboard |
| **21st.dev key revocation** | Leaked in chat 2026-04-30, never rotated (package removed; key still exists in their dashboard) | **You**, ~2 min |
| **Phase 6 — Push to Ads Manager** | Google Ads API approval (~3 weeks) | **You** when ready to start |

---

## ✅ Shipped this week (2026-05-11 → 2026-05-17)

**Today (2026-05-17)** — `c385f93` Phase 3 approval grid + atomic publish · `8ed3d61` Phase 2 Creative Factory · `2602016` Phase 1 Free Audit widget · `c44d6e7` bright theme · `7108266` X-Robots-Tag noindex on authed surfaces · `16f73e4` devIndicators off · `0a62c41` source maps off · `5d138d7` super-structure (STATUS / PO_DECISIONS / TEST_PLAN docs + operating protocol) · **`c292539` IG self-serve setup guide at /instagram-setup in 7 locales + link from the IG-not-detected nudge** · **`9f39da2` Phase 5 Multilingual Context Engine — per-market system prompts (US/ES/PL/PT/DE/FR/IT) so PL/DE/FR/IT/PT drafts come out in the actual target language with local jargon + CTAs instead of English fallback** · **`69e2a80` Phase 2.5 Per-locale visual treatment on Creative Factory — per-market color palettes (DE Bauhaus white+charcoal, IT Tuscan beige+terracotta, FR Parisian cream+navy, PL clean white+navy, PT cream+sage, ES warm sand+terracotta, US cream+green) so graphics match the per-market caption tone** · **`9dbea57` Phase 4 slice 4d — inline OAuth connection state on approval grid (pill strip above grid with ✓ + display name OR "Connect →" link, returnTo preserves so OAuth bounces back to same preview; checkboxes disabled in unconnected columns with "not connected" hint)** · **`03427af` Phase 5.5 ai_generation_log migration + per-call AI usage logging (migration 0061; new src/lib/ai/cost.ts + src/lib/ai/log.ts; runAudit logs per-locale drafter calls with market + latency + token usage + estimated cost in USD cents; /api/social/ai-draft also logs)** · **`1595ea8` Cron to prune unclaimed audits past expires_at — new /api/cron/audit-prune Pages route + workers/audit-prune/ scheduled worker (03:30 UTC daily); ON DELETE SET NULL on ai_generation_log FK means cost history is preserved through pruning** · **`dd9a36d` Fundraise toolkit — docs/PITCH_OUTLINE.md (1-page narrative scaffold for cold VC outreach) + /[locale]/investors landing page (live at /en/investors, noindex, demo CTA + moat + roadmap + ask + contact) + migration 0062 audit_funnel_events table + preview page instrumented with preview_view / preview_claim events for the "X% conversion" pitch metric** · **`71a4e80` importFromUrl Sonnet call now logged to ai_generation_log (purpose='audit_import') — closes the ~30-50% cost-accounting gap; both Free Audit pipeline AND /api/listings/import surface log; importFromUrl return shape changed to {facts, usage, latencyMs, model} so the existing test script + both callers picked up the change cleanly** · **`371da4b` /admin/audit-costs tiny dashboard — 4 top-line tiles (7d cost / 30d cost / avg-per-audit 7d / avg-per-audit 30d with $0.30 target benchmark) + daily rollup table (last 30 days) + per-market table + last-20-audits table; reads from ai_generation_log via service-role admin client; new "AI costs" tab on the /admin nav** · **`e3adc50` Instagram drift cron (Phase 3 of INSTAGRAM_SHARING_PLAN.md) — migration 0063 meta_drift_notifications + /api/cron/instagram-drift Pages route + workers/instagram-drift/ standalone Worker (04:30 UTC daily, 30 min after meta-token-refresh so it sees fresh tokens) + email template instagram-newly-linked.ts; detects agents who linked IG Business in Meta Business Suite after their last AHO OAuth grant, emails them once per (user, ig_id) to click Reconnect** · header redesign (Real estate agent / Save dropdowns + Home) · garlic logo iterations → wordmark only · IG-not-detected nudge on /dashboard/social · Meta domain verification meta tag · property edit page layout fixes · dashboard security audit (4 layers all green)

**Earlier this week** (per `docs/PROGRESS.md` 2026-05-15 entry) — Google OAuth full stack · LinkedIn personal-profile publishing pulled from v1.1 to Stage 1 · MFA QR bug fix · reset-password AAL2 flow · 21st.dev removal · admin comp seat for `info@advertisehomes.online` · Super Pro Stage 1 plan doc (282 lines)

---

## 📦 Punch list — small things mentioned but not lost

Pull from here when there's slack between bigger items. Each is genuine ≤1-2 hour work.

- Cost alerting on `ai_generation_log` daily rollup (target ≤$0.30/audit; alert at $1/audit + at $50/day spend)
- Turnstile on Free Audit submit (current defense is IP rate-limit 5/hour; add Turnstile after first bot abuse signal)
- LinkedIn `DRY_RUN=false` flip — already publishes real; verify first real post lands then write the DECISIONS.md entry
- Phase 3.5 multi-account picker — if an agent has multiple FB Pages, currently we publish to the first one; let them pick
- Phase 3.5 real-time publish progress polling — current UX: button shows "Publishing…" for ~5-10s then results land
- Real-time `published_results` updates without page refresh
- Dashboard Lighthouse re-test in incognito (the 30/100 score was contaminated by Chrome extensions + IndexedDB per Lighthouse's own warning; expected real score 75-85)

---

## How to use this file

- **Read it first** when you start a session.
- **Type `status` to me** in chat — I'll re-read it, summarize the top 3 things, and propose where to start.
- **I keep it current.** Every commit that ships a feature → I move it from "Now" / "Next" → "Shipped." Every blocker I hit → goes into "Blocked." Every nice-to-have you mention → goes into "Punch list" so it isn't lost.
- **Don't put aspirational content here.** Long-term vision lives in `docs/SUPER_PRO_STAGE_1_PLAN.md`, `docs/EXECUTION_PLAN.md`, etc. This file is operational reality.
