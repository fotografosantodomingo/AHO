# SEED_LOG — Tier-3 seed inventory registry

> Authoritative record of the **seed** (non-real) data in production, so it can be
> told apart from real data and removed cleanly. Policy: `DECISIONS.md`
> "2026-06-07 — REVERSED the absolute no-fake-data rule"; CLAUDE.md hard rule #8;
> plan `docs/SEO_COLD_START_PLAN.md` §7; memory `aho_no_fake_data`.

## The one rule

Everything seed is tagged **`data_origin = 'seed'`** on `organizations`, `profiles`,
and `properties`. Real data is `data_origin = 'real'` (default). The split is always:

```sql
-- the real-vs-seed list
select data_origin, count(*) from public.properties group by data_origin;
select * from public.properties   where data_origin = 'seed';
select * from public.organizations where data_origin = 'seed';
select * from public.profiles      where data_origin = 'seed';
```

A DB trigger (`enforce_data_origin_immutable`, migration 0082) blocks laundering a
`seed` row into `real`, so the tag can't silently drift.

## What was seeded (2026-06-07)

- **~100 listings** across 20 flagship-market cities (capitals of ES/PT/MX/US/CO/IT/FR/DE/CR/PA/AE/GR/TH/BR/CA + Barcelona/Porto/Dubai/Cancún/Milan). **DR deliberately excluded** so seeds don't sit beside the 2 real agents' (babula, flbgroup) real listings.
- **3 seed agencies:** `atlas-prime-realty`, `costa-co-properties`, `meridian-global-homes`.
- **6 seed agents:** emails `@aho-seed.test` (Elena Márquez, Tomás Silva, Sofía Reyes, Andrés Gómez, James Carter, Noor Haddad).
- Content: distinct bilingual EN/ES per listing, Claude-generated (not templated). Realistic local-currency prices. **Text-only — no photos** (neutral placeholder; PO photo decision). `display_address=false` (neighborhood only, no fake street address).

Live count any time: `select count(*) from properties where data_origin='seed';`

## How to (re)generate

```bash
set -a && source .env.local && set +a
pnpm tsx scripts/seed-listings.ts                 # dry-run (plan only)
pnpm tsx scripts/seed-listings.ts --apply --limit 1   # one-city test
pnpm tsx scripts/seed-listings.ts --apply         # full set (idempotent per city)
```

## How to REMOVE (when real inventory replaces it)

```bash
set -a && source .env.local && set +a
pnpm tsx scripts/remove-seed.ts            # dry-run (counts)
pnpm tsx scripts/remove-seed.ts --apply    # delete all data_origin='seed'
```

This deletes seed listings → seed memberships → seed auth users (cascades their
profiles) → seed agencies. Listings are dynamic DB reads, so they vanish from the
site immediately; the sitemap drops them automatically (it reads active listings).
If the seed URLs were indexed long enough to matter, follow up with HTTP 410 on the
retired paths for a clean Google removal (see `SEO_COLD_START_PLAN.md` §7).

## Watch for

- **Google Search Console** — if the seed set gets flagged as thin/scaled content,
  pull it (`remove-seed.ts`) and lean on the knowledge-graph data pages instead.
- **Real-agent collision** — never seed cities where real agents operate (DR today).
- **Photos** — seeds stay text-only forever; if photos are ever wanted, they must be
  real photos of real properties, never stock/AI/scraped (CLAUDE.md #8).
