/**
 * Top-level loading skeleton for the [locale] segment. Renders during the
 * Server Component suspense boundary while a route's data fetches.
 *
 * Per Next.js convention: any sibling page.tsx whose Server Component
 * is awaiting data shows this fallback. More specific loading.tsx files
 * (search/loading.tsx, properties/[slug]/loading.tsx) take precedence
 * for those routes; this one's the default.
 *
 * Tokenized chrome: bg-surface-muted shimmer, brand-font headline
 * placeholder, helper-color body lines. Same design system as the rest
 * of the app so the transition is visually quiet.
 */
export default function LocaleLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="space-y-4" aria-hidden="true">
        <div className="h-9 w-2/3 animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
        <div className="h-5 w-1/2 animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
        <div className="h-5 w-1/3 animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
      </div>
    </main>
  );
}
