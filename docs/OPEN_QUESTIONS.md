# Open questions

Tracked here until decided. When resolved, move the answer to `DECISIONS.md` and remove the entry below.

---

## Pending from product owner — what still blocks work

### Email + observability infrastructure

- [x] **Brevo: verify the sending domain.** Done 2026-05-05. PO added DKIM 1+2 CNAMEs + DMARC TXT + brevo-code TXT on the apex `advertisehomes.online`. Brevo dashboard reports all four matching. First successful test send via `brevo.ts` wrapper: messageId `<202605061157.27580665178@smtp-relay.mailin.fr>`.
- [x] **Supabase Auth → SMTP relay through Brevo.** Done 2026-05-06. Configured via Supabase Management API (`PATCH /v1/projects/lqujtquofsdsxtujvjtl/config/auth`) using `SUPABASE_ACCESS_TOKEN`. Settings live: host `smtp-relay.brevo.com`:587, sender `info@advertisehomes.online`, sender name `AHO`. Verified by triggering a recovery-email via `/auth/v1/admin/generate_link` for `michal@babulashots.pl` — `recovery_sent_at` updated, action_link generated, email delivered through the configured SMTP. Per PO directive 2026-05-06: sender is `info@` (monitored mailbox), not `noreply@`, so user replies reach a human.
- [ ] **Sentry org + DSNs** for `aho-web` and `aho-workers`. Two DSNs in `.env.local`. Out of slice 1 per spec; non-blocking but hygienic to wire before paying agents land.
- [ ] **`TURNSTILE_SECRET_KEY` in env** for server-side validation of the lead-form captcha. The site key (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) is already deployed and powers the Supabase auth widget. To server-validate captcha tokens on `POST /api/leads`, we need the matching secret in `.env.local` + Cloudflare Pages secrets. The secret is the same one already configured in Supabase auth (`security_captcha_secret` field of the auth config). Without this, the lead form has only honeypot protection (commit b8e..., 2026-05-06); with it, we get real Turnstile bot-challenge.
- [ ] **PostHog cloud project + API key.** `NEXT_PUBLIC_POSTHOG_KEY=...` and `NEXT_PUBLIC_POSTHOG_HOST=...` in `.env.local`. Same posture as Sentry — out of slice 1.

### Paid-tier infra opt-ins (CLAUDE.md hard rule #9 — needs explicit confirmation before enabling)

- [ ] **R2 enablement.** Cloudflare R2 service is not yet enabled on the account. Token already has `Workers R2 Storage: Edit` scope. Enabling R2 is a paid-tier opt-in (free 10 GB tier exists, then per-GB). Unblocks the image-upload UI on `/dashboard/properties/[id]` (API endpoints + DB schema + RLS already exist).
- [ ] **Stripe live promotion.** Currently in test mode (`sk_test_*`). Live promotion requires an explicit `DECISIONS.md` entry per the protocol after the 2026-04-29 process gap. Defer until a paying agent is ready.

### Brand / content / soft-beta

- [ ] **Brand assets:** colors (current: HashiCorp design tokens substitute), logo (SVG), typography (current: Inter via next/font/google). Pending PO sign-off or replacement.
- [ ] **Marketing copy** for homepage hero, pricing, footer (current: globalized neutral copy). Pending PO sign-off or replacement.
- [ ] **Lawyer-drafted ToS and Privacy Policy.** Placeholder pages live at `/privacy`, `/terms`. Real content swaps in before public launch.
- [ ] **Beta agent list (3–5 Santo Domingo agents).** PO outreach. Names + WhatsApp/email needed for the soft beta. Until then every public surface serves empty states.
- [ ] **Meta and LinkedIn developer-account credentials + app creation.** Required for the slice-3 one-click social-share marquee feature. PO action; Claude provides screencast scripts and OAuth callback URLs.

### Tooling

- [ ] **Rotate the 21st.dev API key** that was leaked in chat 2026-04-30, paste new value into `.env.local` as `TWENTY_FIRST_DEV_API_KEY`. Unblocks the polish phase via the `ui-ux-pro-max` skill (per `DECISIONS.md` "2026-04-30 — UI/UX polish phase").

---

## Security checklist — in place vs. pending

Audit triggered by PO security checklist 2026-04-30. Mapping the list against current state:

### Authentication
- [x] Strong password policy: 8 chars + uppercase + number (`SignUpSchema`). Could tighten to 12 chars + HIBP check.
- [ ] **MFA enforcement at signup.** Supabase supports TOTP; not yet enrolled in the signup flow. Spec calls for required MFA on admin accounts (HANDOFF §5.1) — currently optional. Action: add a post-signup MFA setup step, mandatory for `is_admin = true` profiles.
- [x] **HIBP / breach-list password check.** Implemented at `src/lib/auth/hibp.ts` — k-anonymity (only first 5 chars of SHA-1 hash sent to api.pwnedpasswords.com). Wired into signup + reset-password forms. Fails open on network error so HIBP downtime doesn't block signup. CSP allow-listed.
- [x] Rate limiting on auth: Supabase Auth has built-in per-IP + per-email rate limits; Cloudflare also rate-limits at the edge.
- [ ] **Progressive account lockout** after N failed signin attempts. Supabase rate-limits but doesn't lock — would need a `failed_signin_attempts` table + middleware check.
- [~] **CAPTCHA / Cloudflare Turnstile** on signup + signin. Widget component at `src/components/auth/turnstile-widget.tsx`; signup + signin forms render it when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, capture the token, and pass `options.captchaToken` to Supabase. Two **PO actions** for it to actually verify:
  1. Cloudflare Dashboard → **Turnstile** → Add a site → domain `advertisehomes.online` → save the **Site Key** + **Secret Key**.
  2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `.env.local` + Pages secrets + GitHub Actions secret.
  3. Supabase Dashboard → **Project Settings** → **Auth** → **Captcha protection** → Enable, choose **Turnstile**, paste the **Secret Key**, save. (Supabase verifies the token server-side against this secret.)
- [x] Generic error messages: Supabase Auth returns `Invalid login credentials` on bad password OR unknown email — no enumeration. Verified.

### Session management
- [x] Cryptographically random session tokens: Supabase uses 256-bit random tokens.
- [x] HttpOnly cookie flag: `@supabase/ssr` sets HttpOnly on auth cookies by default.
- [x] Secure cookie flag: set in HTTPS context (Cloudflare Pages enforces HTTPS).
- [~] SameSite: defaults to `Lax` (not `Strict`). `Strict` would break magic-link / password-reset flows that arrive from external email clients. `Lax` is the documented safe default.
- [x] Token rotation on signin: Supabase rotates the access + refresh token pair on every signin.
- [~] Idle timeout: access-token TTL is 1 hour (Supabase default). Spec checklist asks for 15-30min — would need to override in Supabase project settings.
- [~] Absolute re-auth: refresh-token TTL is 30 days. Spec checklist asks for 12-24h. Would need to override.
- [x] Server-side session destruction on signout: `supabase.auth.signOut({ scope: 'global' })` revokes the refresh-token row in `auth.refresh_tokens` (this commit's signout button uses scope='global').

### Advanced technical (this commit)
- [x] HTTPS site-wide: Cloudflare auto.
- [x] **HSTS:** `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (next.config.ts).
- [x] **X-Content-Type-Options:** `nosniff`.
- [x] **X-Frame-Options:** `DENY` + CSP `frame-ancestors 'none'` (belt-and-suspenders).
- [x] **Content-Security-Policy:** allow-listed for self + js.stripe.com + unpkg (Leaflet CSS) + imagedelivery.net (Cloudflare Images) + *.tile.openstreetmap.org + *.supabase.co. `'unsafe-inline'` on script-src is required for the layout's theme-init script + Next.js's RSC bootstrap; CSP nonces are a future polish item.
- [x] **Referrer-Policy:** `strict-origin-when-cross-origin`.
- [x] **Permissions-Policy:** camera/microphone/geolocation blocked; payment scoped to Stripe only.
- [~] WAF: Cloudflare's free-tier managed rules are active. Full WAF (custom rules, OWASP Top 10 ruleset) is paid-tier.
- [x] **`pnpm audit` in CI.** `pnpm audit --prod --audit-level=high` runs before typecheck. Failed initially on a `drizzle-orm@<0.45.2` advisory; resolved by upgrading to `drizzle-orm@^0.45.2` + `next-intl@^4.x` (both via `pnpm add latest`, no code changes needed — Drizzle schema API + next-intl 3→4 API are stable for our usage). 2 moderate vulnerabilities remain (transitive `uuid@<14` + similar) — these don't fail CI at the `high` threshold but are tracked for cleanup.

---

## Engineering — discovered during execution

- [ ] **Dedicated test Supabase project** (per `RISKS.md` R11). RLS test fixtures currently live in the production project. Decide: (a) provision a free-tier test project now, or (b) wait for Supabase database branching to stabilize. Recommend (a) for v1; (b) at v1.1. Until then, every public-facing surface filters `aho-test-org-*` org slugs + `aho-fixture-*` listing slugs (pattern documented in `CLAUDE.md` "Local-dev quirks"). Belt-and-suspenders is in place but a test project is the durable fix.
- [ ] **direnv installation** — never landed (no `brew` on the system). Current workaround: prefix every Bash command needing env vars with `set -a && source .env.local && set +a`. Long-term install via `curl -sfL https://direnv.net/install.sh | bash`. Not blocking.
- [ ] **pnpm not globally installed** — `corepack` symlink permission denied on `/usr/local/bin`. Workaround: shell shim at `node_modules/.bin/pnpm` that execs `corepack pnpm@9.12.3 "$@"`. Future-proof fix: install pnpm to a user-local prefix or use a Node version manager. Not blocking.
- [ ] **DB password** (`Masterdominikana32$` — exposed via a postgres-js parse error in chat 2026-04-29). Treat as no-longer-secret. PO explicitly deferred rotation ("keep the database password now"); flagged for hygiene cleanup. Rotate at Supabase → Project Settings → Database → Reset password and update `SUPABASE_POOLER_URL` in `.env.local`.
- [ ] **Custom-font load on Edge for `next/og`.** Current OG cards use system-ui because Inter / HashiCorp Sans `.woff2` fetch on Cloudflare Pages with @vercel/og's Satori has been finicky. Cosmetic; revisit if OG share rates need a brand polish.
- [ ] **`/admin/users` self-protection** is JS-side only (refuses self-demote in the action). Could harden with a Postgres trigger that prevents the last admin from being demoted (refuses any UPDATE that would leave zero `is_admin = true` rows). Not urgent — current setup needs an attacker who's already an admin to misuse it.

---

## §30 questions from `HANDOFF_part2.md` — recommendations on file

Not blocking. Each must be answered before its respective module starts.

- [ ] **Currency storage.** Spec inconsistency: `properties.price_cents bigint` (correct), `plans.amount_cents int` (overflow risk). Recommendation: `bigint` cents everywhere. Normalize before pricing any non-USD currency.
- [ ] **FX rates source + cadence.** Recommendation: Open Exchange Rates daily into a `currency_rates` table; store both original and `price_usd_cents` snapshot for search comparability. Defer until non-USD pricing exists.
- [ ] **Address geocoding provider.** Recommendation: Mapbox Geocoding API (free tier covers early scale). Currently lat/lng is set manually in the listing form.
- [ ] **Reverse-image fraud detection.** Recommendation: pHash on publish; layer Google Vision later only if abuse rate justifies it.
- [ ] **Agency seat billing model.** Not relevant until v1.1. Recommendation: flat fee + included seats + add-on seat product.
- [ ] **Lead email relay provider.** Recommendation: Resend Inbound (already a dependency for transactional once the key lands).
- [ ] **Listing expiration policy.** Recommendation: 60 days, with -7d/-1d email reminders, one-click renewal, auto-archive at expiry.
- [ ] **Sold/rented status authority.** Recommendation: agent self-attests with timestamp; admin spot-check via `/admin/listings`.
- [ ] **AI content disclosure.** Not relevant in v1.
- [ ] **Mobile app strategy.** v2 = native (Expo). API design constraint for v1: JSON-over-REST with token auth, not RPC-only via Server Actions.
- [ ] **Agency subdomain branding.** Recommendation: path-based for v1.1; subdomain available later as an Agency upgrade.

---

## Resolved (pruned for brevity — see `DECISIONS.md` for full reasoning)

These were tracked here previously and are now decided / done:

- v1 scope locked (Free + Registered + Agent only; Premium/Agency v1.1; Expert v2)
- Pricing: $29/mo, $290/yr, $19/mo founder rate
- Anchor launch market: Santo Domingo, DR (worldwide via city landing pages, lat/lng free-text)
- No-language-fallback rule dropped — single-language listings allowed
- Slice-1 timebox 10 weeks
- Supabase region US East
- Account ownership: PO owns third-party accounts; secrets via `.env.local`
- Founder-rate pricing: application-gated counter, atomic claim
- Migration tooling: hand-written SQL + Drizzle TS schema as runtime types only
- Cloudflare adapter: `@cloudflare/next-on-pages` + Pages (despite npm deprecation)
- Visual design: HashiCorp tokens via `@theme`, Inter substituted for HashiCorp Sans
- GitHub repo + initial push (`fotografosantodomingo/AHO`)
- Cloudflare API token re-scoped (Pages, KV, Workers Scripts, R2 — R2 service still pending opt-in)
- Cloudflare Pages project `aho-web` created + GH Actions deploy on push to `main`
- Stripe archived live products + reverted to test mode (with guardrail script)
- Stripe webhook URL pointing at production domain
- Custom domain `advertisehomes.online` live (Cloudflare Pages)
- Supabase Auth → URL Configuration updated for advertisehomes.online
- 21st.dev / `ui-ux-pro-max` polish-phase decision logged (waiting on key rotation)
