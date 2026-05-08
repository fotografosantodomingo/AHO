/**
 * Loading skeleton for the property detail page. Layout mirrors
 * src/app/[locale]/properties/[slug]/page.tsx so the swap is visually
 * stable. Container width + vertical padding match the live page
 * (max-w-5xl + py-8 md:py-10) so there's no horizontal jump on swap.
 *
 * Adds a hero gallery placeholder + spec-pill row that the previous
 * skeleton skipped — gallery is the LCP element on this page, so
 * showing its slot during streaming keeps perceived load smooth
 * instead of flashing mid-page text first.
 */
export default function PropertyDetailLoading() {
  return (
    <main aria-hidden="true" className="mx-auto max-w-5xl px-6 py-8 md:py-10">
      {/* Hero gallery placeholder. Edge-to-edge on mobile (matches the
          gallery's `-mx-4 md:mx-0` break-out), 16:9 aspect to mirror the
          most common primary-photo ratio. */}
      <div className="-mx-6 mb-8 aspect-[16/9] w-[calc(100%+3rem)] animate-pulse bg-border-strong/15 md:mx-0 md:w-full md:rounded-card" />

      {/* Strap (transaction · city, country) */}
      <div className="h-4 w-48 animate-pulse rounded bg-border-strong/15" />

      {/* Title */}
      <div className="mt-3 space-y-2">
        <div className="h-10 w-3/4 animate-pulse rounded-lg bg-border-strong/15" />
        <div className="h-10 w-1/2 animate-pulse rounded-lg bg-border-strong/15" />
      </div>

      {/* Price */}
      <div className="mt-3 h-8 w-44 animate-pulse rounded bg-border-strong/15" />

      {/* Spec pill row (bd / ba / m²). Mirrors the actual <ul> on the
          loaded page so the swap doesn't push content down. */}
      <ul className="mt-6 flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            className="h-9 w-24 animate-pulse rounded-md bg-border-strong/15"
          />
        ))}
      </ul>

      {/* Description */}
      <div className="mt-10 space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-border-strong/15" />
        <div className="h-4 w-full animate-pulse rounded bg-border-strong/15" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-border-strong/15" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-border-strong/15" />
      </div>

      {/* Contact section. Match the actual page: 1fr / 1.2fr columns on
          md+, single column stacked on mobile. */}
      <div className="mt-12 grid gap-6 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          <div className="h-6 w-40 animate-pulse rounded bg-border-strong/15" />
          <div className="h-4 w-32 animate-pulse rounded bg-border-strong/15" />
          <div className="mt-4 h-10 w-44 animate-pulse rounded-lg bg-border-strong/15" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-24 animate-pulse rounded bg-border-strong/15" />
              <div className="h-9 w-full animate-pulse rounded-lg bg-border-strong/15" />
            </div>
          ))}
          <div className="h-10 w-32 animate-pulse rounded-lg bg-border-strong/15" />
        </div>
      </div>
    </main>
  );
}
