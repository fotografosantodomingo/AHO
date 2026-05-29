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

          {/* Free Audit wedge — converts otherwise-lost 404 traffic.
              Same emerald CTA pattern as the blog / homepage / city /
              country empty states. Real-estate agents who hit a stale
              URL or a typo still see the wedge before bouncing. */}
          <aside className="mt-12 w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-left dark:border-emerald-800 dark:bg-emerald-950/30 md:p-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              For real estate agents
            </p>
            <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100 md:text-2xl">
              Paste your listing URL. Get a full ad campaign in 60 seconds.
            </h2>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 md:text-base">
              3 ready-to-publish captions in the language you choose — one for Facebook, Instagram, and LinkedIn. Free, no signup.
            </p>
            <div className="mt-4">
              <Link
                href="/en/for-agents#free-audit"
                className="inline-flex items-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Try free audit →
              </Link>
            </div>
          </aside>
        </main>
      </body>
    </html>
  );
}
