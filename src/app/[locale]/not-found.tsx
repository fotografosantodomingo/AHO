import { getLocale, getTranslations } from 'next-intl/server';
import { type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

export const runtime = 'edge';

/**
 * Locale-aware 404 page. Triggered when:
 *   - A route handler calls `notFound()` (e.g., property-detail page when
 *     the slug doesn't resolve).
 *   - A user types a URL that doesn't match any registered route inside
 *     the [locale] segment.
 *
 * Server Component. The active locale is resolved via `getLocale()` from
 * next-intl/server — the layout has already called `setRequestLocale` for
 * this request so `getLocale()` returns the right value without needing
 * a `params` prop (Next.js doesn't pass one to not-found.tsx).
 */
const WEDGE_COPY: Record<
  string,
  { eyebrow: string; headline: string; sub: string; button: string }
> = {
  en: {
    eyebrow: 'For real estate agents',
    headline: 'Paste your listing URL. Get a full ad campaign in 60 seconds.',
    sub: '3 ready-to-publish captions in the language you choose — one for Facebook, Instagram, and LinkedIn. Free, no signup.',
    button: 'Try free audit',
  },
  es: {
    eyebrow: 'Para agentes inmobiliarios',
    headline: 'Pega la URL de tu anuncio. Recibe una campaña completa en 60 segundos.',
    sub: '3 textos listos para publicar en el idioma que elijas — uno para Facebook, Instagram y LinkedIn. Gratis, sin registro.',
    button: 'Probar auditoría gratis',
  },
  pl: {
    eyebrow: 'Dla agentów nieruchomości',
    headline: 'Wklej URL swojej oferty. Pełna kampania reklamowa w 60 sekund.',
    sub: '3 gotowe do publikacji teksty w wybranym przez Ciebie języku — po jednym na Facebooka, Instagrama i LinkedIn. Bezpłatnie, bez rejestracji.',
    button: 'Wypróbuj bezpłatny audyt',
  },
  pt: {
    eyebrow: 'Para corretores imobiliários',
    headline: 'Cole o URL do seu anúncio. Campanha completa em 60 segundos.',
    sub: '3 textos prontos a publicar no idioma que escolher — um para Facebook, Instagram e LinkedIn. Grátis, sem registo.',
    button: 'Experimentar auditoria grátis',
  },
  de: {
    eyebrow: 'Für Immobilienmakler',
    headline: 'Inserat-URL einfügen. Komplette Anzeigenkampagne in 60 Sekunden.',
    sub: '3 veröffentlichungsbereite Texte in Ihrer Sprache — je einer für Facebook, Instagram und LinkedIn. Kostenlos, ohne Anmeldung.',
    button: 'Kostenlosen Audit testen',
  },
  fr: {
    eyebrow: 'Pour les agents immobiliers',
    headline: 'Collez l’URL de votre annonce. Campagne publicitaire complète en 60 secondes.',
    sub: '3 textes prêts à publier dans la langue de votre choix — un pour Facebook, Instagram et LinkedIn. Gratuit, sans inscription.',
    button: 'Essayer l’audit gratuit',
  },
  it: {
    eyebrow: 'Per agenti immobiliari',
    headline: 'Incolla l’URL del tuo annuncio. Campagna pubblicitaria completa in 60 secondi.',
    sub: '3 testi pronti da pubblicare nella lingua che scegli — uno per Facebook, Instagram e LinkedIn. Gratis, senza registrazione.',
    button: 'Prova l’audit gratuito',
  },
};

export default async function LocalizedNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'notFound' });
  const homeHref = `/${locale}`;
  const searchHref = localePath(locale as Locale, '/search');
  // WEDGE_COPY.en is the fallback contract — it ALWAYS exists. The
  // non-null assertion satisfies tsconfig's noUncheckedIndexedAccess.
  const wedge = WEDGE_COPY[locale] ?? WEDGE_COPY.en!;
  const auditHref = `${localePath(locale as Locale, '/for-agents')}#free-audit`;

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
        404
      </p>
      <h1 className="mt-3 font-brand text-3xl font-semibold tracking-tight md:text-[42px] md:leading-[1.19]">
        {t('heading')}
      </h1>
      <p className="mt-4 max-w-md text-ink-muted dark:text-ink-inverse-muted">
        {t('body')}
      </p>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <a
          href={homeHref}
          className="btn-primary"
        >
          {t('homeCta')}
        </a>
        <a
          href={searchHref}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
        >
          {t('browseCta')}
        </a>
      </div>

      {/* Free Audit wedge — converts otherwise-lost 404 traffic. Same
          emerald CTA pattern as blog / homepage / city / country empty
          states. Real-estate agents who hit a stale URL or a typo
          still see the wedge before bouncing. */}
      <aside className="mt-12 w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-left dark:border-emerald-800 dark:bg-emerald-950/30 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          {wedge.eyebrow}
        </p>
        <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100 md:text-2xl">
          {wedge.headline}
        </h2>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 md:text-base">
          {wedge.sub}
        </p>
        <div className="mt-4">
          <a
            href={auditHref}
            className="inline-flex items-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            {wedge.button} →
          </a>
        </div>
      </aside>
    </main>
  );
}
