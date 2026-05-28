# STATUS — where we are right now

> The single place to look for "what's happening." Read this first when you start a session. Type **`status`** to me at the start and I'll read this, propose the next action, and either get your sign-off or redirect.
>
> I (Claude) keep this file accurate. Last update: 2026-05-28 (week of first-agent-experience hardening; founder-rate kill + 3-agent audit + Gate 4 write-safety landed earlier in week).

## 🎯 This week's focus (2026-05-27 → 2026-05-31)

**Theme:** first-agent experience — walk the full DR/PL agent journey end-to-end and fix every rough edge before a recruited agent hits it. Strategic frame: product is over-built relative to distribution; everything between today and first revenue is activation + distribution, not code.

**My autonomous track this week:**
- Walk the "first 10 minutes" demo path as if I were a recruited agent
- Fix every friction item as I find it (separate atomic commits)
- Ship `docs/PATH_TO_1M.md` so the revenue map survives sessions

**Cheap PO wins that compound my work (priority order):**
1. **CF Pages Cache Rule** (PO_DECISIONS #6, 5 min) — homepage/listing/blog drop from ~2s to <100ms
2. **Stripe LIVE flip + DECISIONS entry** (15 min) — currently cannot collect a dollar
3. **Apply migrations 0078 + 0079 to prod** (or authorize me to) — plan-override feature 500s without 0078; defense-in-depth REVOKE doesn't engage without 0079

---

## 🆕 Sprint 2026-05-22 → 2026-05-28 (this session block)

**Single-week summary:** killed the $19/mo "first 50 agents" founder rate across 11 surfaces (PO clarified it wasn't real); shipped the Founding 50 recruitment funnel (landing + form + admin + emails) at `/founding-agent`; added manual plan-override admin tool for free-comp / extend / revoke without Stripe; fixed a 60→90 day private-listing billing/marketing drift via a single-source-of-truth constants module; added in-browser voice chat (Web Speech API) to the AHO Assistant with text/voice mode picker; hardened pre-push hook from 1 gate to 4 (typecheck + lint + tests + write-safety); fixed Polish auto-translate FOUC via `translate="no"`; fixed `/en/en/` double-prefix on 5 Free Audit hrefs.

**Then ran a 3-agent parallel audit (Opus, isolated worktrees):**

| Audit | Headline |
|---|---|
| Security | 27 sites where Supabase/Whisper/Brevo raw error text was leaking to anon callers → opaque codes |
| Edge-runtime safety | 13 silent-write-failure `{ error }` destructure adds; new `0079` REVOKE migration on 4 service-role-only tables |
| i18n correctness | 1 double-prefix fix; ~20 hardcoded EN aria-labels / ternaries → `t()` calls; ~107 missing keys × 5 non-EN locales backfilled (~535 native translations) |

**Plus follow-up hardening:** 8 RPC sites missing `{ error }` destructure fixed (Meta×3 + LinkedIn `upsert_platform_token`, `release_founder_rate_slot`×2, `sweep_stale_pending_images`, `record_photo_import_failure`, `resolve_photo_import_failure`); `void pingIndexNow` → `await` so Edge doesn't cancel every publish's IndexNow ping; new `scripts/lint-write-safety.ts` + Gate 4 in pre-push so these three bug classes can't regress.

| Commit | Layer | Impact |
|---|---|---|
| `35bcc91` | hardening | RPC destructure + Edge gaps + Gate 4 write-safety scanner |
| `c4c9fc5` | i18n | merge: 1 double-prefix + ~20 EN→t() + ~535 native translations |
| `36c1a3e` | edge | merge: 13 destructure + new 0079 revoke migration |
| `ec060b4` | security | merge: 27 error-leak fixes |
| `e873998` | i18n FOUC | `translate="no"` + `<meta name="google" content="notranslate">` |
| `f7bac77` | routing | drop `/en/en/` double-prefix on 5 Free Audit hrefs |
| `c036c0a` | pricing | retire $19/mo "first 50" founder rate (per PO) |
| `19fdec8` | AI prompt | rewrite Voice section — kill robotic bulleted/numbered lists |
| `4c9793e` | infra | pre-push: 1 gate → 3 gates (typecheck + lint + tests) |
| `b7f65f2` | billing | 60→90 day private-listing constants module + drift-guard test |
| `5de8eb1` + `e3d367d` | chat | in-browser voice mode (Web Speech API) + entity escaping |
| `72c6619` | admin | manual plan overrides — grant/extend/revoke comps without Stripe |
| `6cd226a` | recruit | Founding 50 funnel: landing + form + admin + welcome+alert emails |

**Live on prod (verified all 200s as of 2026-05-27 23:00 UTC):**
- `/en/founding-agent` — Founding 50 recruitment funnel
- `/en/admin/founding-agents` — moderation queue
- `/admin/orgs/[id]/plan` — manual plan-override UI (server-side runs, but DB migration 0078 needs PO apply)
- AHO Assistant on every page with text/voice mode picker
- All 7 locales fully translated for sell-funnel + social.share namespaces

**NOT yet live (deployed, pending PO action):**
- Plan-override migration `0078_organizations_manual_plan_override.sql` — committed, needs prod apply
- Defense-in-depth migration `0079_revoke_service_role_only_tables.sql` — committed, needs prod apply
- CF Pages edge cache (PO_DECISIONS #6) — still DYNAMIC on /blog/* + /properties/*
- Stripe LIVE flip
- Meta App Review submission
- DR agent recruitment (pack at `docs/DR_AGENT_RECRUITMENT_PACK.md`)

---

## 🆕 Wedge-funnel sprint — shipped 2026-05-21 (9 commits, all green)

**Single-day summary:** every visitor to the public site now lands at a Free Audit CTA within 1 scroll, and every NEW blog article publishes as 7 sibling rows with reciprocal hreflang (was 1 EN-only per cron). Total cron output capacity doubled (12 → 24 topics). The blog SEO investment that was leaking value for 2 weeks is now compounding cleanly.

| Commit | Layer | Impact |
|---|---|---|
| `fcba3b2` | docs | PO #4: auto-video music = royalty-free (Pixabay + YT Audio Library) |
| `c441514` | blog code | 3-in-1: translation validator + Set-Cookie strip + Free Audit CTA on every article × 7 locales |
| `3bfd91c` | docs+lint | Tier-2 polish audit (4 of 5 already done) + killed unused AgentMarket import |
| `16aa325` | docs | CF Pages cache investigation logged → PO_DECISIONS #6 |
| `25e392b` | docs | PROGRESS.md end-of-session log |
| `23d120a` | docs | DR Agent Recruitment Pack — 7 sources + EN/ES pitches + 10-min checklist |
| `2a6a4b5` | homepage | Agent-wedge strip × 7 locales (between Featured + Pro Automation) |
| `632212c` | blog cron | Topic pool 12 → 24 (8 new agent + 4 new seller topics) |
| `d436f34` | docs | STATUS summary |
| _(this commit)_ | **Phase 4 4a-container** | Dockerfile + Remotion composition + Hono HTTP server + CF Worker queue consumer. 9 files, ~750 LOC. Code complete; deploy gated on PO opening CF Containers. |

**What's NOW live on the site (after deploy):**
- `/{locale}` homepage: emerald "For real estate agents — paste URL, 60-second campaign" strip
- `/{locale}/blog/<slug>`: emerald Free Audit CTA at end of every article in 7 locales
- `/{locale}/for-agents#free-audit`: deep link works (anchor wrapper shipped)
- `/sitemap-blog.xml`: future articles will have 7 sibling URLs each
- Blog cron: 24-topic pool, ~24 days of unique ground per pickup

**What's NOT yet live (waiting on PO):**
- CF Pages edge cache (PO #6 — recommended dashboard rule, 5 min)
- Backfill of 3 stranded EN-only blog articles (delete rows OR accept ≤5% loss)
- Stripe LIVE flip (15 min + DECISIONS.md entry)
- Meta App Review submission
- DR agent recruitment (90-min outreach session, pack ready in repo)

---

## 🆕 Blog SEO pipeline unstuck — shipped 2026-05-21

Three bugs the live sitemap surfaced today, all in service of the blog SEO investment finally paying off:

1. **Translation fan-out was silently failing.** The HTML validator required literal `aria-label="Breadcrumb"` — Haiku correctly localizes that to "Brotkrumen", "Migas de pan", etc., so 6 of 6 translated INSERTs per cron run failed validation. Pre-fix sitemap had 3 articles total (all EN, no siblings). Post-fix: every NEW article publishes as 7 sibling rows with reciprocal hreflang. Validator now accepts any non-empty aria-label on a `<nav>` that isn't the ToC. Translator prompt also tightened. (`c441514`)
2. **Edge cache was off on /blog (and /properties).** `next-intl` was emitting `Set-Cookie: NEXT_LOCALE=en` on every locale-routed response despite `localeDetection: false`, and CF treats any Set-Cookie as uncacheable. Middleware now strips that cookie on anon public requests. Cache-Control header was always being set; this finally lets it engage. (`c441514`)
3. **Articles had ZERO conversion path.** Cron auto-publishes 7 articles every ~2 days across 7 locales (~25 indexed pages/week) but readers had no way to try the product. Added a per-locale Free Audit CTA aside at the end of every article linking to `/for-agents#free-audit`. (`c441514`)

**Caveat:** the 3 EN-only articles already published (2026-05-19 + 2026-05-22) will NOT auto-backfill — cron's 90-day dedup excludes them. Either delete those 3 rows so the cron re-picks them on the next run, or accept they stay EN-only (≤5% of one month's output).

---

## 🆕 Programmatic SEO blog — shipped 2026-05-19 (multi-locale)

`workers/blog-publish` cron (09:00 UTC daily, 50% jitter → ~every 2 days) generates a real-estate-marketing article via Anthropic Sonnet, validates the HTML against the spec contract (no Microdata, ToC + breadcrumb + author bio present, anchors map), inserts into `blog_posts`, then fans out **6 parallel Haiku translations** into ES/PL/PT/DE/FR/IT — all linked via `translation_group_id` for reciprocal hreflang. Inserts a row per locale (7 total per cron run), emails operator with per-locale success/failure stats. Pages at `/[locale]/blog` (index) + `/[locale]/blog/[slug]` (article) — both locale-filtered. JSON-LD `BlogPosting` + `Person(author)` + `BreadcrumbList` in one `@graph` per locale. `/sitemap-blog.xml` groups siblings + emits reciprocal `<xhtml:link rel="alternate">` per locale. Distribution to FB Page + IG Business + LinkedIn auto-fires from the EN row using `ad_platform_tokens` for the admin account. Migrations 0075 (schema) + 0076 (translation_group_id) applied to prod. Worker `aho-blog-publish` deployed. Commits today: `a3a6aa2` → `888895a` (~25 commits).

**Two reusable skills shipped**: `/blog-perfect` + `/listing-perfect` — Lighthouse-100 audit playbooks documenting every invariant + pitfall encountered.



---

## 🟢 Now — actively in flight

**End of day 2026-05-18.** 17 commits shipped today; massive sprint covering AI agent (4 channels), AHO Assistant, AI Conversion Stack, Tawk retirement, and the Sell-funnel + $5 private-owner product. **All code on `main`; deploys auto-ran.** The remaining work is PO-side activation steps + soft-beta validation.

**Tomorrow's priority queue** lives in §🟡 Next 5 below.

**Phase 4 — Auto-video Reels/TikTok engine.** Render path locked 2026-05-17: **A = Remotion in Cloudflare Containers**. Sliced into 4 units; 4d + the 4a-scaffold shipped 2026-05-17. Remaining slices (4a-container, 4b, 4c) gated on PO opening CF Containers + R2 bucket + Queue.

**AI Customer-Service Agent — all 5 phases SHIPPED (2026-05-18).** All four channels (web chat / email / WhatsApp / voice) have code on `main`. Commits `c1f5b10` (Phase 1 foundation) + `4d44dbc` (Phases 2-5 in one parallel-agent burst). 744 unit tests pass (+197 from start of session), typecheck + lint clean. Web chat is LIVE the moment the deploy lands — replaces Tawk on listing + agent pages. Email + WhatsApp + voice all gated on PO-side credentials only (DNS for `reply.advertisehomes.online`, 360dialog WABA, Twilio + ConversationRelay).

| Channel | Status | What's needed to go live |
|---|---|---|
| **Web chat** | 🟢 LIVE on next deploy | Nothing — auto-publishes; replaces Tawk on properties/[slug] + agents/[slug]. Always HITL per D2=A. |
| **Email AI** | 🟡 Code ready; PO blocked | Add DNS for `reply.advertisehomes.online` + open CF Email Routing catch-all → worker; set `INBOUND_SECRET` + `LEADS_TOKEN_SECRET` |
| **WhatsApp AI** | 🟡 Code ready; PO blocked | 360dialog account approval + Meta Business Verification (already in flight) + WABA number cert + Embedded Signup |
| **Voice AI** | 🟡 Code ready; PO blocked | Twilio account + ConversationRelay access + per-agent phone-number provisioning + worker secrets |

**[Auto-video Reels/TikTok engine — Phase 4 — moved to top]**

Auto-video engine slice details preserved below.

**Auto-video engine — slice tracker.** Render path locked 2026-05-17: **A = Remotion in Cloudflare Containers**. Sliced into 4 units; 4d + the 4a-scaffold shipped 2026-05-17. Currently paused while AI agent ships.

| Slice | What ships | Effort | Status |
|---|---|---|---|
| **4d** — Inline connection state on the preview's approval grid + "Connect X →" buttons | ✅ Shipped `9dbea57` |
| **4a-scaffold** — Migration 0064 audit_videos + buildVideoScript() pure function + /api/audit/[id]/video POST/GET route + workers/video-render/README documenting what 4b plugs in | ✅ Shipped today |
| **4a-container** — Dockerfile + Remotion composition (`reel-real-estate-v1`) + container HTTP server + queue consumer wiring | L (3-5 days) | ✅ **CODE SHIPPED 2026-05-21** (`workers/video-render/`). 9 files, ~750 LOC. Code complete + typechecks. Deploy gated on PO opening CF Containers + creating R2 bucket + queue. Full deploy procedure in `workers/video-render/README.md`. |
| **4b** — IG Reels + FB Reels publish primitives in `lib/social/publish.ts` (extends today's IG Feed / FB Page primitives — same tokens, different Graph endpoints) | M | Queued — depends on 4a-container ready |
| **4c** — Approval grid expansion: 3×3 → 3×5 with IG Reel + FB Reel rows | S | Queued — depends on 4b |

---

## 🟡 Tomorrow's plan — 2026-05-20

Effort: S = ≤2 hrs, M = ½ day, L = full day+. Owner: who's blocking.

### Soft-beta validation by PO (paused mid-Test 4 yesterday)

| # | Test | Status |
|---|---|---|
| 1 | `/sell/private` anon auth-gate → Sign in / Create account | ✅ verified |
| 2 | Sign-in → bounce back → "Pay $5" button visible | pending |
| 3 | Click Pay $5 → Stripe Checkout at $5.00 USD | pending |
| 4 | Web chat widget — markdown links render clickable | 🟡 fix shipped (`ecd6d56`), retest pending |
| 5 | `/dashboard/ai-inbox` shows approve / edit / reject loop | pending |

### Lighthouse re-test in incognito

After all today's caching + multi-locale fixes deployed (final commit `888895a`):

| URL | Last seen | Expected after deploy |
|---|---|---|
| `/en/blog/<slug>` | 98/100 | 100/100 across all four (after Tailwind purge fix landed in `fd9b8a0`) |
| `/en/properties/<slug>` | 53/100/100/96 (Perf was server-bound) | 90+ once `cf-cache-status: HIT` flips — middleware Cache-Control + `localeDetection: false` should unblock the CDN cache |

Verify with `curl -sI <url>`: should see `cache-control: public, ...` AND no `set-cookie` AND `cf-cache-status` flipping to HIT on the second request.

### Blog multi-locale validation (post the scheduled-wakeup forced cron lands)

Pending wakeup at 02:56 UTC fired a forced cron → expect 7 sibling rows live across 7 locales. Verify:
- `https://advertisehomes.online/en/blog`
- `/es/blog` `/pl/blog` `/pt/blog` `/de/blog` `/fr/blog` `/it/blog` — each shows their own translated article in the index
- `/sitemap-blog.xml` — 8 `<url>` entries (1 index + 7 article siblings) with reciprocal hreflang
- Operator email at info@advertisehomes.online with per-locale cost summary

### Original 🟡 Tomorrow's plan — 2026-05-19 (historical — TIER 1 ALL DONE)

Effort: S = ≤2 hrs, M = ½ day, L = full day+. Owner: who's blocking.

### PO-side activation gates (Tier-1)

| # | Item | Status |
|---|---|---|
| 1 | **Migrations 0066 → 0074 applied to prod Supabase.** Two fixes uncovered + shipped in commit `ee8daa7`: (a) 0066 + 0072 referenced a non-existent `set_updated_at()` — renamed to the real `touch_updated_at()` from 0001; (b) 0068 collided with the existing `email_messages` table from 0055 — renamed the new AI-agent tables to `ai_email_threads` + `ai_email_messages` and updated `/api/inbound/email/route.ts`. | ✅ |
| 2 | **`aho_private_listing_one_time` product created in Stripe TEST** (`prod_UXiuInhrpPIfc2`) + `STRIPE_PRICE_PRIVATE_LISTING_ONE_TIME=price_1TYdSxBsPTDRb0ccgmtxhsWB` set on `aho-web` production via `wrangler pages secret put`. | ✅ |
| 3 | **3 new Workers deployed** to `homekrypto.workers.dev`: `aho-ai-daily-rollup` (02:00 UTC), `aho-ai-weekly-digest` (Mon 09:00 UTC), `aho-listing-expiry` (04:00 UTC). All three have `CRON_SECRET` + `AHO_PAGES_URL=https://advertisehomes.online` set. | ✅ |
| 4 | **Soft-beta — actually use the platform as an agent.** Create a listing, click around the dashboard, fire a conversation as an anonymous buyer on your own listing, approve a draft from `/dashboard/ai-inbox`. | 🟡 PO action — only step left in Tier 1 |

### PO_DECISIONS still open

| # | Item | Why now | Effort | Owner |
|---|---|---|---|---|
| 5 | **PO_DECISIONS #2-4 batch** — Super Pro price ($199/$249/$299) + paywall structure + music library. | Sell-funnel page mentions "from $29/mo" for Agent and the comparison table refers to Pro Automation — adding a 4th tier above is straightforward but needs the price locked. | S (chat reply) | **You** |
| 6 | **Soft-beta agent recruitment** — invite 3-5 real DR agents to try AHO. | The AI Conversion Stack only generates value with real conversations; the $5 product needs real visitors to convert. | M (offline; ~3-5 conversations) | **You** |

### Tier-2 — me-side code follow-ups (unblocked, but PO can deprioritize)

| # | Item | Why | Effort | Owner |
|---|---|---|---|---|
| 7 | **Wire `cost_usd_cents` into `ai_daily_stats` rollup** | `intent_counts` + `risk_flag_counts` are ALREADY wired (verified 2026-05-21 — the message-side pass at `ai-daily-rollup/route.ts:272-320` runs the bumpMessageAgg). `cost_usd_cents` is intentionally deferred pending a migration that adds `org_id` to `ai_generation_log` (see the doc comment in that file). The real outstanding work is the migration + a `logAiCall()` signature change. | M | Me — but warrants a deliberate ship, not a polish slot. |
| 8 | ~~**Extract `countryToMarket()` duplicates**~~ | ✅ Already done — both consumers import from the shared `@/lib/ai/country-to-market`. STATUS was stale (verified 2026-05-21). |
| 9 | ~~**Add a renewal-error toast on `/dashboard/properties`**~~ | ✅ Already done — banner + 5 error codes + EN/ES i18n strings shipped. STATUS was stale (verified 2026-05-21). PL/PT/DE/FR/IT fall back to EN as designed (CONTENT_LOCALES = en+es). |
| 10 | ~~**Header `Sell` link copy review**~~ | ✅ Verified 2026-05-21 — all 7 locales have punchy native verbs (Sell / Vender / Sprzedaj / Vender / Verkaufen / Vendre / Vendi). |
| 11 | **Remove unused `AgentMarket` import in `schedule-draft.ts`** | ✅ Done 2026-05-21 — was a lint warning from the AI agent burst. |

**Tier-2 audit conclusion (2026-05-21): the queue was largely stale. Real outstanding work is just the `cost_usd_cents` migration in #7 (warrants deliberate ship). All other items resolved or done in earlier commits.**

### Tier-3 — creds-blocked AI agent channels (do when ready)

| Channel | Blocker | Effort once unblocked |
|---|---|---|
| **Email AI** | DNS for `reply.advertisehomes.online` MX → CF Email Routing + set INBOUND_EMAIL_SECRET + LEADS_TOKEN_SECRET | S — config only; code is in `workers/inbound-email/` |
| **WhatsApp AI** | 360dialog account approval + Meta Business Verification (already in review) + WABA number cert | M (mostly waiting on Meta) |
| **Voice AI** | Twilio account + ConversationRelay access request + per-agent phone numbers | M |

### Punch list — pull from when there's slack

- Turnstile on `/sell/private` checkout button (defense against bot abuse on the $5 product; same protection as the lead-capture form)
- LinkedIn `DRY_RUN=false` verification (still queued from 2026-05-17)
- Dashboard Lighthouse re-test in incognito
- `/admin/audit-costs` integration with the new private-listing revenue (one-time $5 charges should show up alongside subscription cost data)

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

## ✅ Shipped this week (2026-05-11 → 2026-05-18)

**Today (2026-05-18, full-power session)** — **AI Customer-Service Agent — all 5 phases + polish + Tawk retired (`c1f5b10` Phase 1 + `4d44dbc` Phases 2-5 + `309cc9f` polish + Tawk retirement)**. **Tawk widget retired** — removed mount from `[locale]/layout.tsx` per PO directive 2026-05-18 ("when chat ai is ready disable tawk"). AHO's AI chat now exclusively handles the chat surface on /properties/[slug] + /agents/[slug]. Tawk component file kept on disk for one-line-revert rollback per AI_AGENT_PLAN.md risk R13 (30-day NPS check vs Tawk baseline). Polish round closes the 5 highest-leverage follow-ups: real tier lookup in `/api/ai-chat` (replaces hard-coded `'pro_automation'` via new `src/lib/ai/agent-tier.ts`), HITL poll endpoint `/api/ai-chat/poll` + widget reconciliation every 5s (closes the approve/edit/reject loop so the buyer sees the agent's action without refresh), async draft pipeline `src/lib/ai/schedule-draft.ts` (replaces the no-op stubs in `/api/inbound/{email,whatsapp}` — these channels now actually generate AI drafts when the buyer messages in), `/dashboard/ai-inbox` wired into the sidebar nav across all 7 locales (`navAiInbox` translation key), `INBOUND_EMAIL_SECRET` + `AHO_LEADS_TOKEN_SECRET` added to `src/lib/env.ts` schema. 749 tests pass (+5 from `schedule-draft.test.ts`). PO accepted plan defaults D1=D9=A; built foundation (migrations 0066/0067 + 4 shared lib files in `src/lib/ai/`) THEN dispatched 4 parallel sub-agents for channel scaffolding (web chat endpoint + widget + dashboard inbox UI; email schema 0068 + CF Email Worker + inbound route + threading + Brevo reply; WhatsApp schema 0069 + CF Worker + pricing/templates/wa-link libs; voice schema 0070 + Twilio ConversationRelay worker + TwiML route + warm-transfer/pricing/prompts libs). 46 new files + 7901 LOC in one commit. Web chat replaces Tawk live the moment deploy lands (always HITL per D2=A). 744 unit tests pass (+197 from session start).

**Earlier today (2026-05-18)** — SEO structured-data overhaul shipped in 3 commits: **`645822b` Phase 1 — site-wide @graph + 7 missing indexable pages** (new builders WebPage/CollectionPage/HowTo/FAQPage/SoftwareApplication/Service/RealEstateAgent/Graph in `src/lib/seo/jsonld.ts`; `<JsonLd>` server component; root `[locale]/layout.tsx` emits Organization + WebSite with stable `@id`s once per page; `/countries`, `/instagram-setup`, `/profile-guide`, `/share-guide`, `/docs`, `/privacy`, `/terms` now have JSON-LD they previously lacked) · **`5eeeab0` photo alt-text auto-populated from listing data on all 3 upload paths** (image-uploader, listing-form, import-photos route) — `buildPhotoAlt` now feeds both `alt_text_en` AND `alt_text_es` with the full SEO payload (title + property type + transaction phrase + city + country + "Photo X of Y"); was previously crude `"{title} — {city} — {N}"` written identically to both locale columns · **`4ad5978` Phase 2/3/4 — listing-features enrichment + one-@graph-per-page + smoke gate**: (Phase 2) `buildListingJsonLd` now emits petsAllowed, tourBookingPage (`#contact` anchor added on property page), 9 new boolean amenities, 14 new additionalProperty rows pulled from the features jsonb; (Phase 3) agents/[slug] collapsed 3 inline scripts into one @graph; (Phase 4a) for-agents/automation/save-time/pricing/properties-in/properties/[slug] all moved from 2–4 scripts to one @graph each, search page's WebSite dropped (was duplicate of layout's); (Phase 4b) post-deploy-smoke.yml now asserts `/en` and `/en/for-agents` emit at least one JSON-LD script and the first payload JSON.parses

**Today (2026-05-17, evening — post-QA fixes)** — **`b69ca01` Satori TTF + supabase destructure pattern (real fix for the ImageResponse 0-byte regression: woff2 isn't satori-parseable; vendored Inter-Bold.ttf instead. Three prior mitigation attempts had wrong root cause)** · **`bc15359` Creative satori display:flex fix (`📍 {cityLabel}` is two children — needs explicit display:flex; bug was masked by the woff2 issue until then)** · **`79d67c4` ai_generation_log FK buffer fix — runAudit now buffers LogAiCallInput in memory + route flushes after ai_audits insert (root cause was FK violation 23503: logs were trying to write before the parent audit row existed; supabase-js silently swallowed the error because it doesn't throw on row-level rejections, only network ones)** · **`ed6f611` post-deploy smoke SIGPIPE/pipefail fix — `echo "$body" | grep -q 'AHO'` false-failed all 5 prior runs because grep matches early + closes pipe + echo gets SIGPIPE 141 + pipefail propagates it; switched to bash-native `[[ "$body" == *AHO* ]]` in 6 places, smoke run #8 = first green run since the workflow shipped** · `8a85494` reverted devIndicators (wrong cause; left in for source maps off) + ai-log destructure pattern · `cb8712b` middleware fonts/* exclusion (incidentally correct hygiene, didn't fix the actual woff2 bug) · `a963a48` smoke workflow poll-loop (wrong fix; the real bug was the pipefail issue) · `ca948de` middleware X-Robots-Tag noindex on authed routes (now applies to the 307 redirects, not just the page renders — Next's `redirect()` runs before next.config.ts headers config) + linkedin cron auth normalized to shared checkCronAuth helper · **CRON_SECRET provisioned in CF Pages prod + mirrored to GitHub Actions secrets via libsodium SealedBox (CRON_SECRET was missing → all 6 cron routes returned 503 cron_secret_unconfigured)**

**Today (2026-05-17, daytime)** — `c385f93` Phase 3 approval grid + atomic publish · `8ed3d61` Phase 2 Creative Factory · `2602016` Phase 1 Free Audit widget · `c44d6e7` bright theme · `7108266` X-Robots-Tag noindex on authed surfaces · `16f73e4` devIndicators off · `0a62c41` source maps off · `5d138d7` super-structure (STATUS / PO_DECISIONS / TEST_PLAN docs + operating protocol) · **`c292539` IG self-serve setup guide at /instagram-setup in 7 locales + link from the IG-not-detected nudge** · **`9f39da2` Phase 5 Multilingual Context Engine — per-market system prompts (US/ES/PL/PT/DE/FR/IT) so PL/DE/FR/IT/PT drafts come out in the actual target language with local jargon + CTAs instead of English fallback** · **`69e2a80` Phase 2.5 Per-locale visual treatment on Creative Factory — per-market color palettes (DE Bauhaus white+charcoal, IT Tuscan beige+terracotta, FR Parisian cream+navy, PL clean white+navy, PT cream+sage, ES warm sand+terracotta, US cream+green) so graphics match the per-market caption tone** · **`9dbea57` Phase 4 slice 4d — inline OAuth connection state on approval grid (pill strip above grid with ✓ + display name OR "Connect →" link, returnTo preserves so OAuth bounces back to same preview; checkboxes disabled in unconnected columns with "not connected" hint)** · **`03427af` Phase 5.5 ai_generation_log migration + per-call AI usage logging (migration 0061; new src/lib/ai/cost.ts + src/lib/ai/log.ts; runAudit logs per-locale drafter calls with market + latency + token usage + estimated cost in USD cents; /api/social/ai-draft also logs)** · **`1595ea8` Cron to prune unclaimed audits past expires_at — new /api/cron/audit-prune Pages route + workers/audit-prune/ scheduled worker (03:30 UTC daily); ON DELETE SET NULL on ai_generation_log FK means cost history is preserved through pruning** · **`dd9a36d` Fundraise toolkit — docs/PITCH_OUTLINE.md (1-page narrative scaffold for cold VC outreach) + /[locale]/investors landing page (live at /en/investors, noindex, demo CTA + moat + roadmap + ask + contact) + migration 0062 audit_funnel_events table + preview page instrumented with preview_view / preview_claim events for the "X% conversion" pitch metric** · **`71a4e80` importFromUrl Sonnet call now logged to ai_generation_log (purpose='audit_import') — closes the ~30-50% cost-accounting gap; both Free Audit pipeline AND /api/listings/import surface log; importFromUrl return shape changed to {facts, usage, latencyMs, model} so the existing test script + both callers picked up the change cleanly** · **`371da4b` /admin/audit-costs tiny dashboard — 4 top-line tiles (7d cost / 30d cost / avg-per-audit 7d / avg-per-audit 30d with $0.30 target benchmark) + daily rollup table (last 30 days) + per-market table + last-20-audits table; reads from ai_generation_log via service-role admin client; new "AI costs" tab on the /admin nav** · **`e3adc50` Instagram drift cron (Phase 3 of INSTAGRAM_SHARING_PLAN.md) — migration 0063 meta_drift_notifications + /api/cron/instagram-drift Pages route + workers/instagram-drift/ standalone Worker (04:30 UTC daily, 30 min after meta-token-refresh so it sees fresh tokens) + email template instagram-newly-linked.ts; detects agents who linked IG Business in Meta Business Suite after their last AHO OAuth grant, emails them once per (user, ig_id) to click Reconnect** · **`<this-commit>` AI cost alert cron — /api/cron/ai-cost-alert Pages route + workers/ai-cost-alert/ standalone Worker (05:00 UTC daily, completes the 04:00 → 04:30 → 05:00 cron pipeline) + email template ai-cost-alert.ts; emails info@advertisehomes.online when yesterday's spend > $50 OR avg-per-audit > $1; quiet otherwise (no email on normal days)** · header redesign (Real estate agent / Save dropdowns + Home) · garlic logo iterations → wordmark only · IG-not-detected nudge on /dashboard/social · Meta domain verification meta tag · property edit page layout fixes · dashboard security audit (4 layers all green)

**Earlier this week** (per `docs/PROGRESS.md` 2026-05-15 entry) — Google OAuth full stack · LinkedIn personal-profile publishing pulled from v1.1 to Stage 1 · MFA QR bug fix · reset-password AAL2 flow · 21st.dev removal · admin comp seat for `info@advertisehomes.online` · Super Pro Stage 1 plan doc (282 lines)

---

## 📦 Punch list — small things mentioned but not lost

Pull from here when there's slack between bigger items. Each is genuine ≤1-2 hour work.

- Turnstile on Free Audit submit (current defense is IP rate-limit 5/hour; add Turnstile after first bot abuse signal)
- LinkedIn `DRY_RUN=false` flip — already publishes real; verify first real post lands then write the DECISIONS.md entry
- Real-time `published_results` updates without page refresh (today the streamed cells flip in real time but a PAGE refresh would re-render from the persisted JSONB — already correct, just hasn't been verified end-to-end)
- Dashboard Lighthouse re-test in incognito (the 30/100 score was contaminated by Chrome extensions + IndexedDB per Lighthouse's own warning; expected real score 75-85)

---

## How to use this file

- **Read it first** when you start a session.
- **Type `status` to me** in chat — I'll re-read it, summarize the top 3 things, and propose where to start.
- **I keep it current.** Every commit that ships a feature → I move it from "Now" / "Next" → "Shipped." Every blocker I hit → goes into "Blocked." Every nice-to-have you mention → goes into "Punch list" so it isn't lost.
- **Don't put aspirational content here.** Long-term vision lives in `docs/SUPER_PRO_STAGE_1_PLAN.md`, `docs/EXECUTION_PLAN.md`, etc. This file is operational reality.
