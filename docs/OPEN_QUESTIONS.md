# Open questions

Tracked here until decided. When resolved, move the answer to `DECISIONS.md` and remove the entry below.

---

## Pending from product owner — what still blocks work

### Email + observability infrastructure

- [ ] **Brevo: verify the sending domain.** `BREVO_API_KEY` is in `.env.local` and Cloudflare Pages secrets (PO action 2026-04-30 — replaces Resend). The transactional wrapper at `src/lib/email/brevo.ts` is wired and no-ops without the key. Before emails actually deliver, the PO must verify the sending domain in Brevo: **Senders → Domains → Add `advertisehomes.online`** → add the DKIM CNAMEs + SPF TXT records Brevo prints to Cloudflare DNS for `advertisehomes.online`. Without verification, Brevo returns 401 / 400 with a domain-not-authorized error.
- [ ] **Supabase Auth → SMTP relay through Brevo.** Critical for the SIGNUP CONFIRMATION + PASSWORD RESET + MAGIC LINK emails — those are sent by Supabase, NOT by our Brevo wrapper. Today they go through Supabase's default rate-limited service and frequently don't deliver. PO action: in **Supabase Dashboard → Project Settings → Auth → SMTP Settings**, enable Custom SMTP and set:
  - Host: `smtp-relay.brevo.com`
  - Port: `587`
  - Username: the Brevo SMTP login (Senders → SMTP → SMTP login, e.g. `91xxxx@smtp-brevo.com`)
  - Password: the Brevo SMTP password (separate from the API key — Brevo → SMTP → Generate a new SMTP key)
  - Sender email: `noreply@advertisehomes.online`
  - Sender name: `AHO`
  - Then click "Send test email" to verify before saving. Without this, new signups don't receive the confirmation link and the auth flow is broken end-to-end.
- [ ] **Sentry org + DSNs** for `aho-web` and `aho-workers`. Two DSNs in `.env.local`. Out of slice 1 per spec; non-blocking but hygienic to wire before paying agents land.
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
