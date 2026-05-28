-- 0081_profiles_preferred_language_seven_locales.sql
--
-- PO directive 2026-05-28: the strategic concept for AHO social
-- publishing is "one designated language per agent, the agent's main
-- language" — a Polish agent posts to their Polish Facebook in Polish,
-- not in Spanish or English. The AHO platform listing itself stays
-- multilingual (translated for buyer SEO reach worldwide), but social
-- posts are one language: the agent's.
--
-- profiles.preferred_language exists from migration 0002 but its CHECK
-- constraint locks values to ('en','es'). That CHECK was written when
-- AHO targeted only EN+ES launch markets; the platform has since
-- shipped 7 locales (en/es/pl/pt/de/fr/it) and PO clarified the agent
-- must be able to pick any one of them as their main social-publish
-- language. Today a Polish agent literally cannot set 'pl' here — the
-- INSERT/UPDATE fails the CHECK.
--
-- This migration drops the EN/ES-only constraint and recreates it
-- with the full 7-locale set. Existing rows aren't affected (every
-- value in the column today is already 'en' or 'es' which are still
-- valid in the new set). Application-layer validation in
-- /api/me/profile is updated in the same PR.

alter table public.profiles
  drop constraint if exists profiles_preferred_language_check;

alter table public.profiles
  add constraint profiles_preferred_language_check
  check (preferred_language in ('en','es','pl','pt','de','fr','it'));

comment on column public.profiles.preferred_language is
  'Agent''s main language for social-publish content + lifecycle emails. Distinct from the listing-page locales (those go on each property row). One of: en, es, pl, pt, de, fr, it. Expanded from EN/ES on 2026-05-28 per PO directive.';
