interface StatTileProps {
  label: string;
  primary: number | string;
  secondary: number | string | null;
  secondaryLabel: string;
}

/**
 * Compact stat card for the analytics dashboards. Same shape on both
 * the org-summary surface (`/dashboard/analytics`) and the per-listing
 * drill-down (`/dashboard/analytics/[id]`).
 */
export function StatTile({
  label,
  primary,
  secondary,
  secondaryLabel,
}: StatTileProps) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-whisper">
      <p className="text-xs font-medium uppercase tracking-wider text-helper">
        {label}
      </p>
      <p className="mt-1 font-brand text-2xl font-semibold tracking-tight tabular-nums md:text-[28px]">
        {primary}
      </p>
      {secondary != null && (
        <p className="mt-1 text-xs text-helper">
          {secondary} <span className="text-helper/70">{secondaryLabel}</span>
        </p>
      )}
      {secondary == null && (
        <p className="mt-1 text-xs text-helper">{secondaryLabel}</p>
      )}
    </div>
  );
}

/**
 * "2m ago" / "5h ago" / "3d ago" / "Mar 12" formatter. Locale-aware
 * for Spanish ("hace 2m"). Avoids dragging in date-fns for one tiny use.
 */
export function formatRelativeTime(iso: string, locale: 'en' | 'es'): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return locale === 'es' ? 'ahora' : 'just now';
  if (m < 60) return locale === 'es' ? `hace ${m}m` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return locale === 'es' ? `hace ${h}h` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return locale === 'es' ? `hace ${d}d` : `${d}d ago`;
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-DO' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}
