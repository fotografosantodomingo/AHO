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
        className="inline-flex h-9 w-[8.5rem] items-center rounded-lg border border-border-strong"
      />
    );
  }

  return (
    <fieldset className="inline-flex items-center rounded-lg border border-border-strong">
      <legend className="sr-only">{t('label')}</legend>
      <button
        type="button"
        aria-pressed={theme === 'light'}
        aria-label={t('light')}
        title={t('light')}
        onClick={() => setTheme('light')}
        className={`inline-flex h-9 w-9 items-center justify-center text-sm ${
          theme === 'light' ? 'bg-surface-muted dark:bg-surface-dark' : ''
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
          theme === 'system' ? 'bg-surface-muted dark:bg-surface-dark' : ''
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
          theme === 'dark' ? 'bg-surface-muted dark:bg-surface-dark' : ''
        }`}
      >
        <Moon aria-hidden="true" className="h-4 w-4" />
      </button>
    </fieldset>
  );
}
