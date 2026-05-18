# Test Plan — features deployed but pending your verification

> Every feature I ship lands here with a **3-line manual test**: do **X** → expect **Y** → if wrong, paste **Z** (URL / screenshot / error message). Until you click through it and tell me "verified", I treat the feature as "deployed, not validated."
>
> When you've verified a feature, type **`verified: <name>`** (e.g., `verified: free-audit-widget`) and I'll move it from "Pending verification" to "Verified" with the date.
>
> I (Claude) keep this file accurate. Last update: 2026-05-17 (evening — post-QA fixes).

---

## ⏳ Pending your verification

### `qa-fixes-2026-05-17-evening` — 5 production bugs fixed end-of-day (shipped `b69ca01` + `bc15359` + `79d67c4` + `ed6f611`)
- **Scope:** OG/creative renders + ai_generation_log writes + post-deploy smoke workflow. All five verified by me directly against prod (44/44 assertions PASS). Listed here for the record + so you can spot-check whichever feels worth touching. None require setup.
- **Do (1 min total):**
  1. Open https://advertisehomes.online/en/opengraph-image in a new tab — should render a dark `#15181e` 1200×630 PNG with the AHO wordmark + "Real estate, real listings — anywhere" headline.
  2. Open https://advertisehomes.online/api/audit/1af6552e-9203-4490-9c56-2a16da03af7e/creative/fb — should render a property card PNG (photo left, title/price right, "AHO" footer band).
  3. Open https://github.com/fotografosantodomingo/AHO/actions/workflows/post-deploy-smoke.yml — most recent run should be **green** (#8 was first green after the SIGPIPE fix).
- **Expect:** All three render / show success. If any are broken, paste me the URL + status code (HTTP headers tab in DevTools).
- **Background (for future-you reading this):** Today's day-leg ship was followed by an evening QA pass that found 5 silent prod bugs. Spent the evening root-causing each via `wrangler pages deployment tail` (the prior "fixes" had targeted wrong causes — see PROGRESS.md 2026-05-17 evening entry). The fixes themselves are now permanent guardrails: destructured supabase-js writes log postgrest errors on every site, smoke workflow uses bash-native string matching (no pipe-SIGPIPE bug possible), satori font is TTF not woff2.

### `cron-secret-provisioned` — all 6 cron routes now functional in prod
- **Background:** All 6 cron routes (`/api/cron/audit-prune`, `/api/cron/linkedin-insights`, `/api/cron/meta-insights`, `/api/cron/instagram-drift`, `/api/cron/ai-cost-alert`, `/api/cron/meta-token-refresh`) had been returning 503 `cron_secret_unconfigured` because the `CRON_SECRET` env var was missing in CF Pages prod. Generated 256-bit secret via `openssl rand -hex 32`, set on CF Pages production via the API (PATCH /pages/projects/aho-web with `secret_text` type), mirrored to `.env.local`, also set the GitHub Actions repo secret via libsodium SealedBox encryption + PUT.
- **Do:** Nothing — verified via the smoke workflow which now exercises all 6 routes (no-auth=401, with-bearer=200). They'll start firing on their scheduled times once the 4 standalone Workers (`aho-audit-prune`, `aho-instagram-drift`, `aho-ai-cost-alert`, `aho-meta-token-refresh`) are deployed (separate PO action — `cd workers/<name> && wrangler deploy` from each).
- **Expect:** If everything is in place, you should see daily entries showing up in `ai_generation_log` (after each Free Audit), `meta_drift_notifications` (when an IG link drifts), email to info@... when AI spend > $50/day, etc.

### `ai-cost-rollup-real-data` — admin/audit-costs dashboard now populates
- **Background:** The `/admin/audit-costs` page exists (shipped `371da4b`) but had been showing empty data because `ai_generation_log` rows weren't landing (FK bug fixed today in `79d67c4`). Now that audits actually log their per-Anthropic-call cost, the rollup tiles should fill in.
- **Do:** Sign in as `info@advertisehomes.online`, visit https://advertisehomes.online/en/admin/audit-costs.
- **Expect:** 4 tiles at the top show 7d cost / 30d cost / avg-per-audit-7d / avg-per-audit-30d. Daily rollup table shows the last 30 days (sparse if there hasn't been audit traffic yet). Avg-per-audit should be ≤ $0.30 (the SUPER_PRO_STAGE_1_PLAN.md unit-economics target). One per-market row per locale that's been audited (us/es/pl).
- **If wrong:** Empty tiles after running ≥1 audit since 2026-05-17 21:09 UTC (when the FK fix deployed) means the buffer-and-flush isn't working — paste the page URL + a screenshot.

### `free-audit-widget` — Phase 1 wedge (shipped `2602016`)
- **Do:** Open https://advertisehomes.online/en/for-agents in **incognito**. Paste a real listing URL (your own, otodom.pl, idealista.com, zillow.com). Click "Get my campaign."
- **Expect:** ~30s later, redirected to `/en/preview/<uuid>`. Page shows: listing facts (title, price, beds/baths, area, city), up to 3 hero photos, and a 9-caption grid (English/Spanish/Polish × Facebook/Instagram/LinkedIn).
- **If wrong:** Paste the source URL you used + the URL of the preview page you landed on + screenshot of what's broken.

### `creative-factory` — Phase 2 branded graphics (shipped `8ed3d61` + bright theme `c44d6e7`)
- **Do:** On any preview page from above, scroll to the "3 branded graphics" section. Click the Download link under each.
- **Expect:** Three PNGs — FB 1200×630, IG 1080², Pinterest 1000×1500 — each with the listing photo, dark title text on cream background, green "AHO • Advertise Homes Online" footer bar.
- **If wrong:** Paste the preview URL + which format looks wrong + a screenshot.

### `approval-grid` — Phase 3 atomic publish (shipped `c385f93`)
- **Do:** Sign in as `info@advertisehomes.online`. Create a Free Audit via /for-agents. On the resulting `/en/preview/<uuid>`: confirm the signup CTA at the bottom is REPLACED by an "Publish" section with a 3×3 checkbox grid. Tick **only the English × Facebook cell** for the first test (smallest blast radius). Click "Publish 1."
- **Expect:** Within ~10s the EN×FB cell flips to ✓ Posted. Check your real Advertise Homes Online FB Page — a new post should appear with the AI-drafted caption + photo + UTM-tagged link.
- **If wrong:** Paste the preview URL + screenshot of the grid state after clicking + any error code shown.
- **⚠️ Note:** This is a REAL publish to your live FB Page. Start with one cell, verify, then expand.

### `meta-bv-domain-verification` — Meta Business Verification token (shipped `c6e60da`)
- **Do:** In business.facebook.com → Security Center → "Verify your domain" → click "Verify domain."
- **Expect:** Domain `advertisehomes.online` flips to "Verified" within seconds. Confirms the `<meta name="facebook-domain-verification" content="ztd23gv75ztx1kqizjykrk30oeiinn"/>` tag in our `<head>` is live and Meta reads it correctly.
- **If wrong:** Meta will say "could not find tag" — if so, try the Sharing Debugger (https://developers.facebook.com/tools/debug/) and paste me the result.

### `video-scaffold` — Phase 4 slice 4a scaffold (just shipped; no UI yet)
- **Scope of this slice:** the rails for video render. No actual video gets rendered until slice 4a-container ships (next multi-day session, gated on PO setting up CF Containers + R2 + Queue per `workers/video-render/README.md` pre-reqs).
- **What you can verify today:**
  - Migration 0064 applied — table exists:
    ```sql
    \d audit_videos
    ```
    Should show columns id / audit_id / market / status / r2_key / duration_s / error_code / render_ms / created_at / rendered_at.
  - POST endpoint accepts a request:
    ```bash
    # signed-in as owner of <auditId>; cookies in your browser
    fetch('/api/audit/<auditId>/video', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({locale:'en'})})
    ```
    Expected: `{ ok: true, jobId, status: 'queued', pending: true, hint: 'Render container deploys in slice 4b...' }`.
  - The row lands in `audit_videos`:
    ```sql
    select * from audit_videos where audit_id='<auditId>' order by created_at desc limit 1;
    ```
    Status stays 'queued' forever until slice 4b's container starts consuming the queue.
  - GET endpoint reports it:
    ```bash
    fetch('/api/audit/<auditId>/video?locale=en').then(r=>r.json())
    ```
    Expected: `{ ok: true, jobId, status: 'queued', market: 'us', ... }`.
- **What's NOT testable yet:** the actual MP4 render. That's slice 4a-container; see `workers/video-render/README.md` for the pre-reqs PO needs to complete before that session.

### `publish-streaming` — Phase 3.5 NDJSON streaming (just shipped)
- **Do:** From `/preview/<uuid>`, tick MULTIPLE cells across platforms (e.g. EN×FB + EN×IG + EN×LinkedIn) → click Publish 3. Watch the grid as it processes.
- **Expect:** Cells flip from selected → ✓ Posted (or ✗ error) **one at a time** as each publish lands, not all together after a 10-second wait. FB typically lands first (~1s), IG in ~3-4s (carousel build), LinkedIn last (~4-5s). On a slow LinkedIn, the FB cell shows ✓ while LinkedIn still shows the loading state.
- **AND:** After all cells have landed, refresh the page → the persisted state from `ai_audits.published_results` shows the same ✓/✗ marks. The streamed state and the persisted state match.
- **If wrong:** Most likely failure modes: (a) all cells flip together = streaming isn't working, client is buffering. Paste the network tab's `/publish` response headers — should be `content-type: application/x-ndjson`. (b) Cells flip live but refresh shows none = DB write failed at end of stream; check server logs.

### `multi-account-publish-picker` — Phase 3.5 (just shipped)
- **Setup**: visit `/dashboard/social` as `info@advertisehomes.online`. You should already have 3 FB Pages connected (Advertise Homes Online, Babula Foto Video, Babula Shots) — the multi-account picker will show on Facebook because count > 1.
- **Do:** Create a Free Audit + visit `/preview/<uuid>`. Scroll to the approval grid section.
- **Expect:**
  - The Facebook pill is now a **green dropdown** instead of a static label. Click it → see all 3 Page names. Pick "Babula Foto Video" (or whichever is NOT the default).
  - Instagram + LinkedIn pills stay as plain labels (only 1 account each, so no picker — status quo).
  - Tick the EN×FB cell only → click Publish 1 → check FB → the post should appear on the Page you selected, NOT the first one.
- **If wrong**: paste preview URL + screenshot. Most likely failure mode: dropdown renders but server still publishes to first page (means `accountIds` wasn't sent or wasn't honored). Confirm by checking the actual FB Page post landed.
- **For non-agency users** (only 1 FB Page): everything looks exactly like before. Pickers only appear when count > 1.

### `ai-cost-alert-cron` — Phase 5.5 alerting (just shipped — needs deployment)
- **Code is committed**; one-time Worker deploy:
  ```bash
  cd workers/ai-cost-alert
  set -a && source ../../.env.local && set +a
  npx wrangler@4 secret put CRON_SECRET
  npx wrangler@4 secret put AHO_PAGES_URL
  npx wrangler@4 deploy
  ```
- **Smoke test**: `curl -sL "https://aho-ai-cost-alert.<your-cf-subdomain>.workers.dev/run?secret=<CRON_SECRET>"`
- **Expect on first run today**: `{ "ok": true, "alerted": false, "totalCostUsd": 0, "totalAudits": 0, "totalCalls": 0 }` (yesterday had no AI activity yet). Quiet day = no email.
- **To force an alert email** (verify the template renders correctly): temporarily lower the threshold in `/api/cron/ai-cost-alert/route.ts` (e.g. `DAILY_TOTAL_CENTS_THRESHOLD = 1`), hit /run, confirm the email arrives at info@advertisehomes.online with subject "[AHO] AI cost alert — YYYY-MM-DD · $X.XX". Then revert.
- **Scheduled run**: 05:00 UTC daily (completes the cron pipeline: 04:00 token-refresh → 04:30 IG drift → 05:00 cost alert).

### `instagram-drift-cron` — Phase 3 of IG plan (just shipped — needs deployment)
- **Code is committed** but the standalone Worker at `workers/instagram-drift/` needs the same one-time wrangler deploy as the other crons:
  ```bash
  cd workers/instagram-drift
  set -a && source ../../.env.local && set +a
  npx wrangler@4 secret put CRON_SECRET           # same value as Pages CRON_SECRET
  npx wrangler@4 secret put AHO_PAGES_URL         # https://advertisehomes.online
  npx wrangler@4 deploy
  ```
- **Smoke test after deploy** (manual trigger; runs the same logic the daily cron will):
  ```bash
  curl -sL "https://aho-instagram-drift.<your-cf-subdomain>.workers.dev/run?secret=<CRON_SECRET>"
  ```
- **Expect on first run today**: `{ "ok": true, "scanned": 1, "detected": 0, "emailed": 0, "skipped": 0, "summaries": [...] }`. Scanned = 1 because info@advertisehomes.online has a user-level Meta token. Detected = 0 because PO has no IG Business linked to any Page yet (per earlier audit). Emailed = 0.
- **Expect once PO links an IG Business** in Meta Business Suite (and DOESN'T click Reconnect on AHO yet) → next cron run: `detected: 1, emailed: 1`. The email lands at info@advertisehomes.online with subject "Instagram (@yourhandle) is ready to publish on AHO" and a "Open Social dashboard" button.
- **Re-trigger same day**: `skipped: 1` (UNIQUE on meta_drift_notifications prevents re-emailing).
- **Scheduled run**: 04:30 UTC daily (30 min after meta-token-refresh @ 04:00 UTC, so tokens are fresh).
- **If wrong**: paste the JSON from /run + any error in the `summaries` array per-user `errors`.

### `admin-audit-costs` — AI cost dashboard (just shipped)
- **Do:** Sign in as `info@advertisehomes.online` (admin). Visit https://advertisehomes.online/en/admin/audit-costs.
- **Expect:**
  - 4 top-line tiles at the top: Cost last 7 days / Cost last 30 days / Avg per audit (7d) / Avg per audit (30d). The avg-per-audit tiles show "target: $0.30" as a benchmark.
  - **Daily rollup table** (last 30 days): one row per day with audits / calls / total cost / avg per audit.
  - **Per-market table** (only draft calls have a market — import calls log with NULL): per-language cost picture (US / ES / PL / PT / DE / FR / IT).
  - **Last 20 audits**: per-audit detail with source hostname, detected language, call count, total cost. Useful for "this specific audit cost $X".
- **First-load gotcha:** if you have no audits yet, every table shows "No audits in the last 30 days." Generate a Free Audit first.
- **If wrong:** screenshot + which table looks off. If "AI costs" tab is missing from the admin nav, your is_admin flag may have been lost.

### `audit-import-cost-logging` — Phase 5.5 follow-on (just shipped)
- **Do:** Run a Free Audit. Wait for the preview to render. Then in psql:
  ```sql
  select purpose, model, market, input_tokens, output_tokens,
         estimated_cost_usd_cents, latency_ms
  from ai_generation_log
  where audit_id = '<the-audit-uuid>'
  order by created_at;
  ```
- **Expect:** Now **4 rows** instead of the previous 3:
  - 1× `purpose='audit_import'`, `model='claude-sonnet-4-6'`, NULL market, high input_tokens (the scraped HTML), modest output_tokens (the JSON facts). Cost-per-call typically $0.02-0.10.
  - 3× `purpose='audit_draft'`, `model='claude-haiku-4-5-...'`, per-market (us/es/pl), modest input_tokens, lower output_tokens.
- **Total-cost sanity:** sum of all 4 rows is the actual per-audit cost. Compare against `ai_audits.input_tokens` / `output_tokens` (legacy aggregate columns) — they should now match the sum of all 4 log rows (previously they only matched the 3 drafter rows since `import` wasn't being counted).
- **If wrong:** Most likely failure: only 3 rows show up (the import row is missing). That means the importFromUrl wire-up didn't fire — paste the audit UUID + the SQL output.

### `fundraise-toolkit` — investor brief + funnel analytics (just shipped)
Three artifacts in one ship:

**a) Pitch outline doc** — `docs/PITCH_OUTLINE.md`
- **Do:** Open the file. Skim. Customize: the `$___` ask amount, your calendar link, record the 60-second screencast.
- **Expect:** A 1-page narrative scaffold you can convert to slides or paste into cold-outreach emails verbatim. Covers wedge / moat / why-now / 90-day plan / pricing / ask / honest disclosures.
- **If wrong:** Tell me what's off and I'll iterate.

**b) Investors landing page** — https://advertisehomes.online/en/investors
- **Do:** Open in incognito.
- **Expect:** Hero pitch → "Try the 60-second demo →" button (links to /for-agents) + "Email me — 15 min call" mailto link → sections for wedge / moat / why now / 90-day plan / pricing / ask / honest pre-revenue disclosures. Forced-light theme regardless of system mode. Page is noindex (intentional — you share the URL in cold outreach; you don't want it ranking).
- **AND:** Verify the noindex header:
  ```bash
  curl -sI https://advertisehomes.online/en/investors | grep -i x-robots
  # expected: x-robots-tag: noindex, nofollow, noarchive, nosnippet
  ```
- **If wrong:** Paste screenshot of what's off.

**c) Funnel analytics — `audit_funnel_events` table** (migration 0062 + preview page instrumentation)
- **Do:** Generate a new Free Audit. Visit the resulting `/preview/<uuid>` URL TWICE (once anonymous, once after signing in to claim it). Then in psql:
  ```sql
  select event, user_id, locale, created_at
  from audit_funnel_events
  where audit_id = '<the-audit-uuid>'
  order by created_at;
  ```
- **Expect:** 3 rows — 2× `preview_view` (one per visit) + 1× `preview_claim` (only on the visit that flipped the audit from unclaimed to claimed).
- **AND:** Funnel rate query for the investor pitch:
  ```sql
  with views as (select count(*) as n from audit_funnel_events where event = 'preview_view'),
       claims as (select count(*) as n from audit_funnel_events where event = 'preview_claim')
  select claims.n::float / nullif(views.n, 0) as conversion_rate, views.n as total_views, claims.n as total_claims
  from views, claims;
  ```
  After a week of real audit traffic, this is the concrete "X% of preview viewers convert" number you cite in the deck.
- **If wrong:** Most likely failure: 0 rows. Means the preview-page instrumentation didn't fire — paste the audit UUID + the SQL result.

### `audit-prune-cron` — Phase 5.5 follow-on (just shipped — needs deployment)
- **Code is committed** but the standalone Worker at `workers/audit-prune/` needs to be deployed once via wrangler. Same one-time setup as `workers/meta-token-refresh/`:
  ```bash
  cd workers/audit-prune
  set -a && source ../../.env.local && set +a
  npx wrangler@4 secret put CRON_SECRET            # paste the same value as Pages env CRON_SECRET
  npx wrangler@4 secret put AHO_PAGES_URL          # https://advertisehomes.online
  npx wrangler@4 deploy
  ```
- **Smoke test after deploy** (manual trigger):
  ```bash
  curl -sL "https://aho-audit-prune.<your-cf-subdomain>.workers.dev/run?secret=<CRON_SECRET>"
  ```
  **Expect:** `{ "ok": true, "deleted": 0 }` — zero on first run since no audits are past expires_at yet. After a week of soft-beta, this number will be > 0 daily.
- **Scheduled run**: 03:30 UTC daily (30 min offset from the meta-token-refresh cron at 04:00 UTC).
- **Hands-off check after the first ~10 days**: `select count(*) from ai_audits where expires_at < now() and claimed_by_user_id is null` should stay at 0 between runs (rows get deleted before they accumulate).

### `ai-generation-log` — Phase 5.5 cost observability (just shipped)
- **Do:** Trigger a new Free Audit (paste any portal URL on `/en/for-agents`). Wait for the preview to render. Then in psql / Supabase SQL editor:
  ```sql
  select purpose, model, market, input_tokens, output_tokens,
         estimated_cost_usd_cents, latency_ms, error_code, created_at
  from ai_generation_log
  where audit_id = '<the-audit-uuid-from-the-preview-url>'
  order by created_at;
  ```
- **Expect:** 3 rows (one per locale en/es/pl), all `purpose='audit_draft'`, model `claude-haiku-4-5-20251001`, with sensible token counts (typically 500-1500 input, 200-600 output per call), market values matching localeToMarket (us/es/pl), latency 1000-4000 ms each, error_code NULL.
- **AND:** Daily aggregate sanity check:
  ```sql
  select sum(estimated_cost_usd_cents)::float / 100 as usd_today,
         count(*) as calls_today,
         count(distinct audit_id) as audits_today
  from ai_generation_log
  where created_at > current_date;
  ```
  Should match your audit count × 3 calls per audit; sum should be small (a few cents during testing).
- **If wrong:** Most likely failure mode: zero rows. That means the audit pre-generated UUID flow broke; the route handler in `/api/audit/start` now inserts with an explicit `id` field — if INSERT failed silently, the log rows orphan with that audit_id. Paste me the audit UUID + the SQL output you got.

### `approval-grid-connection-state` — Phase 4 slice 4d (just shipped)
- **Do:** Sign in as `info@advertisehomes.online`. Create a Free Audit. On the resulting `/preview/<uuid>`:
- **Expect:**
  - Above the 3×3 checkbox grid: a row of **3 connection pills** — one each for Facebook / Instagram / LinkedIn. Connected platforms show **green ✓ + account display name**; unconnected ones show a **"Connect →" button** (links straight to `/api/oauth/{provider}/start?returnTo=/en/preview/<uuid>`).
  - In the grid: checkboxes for unconnected platforms are **disabled with "not connected" hint** under them. You can't tick a cell that would definitely fail.
  - Click a "Connect →" pill → bounces through Meta/LinkedIn OAuth → after consent → lands BACK on the SAME preview URL (not /dashboard/social). Connection pill flips to green ✓ + checkboxes in that column become enabled.
- **If wrong:** Paste the preview URL + screenshot of the pills. Most likely failure: returnTo not preserved through OAuth callback → lands on /dashboard/social instead of /preview. If so, paste the URL you ended up on.

### `creative-per-locale-visuals` — Phase 2.5 (just shipped)
- **Do:** Visit the same `/preview/<uuid>` URL but try multiple locales by changing the URL prefix: `/en/preview/<uuid>`, `/pl/preview/<uuid>`, `/de/preview/<uuid>`, `/it/preview/<uuid>`. Look at the 3 branded graphics (FB / IG / Pinterest) for each.
- **Expect:** Color palette changes per locale:
  - **EN/US**: cream `#fbf8f1` background, dark ink, **green** `#2c4d3a` accent (status-quo)
  - **DE**: pure **white** background, charcoal accent — Bauhaus-clean look
  - **IT**: **warm beige** background, **brown** ink, **terracotta** `#c64f2a` accent — Tuscan villa look
  - **FR**: cream background, **deep navy** `#0f3057` accent — Parisian elegant
  - **PL**: near-white background, **deep navy** `#1e3a5f` accent — clean corporate
  - **PT**: cream background, **sage green** `#3d6b4f` accent
  - **ES**: warm sand background, **terracotta** `#b65a3c` accent
- Title prefers the per-locale facts.title* (ES gets `titleEs`, others get `titleEn`).
- Price label localized via `formatPrice(…, locale)`.
- **If wrong:** Paste the preview URL + the locale prefix you tried + screenshot. Most likely failure: cached old version — append `&cb=1` to bust the 1h edge cache.

### `multilingual-context-engine` — Phase 5 (just shipped)
- **Do:** Open https://advertisehomes.online/en/for-agents in **incognito**. Paste a real listing URL — ideally a **Polish** one from otodom.pl (so the source is in Polish too). Click "Get my campaign." Wait ~30s. On the preview page, scroll to the captions grid.
- **Expect:**
  - The **English** row of 3 captions is in English (same as before).
  - The **Spanish** row of 3 captions is in Spanish (same as before).
  - **The Polish row is now ACTUALLY in Polish** — including the "Link in bio" line (becomes "Link w bio"), the "Full details" line (becomes "Pełne szczegóły i zdjęcia:"), and any CTAs (becomes "Umów oglądanie" / similar). NOT English text masquerading as Polish like before.
- **Optional deeper test:** Open Cloudflare Pages logs or the Anthropic console — confirm the system prompt sent for the PL audit contains "Write EVERY word of EVERY caption in Polish."
- **If wrong:** Paste the preview URL + screenshot of the Polish caption row. The most likely failure mode is the model ignoring the instruction and writing in English anyway — if so, paste the captions text so I can adjust the prompt strength.

### `instagram-setup-guide` — Phase 2 IG plan (just shipped)
- **Do:** Visit https://advertisehomes.online/en/instagram-setup. Also try `/pl/instagram-setup`, `/es/configurar-instagram`, `/de/instagram-setup`.
- **Expect:** Full guide page renders in the right language: 4 numbered steps (switch to Business → link to FB Page → reconnect on AHO → verify) + troubleshooting panel with 3 common failures + final CTA to /dashboard/social. Hreflang alternates present in HTML head. Page is statically generated (fast).
- **AND:** Visit /en/dashboard/social as `info@advertisehomes.online`. The amber "Instagram not detected" callout should now have a **"Full setup guide (5 minutes) →"** link below the body. Click it → lands on /en/instagram-setup.
- **If wrong:** Paste the URL you tried + screenshot. Most likely failure: missing translation falls back to key name (e.g. you see literal "instagramSetup.step1A").

### `ig-not-detected-nudge` — Phase 1 IG plan (shipped `5124240`)
- **Do:** Go to https://advertisehomes.online/en/dashboard/social as `info@advertisehomes.online`.
- **Expect:** Below the Facebook Pages list (3 Pages), an amber callout: *"Facebook connected — but no Instagram Business accounts were detected. In Meta Business Suite, link your Instagram Business account..."*
- **If wrong:** Paste the page URL + screenshot.

### `header-redesign` — authed nav with dropdowns + Home (shipped `03de1be` + `6e9cbe1` + `558cd08`)
- **Do:** Sign in. Visit any page (e.g. /en).
- **Expect:** Header shows `AHO  ☀ EN   Home  Real estate agent ▾  Buy  Rent  Find an agent  Save ▾    USD [Sign out]`. Hovering "Real estate agent" reveals Dashboard. Hovering "Save" reveals Saved properties + Saved searches. Email chip + duplicate dashboard/saved links GONE from the right side.
- **If wrong:** Screenshot + which dropdown / link is misbehaving.

### `dashboard-security` — auth wall + X-Robots-Tag (shipped `7108266`)
- **Do:** Run in a terminal:
  ```bash
  curl -sI https://advertisehomes.online/en/dashboard
  ```
- **Expect:** `HTTP/2 307` with `location: /en/signin?next=%2Fen%2Fdashboard` AND `x-robots-tag: noindex, nofollow, noarchive, nosnippet`.
- **If wrong:** Paste the full curl output.

### `bright-theme-preview` — light-mode lock on /preview (shipped `c44d6e7`)
- **Do:** Force your OS to dark mode (System Settings → Appearance → Dark). Visit any `/preview/<uuid>` URL.
- **Expect:** The preview page stays bright/cream regardless of dark-mode preference. Captions cards on white background, dark text. Creative graphics on cream background.
- **If wrong:** Screenshot in dark mode.

---

## ✅ Verified

*(Empty so far — first features to verify above.)*

---

## How to use this file

- **After every ship, I update this file** with the 3-line test plan. You verify when you have a minute.
- **Reply format:** `verified: <name>` if it works. `broken: <name>: <what>` if it doesn't.
- **Don't trust "shipped" without "verified."** A green deploy + clean lint + passing typecheck means the code COMPILES and DEPLOYS. It doesn't mean a real human can use it. The only valid completion signal is one of us actually clicking through.
- **Start with smallest blast radius.** For publish-flow tests, always tick ONE cell first to confirm the path; THEN expand to multi-cell.
