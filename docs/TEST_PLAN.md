# Test Plan — features deployed but pending your verification

> Every feature I ship lands here with a **3-line manual test**: do **X** → expect **Y** → if wrong, paste **Z** (URL / screenshot / error message). Until you click through it and tell me "verified", I treat the feature as "deployed, not validated."
>
> When you've verified a feature, type **`verified: <name>`** (e.g., `verified: free-audit-widget`) and I'll move it from "Pending verification" to "Verified" with the date.
>
> I (Claude) keep this file accurate. Last update: 2026-05-17.

---

## ⏳ Pending your verification

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
