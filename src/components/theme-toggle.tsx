'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Moon, Sun, Monitor } from 'lucide-react';

/**
 * Three-state theme toggle: light / dark / system.
 *
 * Renders a placeholder skeleton on the server to avoid hydration mismatches
 * (the actual current theme is only known on the client).
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="inline-flex h-9 w-[8.5rem] items-center rounded-md border border-zinc-200 dark:border-zinc-800"
      />
    );
  }

  return (
    <fieldset className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-800">
      <legend className="sr-only">{t('label')}</legend>
      <button
        type="button"
        aria-pressed={theme === 'light'}
        aria-label={t('light')}
        title={t('light')}
        onClick={() => setTheme('light')}
        className={`inline-flex h-9 w-9 items-center justify-center text-sm ${
          theme === 'light' ? 'bg-zinc-100 dark:bg-zinc-800' : ''
        }`}
      >
        <Sun aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-pressed={theme === 'system'}
        aria-label={t('system')}
        title={t('system')}
        onClick={() => setTheme('system')}
        className={`inline-flex h-9 w-9 items-center justify-center text-sm ${
          theme === 'system' ? 'bg-zinc-100 dark:bg-zinc-800' : ''
        }`}
      >
        <Monitor aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-pressed={theme === 'dark'}
        aria-label={t('dark')}
        title={t('dark')}
        onClick={() => setTheme('dark')}
        className={`inline-flex h-9 w-9 items-center justify-center text-sm ${
          theme === 'dark' ? 'bg-zinc-100 dark:bg-zinc-800' : ''
        }`}
      >
        <Moon aria-hidden="true" className="h-4 w-4" />
      </button>
    </fieldset>
  );
}
