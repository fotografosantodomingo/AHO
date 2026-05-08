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
        <div className="h-10 w-72 animate-pulse rounded-lg bg-border-strong/15" />
        <div className="h-9 w-36 animate-pulse rounded-lg bg-border-strong/15" />
      </div>

      {/* Filter card. Mirrors the actual SearchFilters layout exactly:
          7 fields (q · city · country · transaction · beds · min · max)
          in md:grid-cols-4 with the action row spanning the row. The
          earlier 6-cell mock looked wider than the real card and made
          the swap-in feel like a layout shift. */}
      <div className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep md:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded bg-border-strong/15" />
            <div className="h-9 w-full animate-pulse rounded-lg bg-border-strong/15" />
          </div>
        ))}
        <div className="md:col-span-4 flex items-center gap-3 border-t border-border pt-3">
          <div className="h-9 w-28 animate-pulse rounded-lg bg-border-strong/15" />
          <div className="h-9 w-20 animate-pulse rounded-lg bg-border-strong/15" />
        </div>
      </div>

      {/* View toggle — match production: h-11 on <md (Apple HIG tap-target
          floor on mobile), h-9 on md+. */}
      <div className="flex gap-1">
        <div className="h-11 w-20 animate-pulse rounded-lg bg-border-strong/15 md:h-9 md:w-16" />
        <div className="h-11 w-20 animate-pulse rounded-lg bg-border-strong/15 md:h-9 md:w-16" />
      </div>

      {/* Result count strap */}
      <div className="h-4 w-32 animate-pulse rounded bg-border-strong/15" />

      {/* 6 ListingCard placeholders */}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            className="overflow-hidden rounded-card border border-border bg-surface shadow-whisper dark:bg-surface-deep"
          >
            <div className="aspect-[4/3] w-full animate-pulse bg-border-strong/15" />
            <div className="space-y-2 p-4">
              <div className="h-3 w-24 animate-pulse rounded bg-border-strong/15" />
              <div className="h-5 w-3/4 animate-pulse rounded bg-border-strong/15" />
              <div className="h-6 w-1/2 animate-pulse rounded bg-border-strong/15" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-border-strong/15" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
