import { notFound } from 'next/navigation';

export const runtime = 'edge';

/**
 * Catch-all for unmatched paths inside the [locale] segment.
 *
 * Next.js's app-router behavior: an unmatched URL like `/es/foo/bar` does
 * NOT trigger `[locale]/not-found.tsx` automatically — that only fires
 * for explicit `notFound()` calls from inside the [locale] tree. Without
 * this catch-all, Next.js falls back to the root `not-found.tsx` (which
 * is English-only) for those URLs.
 *
 * By matching every sub-path that no specific route claimed and calling
 * `notFound()` here, we force the locale-aware not-found.tsx to render.
 *
 * Specific routes (e.g. `[locale]/properties/[slug]/page.tsx`,
 * `[locale]/dashboard/...`) take precedence per Next.js routing rules,
 * so this only fires when nothing else matched.
 */
export default function LocaleCatchAll() {
  notFound();
}
