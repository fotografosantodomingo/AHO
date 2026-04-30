/**
 * Loading skeleton for /search and /buscar. Mirrors the actual page
 * layout — H1, filter card, view toggle, results grid — so the
 * transition into the loaded state is positionally stable (no layout
 * shift when real content swaps in).
 */
export default function SearchLoading() {
  return (
    <main
      aria-hidden="true"
      className="mx-auto max-w-6xl space-y-6 px-6 py-8"
    >
      {/* H1 + Save-search button row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-10 w-72 animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
        <div className="h-9 w-36 animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
      </div>

      {/* Filter card */}
      <div className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded bg-surface-muted dark:bg-surface-dark" />
            <div className="h-9 w-full animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
          </div>
        ))}
        <div className="md:col-span-6 flex items-center gap-3 border-t border-border pt-3">
          <div className="h-9 w-28 animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
          <div className="h-9 w-20 animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-1">
        <div className="h-8 w-16 animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
        <div className="h-8 w-16 animate-pulse rounded-lg bg-surface-muted dark:bg-surface-dark" />
      </div>

      {/* Result count strap */}
      <div className="h-4 w-32 animate-pulse rounded bg-surface-muted dark:bg-surface-dark" />

      {/* 6 ListingCard placeholders */}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            className="overflow-hidden rounded-card border border-border bg-surface shadow-whisper dark:bg-surface-deep"
          >
            <div className="aspect-[4/3] w-full animate-pulse bg-surface-muted dark:bg-surface-dark" />
            <div className="space-y-2 p-4">
              <div className="h-3 w-24 animate-pulse rounded bg-surface-muted dark:bg-surface-dark" />
              <div className="h-5 w-3/4 animate-pulse rounded bg-surface-muted dark:bg-surface-dark" />
              <div className="h-6 w-1/2 animate-pulse rounded bg-surface-muted dark:bg-surface-dark" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-muted dark:bg-surface-dark" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
