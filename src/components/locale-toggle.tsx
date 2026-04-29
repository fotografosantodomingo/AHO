'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Globe } from 'lucide-react';
import { LOCALES, type Locale } from '@/i18n/config';
import { usePathname, useRouter } from '@/i18n/routing';

/**
 * Locale switcher. Navigates to the same logical path under the new locale,
 * preserving search params. Path translations (e.g. `/properties` ↔
 * `/propiedades`) are handled by `next-intl/navigation` from the routing
 * config.
 */
export function LocaleToggle() {
  const t = useTranslations('locale');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;
    startTransition(() => {
      // `pathname` is the canonical (locale-agnostic) path; router.replace
      // re-resolves it under `next`.
      // @ts-expect-error — typed-routes for dynamic [slug] not always inferred
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">{t('label')}</span>
      <Globe aria-hidden="true" className="h-4 w-4" />
      <select
        value={locale}
        onChange={(e) => switchTo(e.target.value as Locale)}
        disabled={isPending}
        className="h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(l)}
          </option>
        ))}
      </select>
    </label>
  );
}
