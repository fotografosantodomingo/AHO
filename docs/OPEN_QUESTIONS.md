# Open questions

Tracked here until decided. When resolved, move the answer to `DECISIONS.md` and remove the entry below.

---

## Resolved 2026-04-29 — see `DECISIONS.md`

The following are now decided, listed briefly for traceability before being pruned in a future cleanup:

- v1 scope (Free + Registered + Agent only)
- Premium / Agency / Expert deferral (v1.1 / v1.1 / v2)
- TikTok integration deferral (v2 or never)
- Launch market: Santo Domingo
- Pricing: $29/mo, $290/yr, $19/mo founder rate (first 50, 60-day window)
- No-language-fallback rule dropped — single-language listings allowed
- Meta + LinkedIn app review submission (week 1)
- Slice-1 timebox (10 weeks, hard)
- Spec scope-marker strategy (top-of-doc banner)
- Engineering defaults: pnpm, Node 22 LTS, GitHub Actions, Vitest + Playwright + Supabase RLS test harness, Conventional Commits, trunk-based with squash-merge
- direnv (Option A) for Cloudflare token loading
- Supabase region: US East (override of EU recommendation)
- Account ownership: PO owns all third-party accounts; secrets reach Claude via `.env.local`
- Founder-rate pricing: application-gated counter, not Stripe-gated
- §30 questions with recommendations on file (most still un-built; they unblock specific modules later, not the build start)

---

## Pending from product owner — sequenced by what blocks what

These actually block work. Listed in the order I need them to fully start week 1.

### Tier 1 — needed for me to verify Cloudflare access from my Bash subprocess

- [ ] **Install direnv and create `.envrc`** so `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are present when Bash subprocesses launch. Once done, I'll verify with `wrangler whoami`. (Account ID is `5a389e6eea7a4e92999c5f1612eafbcc`; not a secret. Token is in `.env.local` from earlier.)

### Tier 2 — needed before Cloudflare resource creation

- [ ] **Decide GitHub repo location:** organization (`advertisehomes-online/aho`, recommended for forward compatibility) or personal account. Tell me which; I'll update the git remote.
- [ ] **Create the GitHub repo** in the chosen location.

### Tier 3 — needed for first migration / first deploy

- [ ] **Supabase project provisioned (US East).** Add to `.env.local`:
  - `SUPABASE_URL=https://lqujtquofsdsxtujvjtl.supabase.co`
  - `SUPABASE_ANON_KEY=...` (from Project Settings → API → anon public)
  - `SUPABASE_SERVICE_ROLE_KEY=...` (from Project Settings → API → service_role secret)
  - `SUPABASE_DB_PASSWORD=...` (set when you created the project)
  - `SUPABASE_POOLER_URL=...` (from Project Settings → Database → Connection Pooling → Transaction or Session mode connection string; this is what Drizzle uses from Workers, since direct port-5432 is IPv6-only)
- [ ] **Stripe account in TEST mode + API keys.** Add to `.env.local`:
  - `STRIPE_SECRET_KEY=sk_test_...`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`
  - `STRIPE_WEBHOOK_SECRET=whsec_...` (you generate this when creating the webhook endpoint, mid-week 2)

### Tier 4 — needed during week 1

- [ ] **Resend account + API key** for the `mail.advertisehomes.online` and `tx.advertisehomes.online` sending domains. `RESEND_API_KEY=...` in `.env.local`.
- [ ] **Sentry org + DSNs** for `aho-web` and `aho-workers`. Two DSNs in `.env.local`.
- [ ] **PostHog cloud project + API key.** `NEXT_PUBLIC_POSTHOG_KEY=...` and `NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com` (or eu host) in `.env.local`.
- [ ] **DNS for `advertisehomes.online` pointed at Cloudflare nameservers.** Per your "split control" plan: you change the nameservers at the registrar after I provide them via Cloudflare Dashboard. I'll then draft DNS records in `docs/DNS.md`; you paste them into Cloudflare yourself, OR you grant me DNS-edit permission scoped to just this zone (via the API token's zone-resource scope) and I add records via wrangler.

### Tier 5 — non-blocking, lands later in slice 1

- [ ] **Brand assets:** colors, logo (SVG + raster), typography. Neutral defaults until provided.
- [ ] **Marketing copy** for `/pricing`, homepage hero, footer.
- [ ] **Lawyer-drafted ToS and Privacy Policy.** Placeholder pages live in week 1 (sufficient for Meta/LinkedIn app review per `DECISIONS.md`); real content swaps in before public launch.
- [ ] **Beta agent list (5–10 Santo Domingo agents).** PO outreach. Names + WhatsApp/email needed by week 7–8 so the soft beta in week 10 has real users.
- [ ] **Meta and LinkedIn developer-account credentials + app creation.** PO action; I support with screencast scripts and OAuth callback URLs once the auth flow exists.

---

## Engineering — discovered during slice-1 week 1 execution

- [ ] **Dedicated test Supabase project** (per `RISKS.md` R11). Currently RLS test fixtures live in the production project. Decide: (a) provision a free-tier test project now, or (b) wait until Supabase database branching is stable on our tier and use ephemeral per-PR DBs. Either is fine; recommend (a) for v1 and revisit (b) at v1.1.
- [ ] **direnv installation** — never landed (no `brew` on the system; install hook never made it into `~/.zshrc`). Workaround in place: every Bash command sources `.env.local` manually with `set -a && source .env.local && set +a`. Long-term install via `curl -sfL https://direnv.net/install.sh | bash`. Not blocking; flagging because future sessions will hit the same gap.
- [ ] **pnpm not globally installed** — `corepack` symlink permission denied on `/usr/local/bin`, so `pnpm` is invoked via `corepack pnpm@9.12.3 ...` everywhere. Future-proof fix: install pnpm to a user-local prefix that doesn't need root, or use a Node version manager (nvm/asdf) that puts pnpm in a writable location.
- [ ] **Stripe is in LIVE mode** — per PO directive ("nobody is going to pay"), products + prices live in production Stripe. When the checkout flow is built, end-to-end testing will need real cards (no `4242 4242 4242 4242` test cards in live mode). Decide before checkout-flow work: (a) accept the friction and use real low-value cards for testing, (b) provision a separate Stripe test account purely for E2E, (c) spin up Stripe in test mode now and migrate later. Recommend (b) once we get to checkout work in week 3.
- [ ] **DB password rotation** — current password (`Masterdominikana32$`) was exposed via a postgres-js parse error in chat. Treat as no-longer-secret. Rotate at Supabase → Project Settings → Database → Reset password; pick a strong random one; update `SUPABASE_POOLER_URL` in `.env.local`. PO has explicitly deferred this ("keep the database password now"); flagged for hygiene cleanup later.

## Engineering — recommendations on file from §30 (HANDOFF_part2.md)

Not blocking week 1. Each must be answered before its respective module starts.

- [ ] **Service-role access pattern.** Recommendation: Workers-only, exported from a single `lib/supabase/admin.ts` module with a lint rule against importing it elsewhere.
- [ ] **Drizzle vs. Supabase client split.** Recommendation: Drizzle for migrations + complex server-side queries from Workers/Server Actions; `@supabase/ssr` client for user-context reads where RLS is the enforcement.
- [ ] **Currency storage.** Spec inconsistency: `properties.price_cents bigint` (good), `plans.amount_cents int` (overflow risk). Recommendation: `bigint` cents everywhere. Normalize before the first migration.
- [ ] **FX rates source + cadence.** Recommendation: Open Exchange Rates daily into a `currency_rates` table; store both original and `price_usd_cents` snapshot for search comparability. Defer until non-USD pricing exists.
- [ ] **Address geocoding provider.** Recommendation: Mapbox Geocoding API (free tier covers early scale).
- [ ] **Reverse-image fraud detection.** Recommendation: pHash on publish; layer Google Vision later only if abuse rate justifies it.
- [ ] **Agency seat billing model.** Not relevant until v1.1. Recommendation: flat with included seats + add-on seat product.
- [ ] **Lead email relay provider.** Recommendation: Resend Inbound (already a dependency for transactional).
- [ ] **Listing expiration policy.** Recommendation: 60 days, with -7d/-1d email reminders, one-click renewal, auto-archive at expiry.
- [ ] **Sold/rented status authority.** Recommendation: agent self-attests with timestamp; admin spot-check.
- [ ] **AI content disclosure.** Not relevant in v1.
- [ ] **Mobile app strategy.** v2 = native (Expo). API design constraint for v1: JSON-over-REST with token auth, not RPC-only via Server Actions.
- [ ] **Agency subdomain branding.** Recommendation: path-based for v1.1; subdomain available later as an Agency upgrade.
