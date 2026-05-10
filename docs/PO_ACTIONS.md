# PO actions — outstanding external tasks

Items that block forward motion on AHO and that **only the product owner can do** because they require credentials, registrar access, lawyer engagement, or commercial decisions outside Claude's scope. Sorted by impact-per-minute.

Last updated: 2026-05-10

---

## 1. Apply migrations 0043 + 0044 to Supabase (2 minutes) — **NEW THIS SESSION**

**Why it matters now:**

- **0043** — favorite-toggle code records `favorite_remove` events. Until the enum is widened, every un-favorite logs a `[favorite] event record failed` warning. The toggle itself still works; only the analytics insert fails silently.
- **0044** — `/admin/users` and `/admin/orgs` now call grouped-count RPCs instead of firing one (or two) HEAD queries per row. Until the RPCs exist, both pages render with `0` in the Members / Active listings columns — visible but recoverable; one refresh after the migration runs fixes it.

**How to apply:**

```bash
set -a && source .env.local && set +a && \
  pnpm tsx scripts/migrate.ts 0043 && \
  pnpm tsx scripts/migrate.ts 0044
```

Or via Supabase Studio → SQL editor → paste each file in `src/db/migrations/` → Run. Both are idempotent (`create or replace` for the RPCs; `drop … if exists` + `add` for the enum).

---

## 2. Custom-domain DNS for advertisehomes.online → Cloudflare Pages (15 minutes)

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
