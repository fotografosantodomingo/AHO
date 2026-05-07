-- 0035_agent_faqs_multilocale.sql
--
-- Extends agent_faqs (migration 0032) from bilingual EN/ES to AHO's
-- full 7-locale set (EN, ES, PL, PT, DE, FR, IT).
--
-- The original schema added per-locale columns (question_en/_es,
-- answer_en/_es). To stay consistent and avoid breaking the existing
-- query patterns, we keep the flat-column model and add 10 more
-- columns: question_{pl,pt,de,fr,it} + answer_{pl,pt,de,fr,it}.
--
-- Why not flip to a normalized translations table now: the existing
-- table is small (≤ a handful of rows in production at the time of
-- this migration), the per-locale read pattern in
-- `fetchAgentFaqs(locale)` is a simple `select question_<locale>,
-- answer_<locale>`, and a flat-column model keeps the agent profile
-- page's render path branchless. If we ever add more than 10-12
-- locales we should revisit and migrate to a translations side-table.
--
-- The check constraint is rewritten to require AT LEAST ONE locale
-- pair to be filled — same intent as before, just over the wider set.
--
-- RLS / triggers / indexes are unchanged from 0032. New columns
-- inherit the row-level security automatically.

alter table public.agent_faqs add column if not exists question_pl text;
alter table public.agent_faqs add column if not exists question_pt text;
alter table public.agent_faqs add column if not exists question_de text;
alter table public.agent_faqs add column if not exists question_fr text;
alter table public.agent_faqs add column if not exists question_it text;
alter table public.agent_faqs add column if not exists answer_pl text;
alter table public.agent_faqs add column if not exists answer_pt text;
alter table public.agent_faqs add column if not exists answer_de text;
alter table public.agent_faqs add column if not exists answer_fr text;
alter table public.agent_faqs add column if not exists answer_it text;

-- Replace the bilingual-only check constraint with the wide-locale
-- version. We drop the old name explicitly; the new one is named to
-- describe the policy (any locale pair filled).
alter table public.agent_faqs
  drop constraint if exists agent_faqs_at_least_one_locale;

alter table public.agent_faqs
  add constraint agent_faqs_at_least_one_locale check (
    (question_en is not null and answer_en is not null)
    or (question_es is not null and answer_es is not null)
    or (question_pl is not null and answer_pl is not null)
    or (question_pt is not null and answer_pt is not null)
    or (question_de is not null and answer_de is not null)
    or (question_fr is not null and answer_fr is not null)
    or (question_it is not null and answer_it is not null)
  );
