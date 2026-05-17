# AHO — Advertise Homes Online

## Project summary
Subscription-based real estate platform (Zillow-style) with bilingual EN/ES, multi-currency display, and a marquee one-click social-distribution feature for paid tiers. Worldwide market scope (with launch-market caveats — see `docs/RISKS.md`). Domain: **advertisehomes.online**, brand short name **AHO**, internal slug `aho`. Repo: `git@github.com:fotografosantodomingo/AHO.git`. Cloudflare account ID: `5a389e6eea7a4e92999c5f1612eafbcc` (account IDs are not secrets; the API token in `.env.local` is). Supabase project ref: `lqujtquofsdsxtujvjtl` (URL: `https://lqujtquofsdsxtujvjtl.supabase.co`).

## Status
Live at **https://advertisehomes.online** (Cloudflare Pages, auto-deploy on push to `main` via `.github/workflows/deploy.yml`; preview URL `https://aho-web.pages.dev`). Slice 1 ~92% (gated on PO actions: Meta App Review submission per `docs/META_APP_REVIEW_SUBMISSION.md` + soft-beta agents). All five slice-2 surfaces shipped: city landing, agent profiles, admin moderation, saved searches, search/filter/map. Slice-3 polish in progress (bbox-driven map re-fetch, loading skeletons, design-system migration complete). 33 Edge Function Routes. 141/141 tests. See `docs/PROGRESS.md` for the per-session log.

## Tech stack (summary — full detail in `docs/HANDOFF.md` §3)
- Frontend: Next.js 15 (App Router, RSC) on Cloudflare Pages
- Auth: Supabase Auth (email+password, Google OAuth, magic link, TOTP MFA)
- DB: Supabase Postgres + PostGIS, RLS-enforced tier model
- Storage: Cloudflare R2 (originals) + Cloudflare Images (variants)
- Edge: Cloudflare Workers + Queues
- Payments: Stripe (Checkout, Billing, Customer Portal); Stripe Tax for VAT/sales tax
- Email: Brevo (transactional) on `mail.advertisehomes.online`
- ORM/migrations: Drizzle (recorded in `docs/DECISIONS.md`)

## Folder map
```
/CLAUDE.md                 — this file (Claude Code memory; high-signal, ~200 lines max)
/docs/
  HANDOFF.md               — canonical product spec (source of truth)
  HANDOFF_part2.md         — part 2 of the spec (sections 12+); merge into HANDOFF.md when stable
  DECISIONS.md             — architecture decision log (one entry per significant choice)
  PROGRESS.md              — session-by-session log
  OPEN_QUESTIONS.md        — items needing product owner decision
  RISKS.md                 — live risk register
  CRITIQUE.md              — slice-1 critique + slice 2/3 plan (CRITIQUE.md §F)
  DESIGN_REFERENCE.md      — HashiCorp-inspired design tokens (canonical visual language)
  CLOUDFLARE_RESOURCES.md  — infra to provision; some shipped, some pending
/.claude/skills/           — project-scoped skills (per-task playbooks)
  supabase-migration/, stripe-webhook/, social-platform-integration/, new-page/, rls-policy/
/src/
  app/[locale]/            — pages (homepage, search, property detail, pricing, dashboard, admin, agents/[slug], properties-in/[country]/[city], saved-searches, onboarding, auth surfaces, 404 + error boundaries)
  app/api/                 — billing/checkout-session, billing/portal, leads, properties/[id]/images, properties/by-bbox, webhooks/stripe
  app/sitemap.ts, robots.ts, not-found.tsx (root)
  components/              — auth, billing, listings, leads, admin, saved-searches, theme/locale toggles
  db/migrations/           — 10 hand-written SQL migrations (0001_init through 0010_saved_searches)
  db/schema.ts             — Drizzle TS schema mirror (runtime types only)
  lib/                     — supabase clients, billing handlers, listings/search, auth schemas, email templates, admin actions
  middleware.ts            — next-intl + Supabase session refresh, with /sitemap.xml + /robots.txt + /api/* + /auth/callback exclusions
  i18n/config.ts           — locales (en/es), default (en), localized PATHNAMES
/messages/{en,es}.json     — bilingual i18n strings, structurally identical
/scripts/                  — migrate.ts, setup-stripe-products.ts, seed-plans.ts, stripe-webhook-replay.ts
/tests/{rls,unit}/         — RLS pairs (identity/billing/properties/leads/saved-searches) + unit (upload, billing-slug, founder-window, whatsapp, email-templates)
/.github/workflows/        — ci.yml (typecheck + lint + unit), deploy.yml (build + wrangler pages deploy on push to main)
wrangler.toml              — name=aho-web, compatibility_flags=["nodejs_compat"], pages_build_output_dir=".vercel/output/static"
```

## Conventions
- DB names: `snake_case`. Every table has `created_at`, `updated_at` `timestamptz` defaulting to `now()`.
- TS: `camelCase`; types in PascalCase.
- Code-side branding prefix: `aho` (env vars, KV namespaces, R2 buckets, Stripe metadata).
- Money is stored as integer cents in `bigint` where necessary.
- All public-facing copy must exist in both EN and ES. Do **not** fall back across languages — a listing missing one language does not appear in that language's site.
- Currency formatting via `Intl.NumberFormat` with the active locale; never hand-roll.

## Local-dev quirks (until cleaned up)

- **No direnv.** `.env.local` is not auto-loaded by Bash subprocesses. Prefix every command that needs env vars with `set -a && source .env.local && set +a && <cmd>`.
- **pnpm via corepack.** Global `pnpm` symlink couldn't be created (permission denied on `/usr/local/bin`). Invoke pnpm as `corepack pnpm@9.12.3 ...` everywhere. A shim at `node_modules/.bin/pnpm` (`exec corepack pnpm@9.12.3 "$@"`) keeps `next-on-pages` build subprocesses happy.
- **Stripe is in TEST mode.** Live products were archived 2026-04-29 after a process gap (see `DECISIONS.md` "Stripe live → test"); current `.env.local` keys are `sk_test_…`. `scripts/setup-stripe-products.ts` has a guardrail that refuses live keys. Live promotion requires an explicit DECISIONS.md entry per CLAUDE.md hard rule #9.
- **RLS test fixtures share the production Supabase project.** Public-facing surfaces (sitemap, city landing, agent profiles, by-bbox API) ALL filter `aho-test-org-%` org slugs + `aho-fixture-%` listing slugs. See `RISKS.md` R11. Pattern recap: PostgREST inner-join `.not('organizations.slug', 'like', 'aho-test-org-%')` + a defensive in-loop slug check.
- **No `pnpm dev`.** Per-machine memory `aho_no_local_runtime`: dev/preview/prod all happen on Cloudflare Pages via `git push` → GH Actions → `wrangler pages deploy`. ~2 min from push to live. Do NOT start `next dev`.
- **Pre-push hook runs `pnpm test:unit` automatically.** Versioned at `.githooks/pre-push`; activate per-machine once via `bash scripts/setup-git-hooks.sh` (sets `core.hooksPath`). Closes the 2026-05-17 gap where a Phase 5 commit broke a test assertion and every subsequent push silently failed CI. Bypass with `git push --no-verify` for docs-only emergencies. Anything that touches `src/` should NOT bypass.
- **Post-deploy smoke runs after every Deploy.** `.github/workflows/post-deploy-smoke.yml` triggers on the Deploy workflow's completion; hits production endpoints (homepage, /for-agents, /investors, dashboard auth gate, OG image bytes, cron auth) + asserts shapes. Catches build-output regressions that survive typecheck + lint + tests (e.g., the 2026-05-17 `devIndicators: false` change that silently broke every ImageResponse route to 0 bytes). Failure surfaces as a red workflow run + the operator email PO already gets — but as an alert to fix, not as a mystery.
- **Edge runtime kills unawaited promises.** Cloudflare Workers / Pages Edge runtime cancels any promise the request handler doesn't `await` once it returns the Response. Pattern that LOOKS like fire-and-forget but ISN'T:
  ```ts
  void admin.from('audit_funnel_events').insert({...});  // ✗ silently dropped on Edge
  ```
  Always `await` server-side writes that should happen inside the request lifecycle. `logAiCall`, funnel-event inserts, and any other side-effect-during-render need the await. The 2026-05-17 QA pass found 0 rows in `ai_generation_log` + `audit_funnel_events` after real prod traffic because of this exact gotcha. The proper Cloudflare-native primitive is `ctx.waitUntil(promise)` but next-on-pages doesn't expose `ctx` cleanly; await is the pragmatic fix.
- **RLS-deny-all tables need explicit REVOKE.** Supabase's default grants give `anon` + `authenticated` SELECT on every newly-created table. For tables that should be service-role-only (RLS enabled, zero policies), the migration MUST end with:
  ```sql
  revoke all on public.<table_name> from anon, authenticated;
  ```
  RLS with no policies still blocks reads in practice, but defense-in-depth missing. See `src/db/migrations/0065_revoke_extra_grants.sql` for the precedent.

## Hard rules (must hold throughout the build)
1. **Never commit secrets.** Use `.env.local` locally and Cloudflare/Supabase/Stripe-managed secrets in deployed envs.
2. **Every RLS policy ships with a paired test** that exercises it from each affected tier — positive and negative cases. RLS is the primary tier enforcement layer; everything else is UX.
3. **Stripe webhooks must verify signatures and be idempotent** (use a `stripe_events_processed` dedup table). The DB is a cache of Stripe state, not the source of truth.
4. **The frontend never decides what a user can do.** It asks the database. Feature flags drive UX only.
5. **Run typecheck and lint before committing** (scripts wired into `package.json` once the project is scaffolded).
6. **`docs/HANDOFF.md` is truth.** If a build deviates, the same PR updates the spec.
7. **Append to `docs/PROGRESS.md` at the end of every working session.** Architectural choices also go to `docs/DECISIONS.md`.
8. **No fake data, no stock photos — ever, in any user-facing context.** AHO is a real estate marketplace; fake listings or stock photography in property slots destroys trust irreversibly. No seeded "demo" listings, agents, or photos in staging or production. No Lorem Ipsum, no Unsplash, no placeholder agents, no example properties on the marketing site. Empty states must read as "no listings yet" rather than be filled with mock data. **Permitted exceptions:** test fixtures under `tests/` and ephemeral local-dev databases — neither reachable from any user-visible URL or deployed environment. When the platform is empty, it shows empty.
9. **Any operation that creates billable resources or live-mode payment infrastructure requires explicit confirmation in chat before execution. The presence of a live API key is not implicit consent.** This applies to Stripe (live products / prices / customers / invoices), Cloudflare paid plans, paid-tier infra (Workers Paid, Supabase team plan), and any third-party API call that incurs cost. If the env has a live key but the user has not explicitly told me "create live X right now in this conversation," I default to test mode or ask. Logged after a process gap on 2026-04-29 where ambiguous "keep live" guidance was read as authorization to create live Stripe products; the policy in `docs/DECISIONS.md` is to default test, ask explicitly, and run with live only after a DECISIONS.md entry approves the specific operation.

## Read these before starting work
1. **`docs/STATUS.md`** — single source of truth for "where are we right now." Read this FIRST.
2. **`docs/PO_DECISIONS.md`** — open decisions blocking active work; check before assuming what to build.
3. **`docs/TEST_PLAN.md`** — features deployed but not yet validated by the PO clicking through them.
4. `docs/HANDOFF.md` (+ `HANDOFF_part2.md`) — full spec.
5. `docs/DECISIONS.md` — architectural choices made and why.
6. `docs/PROGRESS.md` — last session's "Next session should start with".
7. `docs/OPEN_QUESTIONS.md` — older open-questions doc; superseded by `PO_DECISIONS.md` for new items.
8. `docs/RISKS.md` — what might bite us and what we're doing about it.

## Operating protocol (PO 2026-05-17 — collaboration ritual)

This is HOW we work, not just WHAT we work on. Treat these as defaults — only deviate when the user explicitly redirects.

**The status ritual.** When the user types `status` (or "where are we" / "what's next"), I:
1. Read `docs/STATUS.md` and `docs/PO_DECISIONS.md`.
2. Summarize the top 3 things in flight + the top 3 things blocked.
3. Propose where to start this session (highest-leverage unblocked item from `STATUS.md` 🟡 Next 5).
4. Wait for sign-off or redirect before executing.

**The shipping discipline.** A feature is NOT "done" until:
1. It's committed + pushed + deployed (current bar).
2. It has an entry in `docs/TEST_PLAN.md` with a 3-line manual verification.
3. The user has typed `verified: <name>` confirming they clicked through it and it works.
Until step 3, I refer to it as "deployed, not validated" — never "shipped."

**Doc-maintenance is my job, not theirs.** I keep `STATUS.md`, `PO_DECISIONS.md`, `TEST_PLAN.md` current as I work. When a feature lands → it moves from `STATUS.md` 🟢/🟡 → ✅ AND gets a `TEST_PLAN.md` entry. When a decision blocks me → it lands in `PO_DECISIONS.md`, not as a mid-task chat interruption. When the user mentions a nice-to-have → it goes into the `STATUS.md` 📦 Punch list so it isn't lost.

**Mid-task interruptions.** If I hit something that needs PO input, I do NOT pause to ask. I:
- (a) Push the question into `PO_DECISIONS.md` with my recommended answer.
- (b) Either pick the safe default and proceed, OR move to a different unblocked item.
- Only block the chat with a question if the question is BOTH unanswerable by recommendation AND blocking ALL forward progress.

## Current focus
Slice 2 surfaces all live; slice-3 polish in progress (live-bbox map shipped; loading skeletons shipped). The remaining slice-1 close-out items are all PO-action-blocked:

| Pending PO action | Unlocks |
|---|---|
| Custom domain DNS (`advertisehomes.online` → Cloudflare Pages) | Production-grade URL. Sitemap + canonical URLs auto-pivot via `NEXT_PUBLIC_SITE_URL`. |
| Soft-beta agent recruitment (3–5 in DR) | First real listings; everything downstream of "real-only data" rule starts to pay off. |
| 21st.dev API key rotation (leaked in chat 2026-04-30) | UI/UX polish phase via `ui-ux-pro-max` skill (see `DECISIONS.md` "2026-04-30 — UI/UX polish phase"). |

While those unblock, Claude continues on autonomous slice-3 polish + slice-2 deepening (list-view sync to bbox, OG image generation, fixture-Stripe-state harness for the 5 deferred webhook-replay cases, marker clustering at high density, neighborhood overlays).
