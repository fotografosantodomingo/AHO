# AHO 90-day execution plan

**Owner:** Michał (PO)
**Builder:** Claude (dev)
**Started:** 2026-05-07
**Strategic frame:** Active sales engine, not a database. See `aho_strategic_vision.md` (Claude memory) for the long-form vision.

> **Daily protocol.** PO opens a Claude session and writes one line: "**start dzień N**". Claude responds with: yesterday's report → today's PO list (1-3 items) → Claude's dev list (3-5 items). End of day: PR/commit summary + status. If a day is blocked on PO action, Claude says so explicitly and proposes parallel work.

> **Hard rule reminders.**
> - PO authorizes paid resources EXPLICITLY each time (CLAUDE.md hard rule #9).
> - Stripe stays in TEST until a DECISIONS.md entry promotes it.
> - No demo data, no stock photos. Test fixtures stay in `tests/`.

---

## Phase progression

| Phase | Days | Goal | Acceptance |
|---|---|---|---|
| Day 0 | TODAY | P0 map fix + 3 PO accounts created | Map renders + doesn't disappear; CF Images on; Meta dev app; Anthropic key in `.env.local` |
| Sprint 1 | Day 1-14 | Foundation (CF Images backfill, Meta App Review submitted, AI Copywriter v1, Queues, schema) | Listing-page Perf 85+; AI generates copy; Meta review "in review"; queues live |
| Sprint 2 | Day 15-35 | The "Magic" — paste-link → preview → publish | Soft-beta agent posts an ad on FB+IG (sandbox or live if Meta approved) |
| Sprint 3 | Day 36-90 | Scale — Google + LinkedIn + TikTok + Admin dashboard + 2-market launch | First paying $99 customer; 2nd market open with local payment methods |

---

## Day 0 — TODAY

### PO actions (≈45 min total, your side)
- [ ] **Cloudflare Images activation.** Dashboard → Images → "Get Started". Plan ~$5/mo + $1 per 100k requests. Use the same account ID `5a389e6eea7a4e92999c5f1612eafbcc`. After activation, paste the **CF Images Account Hash** (Dashboard → Images → "Use this URL" example) into chat — Claude needs it for `NEXT_PUBLIC_CF_IMAGES_HASH`.
- [ ] **Meta for Developers account.** developers.facebook.com → Get Started → create a **Business** app named `AHO Distribution` (or similar). Paste the **App ID + App Secret** into chat. Claude prepares the App Review submission text + screenshots; PO clicks Submit.
- [ ] **Anthropic API key.** console.anthropic.com → API Keys → Create Key, name it `aho-prod`. Paste the key into chat. Claude adds it to Cloudflare Pages secrets via wrangler (PO confirms first).

### Claude actions (today)
- [x] **Map fix shipped** — 3 changes: (1) map view never unmounts on empty results, (2) interaction detected via native pointer/wheel/keydown, (3) `/api/properties/by-bbox` accepts `include_no_coords=1` and returns no-coord listings at low zoom. PR + deploy + verification on `/pl/search?view=map` and `/en/search?view=map`.
- [x] **Execution plan committed** — this file.
- [ ] **PO Day-0 checklist** — sent in chat with screenshots / exact button names.
- [ ] **End-of-day report** — what shipped, what's waiting on PO, blockers.

### Day 0 acceptance
- ✅ Mapa pokazuje pin twojej PL nieruchomości i NIE znika.
- ⏳ CF Images aktywne (waiting on PO).
- ⏳ Meta dev app stworzona (waiting on PO).
- ⏳ Anthropic key w `.env.local` (waiting on PO).

---

## Sprint 1 — Foundation (Day 1-14)

### Week 1

| Day | PO action | Claude action | Acceptance |
|---|---|---|---|
| 1 | Confirm `NEXT_PUBLIC_CF_IMAGES_HASH` is set in Cloudflare Pages env vars (production). | `scripts/backfill-r2-to-cf-images.ts` — walks every `property_images.r2_key`, uploads to CF Images, writes back `cf_image_id`. Idempotent (skips if id exists). Run on prod. | Lighthouse `/pl/property` Perf 42 → **85+**. R12 in RISKS.md → resolved. |
| 2 | — | DB: `properties_per_country` materialized view (or RPC) + indexes. Returns `{country_code, count, centroid_lat, centroid_lng, min_price_cents, max_price_cents}`. | RPC callable; benchmark <50ms for full table scan. |
| 3 | Submit **Meta App Review** (Claude provides text + 5 screenshots + screencast script). Permissions: `pages_manage_posts`, `pages_show_list`, `instagram_basic`, `instagram_content_publish`. | App Review submission package + sandbox-mode FB publishing E2E test. | Meta review "In Review" status visible in Meta dashboard. |
| 4 | — | Map Etap B: at zoom 1-4, render one big pin per country with the count badge (`🇵🇱 12`); click → zoom in + filter. At zoom 5-9, city-level. At zoom 10+, marker clustering (existing). | `/search?view=map` at zoom 2 shows world view with country-count pins. |
| 5 | — | `wrangler.toml` extended with Cloudflare Queues: `q.ai-gen`, `q.publish`, `q.metrics-poll`, `q.token-refresh`. DECISIONS.md entry: "2026-05-XX — Cloudflare Queues for ad pipeline". | `wrangler queues list` shows the four. |
| 6 | — | Migration `0011_ad_creatives_campaigns.sql` — tables `ad_creatives`, `ad_campaigns`, `ad_campaign_metrics`, `ad_platform_tokens` + RLS + paired RLS tests. | Migration applied to prod; 4 new RLS test files green. |
| 7 | **Daily review session — 30 min in chat.** What works, what doesn't, what to drop. | Week-1 PROGRESS.md retrospective + Week-2 plan adjustments. | — |

### Week 2

| Day | PO action | Claude action | Acceptance |
|---|---|---|---|
| 8 | — | AI Copywriter v1: `lib/ai/copywriter.ts` + `app/api/ai/copywriter/route.ts`. Input: property facts JSON. Output: 3 caption variants × 1 locale (EN). Anthropic Claude Sonnet 4.6, system prompt tuned for real-estate marketing. | Manual test: paste a listing's facts, get back 3 distinct, idiomatic captions. |
| 9 | — | AI Copywriter v2: multilocale (EN, ES, PL). Per-market system prompts (US "lifestyle", PL "praktyczność + lokalizacja", ES "estilo + ubicación"). | 3 variants × 3 locales = 9 captions per call. |
| 10 | — | Creative Factory v1: Worker generates 3 graphic formats (FB feed 1200×630, IG square 1080², Pinterest 1000×1500) from a template + listing photo + Copywriter caption. Stored in CF Images under variant `ad_*`. | One listing → 9 caption variants × 3 graphic formats = 27 ready-to-publish creatives. |
| 11 | — | Preview screen `/preview/[temp-id]` (gated sign-up). Shows all generated creatives + per-platform CTA "Approve & publish on FB". | Anon visitor lands on preview, sees all 27 assets. |
| 12 | Test the Free Audit widget end-to-end as a fresh visitor. Send screen recording of any rough edges. | Free Audit widget on `/for-agents` — paste-URL → loading → `/preview/[temp-id]`. Otodom + Idealista + Zillow scrapers v1. | A real listing URL (not AHO) returns a usable preview within 60s. |
| 13 | — | Onboarding wizard 5-step in UI (sign-up → connect FB → import listing → preview → publish). | Cold visitor → first ad live (sandbox if Meta not yet approved) in <5 min. |
| 14 | **Daily review + Sprint 1 close.** | Sprint 1 retrospective in PROGRESS.md. Sprint 2 plan adjustments. | — |

---

## Sprint 2 — "Magic" (Day 15-35)

Not day-by-day yet — gets daily breakdown at Day 14 retrospective. High-level deliverables:

- **Video Engine** (Remotion or FFmpeg-in-Worker): photos → 15-30s Reels with localized captions.
- **Multilingual Context Engine** (DeepL + Claude per-market prompts): handles real-estate jargon properly per country.
- **Lead webhook** from FB Lead Ads → AHO `leads` table → instant push (in-app + email + WhatsApp).
- **Performance dashboard** in user UI: reach, impressions, CPL per platform.
- **Brevo digest emails:** `weekly.reach`, `lead.created`, `cpl.insight`, `creative.fatigue`.
- **Soft-beta launch** in Santo Domingo: 3-5 real agents, free for 30 days, mandatory weekly feedback session.

### Sprint 2 acceptance (Day 35)
- Soft-beta agent pastes `https://otodom.pl/...` (or any portal URL) on `/for-agents`.
- 30 seconds later, full preview: 9 captions × 3 graphic formats × 1 video Reel × 3 locales.
- Approve → ad live on FB+IG (sandbox if Meta still in review, live if approved).
- One agent's first lead arrives via the FB lead webhook.

---

## Sprint 3 — Scale (Day 36-90)

- Google Ads API (Performance Max).
- LinkedIn + TikTok publishers.
- Admin operations dashboard `/admin/operations` (pulse, top users, platform health, fraud signals).
- Predictive budgeting v1 (per-city CPM lookup via FB Ad Library API).
- White-label flag in `organizations.theme_overrides` JSONB.
- 2nd market launch (PL) with BLIK + Sofort + iDEAL via Stripe Elements.

### Sprint 3 acceptance (Day 90)
- First **paying** Pro Automation customer ($99/mo) actively using AHO.
- 2nd market open: PL agent can sign up + pay in PLN via BLIK.
- Admin operations dashboard live; Claude & PO can see system pulse in real time.

---

## Blocking event registry

When something blocks, log here with date + ETA. PO and Claude both write entries.

| Date | Blocker | Owner | ETA | Resolution |
|---|---|---|---|---|
| 2026-05-07 | CF Images not activated → R2 originals serve every listing image (R12 in RISKS.md) | PO | Day 0-1 | activation in CF dashboard |
| 2026-05-07 | Stripe in TEST mode (DECISIONS.md "Stripe live → test") | PO + dev | Day 30+ | live promotion after Meta + soft-beta |
| 2026-05-07 | Meta App Review not submitted | PO + dev | Day 3 submit, Day 30-60 approval | review process |

---

## Out-of-scope right now (DON'T start without explicit approval)

- AHO Plus tier polish (was on slice-2 critique list).
- Featured-ranking v1.
- Neighborhood overlays on map.
- MLS integrations (deferred to post-Day 90).
- White-label theming engine beyond the JSONB flag.

If something here becomes important, raise it in a daily review.
