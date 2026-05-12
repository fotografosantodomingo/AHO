-- 0048_pin_function_search_path.sql
-- Clear the 7 `function_search_path_mutable` warnings from the
-- Supabase security advisor by pinning an explicit empty search_path
-- on each affected function.
--
-- Why this matters: PostgreSQL resolves unqualified names against the
-- caller's `search_path`. If a function is invoked by a session whose
-- search_path puts a malicious schema before `public`, an attacker
-- could shadow `public.foo` with their own `evil_schema.foo` and
-- redirect calls. The standard fix is to attach
-- `SET search_path = ...` to the function itself; this overrides the
-- caller's search_path for the function body's duration.
--
-- We use `SET search_path = ''` (empty) which is the strictest valid
-- form. PostgreSQL ALWAYS implicitly includes pg_catalog (built-ins
-- like now(), random(), coalesce(), substr() etc. resolve through
-- it), so an empty user-facing path is safe AS LONG AS every other
-- reference inside the function body is fully qualified.
--
-- Audited every function below — all use `public.foo` / `auth.foo`
-- qualified names everywhere they reference our own objects. No
-- function body changes needed; just attaching the config.
--
-- Owner check: all 7 are owned by `postgres` (us), not by
-- supabase_admin, so `alter function ... set search_path` succeeds —
-- unlike the spatial_ref_sys / extension-in-public cases which are
-- blocked by ownership (see docs/RISKS.md R13).
--
-- Note: this is migration 0048 (the prior 0048_spatial_ref_sys_rls
-- attempt was deleted unapplied because we couldn't get the necessary
-- ownership; the slot is reused here for the next forward step).

alter function public.require_sold_date_on_close() set search_path = '';
alter function public.aggregate_rating_for_agent(uuid) set search_path = '';
alter function public.trigger_recompute_agent_stats() set search_path = '';
alter function public.protect_review_fields() set search_path = '';
alter function public.gen_short_id() set search_path = '';
alter function public.protect_profile_admin_fields() set search_path = '';
alter function public.touch_updated_at() set search_path = '';
