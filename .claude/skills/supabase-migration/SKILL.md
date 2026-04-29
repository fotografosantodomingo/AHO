---
name: supabase-migration
description: Author and ship a Postgres migration with paired RLS policies and tests
---

# When to use this skill
Use when adding or modifying a Supabase Postgres table, function, index, RLS policy, or extension. Do **not** use for ad-hoc data fixes — those go through a separate one-off migration path.

# Required reading before starting
- `docs/HANDOFF.md` §4 (database schema, the canonical names and types)
- `docs/HANDOFF.md` §4.7 (RLS principles — RLS is the primary tier enforcement layer)
- `CLAUDE.md` "Hard rules" #2 (every RLS policy ships with a paired test)

# Steps
1. Create a new migration file under `supabase/migrations/` (Drizzle).
2. Express the schema change idiomatically. Prefer additive changes; if you must drop or rename, write the rollback explicitly in a comment.
3. If the change touches a table with RLS, update or add policies in the **same** migration. Never let schema and RLS drift apart.
4. For every new or changed RLS policy, add a paired test under `tests/rls/` that exercises it from each affected tier — at minimum: anon, registered, premium, agent, agency, expert, admin. Test both positive (allowed) and negative (denied) cases.
5. Apply locally against `supabase start`, run the test suite, eyeball with `psql`.
6. If the change is non-obvious (denormalization, unusual index, a `security definer` function), record the rationale in `docs/DECISIONS.md`.
7. Open the PR. CI runs migrations against an ephemeral DB and runs the RLS test suite before merge.

# Caveats
- TODO: fill in concrete file naming convention once first migration ships.
- TODO: document the RLS test harness pattern (likely `pgtap` or a TS helper that opens authenticated Supabase clients).
- TODO: link to the seeded test fixtures (one user per tier) once they exist.
