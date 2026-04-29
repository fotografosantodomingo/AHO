# AHO — Advertise Homes Online

Subscription real estate platform. v1 in development. The full spec is the source of truth — see [`docs/HANDOFF.md`](docs/HANDOFF.md) and [`docs/HANDOFF_part2.md`](docs/HANDOFF_part2.md).

## Stack

- **Frontend:** Next.js 15 (App Router, RSC) on Cloudflare Pages
- **Auth + DB:** Supabase (Postgres + PostGIS + Auth + RLS) — US East
- **Payments:** Stripe (Checkout, Billing, Tax)
- **Storage:** Cloudflare R2 (originals) + Cloudflare Images (variants)
- **Edge:** Cloudflare Workers + Queues
- **Email:** Resend (transactional) on `mail.advertisehomes.online`
- **i18n:** `next-intl` — EN + ES at launch
- **ORM:** Drizzle (migrations + complex queries); `@supabase/ssr` (user-context reads)
- **Test:** Vitest (unit + integration), Playwright (E2E), Supabase RLS test harness

## Getting started

```sh
nvm use            # Node 22 from .nvmrc
pnpm install
cp .env.example .env.local   # then fill in your values
pnpm dev
```

The app boots without any backend credentials, but most pages will fail to render server-side until `.env.local` is populated. Required-for-boot keys are listed in `.env.example`.

## Project docs

| File | Purpose |
|---|---|
| [`docs/HANDOFF.md`](docs/HANDOFF.md) + [`docs/HANDOFF_part2.md`](docs/HANDOFF_part2.md) | Full spec — source of truth |
| [`docs/CRITIQUE.md`](docs/CRITIQUE.md) | Engineering critique informing v1 scope cuts |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Architecture decisions, with rationale and reconsider-if conditions |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Session-by-session log; weekly Friday EOD update during slice 1 |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | Items needing PO decision |
| [`docs/RISKS.md`](docs/RISKS.md) | Live risk register |
| [`docs/DNS.md`](docs/DNS.md) | DNS records draft for `advertisehomes.online` |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code project memory (loaded every session) |
| [`.claude/skills/`](.claude/skills) | Project-scoped Claude Code skills (per-task playbooks) |

## Conventions

- **DB:** `snake_case`. Every table has `created_at`/`updated_at` `timestamptz default now()`.
- **TS:** `camelCase`, types in `PascalCase`. Path alias `@/*` resolves to `./src/*`.
- **Money:** integer cents in `bigint` everywhere.
- **RLS:** the primary tier-enforcement layer. Every public table has policies; every policy ships with a paired test under `tests/rls/`.
- **Branch strategy:** trunk-based with `main` always staging-deployable. Feature branches `feat/*`, `fix/*`, `chore/*`, `docs/*`. Conventional Commits. Squash-merge.
- **Real-only data:** no demo listings, no seeded content, no stock photography in user-facing slots. Test fixtures stay under `tests/` and never reach a deployed environment. See `docs/DECISIONS.md`.

## License

Proprietary — © 2026 Advertise Homes Online. All rights reserved.
