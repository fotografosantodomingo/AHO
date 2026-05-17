# STATUS — where we are right now

> The single place to look for "what's happening." Read this first when you start a session. Type **`status`** to me at the start and I'll read this, propose the next action, and either get your sign-off or redirect.
>
> I (Claude) keep this file accurate. Last update: 2026-05-17.

---

## 🟢 Now — actively in flight

*(Nothing right now — Stage 1 Phases 1-3 just shipped. Ready to pick the next thing from the 🟡 queue.)*

---

## 🟡 Next 5 — priority queue

Effort: S = same-session, M = 1-3 days, L = ≥4 days. Owner: who's blocking.

| # | Item | Why now | Effort | Owner |
|---|---|---|---|---|
| 1 | **Soft-beta recruitment + first end-to-end test** of the Free Audit → Approval Grid → Publish loop on your own account. | The wedge is BUILT but UN-VALIDATED. Nothing else matters until we know it works for one real agent. | S | **You** |
| 2 | **Phase 4 — Auto-video Reels/TikTok engine.** Super Pro tier paywall feature. | $199-249/mo tier needs this differentiator before pricing change makes sense. | L | Me (waiting on PO decision in `PO_DECISIONS.md` #1) |
| 3 | **AI Customer Service Agent MVP** — knowledge ingestion (19a) → web chat replaces Tawk (19b) → confidence gating (19f). | ~7-day shippable slice; not blocked on Meta. Replaces Tawk + becomes the on-site sales engine. | L | Me (waiting on PO greenlight to commit to the 7-day window) |
| 4 | **Phase 2.5 — Per-locale visual treatment on Creative Factory.** US bright sans / DE technical mono / IT serif + warm cream / PL bold accent in `route.tsx`. | Today all 7 locales render with one neutral template; per-market visual matches the per-market caption tone shipped in Phase 5. | M | Me |
| 5 | **`ai_generation_log` migration + per-audit cost tracking.** Per the SUPER_PRO_STAGE_1_PLAN.md §5 + §7 unit-economics target (≤$0.30/audit). Today token usage lands on `ai_audits` columns; this normalizes into a per-call log + adds a daily cost rollup. | First soft-beta cohort generates ≥50 audits/day; we need cost observability before we get a surprise Anthropic invoice. | S | Me |

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

**Today (2026-05-17)** — `c385f93` Phase 3 approval grid + atomic publish · `8ed3d61` Phase 2 Creative Factory · `2602016` Phase 1 Free Audit widget · `c44d6e7` bright theme · `7108266` X-Robots-Tag noindex on authed surfaces · `16f73e4` devIndicators off · `0a62c41` source maps off · `5d138d7` super-structure (STATUS / PO_DECISIONS / TEST_PLAN docs + operating protocol) · **`c292539` IG self-serve setup guide at /instagram-setup in 7 locales + link from the IG-not-detected nudge** · **`9f39da2` Phase 5 Multilingual Context Engine — per-market system prompts (US/ES/PL/PT/DE/FR/IT) so PL/DE/FR/IT/PT drafts come out in the actual target language with local jargon + CTAs instead of English fallback** · header redesign (Real estate agent / Save dropdowns + Home) · garlic logo iterations → wordmark only · IG-not-detected nudge on /dashboard/social · Meta domain verification meta tag · property edit page layout fixes · dashboard security audit (4 layers all green)

**Earlier this week** (per `docs/PROGRESS.md` 2026-05-15 entry) — Google OAuth full stack · LinkedIn personal-profile publishing pulled from v1.1 to Stage 1 · MFA QR bug fix · reset-password AAL2 flow · 21st.dev removal · admin comp seat for `info@advertisehomes.online` · Super Pro Stage 1 plan doc (282 lines)

---

## 📦 Punch list — small things mentioned but not lost

Pull from here when there's slack between bigger items. Each is genuine ≤1-2 hour work.

- Per-locale visual treatment on Creative Factory (US bright sans, DE technical mono, IT serif + warm cream, PL bold accent) — currently one neutral template for all 7 locales
- Cost alerting on `ai_audits` once we have ≥10 prod audits (target ≤$0.30/audit; token usage already columns logged)
- Cron to prune unclaimed `ai_audits` past `expires_at` (7-day TTL — table will accumulate ~free for first few weeks)
- Turnstile on Free Audit submit (current defense is IP rate-limit 5/hour; add Turnstile after first bot abuse signal)
- LinkedIn `DRY_RUN=false` flip — already publishes real; verify first real post lands then write the DECISIONS.md entry
- Phase 3.5 multi-account picker — if an agent has multiple FB Pages, currently we publish to the first one; let them pick
- Phase 3.5 real-time publish progress polling — current UX: button shows "Publishing…" for ~5-10s then results land
- Real-time `published_results` updates without page refresh
- Dashboard Lighthouse re-test in incognito (the 30/100 score was contaminated by Chrome extensions + IndexedDB per Lighthouse's own warning; expected real score 75-85)
- `docs/INSTAGRAM_SHARING_PLAN.md` Phase 3 — drift cron (daily `/me/accounts` poll, email agents who newly linked IG)

---

## How to use this file

- **Read it first** when you start a session.
- **Type `status` to me** in chat — I'll re-read it, summarize the top 3 things, and propose where to start.
- **I keep it current.** Every commit that ships a feature → I move it from "Now" / "Next" → "Shipped." Every blocker I hit → goes into "Blocked." Every nice-to-have you mention → goes into "Punch list" so it isn't lost.
- **Don't put aspirational content here.** Long-term vision lives in `docs/SUPER_PRO_STAGE_1_PLAN.md`, `docs/EXECUTION_PLAN.md`, etc. This file is operational reality.
