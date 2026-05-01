'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Moon, Sun } from 'lucide-react';

/**
 * Two-state theme toggle: light ↔ dark, rendered as a single switch
 * (sun on the left, moon on the right). The "system" option is no
 * longer surfaced — too many users land on light by accident when
 * their OS is light-mode and the brand intends a dark default. They
 * can still set system via OS preferences if desired; we just don't
 * give a third UI state that confuses the binary semantic.
 *
 * Renders a placeholder skeleton on the server to avoid hydration
 * mismatches (current resolved theme is only known on the client).
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="inline-flex h-9 w-[3.5rem] items-center rounded-full border border-border-strong"
      />
    );
  }

  const isDark = resolvedTheme === 'dark';
  const next = isDark ? 'light' : 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={t('label')}
      title={isDark ? t('light') : t('dark')}
      onClick={() => setTheme(next)}
      className="relative inline-flex h-9 w-14 items-center rounded-full border border-border-strong bg-surface px-1 transition dark:bg-surface-deep"
    >
      {/* Track icons */}
      <Sun
        aria-hidden="true"
        className="absolute left-2 h-3.5 w-3.5 text-amber-500 opacity-90"
      />
      <Moon
        aria-hidden="true"
        className="absolute right-2 h-3.5 w-3.5 text-helper opacity-80"
      />
      {/* Knob */}
      <span
        aria-hidden="true"
        className={`pointer-events-none relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface-dark text-ink-inverse-muted shadow-whisper transition-transform duration-200 dark:bg-surface dark:text-ink ${
          isDark ? 'translate-x-5' : 'translate-x-0'
        }`}
      >
        {isDark ? (
          <Moon aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Sun aria-hidden="true" className="h-3.5 w-3.5" />
        )}
      </span>
    </button>
  );
}
