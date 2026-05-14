# PO actions — outstanding external tasks

Items that block forward motion on AHO and that **only the product owner can do** because they require credentials, registrar access, lawyer engagement, or commercial decisions outside Claude's scope. Sorted by impact-per-minute.

Last updated: 2026-05-13

---

## 0. Meta App Review submission — files the $99 Pro Automation feature (estimated 4-8 wks turnaround)

**Why it matters:** Phase A-F of the social-publish feature shipped 2026-05-13 — code is ready end-to-end. The remaining gate to "real $99 customer can publish on Facebook + Instagram" is Meta App Review. Without approval, only Facebook accounts added to App Roles can OAuth and publish (dev-mode tester path). Originally scheduled for slice-1 week 1 per `DECISIONS.md` 2026-04-29; slipped. Filing now puts approval in flight while dev moves to Phase G (token-refresh cron) in parallel.

**What to do:** open `docs/META_APP_REVIEW_SUBMISSION.md` — it's the complete pack:
1. **§2.2 — Fix the OAuth dialog 502 first** (it's been broken since 2026-05-07, debug checklist included). Filing without fixing → rejection-rate goes up because reviewers test the dialog.
2. **§3 — Per-permission text** (4 permissions: `pages_show_list`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`). Copy/paste verbatim into the dashboard.
3. **§4 — Screencast script** (~3:30 outline with timestamps + narration). Record against the test agent account; upload to the submission form.
4. **§5 — Free-form app-details + test-instructions text**. Copy/paste.
5. **§6 — Post-approval steps**. App Mode flip to Live + DECISIONS.md entry per CLAUDE.md hard rule #9.
6. **§7 — End-to-end smoke test** (9-step probe before opening public Pro Automation enrollment).

**Done when:** Meta dashboard shows "In Review" for all 4 permissions. Surface the date in PROGRESS.md so we can track the calendar.

**Parallel work:** Dev moves to Phase G (token-refresh cron + connection-test endpoint) while waiting. PO_ACTION #2 (custom domain) also helps — Meta reviewers prefer canonical domains over `.pages.dev`.

---

## 1. ~~Apply migrations 0043 + 0044 to Supabase~~ — **DONE 2026-05-10**

Applied via `pnpm tsx scripts/migrate.ts` after fixing a pre-existing IMMUTABLE-expression bug in 0038 that had been blocking the queue. Verified live: `property_events_event_type_check` now includes `favorite_remove`; both `admin_user_membership_counts()` and `admin_org_counts()` RPCs are deployed. The previously-stuck migrations 0038, 0039, 0040, 0041, 0042 also applied in the same run.

---

## 2. ~~Custom-domain DNS for advertisehomes.online → Cloudflare Pages~~ — **DONE 2026-05-13**

Verified live 2026-05-13 — `curl https://advertisehomes.online/sitemap.xml` returns 200; `www.` → apex 301 redirect works; `NEXT_PUBLIC_SITE_URL` set to canonical in `.env.local`. **One residual PO confirmation needed:** verify `NEXT_PUBLIC_SITE_URL=https://advertisehomes.online` is also set in Cloudflare Pages → `aho-web` → Settings → Environment variables → Production. If not, deployed builds still emit `.pages.dev` URLs in sitemap/canonical/OG. Quick check: open the site, View Source, look for `<link rel="canonical" href="...">` — if it points at the canonical domain, the env var is set correctly. Original entry preserved below for archive.

### Original entry (for archive)

**Why it matters:** Today the live URL is `https://aho-web.pages.dev`. Every public-facing surface (sitemap, canonical URLs, OG images, social shares) reads from `NEXT_PUBLIC_SITE_URL`. Pivoting to the real domain is a single env-var change once DNS is live; everything downstream (search-engine indexing, social-share previews, agent trust) auto-pivots.

**What to do:**

1. Cloudflare Dashboard → Pages → `aho-web` → Custom domains → **Add `advertisehomes.online`** and **`www.advertisehomes.online`**.
2. Cloudflare will display the exact DNS records to add. Cross-check against `docs/DNS.md` "Apex + www" block.
3. At the registrar, point nameservers at Cloudflare (if not already) — Cloudflare will tell you the exact NS hostnames.
4. Once "Active" lights up next to the custom domain in Pages (usually < 30 minutes after NS propagation), set `NEXT_PUBLIC_SITE_URL=https://advertisehomes.online` in:
   - Cloudflare Pages → `aho-web` → Settings → Environment variables → Production
   - Local `.env.local` (so future builds match)
5. Trigger a redeploy (`git commit --allow-empty -m "chore: pivot to custom domain" && git push`) so the sitemap and canonical URLs pick up the new origin.

**Done when:** `https://advertisehomes.online/sitemap.xml` returns the sitemap with `https://advertisehomes.online/...` URLs throughout.

---

## 3. Supabase Auth → Brevo SMTP relay (10 minutes)

**Why it matters:** `src/lib/email/brevo.ts` already routes our app-side transactional email (welcome, lead notification, review request, magic-link click confirmations) through Brevo on `advertisehomes.online`. Supabase Auth's own outbound (signup confirmation, password reset, magic-link link) still uses Supabase's built-in SMTP, which is rate-limited and lacks AHO branding.

**What to do:**

1. Brevo dashboard → SMTP & API → SMTP → create an **SMTP key** (separate from the transactional API key already in `.env.local`).
2. Supabase Studio → Project settings → Auth → SMTP settings → toggle "Enable custom SMTP server" and fill:
   - Host: `smtp-relay.brevo.com`
   - Port: `587`
   - Username: the Brevo SMTP login (shown next to the SMTP key)
   - Password: the SMTP key just created
   - Sender email: `info@advertisehomes.online`
   - Sender name: `AHO`
3. Save. Supabase tests the connection inline — it should succeed because the apex already passes DKIM (see `docs/DNS.md` "Email — Brevo (LIVE)").
4. Trigger a password-reset email from `/forgot-password` to confirm delivery from the AHO sender.

---

## 4. Soft-beta agent recruitment (open-ended)

**Why it matters:** The platform's real-only data rule (CLAUDE.md hard rule #8) means we cannot seed listings to demo the value. Public surfaces (city landing, agent profiles, search) only come alive once real agents publish real properties. Until then the homepage is technically functional but tells no story.

**Concrete ask:** 3–5 agents in Santo Domingo (DR launch market) who'll publish at minimum 5 listings each in the first month at the **Agent** tier ($29/mo) — free for the founder window if PO grants comp accounts manually via the Stripe Customer Portal. Per `HANDOFF.md` §5, the founder-window logic (auto-discounted onboarding) is wired in code but turned off until the first cohort is identified.

**Side note for the cohort pitch:** the documentation hub at `/docs` was added 2026-05-10 in seven languages and walks new agents through every surface — pricing, onboarding, photo guidelines, the lead inbox, the social-distribution grid, MFA. Hand them the `/docs` link as the self-serve onboarding companion.

---

## 5. ToS / privacy lawyer review (v1.1+ scope)

**Why it matters:** Current `/terms` and `/privacy` pages are reasonable plain-language drafts but have not been reviewed by counsel. For v1 launch in DR with a small private-beta cohort that's acceptable; for the v1.1+ scale-up (multi-market, automated payouts, EU traffic via the SEO landing pages), a lawyer-reviewed version is needed.

**What's open:**

- Whether the founder ToS variant is treated as a separate contract or a rider on the master ToS. (Stripe metadata already tags founder accounts.)
- Whether the per-locale ToS pages need a hand-translated legal version per market or whether English-with-local-summary is acceptable for non-DR markets at v1.1.
- DSAR / "right to be forgotten" workflow: today account-delete cascades through favorites + saved searches + leads, but billing records are retained per tax law. The current copy says this; counsel should confirm the retention windows match local rules in each launch market.
- LinkedIn / Meta API ToS alignment: scoping the social-distribution feature against the platforms' own terms before turning on auto-publish.

**Suggested cadence:** book the review once the v1.1 scope is locked (so the lawyer reviews a stable copy), targeting 4–6 weeks before the EU traffic ramp.

---

## 6. 21st.dev API key rotation (5 minutes)

**Why it matters:** The previous key leaked in chat 2026-04-30 (per `docs/DECISIONS.md` "UI/UX polish phase"). Until rotated, the leaked key remains valid and the leakage isn't formally closed. UI/UX polish via the `ui-ux-pro-max` skill is parked behind this.

**What to do:** 21st.dev dashboard → API keys → revoke the leaked key, generate a new one, paste into `.env.local` under `TWENTY_FIRST_DEV_API_KEY`. Restart Claude Code so the new value reaches the MCP server.

---

## Already done (in this session) — no PO action required

- Documentation hub at `/docs` shipped in all 7 locales with native translation (commits `1da21ae` + `6e7edef`).
- Footer `Documentation` link with translated label per locale.
- All 5 marketing locales (PL/PT/DE/FR/IT) at full key parity with EN.
- P1 i18n correctness pass: auth-error / error / property / saved-searches / city-landing canonical no longer hardcode EN-or-ES (commit `9cf58f8`).
- Admin slug correctness: org links use `public_slug ?? slug`, zero-listing orgs render without the click-to-404 link (commit `4c4c112`).
- Favorite analytics symmetry (commit `4c4c112` + migration `0043`).
- Review-moderation queue resolves the agent's public profile slug.

---

## Why this list is shorter than it looks

A lot of the "still pending" items in `CLAUDE.md` § Current focus are blocked on **one** PO action and unblock cascades:

- Custom domain DNS (#2) → unblocks production SEO, social-share previews, the entire agent-trust story.
- Soft-beta agents (#4) → unblocks the real-only data rule's payoff: public homepage, city landing pages, agent profiles, lead routing rules, all start showing real activity.
- 21st.dev key rotation (#6) → unblocks the UI/UX polish phase (`ui-ux-pro-max`), which is the only remaining slice-1 polish lever I still can't pull autonomously.

Three external decisions, three big unlocks.
