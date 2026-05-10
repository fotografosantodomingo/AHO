'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/**
 * Route-level error boundary for everything under [locale]. Triggered when
 * a Server Component or route handler throws during rendering.
 *
 * Per Next.js convention: must be a Client Component (uses `'use client'`),
 * receives `{ error, reset }` props, and reset() retries the segment.
 *
 * The error.digest value is server-side only — it's the hash Next.js logs
 * to the server but we surface it to the user as a "reference ID" they
 * can quote in support requests.
 */
export default function LocalizedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('error');
  const locale = useLocale();
  const eyebrow = t('eyebrow');

  useEffect(() => {
    // Surfaces in the Cloudflare Workers log — we'll wire Sentry here
    // once the DSN is configured (out of slice 1; spec §22).
    console.error('[error.tsx]', error);
  }, [error]);

  const homeHref = `/${locale}`;

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-warn">
        {eyebrow}
      </p>
      <h1 className="mt-3 font-brand text-3xl font-semibold tracking-tight md:text-[42px] md:leading-[1.19]">
        {t('heading')}
      </h1>
      <p className="mt-4 max-w-md text-ink-muted dark:text-ink-inverse-muted">
        {t('body')}
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-xs text-helper">
          {t('details', { digest: error.digest })}
        </p>
      )}
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="btn-primary"
        >
          {t('retryCta')}
        </button>
        <a
          href={homeHref}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
        >
          {t('homeCta')}
        </a>
      </div>
    </main>
  );
}
