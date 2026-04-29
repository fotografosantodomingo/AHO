---
name: rls-policy
description: Add or modify a Postgres Row Level Security policy with a paired test exercising it from each tier
---

# When to use this skill
Use whenever you add, change, or remove an RLS policy on any table in `public.*`. RLS is the **primary** tier enforcement layer — every change here is security-critical.

# Required reading before starting
- `docs/HANDOFF.md` §4.7 (RLS principles and example patterns) and §6 (the tier matrix)
- `docs/RISKS.md` R7 (service-role misuse — RLS does not protect service-role queries)
- `CLAUDE.md` "Hard rules" #2 (every RLS policy ships with a paired test) and #4 (frontend never decides)

# Steps
1. **State the intent in plain English** at the top of the migration: "anonymous users can read X when Y", "members of role Z in org O can write W", etc. If you can't write the rule clearly, the policy probably isn't right yet.
2. **Pick the right policy clause.** `USING` for reads/updates/deletes (visibility); `WITH CHECK` for inserts/updates (mutation legality). Many policies need both.
3. **Reference `auth.uid()` and `auth.jwt()` carefully.** Performance matters — wrap subqueries in `select` to allow init-plan caching where appropriate.
4. **Avoid recursive policies.** A policy on table A that joins table B which has its own policy can re-trigger evaluation. Use `security definer` helper functions for complex tier checks (e.g., `public.get_user_tier`).
5. **Cap-style enforcement** (e.g., listing cap of 5 per agent) goes inside `WITH CHECK` with a `count(*)` subquery against the tier's cap. Keep these queries indexed.
6. **Add the paired test** under `tests/rls/`. The test must:
   - Open one Supabase client per tier under test (anon, registered, premium, agent, agency, expert, admin) using a fixture user per tier.
   - Cover positive cases (each tier that *should* succeed actually succeeds).
   - Cover negative cases (each tier that *should* fail returns the expected denial — typically 0 rows for SELECT, or a permission error for INSERT/UPDATE/DELETE).
   - Include at least one cross-org test (an agent in org A cannot mutate org B's data).
7. **Document the policy** in `docs/HANDOFF.md` §4.7 if it's a pattern reused elsewhere, or in `docs/DECISIONS.md` if it's an unusual choice.
8. **Penetration-test path.** Before launch, the entire RLS surface gets a focused pen-test pass (success criterion §1.6). Add new policies to the test suite so they're covered.

# Caveats
- Service-role queries bypass RLS by design. Service-role usage outside the dedicated server-only module must be flagged in code review (and ideally lint).
- `security definer` functions run as their owner — auditing required.
- Forgetting `alter table ... enable row level security` is the most common mistake. Every new public table must enable RLS even if its first policy is "deny all".
