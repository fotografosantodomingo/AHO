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
} as const;
