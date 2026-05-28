-- 0080_ai_audits_target_locale.sql
--
-- PO directive 2026-05-28: the Free Audit at /for-agents was running
-- the drafter 3 times (EN/ES/PL) for every paste-URL submission. An
-- agent in Poland doesn't want Spanish captions; an agent in DR doesn't
-- want Polish ones. We're swapping the hardcoded 3-locale fanout for a
-- single agent-chosen target locale: dropdown on the widget, persisted
-- here, read by the preview to render a single localized caption block
-- + creative overlay + photo alt text.
--
-- Cost win: 3 Haiku calls → 1 Haiku call (~3× cost reduction).
-- UX win: agent sees exactly the language they'll actually publish in.
--
-- The column is nullable so existing audits (pre-2026-05-28) that have
-- a 3-locale `drafts` JSONB continue to render via backward-compat in
-- the preview page — those rows expire after 7 days per the audit's
-- TTL anyway, so the backward-compat code path is short-lived.
--
-- Values are validated at the application layer against the 7-locale
-- set (en/es/pl/pt/de/fr/it) — no CHECK constraint here because the
-- locale set is a code concern, not a DB invariant.

alter table public.ai_audits
  add column if not exists target_locale text;

comment on column public.ai_audits.target_locale is
  'Agent-chosen target language for the drafter + title translation + creative overlay. One of: en, es, pl, pt, de, fr, it. NULL for pre-2026-05-28 audits which used the 3-locale fanout — preview page reads drafts keys instead for those. PO directive 2026-05-28.';

-- RLS: existing public_select policy already exposes columns to
-- preview consumers; new column inherits that visibility. Service-role
-- writes via /api/audit/start bypass RLS as designed. No new policy.
