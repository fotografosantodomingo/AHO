-- 0045_reviews_locale_all_locales.sql
-- Expand reviews.locale CHECK to cover the full LOCALES set.
--
-- 0016_reviews.sql shipped with `check (locale in ('en', 'es'))` because
-- AHO was bilingual at the time. We've since added pl/pt/de/fr/it as
-- marketing locales (see src/i18n/config.ts). The route layer accepts
-- the wider set via Zod, but the DB CHECK still rejected anything
-- outside en/es — surfacing as `check_violation` for any reviewer on a
-- non-EN/ES surface.
--
-- Discovered live 2026-05-10 when the agent-profile review form on /pl
-- returned the generic "Nie udało się wysłać opinii" — first symptom
-- was a separate RLS bug (anon RETURNING on pending_verification),
-- fixed in 9eb20c1; this is the second layer that surfaced once RLS
-- stopped masking it.
--
-- Verification email body itself is bilingual EN/ES; the route narrows
-- via narrowContentLocale() before rendering, so storing the wider
-- locale code is purely informational (kept for future per-locale
-- moderation triage and localized agent-facing notification copy).

alter table public.reviews drop constraint if exists reviews_locale_check;

alter table public.reviews
  add constraint reviews_locale_check
  check (locale in ('en', 'es', 'pl', 'pt', 'de', 'fr', 'it'));
