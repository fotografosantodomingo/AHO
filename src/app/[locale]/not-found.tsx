import { getLocale, getTranslations } from 'next-intl/server';

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
export default async function LocalizedNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'notFound' });
  const homeHref = `/${locale}`;
  const searchHref = `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`;

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
          className="inline-flex h-10 items-center justify-center rounded-lg bg-surface-dark px-5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink"
        >
          {t('homeCta')}
        </a>
        <a
          href={searchHref}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-surface-muted dark:hover:bg-surface-dark"
        >
          {t('browseCta')}
        </a>
      </div>
    </main>
  );
}
