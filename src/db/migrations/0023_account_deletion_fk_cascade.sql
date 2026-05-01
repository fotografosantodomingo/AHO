-- 0023_account_deletion_fk_cascade.sql
--
-- GDPR-floor account deletion (Batch A4b). When a user invokes
-- POST /api/account/delete, the server-side flow does:
--   1. Cancel any owned-org Stripe subscriptions (immediate cancel,
--      not at_period_end — full GDPR right-to-erasure semantics).
--   2. Archive listings owned by the user (status='archived').
--   3. supabase.auth.admin.deleteUser(userId)   ← cascades:
--        auth.users (delete) →
--        public.profiles (CASCADE, see migration 0002) →
--        public.organization_members (CASCADE, see migration 0002).
--
-- Step 3's cascade is currently BLOCKED on these unrelaxed FKs:
--   - properties.created_by   NOT NULL, NO ACTION    ← blocks
--   - properties.primary_agent_id   NO ACTION        ← blocks
--   - subscriptions.user_id   NO ACTION              ← blocks
--   - leads.user_id           NO ACTION              ← blocks
--   - leads.assigned_to       NO ACTION              ← blocks
--   - founder_rate_grants.user_id   NOT NULL, NO ACTION  ← blocks
--   - audit_log.actor_id      NO ACTION              ← blocks
--
-- Fix: drop and recreate each FK with ON DELETE SET NULL semantics
-- (or CASCADE where that's the right call) and relax NOT NULL where
-- needed. The resulting database state preserves audit/review/lead
-- history with author anonymized, while the user's PII is removed.
--
-- Idempotent — uses `do $$ begin ... exception when undefined_object`
-- guards so a partial prior run can be re-applied safely.

-- properties.created_by — NOT NULL → nullable, NO ACTION → SET NULL.
-- After deletion, the listing stays in the org with NULL creator.
-- An admin/coworker can re-assign primary_agent_id later. Leaving
-- the row makes audit/SEO/inbound-lead history coherent.
do $$ begin
  alter table public.properties drop constraint properties_created_by_fkey;
exception when undefined_object then null; end $$;

alter table public.properties alter column created_by drop not null;

alter table public.properties
  add constraint properties_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- properties.primary_agent_id — already nullable; just rewire the FK.
do $$ begin
  alter table public.properties drop constraint properties_primary_agent_id_fkey;
exception when undefined_object then null; end $$;

alter table public.properties
  add constraint properties_primary_agent_id_fkey
  foreign key (primary_agent_id) references public.profiles(id) on delete set null;

-- subscriptions.user_id — already nullable; rewire FK to SET NULL.
do $$ begin
  alter table public.subscriptions drop constraint subscriptions_user_id_fkey;
exception when undefined_object then null; end $$;

alter table public.subscriptions
  add constraint subscriptions_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- leads.user_id — already nullable; rewire FK to SET NULL.
do $$ begin
  alter table public.leads drop constraint leads_user_id_fkey;
exception when undefined_object then null; end $$;

alter table public.leads
  add constraint leads_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- leads.assigned_to — already nullable; rewire FK to SET NULL.
do $$ begin
  alter table public.leads drop constraint leads_assigned_to_fkey;
exception when undefined_object then null; end $$;

alter table public.leads
  add constraint leads_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

-- founder_rate_grants.user_id — NOT NULL → nullable, NO ACTION → SET NULL.
-- Counter / cap accounting unaffected (founder_rate_counter is its own row).
-- Released grants stay; they just lose their PII linkage.
do $$ begin
  alter table public.founder_rate_grants drop constraint founder_rate_grants_user_id_fkey;
exception when undefined_object then null; end $$;

alter table public.founder_rate_grants alter column user_id drop not null;

alter table public.founder_rate_grants
  add constraint founder_rate_grants_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- audit_log.actor_id — already nullable; rewire FK to SET NULL.
-- Audit history preserved (kind / target_id / payload remain) but the
-- "who" pointer becomes NULL. payload may have already-redacted PII
-- per migration 0015.
do $$ begin
  alter table public.audit_log drop constraint audit_log_actor_id_fkey;
exception when undefined_object then null; end $$;

alter table public.audit_log
  add constraint audit_log_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;
