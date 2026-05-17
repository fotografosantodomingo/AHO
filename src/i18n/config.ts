/**
 * i18n configuration — single source of truth for locales, default locale,
 * and localized pathnames.
 *
 * Per HANDOFF.md §11 + 2026-05-07 expansion: launch locales EN + ES, plus
 * marketing/SEO locales PL + PT + DE + FR + IT for agent-acquisition
 * landing pages. The marketing locales render the same chrome as EN/ES
 * (with EN fallback for any untranslated keys via the merge in
 * `request.ts`); listings + agent profiles + city pages stay in the
 * language(s) their authors wrote.
 *
 * Locale switching: per CRITIQUE.md / HANDOFF.md §15.4, never auto-redirect
 * based on Accept-Language. The user lands on the URL they were given;
 * the language toggle changes locale on demand.
 */

export const LOCALES = ['en', 'es', 'pl', 'pt', 'de', 'fr', 'it'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Content locales — the subset that has full content translation
 * (listings, agent profiles, city pages, currency labels, photo SEO
 * dictionaries). The other `Locale` values are marketing-only and
 * fall back to EN content for content-side surfaces. Use
 * `narrowContentLocale()` to coerce a Locale into a ContentLocale at
 * any call site that needs the narrower type.
 */
export const CONTENT_LOCALES = ['en', 'es'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export function narrowContentLocale(locale: Locale): ContentLocale {
  return locale === 'es' ? 'es' : 'en';
}

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Localized path segments. ES has hand-translated segments (Spanish-
 * speaking visitors expect /precios, not /pricing). For the v1
 * marketing locales (PL/PT/DE/FR/IT) we keep the English path segments
 * — agents in those markets are used to seeing English in URLs and
 * over-localizing every segment churns translation work without SEO
 * payoff. The new agent-acquisition routes (/for-agents, /automation,
 * /save-time) ARE translated per locale because their slug IS the
 * keyword Google indexes against.
 */

// Helper to spread the EN form across the v1 marketing locales (no
// localized path segments yet for those). Reduces churn in this file.
const en5 = (path: string) => ({
  pl: path,
  pt: path,
  de: path,
  fr: path,
  it: path,
});

export const PATHNAMES = {
  '/': '/',
  '/pricing': {
    en: '/pricing',
    es: '/precios',
    ...en5('/pricing'),
  },
  '/privacy': {
    en: '/privacy',
    es: '/privacidad',
    ...en5('/privacy'),
  },
  '/terms': {
    en: '/terms',
    es: '/terminos',
    ...en5('/terms'),
  },
  '/signin': {
    en: '/signin',
    es: '/iniciar-sesion',
    ...en5('/signin'),
  },
  '/signup': {
    en: '/signup',
    es: '/registrarse',
    ...en5('/signup'),
  },
  '/forgot-password': {
    en: '/forgot-password',
    es: '/recuperar-contrasena',
    ...en5('/forgot-password'),
  },
  '/reset-password': {
    en: '/reset-password',
    es: '/restablecer-contrasena',
    ...en5('/reset-password'),
  },
  '/magic-link': {
    en: '/magic-link',
    es: '/enlace-magico',
    ...en5('/magic-link'),
  },
  '/auth/error': '/auth/error',
  '/search': {
    en: '/search',
    es: '/buscar',
    ...en5('/search'),
  },
  '/dashboard': {
    en: '/dashboard',
    es: '/panel',
    ...en5('/dashboard'),
  },
  '/dashboard/properties': {
    en: '/dashboard/properties',
    es: '/panel/propiedades',
    ...en5('/dashboard/properties'),
  },
  '/dashboard/properties/new': {
    en: '/dashboard/properties/new',
    es: '/panel/propiedades/nuevo',
    ...en5('/dashboard/properties/new'),
  },
  '/dashboard/properties/[id]': {
    en: '/dashboard/properties/[id]',
    es: '/panel/propiedades/[id]',
    ...en5('/dashboard/properties/[id]'),
  },
  '/dashboard/leads': {
    en: '/dashboard/leads',
    es: '/panel/contactos',
    ...en5('/dashboard/leads'),
  },
  '/dashboard/leads/[id]': {
    en: '/dashboard/leads/[id]',
    es: '/panel/contactos/[id]',
    ...en5('/dashboard/leads/[id]'),
  },
  '/dashboard/leads/routing': {
    en: '/dashboard/leads/routing',
    es: '/panel/contactos/enrutamiento',
    ...en5('/dashboard/leads/routing'),
  },
  '/dashboard/analytics': {
    en: '/dashboard/analytics',
    es: '/panel/estadisticas',
    ...en5('/dashboard/analytics'),
  },
  '/dashboard/analytics/[id]': {
    en: '/dashboard/analytics/[id]',
    es: '/panel/estadisticas/[id]',
    ...en5('/dashboard/analytics/[id]'),
  },
  '/dashboard/social': {
    en: '/dashboard/social',
    es: '/panel/social',
    ...en5('/dashboard/social'),
  },
  '/dashboard/profile': {
    en: '/dashboard/profile',
    es: '/panel/perfil',
    ...en5('/dashboard/profile'),
  },
  '/saved-searches': {
    en: '/saved-searches',
    es: '/busquedas-guardadas',
    ...en5('/saved-searches'),
  },
  '/preview/[auditId]': {
    en: '/preview/[auditId]',
    es: '/vista-previa/[auditId]',
    ...en5('/preview/[auditId]'),
  },
  '/saved-properties': {
    en: '/saved-properties',
    es: '/inmuebles-guardados',
    ...en5('/saved-properties'),
  },
  '/onboarding/welcome': {
    en: '/onboarding/welcome',
    es: '/inicio/bienvenida',
    ...en5('/onboarding/welcome'),
  },
  '/properties/[slug]': {
    en: '/properties/[slug]',
    es: '/propiedades/[slug]',
    ...en5('/properties/[slug]'),
  },
  '/countries': {
    en: '/countries',
    es: '/paises',
    ...en5('/countries'),
  },
  '/properties-in/[country]': {
    en: '/properties-in/[country]',
    es: '/inmuebles-en/[country]',
    ...en5('/properties-in/[country]'),
  },
  '/properties-in/[country]/[city]': {
    en: '/properties-in/[country]/[city]',
    es: '/inmuebles-en/[country]/[city]',
    ...en5('/properties-in/[country]/[city]'),
  },
  '/agents/[slug]': {
    en: '/agents/[slug]',
    es: '/agentes/[slug]',
    ...en5('/agents/[slug]'),
  },
  '/admin': '/admin',
  // Admin subtree — same single-string path across every locale (admin
  // URLs are internal moderation, not user-facing SEO surfaces, so we
  // don't translate the segments). Registered explicitly so the locale
  // switcher's `getPathname()` resolves them cleanly instead of falling
  // back to home (QA-2026-05-10 P0 #6). `/admin/reviews` was already
  // registered below; keep it grouped with the rest of /admin/* here so
  // a future contributor sees the full subtree in one block.
  '/admin/orgs': '/admin/orgs',
  '/admin/leads': '/admin/leads',
  '/admin/users': '/admin/users',
  // MFA enrollment interstitial for admin accounts. Lives outside
  // /dashboard so the dashboard-layout MFA gate can redirect to it
  // without looping. Same path across locales — admin/security
  // surfaces don't need localized URL segments.
  '/setup-mfa': '/setup-mfa',
  '/reviews/verify/[token]': {
    en: '/reviews/verify/[token]',
    es: '/resenas/verificar/[token]',
    ...en5('/reviews/verify/[token]'),
  },
  '/dashboard/reviews': {
    en: '/dashboard/reviews',
    es: '/panel/resenas',
    ...en5('/dashboard/reviews'),
  },
  '/admin/reviews': '/admin/reviews',

  // ─── Agent acquisition / SEO landing pages ────────────────────────
  // The slug IS the keyword Google indexes against, so these are fully
  // localized per market. Added 2026-05-07 per PO directive — these
  // pages are conversion triggers for Pro Automation ($99/mo).

  '/for-agents': {
    en: '/for-agents',
    es: '/para-agentes',
    pl: '/dla-agentow',
    pt: '/para-agentes-imobiliarios',
    de: '/fuer-makler',
    fr: '/pour-agents',
    it: '/per-agenti',
  },
  '/automation': {
    en: '/automation',
    es: '/automatizacion',
    pl: '/automatyzacja',
    pt: '/automacao',
    de: '/automatisierung',
    fr: '/automatisation',
    it: '/automazione',
  },
  '/save-time': {
    en: '/save-time',
    es: '/ahorra-tiempo',
    pl: '/oszczedzaj-czas',
    pt: '/economize-tempo',
    de: '/zeit-sparen',
    fr: '/gagner-du-temps',
    it: '/risparmia-tempo',
  },

  // Documentation hub — written guide for buyers + agents + admins.
  // Per locale because the slug IS what users type and what Google
  // indexes; "documentation" in your own language is the natural URL.
  '/docs': {
    en: '/docs',
    es: '/documentacion',
    pl: '/dokumentacja',
    pt: '/documentacao',
    de: '/dokumentation',
    fr: '/documentation',
    it: '/documentazione',
  },

  // Step-by-step manual: how an agent goes from sign-up to a live
  // Facebook + Instagram post in 4 steps. Linked from /for-agents.
  // Per-locale slugs because the URL IS the keyword Google indexes —
  // "how to share real estate listings on social media" in each market.
  '/share-guide': {
    en: '/share-guide',
    es: '/guia-de-publicacion',
    pl: '/przewodnik-publikacji',
    pt: '/guia-de-publicacao',
    de: '/teilen-anleitung',
    fr: '/guide-de-partage',
    it: '/guida-condivisione',
  },

  // Profile-SEO guide: how to fill the AHO agent profile so Google
  // picks the agent up for "real estate agent in {city}" searches.
  // Covers the structured-data fields we auto-emit (RealEstateAgent
  // JSON-LD) + which profile fields drive each schema property.
  // Linked from /share-guide and /for-agents.
  '/profile-guide': {
    en: '/profile-guide',
    es: '/guia-perfil',
    pl: '/przewodnik-profilu',
    pt: '/guia-do-perfil',
    de: '/profil-anleitung',
    fr: '/guide-du-profil',
    it: '/guida-profilo',
  },
} as const;
