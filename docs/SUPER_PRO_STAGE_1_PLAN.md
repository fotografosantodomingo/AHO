# Super Pro — Stage 1 plan: "Paste URL → full multi-channel campaign"

> **The wedge.** Strategic vision (`aho_strategic_vision.md`, 2026-05-07): AHO is a global ad-automation leader. Stage 1 = agent pastes any listing URL → AHO returns a complete multi-platform campaign (graphics + copy + auto-video + ready-to-publish) tuned to the local market. Hook line: *"feel like a marketing genius without doing anything."*
>
> Started: 2026-05-15 · Owner: dev (with PO checkpoints called out) · Cross-refs: `docs/EXECUTION_PLAN.md` (parent 90-day plan), `docs/SOCIAL_AUTOMATION_PLAN.md` ($99 Pro Automation Phase A-K), `docs/CONTENT_HUB_VISION.md` (broader strategic frame).

---

## 1. What "Stage 1 done" means

Acceptance bar — every one of these holds on production for a cold visitor:

1. **Anonymous visitor pastes any portal URL on /for-agents → 60 seconds later sees a preview screen with:**
   - Listing facts (title, price, beds/baths, area, photos) extracted from the source
   - **9 captions** = 3 platforms (FB / IG / LinkedIn) × 3 locales (EN / ES / PL)
   - **3 static graphic formats** = FB 1200×630, IG 1080², Pinterest 1000×1500 — listing photo composited with title + price + brand
   - **1 Reel/TikTok video** = 15–30s Ken-Burns of the photos with localized captions
   - **Predicted weekly reach + lead estimate** per platform (cold-start heuristic OK)
2. **Anonymous → signup → first ad live in ≤ 5 minutes** end-to-end (anonymous preview → email signup → connect FB → approve all → publish all).
3. **AI cost per preview ≤ $0.30.** Tracked in `ai_generation_log` (new table) so we can model unit economics before scaling.
4. **Supported source portals work without scrapers breaking:** otodom.pl, idealista.com, zillow.com, rightmove.co.uk, immobilienscout24.de, leboncoin.fr + generic schema.org fallback. (URL parser already exists — see §2.)
5. **Multi-language copy is *localized*, not translated.** US "lifestyle dream" tone; DE "tech specs + Quadratmeter"; PL "praktyczność + lokalizacja"; IT "vista + emozione"; ES "estilo + ubicación". Per-market system prompts.
6. **Pro Automation $99 tier publishes to FB + IG.** Higher Super Pro tier ($199–249/mo, TBD per PO) adds: auto-video, paid ads on FB/IG/Google, predictive budgeting, white-label PDF report.

If any of these is "best-effort", it's not Stage 1 done.

---

## 2. What already exists (don't rebuild)

Audit on 2026-05-15. Confirmed by file inspection — these are real, not aspirational.

| Capability | File(s) | Lines | Status |
|---|---|---|---|
| **URL → listing facts importer** (Claude Sonnet 4.6, JSON-LD + body, 6 portals + fallback, cost < $0.10) | `src/lib/listings/import-from-url.ts` | 428 | ✅ Production |
| **Voice → listing importer** (agent dictates, gets structured data) | `src/lib/listings/import-from-voice.ts` | 222 | ✅ Production |
| **AI ad-caption drafter** (Claude Haiku 4.5, tool-use JSON, FB+IG+LinkedIn) | `src/lib/social/ai-drafter.ts` | 348 | ✅ Production |
| **Post formatter** (deterministic templates per platform) | `src/lib/social/post-formatter.ts` | 335 | ✅ Production |
| **Multi-platform publish pipeline** (FB Page + IG single + IG carousel 3-step) | `src/lib/social/publish.ts` | 555 | ✅ Production |
| **`/api/social/ai-draft`** + **`/api/social/post`** routes | `src/app/api/social/*` | — | ✅ Production |
| **Encrypted token storage** (5-platform `ad_platform_tokens` + RLS + decrypt RPC) | migration 0036 | — | ✅ Production |
| **Audit tables** (`social_posts`, `social_post_attempts` with idempotency) | migration 0052 | — | ✅ Production |
| **Connect-FB UI** + share button on listing detail | `src/components/social/*`, `src/components/listings/share-to-socials.tsx` | — | ✅ Production |
| **Meta token-refresh cron** (daily, 60d expiry) | `workers/meta-token-refresh/` | — | ✅ Production (deployed 2026-05-14) |
| **CF Images variant pipeline** (R2 originals → variants) | `NEXT_PUBLIC_CF_IMAGES_HASH` + uploads | — | ✅ Production |
| **AI Copywriter dashboard surface** | `src/app/[locale]/dashboard/copywriter/*` | — | ⚠️ Exists but not full Stage-1 flow |
| **Cloudflare Pages + Workers + Queues** | `wrangler.toml`, Worker dirs | — | ⚠️ Queues exist but not the 4 Stage-1 ones |

**Net:** ~1900 LOC of AI/social plumbing is shipped. The wedge feature is **60-70% built**. Remaining work is the unified "paste URL → preview screen → approve all → publish all" UX *plus* the Creative Factory + auto-video + multilingual context engine.

---

## 3. What's missing — six phases sequenced by value-per-week

Each phase has: deliverable, key files, est. complexity (S/M/L), depends-on, what it unblocks.

### Phase 1 — Free Audit widget on `/for-agents` (Week 1; complexity M)

**Deliverable.** Anonymous-visitor `/for-agents` page gets a hero widget: text input "Paste your listing URL", primary button "Get my campaign". Submit → server fetches via `import-from-url.ts` → seeds a temporary preview record → redirects to `/preview/[temp-id]`. Preview page shows the facts + 3 captions × 3 locales × 3 platforms = 9 captions, rendered as cards next to a CTA "Sign up to publish these on Facebook + Instagram in 1 click." (No graphic factory yet — Phase 2 adds it.)

**Why first.** Lowest-cost wedge that immediately demonstrates Stage 1 magic. No new AI capability — composes `import-from-url` + `ai-drafter` that already exist. The preview is the hook that drives signup. **This is the headline acquisition moment that the strategic vision is centered on.**

**Files to create/change:**
- `src/app/api/audit/start/route.ts` — POST {url} → calls `importFromUrl()` + `draftSocials()` (3 platforms × 3 locales) → inserts `ai_audits` row → returns `{auditId}`
- `src/db/migrations/0058_ai_audits.sql` — table `ai_audits (id, source_url, facts jsonb, drafts jsonb, locale_set, created_at, expires_at 7d, claimed_by_user_id nullable)` + RLS (public read by id, no write)
- `src/app/[locale]/preview/[auditId]/page.tsx` — server-rendered preview screen
- `src/components/marketing/free-audit-widget.tsx` — hero widget (paste + submit + loading state)
- `src/app/[locale]/for-agents/page.tsx` — inject widget as hero
- `messages/{en,es,pl,pt,de,fr,it}.json` — `freeAudit.*` keys (~25 each)
- `tests/unit/ai-audits.test.ts` — RLS pair + edge cases (rate limit per IP, malformed URL, source portal 404)

**Depends on.** Nothing. All inputs exist.

**Unblocks.** Phase 2 graphic factory (audit already has all the data). Phase 3 multi-channel grid. Lead-gen funnel for soft-beta agent recruitment (this widget IS the conversion mechanism).

**Risks / mitigations.**
- *Cost runaway from bot abuse.* → IP rate limit (5/hour anon) + Turnstile on submit + per-audit cost cap at $0.30 (Claude max_tokens cap).
- *Scraping ToS gray zone.* → Anonymous audit reads the *public* portal page (same as a Google bot). User submits the URL, claiming authorship. Doc updated: agent must have authority over the listing to publish derivatives.
- *Source portal serves a bot-challenge page.* → `import-from-url.ts` already detects via `MIN_BODY_BYTES_FOR_REAL_PAGE`; on detect, return a friendly "this portal blocks scrapers — paste the listing details manually" fallback.

**PO checkpoint at end:** Free Audit widget live on prod. Cold-visitor test: open incognito, paste a real otodom.pl URL, get 9 captions within 60s. If yes → ship the marketing push (LinkedIn + agent outreach point at /for-agents).

---

### Phase 2 — Creative Factory v1 (Week 2; complexity M-L)

**Deliverable.** Same audit, but `/preview/[auditId]` now also shows **3 graphic formats per platform** = FB feed 1200×630, IG square 1080², Pinterest 1000×1500. Generated server-side from the source listing photo (or first hero photo) composited with: title overlay, price chip, AHO brand mark, locale-appropriate CTA text. Stored as new variants in CF Images.

**Why second.** Captions alone read as "AI text generator." Captions + branded graphics read as "marketing team." This is the moment a visitor goes from "neat" to "I need this."

**Files to create/change:**
- `src/lib/creative/factory.ts` — pure function: takes (photoUrl, listingFacts, locale, platform) → returns SVG (or canvas-rendered PNG) layered with text. We composite server-side (Edge runtime, satori for SVG-to-PNG conversion).
- `src/lib/creative/templates/` — one template per (platform × locale-feel). FB-US, IG-DE, etc. Templates are TSX-like JSX-to-SVG via satori.
- `src/app/api/audit/[id]/creatives/route.ts` — GET → generates if not cached, returns `{platform, format, cfImageId}[]`
- Background job (Cloudflare Queue `q.creative-gen`) — async generation so preview screen progressively renders as creatives complete
- `src/db/migrations/0059_audit_creatives.sql` — `audit_creatives (audit_id, platform, format, cf_image_id, generated_at)`
- `tests/unit/creative-factory.test.ts` — snapshot tests of SVG output per platform × locale

**Depends on.** Phase 1 (`ai_audits` row exists).

**Unblocks.** Phase 3 approval grid (needs creatives to show). The visual "wow" moment that converts.

**Risks / mitigations.**
- *Generated graphic looks generic / template-y.* → Per-locale visual treatment: US bright + bold sans, DE clean + technical mono accents, IT serif + warm cream background, PL bold accent color. Each template is ~50 LOC of JSX.
- *Photo composition fails on portrait vs landscape.* → Detect aspect ratio of source photo, pick layout variant (photo-left vs photo-top vs photo-full-bleed).
- *Satori limits / Edge runtime memory.* → 1024×1024 max per render; chunked queue jobs (one at a time per audit) so we don't hit Edge memory ceiling.

**Open product decision:** Brand mark on every generated creative — bold "Powered by AHO" footer, or subtle corner watermark? Conversion ask: which makes the agent more likely to use the asset? **PO decide.**

---

### Phase 3 — Multi-channel approval grid (Week 3; complexity S-M)

**Deliverable.** Logged-in agent (any tier from Agent $29 up — gated on signup at this point, paywall comes later) on `/preview/[auditId]` sees a grid: rows = platforms (FB / IG / IG Story / LinkedIn), cols = (caption, graphic, video placeholder). Each cell has its own approve checkbox + edit button. Single primary button "Publish approved (N)" — atomic fan-out to all checked items.

**Why third.** Captions + graphics exist, but until there's a one-click "publish all approved" the agent still has to do per-platform legwork. This is the moment the loop closes.

**Files to create/change:**
- `src/app/[locale]/preview/[auditId]/page.tsx` — extend with grid (currently just cards)
- `src/components/preview/approval-grid.tsx` — checkbox-per-cell + sticky footer "Publish (N)"
- `src/app/api/audit/[id]/publish/route.ts` — POST {selections: {platform, format}[]} → enqueues to `q.publish` per platform → returns `{publishJobId}`
- `src/app/[locale]/preview/[auditId]/publishing.tsx` — real-time status panel (polls `q.publish` results)
- `src/lib/social/publish.ts` — already does the per-platform work; we just orchestrate
- `tests/unit/approval-grid.test.ts` — partial-success semantics (FB OK, IG fails: row 1 ✓, row 2 ✗ with reason)

**Depends on.** Phase 1 + 2. Requires Meta App Review approved OR test-mode tester agent.

**Unblocks.** The "30-second from cold visitor to live ad" headline moment.

**PO checkpoint:** SOP for soft-beta cohort uses this flow. Agent's first session on AHO is: free audit → see preview → sign up → connect FB → approve all → published. Target: < 5 min cold-to-live.

---

### Phase 4 — Auto-video engine for Reels/TikTok (Week 4-5; complexity L)

**Deliverable.** From the listing photos (3-8 photos typical), generate one 15–30s vertical 9:16 video with: Ken Burns motion on each photo (3–4s each), title card at the start, price card at the end, optional music bed (royalty-free Pixabay / FMA). Captions burned into the video per locale. Output stored in CF Stream or R2.

**Why fourth.** Reels/TikTok is the highest-converting format in 2026 real-estate ads (per the strategic vision memo). Static graphics + captions get the agent to "wow." Video gets the agent to "I'll pay $99 for this." This is the **Super Pro tier ($199-249/mo) differentiator** — Pro Automation $99 stays at static/carousel; Super Pro adds video.

**Technical choice — pick one:**
- **A) Remotion in a long-running Node Worker on Cloudflare Containers** (released 2026, GA). Cleanest JSX-to-MP4 pipeline. Cost: ~$0.05/video. Latency: 30-60s per video. **Recommended.**
- **B) FFmpeg-WASM in a Worker.** Cheaper (no Containers fee), but CPU-bound on Workers; 15s render budget is tight for 30s output.
- **C) External service (Creatomate / Bannerbear).** Fastest to ship but ~$0.50-1.00 per video. Reasonable if Stage 1 launch is urgent; pull in-house in Phase 6 if margins demand.

**Files to create/change:**
- New worker dir `workers/video-engine/` with Remotion composition + scheduled fetch handler
- `wrangler.toml` queue `q.video-gen`
- `src/lib/creative/video-script.ts` — listing → Remotion props (photo URLs, durations, captions, music bed pick)
- `src/db/migrations/0060_audit_videos.sql` — `audit_videos (audit_id, locale, r2_key, duration_s, status, generated_at)`
- `src/app/api/audit/[id]/video/route.ts` — POST to enqueue, GET to poll status

**Depends on.** Phase 1 (audit row). Phase 2 *not* strict — video uses raw photos, not Factory graphics.

**Unblocks.** Super Pro pricing tier (PO sign-off needed on $199-249 price point — see §5 Open product decisions).

**Risks / mitigations.**
- *Music licensing.* → Royalty-free libraries only (Pixabay, FMA, YouTube Audio Library) with attribution stored on each render. No Spotify / commercial tracks.
- *Auto-video looks Zillow-template-y.* → Per-locale visual treatment continues: US-style energetic 24fps with quick cuts, DE-style measured 4s holds, IT-style cinematic Ken Burns + warm grade.
- *Generative video drift (true gen-video = unpredictable).* → Stick to deterministic template-based motion. No "AI video generator" — predictability beats novelty for real estate.

---

### Phase 5 — Multilingual Context Engine (Week 5-6; complexity M)

**Deliverable.** Replace the single `ai-drafter` prompt with **per-market system prompts** that bake in local emotional levers + real-estate jargon. New `MARKET` dim joins (locale, platform) in the drafter call. Examples:

| Market | Tone | Jargon | Closing CTA |
|---|---|---|---|
| US (en-US) | Lifestyle dream, aspirational | "sqft", "HOA", "closing costs" | "Schedule a tour" |
| UK (en-GB) | Practical, freehold/leasehold-aware | "sq m", "freehold", "EPC" | "Book a viewing" |
| DE (de-DE) | Technical precision + sqm/efficiency | "Wohnfläche", "Energiebedarf", "Baujahr" | "Besichtigung vereinbaren" |
| PL (pl-PL) | Practicality + location | "metraż", "RTV/AGD", "stan deweloperski" | "Umów oglądanie" |
| IT (it-IT) | View + emotion | "trilocale", "vista mare", "rifinito" | "Prenota visita" |
| ES (es-ES) | Style + ubicación | "metros², estado, urbanización" | "Reservar visita" |
| PT-BR (pt-BR) | Aspirational + family | "m²", "condomínio", "vista" | "Marcar visita" |

**Why fifth.** Translation alone passes for "AI ad generator." Localization is the moat. Anyone can pipe a listing through GPT for English copy. Few competitors have *seven* market-specific persona engines.

**Files to create/change:**
- `src/lib/social/market-prompts.ts` — per-market system prompt builders + tone guardrails
- `src/lib/social/ai-drafter.ts` — accept `market` param, route to the right prompt
- `src/db/migrations/0061_ai_market_index.sql` — `ai_generation_log` gains `market` column for unit-economics tracking
- `tests/unit/market-prompts.test.ts` — snapshot tests per market × platform (prevents prompt drift across PRs)

**Depends on.** Phase 1 (need the drafter call to exist before specializing it).

**Unblocks.** Multi-market expansion. Every soft-beta cohort outside DR uses this. Counters generic-AI-marketer competitor positioning.

**Open product decision:** Do we expose the market selector to the agent ("preview as US / DE / PL") or auto-detect from listing country + locale? Auto-detect is the magic UX; manual selector is the safety valve. Suggest: auto-detect, with a quiet "preview as a different market" overflow link.

---

### Phase 6 — Push to paid Ads Manager (Week 7-9; complexity L)

**Deliverable.** Beyond organic FB/IG post: actual paid ad creation via the platform Ads APIs.

- **FB + IG paid ads** via Marketing API (separate from publish API) — create AdSet + Ad with the Phase 2/4 creatives, draft mode by default (agent confirms in their Ads Manager before launch).
- **Google Search + Display ads** via Google Ads API — title + description + image extension, ad-group level.
- **Predictive budgeting (v1)** — per-city CPM lookup from FB Ad Library + IG public benchmarks; show "Madrid €50/d to be competitive, Kraków €15/d works." Cold-start uses world-region defaults until we accumulate per-market data.

**Why sixth.** This is the moment AHO goes from "ad generator" to **"ad agency that doesn't sleep."** The strategic vision's promise: agent never leaves AHO; ad goes live in their Ads Manager. Highest pricing leverage in Super Pro tier.

**Files to create/change:**
- `src/lib/ads/meta-marketing.ts` — create draft ad set + ad in agent's connected Business Manager
- `src/lib/ads/google-ads.ts` — Google Ads API client (OAuth2 + customer ID; new OAuth path needed)
- `src/lib/ads/budget-predictor.ts` — per-city heuristic; data sources documented inline
- `src/db/migrations/0062_ad_campaigns.sql` — `ad_campaigns (id, audit_id, platform, ad_set_external_id, ad_external_id, status, projected_cost_eur)`
- `/api/ads/create/route.ts` — POST to enqueue + create draft

**Depends on.** Phase 1-5. Plus: new Google Ads OAuth flow (separate from existing FB/IG OAuth).

**Unblocks.** Super Pro tier launch. v1.1 milestone M3 ("test campaign in 2 markets").

**Risks / mitigations.**
- *Accidental live spending.* → Hard rule: all created ads stay in DRAFT until agent confirms in their Ads Manager. AHO never auto-launches a paid campaign. Mirrors CLAUDE.md hard rule #9 posture.
- *Google Ads API approval.* → Manager-account-required + dev-token approval can take weeks. Apply early; this is a PO action that starts Week 7.

**PO checkpoint:** End of Phase 6 = Super Pro tier ships. PO confirms $199-249/mo price + which features paywall to which tier.

---

## 4. Sequencing — calendar from today

Today is 2026-05-15. Stage 1 target: Phase 1-3 by Day 35 (matches Sprint 2 close in `EXECUTION_PLAN.md`). Phase 4-6 by Day 90.

| Week | Phase | Calendar | Acceptance |
|---|---|---|---|
| **1** (now) | Phase 1 — Free Audit widget | 2026-05-16 → 2026-05-22 | Cold visitor pastes otodom.pl URL → 60s → preview with 9 captions |
| 2 | Phase 2 — Creative Factory | 2026-05-23 → 2026-05-29 | Same preview now also shows 3 graphic formats per platform |
| 3 | Phase 3 — Approval grid | 2026-05-30 → 2026-06-05 | Logged-in agent: free audit → signup → connect FB → approve → publish all (FB + IG live) |
| 4-5 | Phase 4 — Auto-video | 2026-06-06 → 2026-06-19 | Same flow + 1 vertical Reel attached to the preview, publishable to IG Reels + FB Reels |
| 6 | Phase 5 — Multilingual context | 2026-06-20 → 2026-06-26 | Per-market tone visible on preview; DE preview *reads* German, not translated English |
| 7-9 | Phase 6 — Ads Manager push | 2026-06-27 → 2026-07-17 | Draft paid ad lands in agent's FB + Google Ads Manager; predictive budget shown |

Stage 1 complete: **2026-07-17 (Day 63 of the 90-day plan).**

Stage 2 (glocal architecture — MLS integrations, local payments, market-by-market launch) takes Day 64-90 + extends into v1.1 per `EXECUTION_PLAN.md` Sprint 3.

---

## 5. Open product decisions (PO sign-off needed before kicking off each phase)

Listed by deadline.

| # | Decision | Phase blocking | Owner | Deadline |
|---|---|---|---|---|
| 1 | **Anonymous Free Audit available without signup?** Strategic vision says yes (lead-gen wedge). Risk: cost-per-bot-abuse. Mitigation: rate limit + Turnstile. | Phase 1 | PO | 2026-05-16 |
| 2 | **Brand mark on every generated creative** — bold "Powered by AHO" footer vs. subtle corner watermark? | Phase 2 | PO | 2026-05-23 |
| 3 | **Pricing tier paywall** — captions free for anon; graphics gated on signup (free tier); video gated on Super Pro? Or: everything free in preview, paywall on publish? | Phase 3-4 | PO | 2026-05-30 |
| 4 | **Super Pro tier price point** — $199, $249, $299/mo? + annual discount? Featured at hero on `/pricing`? | Phase 4-6 | PO | 2026-06-13 |
| 5 | **Music library + attribution policy** on auto-video. Pixabay only, or pay for Epidemic Sound (~$50/mo for the agency tier)? | Phase 4 | PO | 2026-06-06 |
| 6 | **Google Ads OAuth + dev token application** — needs to start ~3 weeks before Phase 6 due to Google's review. PO opens an Ads Manager account, gives Claude dev-token applicant access. | Phase 6 | PO | 2026-06-06 |

---

## 6. Parallel tracks (run alongside the phase sequence)

These don't block the phases but multiply their value when they land.

- **Meta App Review submission** (PO_ACTIONS §2, overdue from Day 3 of EXECUTION_PLAN). Blocks the $99 Pro Automation revenue ramp; Phase 3 onward needs this approved for non-tester agents to publish.
- **Soft-beta agent recruitment** (PO_ACTIONS §0 + §4). The Free Audit widget (Phase 1) IS the wedge for cold outreach: send any agent the URL, "we built you 9 ad captions in 60s for your latest listing." That's a stronger pitch than "subscribe to our platform."
- **MLS integrations (Stage 2)** — start scoping during Phase 4 so the second-market launch (PL or ES) lands with portal-of-record integration rather than manual listing entry.
- **Localized payment methods (Stage 2)** — BLIK (PL), Sofort (DE), iDEAL (NL). Stripe Elements covers all; activation work is per-market dashboard config + a feature flag.

---

## 7. Tracking + protocol

- Each phase ships as **one or more PRs**, each green on typecheck + lint + the new tests.
- Each phase ends with a **PROGRESS.md entry** (date + what shipped + what's next) per CLAUDE.md hard rule #7.
- Each phase end has a **PO checkpoint** — short demo in the daily review session.
- The phase cost-per-audit is **logged in `ai_generation_log`** so unit economics are observable before scaling. Target: < $0.30/audit at Phase 1, < $1.00/audit at Phase 4 (with video).

---

## 8. Why this plan is the right scope

- **Builds on what's already done** — 1900 LOC of AI/social plumbing wasn't accidental; the Stage 1 wedge has been the implicit destination since 2026-05-07. This plan makes it explicit + sequenced.
- **Each phase shippable on its own** — Phase 1 alone is a marketing win even if Phases 2-6 slip. We never get stuck "almost-done with the big bang."
- **PO acceptance bar is concrete** — every phase ends with "cold visitor does X, sees Y, in Z seconds." No fuzzy "polish" deliverables.
- **Strategic vision is preserved** — multilingual context engine, auto-video, predictive budgeting are all in scope, just sequenced behind the wedge that proves them.
- **Revenue gates are flagged** — Meta App Review must clear before Phase 3 monetizes; Super Pro tier opens at end of Phase 4. PO knows where the money-gates are.
