/**
 * i18n configuration — single source of truth for locales, default locale,
 * and localized pathnames.
 *
 * Per HANDOFF.md §11: EN + ES at launch, path-prefix routing
 * (`/en/...`, `/es/...`), per-locale path segments for the listing routes.
 *
 * Locale switching: per CRITIQUE.md / HANDOFF.md §15.4, never auto-redirect
 * based on Accept-Language. The user lands on the URL they were given;
 * the language toggle changes locale on demand.
 */

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Localized path segments — `/properties` (EN) ↔ `/propiedades` (ES).
 * Routes must be registered in both branches.
 */
export const PATHNAMES = {
  '/': '/',
  '/pricing': {
    en: '/pricing',
    es: '/precios',
  },
  '/privacy': {
    en: '/privacy',
    es: '/privacidad',
  },
  '/terms': {
    en: '/terms',
    es: '/terminos',
  },
  '/signin': {
    en: '/signin',
    es: '/iniciar-sesion',
  },
  '/signup': {
    en: '/signup',
    es: '/registrarse',
  },
  '/forgot-password': {
    en: '/forgot-password',
    es: '/recuperar-contrasena',
  },
  '/reset-password': {
    en: '/reset-password',
    es: '/restablecer-contrasena',
  },
  '/magic-link': {
    en: '/magic-link',
    es: '/enlace-magico',
  },
  '/auth/error': '/auth/error',
  '/search': {
    en: '/search',
    es: '/buscar',
  },
  '/dashboard': {
    en: '/dashboard',
    es: '/panel',
  },
  '/dashboard/properties': {
    en: '/dashboard/properties',
    es: '/panel/propiedades',
  },
  '/dashboard/properties/new': {
    en: '/dashboard/properties/new',
    es: '/panel/propiedades/nuevo',
  },
  '/dashboard/properties/[id]': {
    en: '/dashboard/properties/[id]',
    es: '/panel/propiedades/[id]',
  },
  '/dashboard/leads': {
    en: '/dashboard/leads',
    es: '/panel/contactos',
  },
  '/dashboard/analytics': {
    en: '/dashboard/analytics',
    es: '/panel/estadisticas',
  },
  '/dashboard/analytics/[id]': {
    en: '/dashboard/analytics/[id]',
    es: '/panel/estadisticas/[id]',
  },
  '/dashboard/social': {
    en: '/dashboard/social',
    es: '/panel/social',
  },
  '/dashboard/profile': {
    en: '/dashboard/profile',
    es: '/panel/perfil',
  },
  // Saved searches — top-level (NOT inside /dashboard) because they're a
  // buyer feature: anyone with an account can save filters, regardless of
  // whether they have an Agent subscription. Putting this under
  // /dashboard/* would trip the layout's org-membership redirect to
  // /pricing for non-agent buyers.
  '/saved-searches': {
    en: '/saved-searches',
    es: '/busquedas-guardadas',
  },
  // Saved properties (favorites) — same buyer-feature reasoning as
  // saved-searches; lives at top-level so non-agent buyers can reach it.
  '/saved-properties': {
    en: '/saved-properties',
    es: '/inmuebles-guardados',
  },
  '/onboarding/welcome': {
    en: '/onboarding/welcome',
    es: '/inicio/bienvenida',
  },
  // Property detail — slug parameter contains both the human-readable slug
  // and the 6-char short ID, joined with a hyphen: `{slug}-{shortId}`.
  '/properties/[slug]': {
    en: '/properties/[slug]',
    es: '/propiedades/[slug]',
  },
  // Countries directory — public, indexable. Lists every country with
  // active listings. Top of the geography hierarchy.
  '/countries': {
    en: '/countries',
    es: '/paises',
  },
  // Country-level landing — public, indexable. Lists cities (with active
  // listing counts) for a single country. Two-letter ISO code in URL.
  '/properties-in/[country]': {
    en: '/properties-in/[country]',
    es: '/inmuebles-en/[country]',
  },
  // City landing pages — indexable browse alternative to /search.
  // `[country]` is a lowercase ISO-3166-1 alpha-2 code (do, us, mx, etc.);
  // `[city]` is the slugified city name (santo-domingo, new-york, etc.).
  // Spec §16.7: city landing pages serve as the SEO-indexable browse path
  // since /search itself is noindex (faceted URLs cause infinite crawl).
  '/properties-in/[country]/[city]': {
    en: '/properties-in/[country]/[city]',
    es: '/inmuebles-en/[country]/[city]',
  },
  // Agent / org profile pages — public, indexable. Each Agent-tier org
  // (and later Agency-tier) gets a profile at `/agents/{slug}` that lists
  // their active+published listings + headquarters + description.
  '/agents/[slug]': {
    en: '/agents/[slug]',
    es: '/agentes/[slug]',
  },
  // Admin moderation surface — same path in both locales (internal tool;
  // platform admins are us, not localized). robots noindex enforced inline.
  '/admin': '/admin',
  // Public review-verification landing page (clicked from email link).
  '/reviews/verify/[token]': {
    en: '/reviews/verify/[token]',
    es: '/resenas/verificar/[token]',
  },
  // Agent's own review inbox + reply UI.
  '/dashboard/reviews': {
    en: '/dashboard/reviews',
    es: '/panel/resenas',
  },
  // Admin moderation queue (internal — not localized).
  '/admin/reviews': '/admin/reviews',
} as const;
