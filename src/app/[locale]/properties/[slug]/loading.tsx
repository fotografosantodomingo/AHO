/**
 * Loading skeleton for the property detail page. Layout mirrors
 * src/app/[locale]/properties/[slug]/page.tsx so the swap is visually
 * stable.
 */
export default function PropertyDetailLoading() {
  return (
    <main aria-hidden="true" className="mx-auto max-w-4xl px-6 py-10">
      {/* Strap (transaction · city, country) */}
      <div className="h-4 w-48 animate-pulse rounded bg-border-strong/15" />

      {/* Title */}
      <div className="mt-3 space-y-2">
        <div className="h-10 w-3/4 animate-pulse rounded-lg bg-border-strong/15" />
        <div className="h-10 w-1/2 animate-pulse rounded-lg bg-border-strong/15" />
      </div>

      {/* Price */}
      <div className="mt-3 h-8 w-44 animate-pulse rounded bg-border-strong/15" />

      {/* 4-stat grid */}
      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded bg-border-strong/15" />
            <div className="h-6 w-12 animate-pulse rounded bg-border-strong/15" />
          </div>
        ))}
      </dl>

      {/* Description */}
      <div className="mt-10 space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-border-strong/15" />
        <div className="h-4 w-full animate-pulse rounded bg-border-strong/15" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-border-strong/15" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-border-strong/15" />
      </div>

      {/* Contact section */}
      <div className="mt-12 grid gap-6 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep md:grid-cols-2">
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
