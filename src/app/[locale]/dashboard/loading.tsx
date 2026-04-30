/**
 * Loading skeleton for the dashboard tree (properties / leads /
 * saved-searches). The dashboard layout's sidebar renders eagerly
 * (it doesn't await data); only the right-side content area suspends,
 * so this skeleton lives inside the layout's `<section>` slot.
 *
 * Layout mirrors the dashboard tables: header + status filter row +
 * 8 row placeholders in a divided list.
 */
export default function DashboardLoading() {
  return (
    <main aria-hidden="true" className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-9 w-48 animate-pulse rounded-lg bg-border-strong/15" />
        <div className="h-9 w-32 animate-pulse rounded-lg bg-border-strong/15" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full max-w-md animate-pulse rounded bg-border-strong/15" />
        <div className="divide-y divide-border/60">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-3">
              <div className="flex-1 space-y-1">
                <div className="h-4 w-2/3 animate-pulse rounded bg-border-strong/15" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-border-strong/15" />
              </div>
              <div className="h-5 w-16 animate-pulse rounded-full bg-border-strong/15" />
              <div className="h-5 w-24 animate-pulse rounded bg-border-strong/15" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
