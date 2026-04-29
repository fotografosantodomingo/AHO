# AHO — Advertise Homes Online

## Project summary
Subscription-based real estate platform (Zillow-style) with bilingual EN/ES, multi-currency display, and a marquee one-click social-distribution feature for paid tiers. Worldwide market scope (with launch-market caveats — see `docs/RISKS.md`). Domain: **advertisehomes.online**, brand short name **AHO**, internal slug `aho`. Repo: `git@github.com:fotografosantodomingo/AHO.git`. Cloudflare account ID: `5a389e6eea7a4e92999c5f1612eafbcc` (account IDs are not secrets; the API token in `.env.local` is). Supabase project ref: `lqujtquofsdsxtujvjtl` (URL: `https://lqujtquofsdsxtujvjtl.supabase.co`).

## Status
v1 build, pre-development. Spec is under critique. No application code yet.

## Tech stack (summary — full detail in `docs/HANDOFF.md` §3)
- Frontend: Next.js 15 (App Router, RSC) on Cloudflare Pages
- Auth: Supabase Auth (email+password, Google OAuth, magic link, TOTP MFA)
- DB: Supabase Postgres + PostGIS, RLS-enforced tier model
- Storage: Cloudflare R2 (originals) + Cloudflare Images (variants)
- Edge: Cloudflare Workers + Queues
- Payments: Stripe (Checkout, Billing, Customer Portal); Stripe Tax for VAT/sales tax
- Email: Resend (transactional) on `mail.advertisehomes.online`
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
/.claude/skills/           — project-scoped skills (per-task playbooks)
  supabase-migration/SKILL.md
  stripe-webhook/SKILL.md
  social-platform-integration/SKILL.md
  new-page/SKILL.md
  rls-policy/SKILL.md
```
Application folders (`app/`, `lib/`, `supabase/migrations/`, `tests/`, `emails/`, etc.) will be added once the build slice is approved.

## Conventions
- DB names: `snake_case`. Every table has `created_at`, `updated_at` `timestamptz` defaulting to `now()`.
- TS: `camelCase`; types in PascalCase.
- Code-side branding prefix: `aho` (env vars, KV namespaces, R2 buckets, Stripe metadata).
- Money is stored as integer cents in `bigint` where necessary.
- All public-facing copy must exist in both EN and ES. Do **not** fall back across languages — a listing missing one language does not appear in that language's site.
- Currency formatting via `Intl.NumberFormat` with the active locale; never hand-roll.

## Local-dev quirks (discovered 2026-04-29 — until cleaned up)

- **No direnv.** `.env.local` is not auto-loaded by Bash subprocesses. Prefix every command that needs env vars with `set -a && source .env.local && set +a && <cmd>`. Long-term fix in `OPEN_QUESTIONS.md`.
- **pnpm via corepack.** Global `pnpm` symlink couldn't be created (permission denied on `/usr/local/bin`). Invoke pnpm as `corepack pnpm@9.12.3 ...` everywhere.
- **Stripe is in LIVE mode.** Products and prices live in the PO's production Stripe account; no test mode set up. End-to-end testing of checkout flows in v1 week 3 will need real cards or a separate test account.
- **RLS test fixtures share the production Supabase project.** Filter UI / admin queries by `stripe_price_id NOT LIKE 'price_test_%'` and `slug NOT LIKE 'aho-test-org-%'` until a dedicated test project lands. See `RISKS.md` R11.

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
1. `docs/HANDOFF.md` (and `HANDOFF_part2.md` while it exists) — full spec.
2. `docs/DECISIONS.md` — architectural choices made and why.
3. `docs/PROGRESS.md` — last session's "Next session should start with".
4. `docs/OPEN_QUESTIONS.md` — items blocked on product owner.
5. `docs/RISKS.md` — what might bite us and what we're doing about it.

## Current focus
Awaiting `HANDOFF_part2.md`. Once received, produce a written critique covering risks, technical correctness, sequencing, timeline, and a recommended first build slice. **Do not write application code until the critique is reviewed and a slice is approved.**
