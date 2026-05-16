# PO actions — outstanding external tasks

Items that block forward motion on AHO and that **only the product owner can do** because they require credentials, registrar access, lawyer engagement, or commercial decisions outside Claude's scope. Sorted by impact-per-minute.

Last updated: 2026-05-15

---

## 0. Agent acquisition outreach — first 50 paying agents

**Why it matters:** AHO has zero real agents on the platform. Every feature shipped — Pro Automation, audience uploader, social automation, /share-guide, /profile-guide — is downstream of "real agents exist who pay for it." Without paying agents, none of the product investment compounds. The Founder Rate ($19/mo lifetime) caps at 50 agents; getting to that ceiling is the milestone that proves the funnel + unlocks the next pricing phase.

**Why this is a PO task and not Claude's:** I can do market research (DONE — see `docs/AGENT_OUTREACH_RESEARCH.md`) and draft personalized pitches via the `agent-outreach` subagent. I cannot **send** outreach. The pitches must come from your personal Gmail / Outlook / LinkedIn / WhatsApp — not from `info@advertisehomes.online` (cold mail through that domain burns the transactional channel that paying customers depend on for listing-share confirmations + billing).

**What's already in hand:**
- Public-directory map for the 4 legally-permissive markets: US (Miami), Mexico (CDMX + coastal), Australia (Sydney/Brisbane/Melbourne), Singapore. Full doc: `docs/AGENT_OUTREACH_RESEARCH.md`.
- 5-agent first-wave shortlist diversified across markets + pricing tiers ($19 / $29 / $49 / $99) — so the first week of reply data tells you which (market × tier) combos convert.
- `.claude/agents/agent-outreach.md` subagent — Mode 1 (market research) + Mode 2 (personalized 3-channel pitch: email + LinkedIn DM + WhatsApp opener). Available after Claude Code restart.

**What to do (first 2 weeks):**
1. Send the 5 first-wave pitches (Mode 2 drafts available on request; I'll fire them in parallel when you say "go"). From your personal channels, one per day spread across the week.
2. Track replies in a simple sheet: `name, market, plan_tier_pitched, channel, sent_at, replied, outcome` (interested / not now / blocked / silent).
3. After day 7, count replies by (market × tier). Whichever combo has the highest reply rate gets ramped to 5-10 pitches/week. Drop the laggards.
4. Once you find a working pattern, ask me to run `agent-outreach` Mode 2 in batches of 10 against named agents you've picked from the directories.

**Done when:** 50 paying agents on the platform (Founder Rate seats filled). Early-stop signal: if reply rate is <2% across 30 pitches after 2 weeks, the message + targeting needs rework — escalate before continuing.

**Parallel: paid acquisition.** When monthly outreach exceeds time-available, scale via Meta Ads / Google Ads against `/for-agents` + `/automation`. Budget question — flag when ready.

---

## 1. ~~Google OAuth provider — Supabase + Google Cloud Console config~~ — **DONE 2026-05-15**

Google Cloud OAuth 2.0 Client created (Web application, project "AHO google"), authorized origins `https://advertisehomes.online` + `https://aho-web.pages.dev`, redirect URI `https://lqujtquofsdsxtujvjtl.supabase.co/auth/v1/callback`. `external_google_enabled=true` set on Supabase via Management API PATCH `/v1/projects/lqujtquofsdsxtujvjtl/config/auth` — client ID + secret stored Supabase-side. App stays in **Testing** mode (consent screen yellow warning, 100-user cap — sufficient for soft beta). Follow-up: file Google verification once first soft-beta agents are real.

---

## 2. Meta App Review submission — files the $99 Pro Automation feature (estimated 4-8 wks turnaround)

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

## 2b. LinkedIn dev app + product approvals (1-2 wks LinkedIn turnaround)

**Why it matters:** Per `DECISIONS.md` 2026-05-15 (LinkedIn pulled into Stage 1), the publish stub at `src/lib/social/publish.ts:540` becomes real once we have a LinkedIn dev app with approved products. Personal-profile posting only — `w_member_social` scope. Company-page posting (`w_organization_social`, requires Marketing Developer Platform) stays v1.1.

**One-time setup (~20 min PO time + LinkedIn-side review wait):**

1. **LinkedIn Developer Portal** — https://www.linkedin.com/developers/apps → **Create app**
   - App name: `Advertise Homes Online`
   - LinkedIn Page: requires you to associate with a LinkedIn Page. If AHO doesn't have one yet, create a free Company Page first at https://www.linkedin.com/company/setup/new (this is the page LinkedIn shows on the OAuth consent screen — separate from posting target). Use `info@advertisehomes.online` as the page admin.
   - Privacy policy URL: `https://advertisehomes.online/privacy`
   - App logo: 100×100 minimum, the AHO mark
2. **Add products** (Products tab):
   - **Sign In with LinkedIn using OpenID Connect** — usually instant approval (unlocks `openid`, `profile`, `email` scopes for sign-in)
   - **Share on LinkedIn** — typically 1-2 wks LinkedIn review (unlocks `w_member_social` for posting to a member's own feed)
3. **Auth tab → OAuth 2.0 settings → Authorized redirect URLs**:
   - `https://advertisehomes.online/api/oauth/linkedin/callback` (publish flow — our own OAuth)
   - `https://lqujtquofsdsxtujvjtl.supabase.co/auth/v1/callback` (sign-in flow via Supabase Auth — analogous to how Google was wired today)
4. **Auth tab → Application credentials**: copy **Client ID** + **Client Secret**, paste here in chat. Goes into Cloudflare Pages env (`LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET`) and Supabase Auth provider config (Management API push, same shape as today's Google enable).

**Done when:** the "Share on LinkedIn" product status reads "Verified" / "Approved" in the Products tab. (Sign-In product is usually instant.)

**Parallel dev work while LinkedIn reviews:** Claude builds the OAuth scaffold (`/api/oauth/linkedin/{start,callback}/route.ts`) + flips the publish stub against `/rest/posts` (LinkedIn versioned API, 2024+) with a `LINKEDIN_DRY_RUN=true` env so we test the flow with App Tester accounts before real publish. Sign-In side flips on via Supabase Management API the moment Client ID + Secret arrive.

---

## 1. ~~Apply migrations 0043 + 0044 to Supabase~~ — **DONE 2026-05-10**

Applied via `pnpm tsx scripts/migrate.ts` after fixing a pre-existing IMMUTABLE-expression bug in 0038 that had been blocking the queue. Verified live: `property_events_event_type_check` now includes `favorite_remove`; both `admin_user_membership_counts()` and `admin_org_counts()` RPCs are deployed. The previously-stuck migrations 0038, 0039, 0040, 0041, 0042 also applied in the same run.

---

## 2. ~~Custom-domain DNS for advertisehomes.online → Cloudflare Pages~~ — **DONE 2026-05-13** (env confirmed 2026-05-15)

Verified live 2026-05-13 — `curl https://advertisehomes.online/sitemap.xml` returns 200; `www.` → apex 301 redirect works; `NEXT_PUBLIC_SITE_URL` set to canonical in `.env.local`. **Env-var confirmation 2026-05-15:** all sitemap entries on `/sitemap-pages.xml` resolve as `https://advertisehomes.online/...` (not `aho-web.pages.dev/...`), proving `NEXT_PUBLIC_SITE_URL=https://advertisehomes.online` is set in Cloudflare Pages → `aho-web` → Settings → Environment variables → Production. Original entry preserved below for archive.

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

## 3. ~~Supabase Auth → Brevo SMTP relay~~ — **DONE** (verified 2026-05-15)

Supabase Management API audit on 2026-05-15 confirmed custom SMTP is fully configured: `smtp_host=smtp-relay.brevo.com`, `smtp_port=587`, `smtp_user=a9d89c001@smtp-brevo.com`, `smtp_pass=set`, `smtp_admin_email=info@advertisehomes.online`, `smtp_sender_name=AHO`. Was wired previously (PROGRESS.md note "Supabase Auth emails go through Supabase's SMTP relay" implies pre-2026-05-14). Signup-confirm / magic-link / password-reset / change-email all send from the AHO-branded sender. Doc entry was stale; removing.

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

## 6. ~~21st.dev API key rotation~~ — **REMOVED 2026-05-15**

21st.dev "Magic" MCP server (and the parked `ui-ux-pro-max` skill) were never actually used — zero code imports, zero generated components. The HashiCorp-tokens + Inter design system carried the whole shipped product in 7 locales without it. Per PO decision 2026-05-15: pull the dep entirely rather than rotate a key for a tool we'd never invoke. Removed `.mcp.json`, removed `TWENTY_FIRST_DEV_API_KEY` from `.env.local`, removed the WebFetch(domain:21st.dev) allowlist entry. The leaked key from 2026-04-30 is now actively unused on AHO's side; recommend revoking it in the 21st.dev dashboard so it can't bill against any account. If a future polish phase wants fancy marketing primitives, re-add then.

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

- Soft-beta agents (#4) → unblocks the real-only data rule's payoff: public homepage, city landing pages, agent profiles, lead routing rules, all start showing real activity.
- Meta App Review (#2) → unblocks $99 Pro Automation revenue for non-tester accounts.
- Agent outreach (#0) → the human-channel work that feeds #4.

The biggest remaining unlocks are now market-side, not infrastructure-side.
