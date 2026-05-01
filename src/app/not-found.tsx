import Link from 'next/link';

/**
 * Root not-found.tsx — handles any URL that doesn't match a registered
 * route at all (the locale-aware version at `[locale]/not-found.tsx` only
 * catches `notFound()` calls from inside the [locale] tree).
 *
 * Locale isn't known at this layer (the request didn't reach a [locale]
 * segment). Default to English content. The "Back to home" link points
 * to `/en` to keep the user inside a known locale.
 *
 * The runtime declaration is required by next-on-pages for any non-static
 * route. Keeping this file dependency-free (no Supabase, no next-intl)
 * means it can render even when the runtime can't reach those services.
 */
export const runtime = 'edge';

export default function GlobalNotFound() {
  return (
    <html lang="en" className="bg-surface text-ink dark:bg-surface-dark dark:text-ink-inverse">
      <body className="font-sans antialiased">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            404
          </p>
          <h1 className="mt-3 font-brand text-3xl font-semibold tracking-tight md:text-[42px] md:leading-[1.19]">
            Page not found
          </h1>
          <p className="mt-4 max-w-md text-ink-muted dark:text-ink-inverse-muted">
            The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
          </p>
          <div className="mt-8 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/en"
              className="btn-primary"
            >
              Back to home
            </Link>
            <Link
              href="/en/search"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              Browse listings
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
