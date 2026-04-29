## What

<!-- One sentence per change. Reference an issue/decision if relevant. -->

## Why

<!-- The reason this change exists. If a non-obvious choice, also update docs/DECISIONS.md in this PR. -->

## Test plan

- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm test` clean
- [ ] If RLS changed: paired test added under `tests/rls/` exercising every affected tier
- [ ] If schema changed: migration runs against an empty DB and against a backfilled fixture set
- [ ] If a public page changed: Lighthouse mobile ≥ 90; OG image renders; hreflang resolves

## Docs touched

- [ ] `docs/HANDOFF.md` (only if implementation deviated from spec)
- [ ] `docs/DECISIONS.md` (if a non-obvious choice was made)
- [ ] `docs/PROGRESS.md` (every PR — append to current week's entry)
- [ ] `docs/OPEN_QUESTIONS.md` (close any items this PR resolves)
