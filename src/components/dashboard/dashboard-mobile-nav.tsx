'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

interface NavItem {
  href: string;
  label: string;
}

interface Props {
  items: NavItem[];
  ariaLabel: string;
  /** Optional trailing CTA — e.g. the BillingPortalButton — rendered
   *  beneath the dropdown so it's reachable without selecting it. */
  trailing?: React.ReactNode;
}

/**
 * Compact mobile dropdown for the dashboard sidebar. Native `<select>`
 * for accessibility (mobile keyboard, screen-reader semantics). Replaces
 * the prior horizontal-scroll row on mobile, which was visually chaotic
 * with 5+ items and no way to see "where am I now."
 *
 * Visible <md only — the desktop sidebar (rendered separately in
 * dashboard/layout.tsx) takes over at md+.
 *
 * Active item:
 *   The current pathname is matched against each item's `href`. The
 *   matching item's value is set as the select's `value`, so the
 *   dropdown shows where the user currently is.
 *
 * Navigation:
 *   On change, the route is pushed via the typed router. No full reload.
 */
export function DashboardMobileNav({ items, ariaLabel, trailing }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // Find the currently-active item. Match by exact path or by prefix
  // (e.g. /dashboard/properties/abc still highlights /dashboard/properties).
  const active =
    items.find((it) => pathname === it.href) ??
    items.find((it) => pathname.startsWith(it.href + '/')) ??
    items[0];

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next && next !== pathname) {
      startTransition(() => router.push(next));
    }
  }

  return (
    <div className="flex flex-col gap-2 md:hidden">
      <label className="block">
        <span className="sr-only">{ariaLabel}</span>
        <select
          value={active?.href ?? ''}
          onChange={onChange}
          disabled={pending}
          className="block h-11 w-full cursor-pointer appearance-none rounded-full border border-border-strong bg-surface bg-[image:var(--chevron-down)] bg-[position:right_0.875rem_center] bg-[size:0.85em] bg-no-repeat py-0 pr-10 pl-4 text-sm font-medium tracking-tight transition-colors hover:border-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action/50 disabled:opacity-60 dark:bg-surface-deep dark:hover:border-action-dark dark:focus-visible:ring-action-dark/50"
          style={{
            ['--chevron-down' as string]:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%231d5a3c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='1,1 6,6 11,1'/></svg>\")",
          }}
        >
          {items.map((it) => (
            <option
              key={it.href}
              value={it.href}
              style={{
                color: 'var(--color-ink)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              {it.label}
            </option>
          ))}
        </select>
      </label>
      {trailing}
    </div>
  );
}
