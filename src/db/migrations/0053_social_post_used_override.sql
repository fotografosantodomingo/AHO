-- 0053_social_post_used_override.sql
-- Audit column for Phase J of docs/SOCIAL_AUTOMATION_PLAN.md.
--
-- When an agent uses the AI-draft generator and then clicks Share now,
-- the publish route writes the agent's (possibly edited) text into the
-- platform call instead of the deterministic formatter output. We need
-- to know per attempt whether that happened — for telemetry ("are
-- agents actually using AI?"), for support triage ("was this caption
-- agent-edited or templated?"), and for the future "regenerate from
-- attempt" UI surface.
--
-- Nullable boolean — null means "this attempt happened before the
-- column existed". Default false matches the no-override path on
-- existing attempts. No backfill needed.

alter table public.social_post_attempts
  add column if not exists used_override boolean not null default false;

comment on column public.social_post_attempts.used_override is
  'True when the publish call used the agent''s AI-edited or hand-edited text (via /api/social/post body.overrides), false when it used the deterministic formatter output. See docs/SOCIAL_AUTOMATION_PLAN.md Phase J.';
