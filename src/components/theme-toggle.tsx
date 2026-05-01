'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Moon, Sun } from 'lucide-react';

/**
 * Two-state theme toggle (light ↔ dark) styled as a Starbucks-inspired
 * pill switch:
 *   - 44 × 64 px track (≥44 touch target per DP-2 directive).
 *   - Forest-green knob carrying the active-mode icon (the knob IS the
 *     state indicator — track icons are the subdued "off" hints).
 *   - Knob slides on a cubic-bezier(.4,0,.2,1) 220 ms transition for the
 *     quiet, confident motion the brand voice asks for.
 *   - active:scale-95 press feedback, mirroring the same micro-interaction
 *     baked into .btn-primary in DP-2a.
 *   - Forest-green focus ring for keyboard nav.
 *
 * Renders an aria-hidden skeleton on the server so SSR markup matches
 * the post-hydration mounted state and we don't hit a hydration mismatch.
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
        className="inline-flex h-11 w-16 items-center rounded-full border border-border-strong bg-surface dark:bg-surface-deep"
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
      className="group relative inline-flex h-11 w-16 items-center rounded-full border border-border-strong bg-surface px-1 transition-colors duration-200 hover:border-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action/50 active:scale-95 dark:bg-surface-deep dark:hover:border-action-dark dark:focus-visible:ring-action-dark/50"
    >
      {/* Track hints — the "other" mode shown in subdued helper color so
          the user reads the toggle as 'pick the other side'. */}
      <Sun
        aria-hidden="true"
        className="absolute left-2.5 h-3.5 w-3.5 text-helper/60 transition-opacity duration-200 dark:opacity-100"
      />
      <Moon
        aria-hidden="true"
        className="absolute right-2.5 h-3.5 w-3.5 text-helper/60 transition-opacity duration-200"
      />

      {/* Knob — forest-green pill with the ACTIVE mode's icon in white.
          Slides on a cubic-bezier ease — subtle, not bouncy. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-action text-white shadow-whisper transition-transform duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)] dark:bg-action-dark dark:text-surface-deep ${
          isDark ? 'translate-x-5' : 'translate-x-0'
        }`}
      >
        {isDark ? (
          <Moon aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
        ) : (
          <Sun aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
        )}
      </span>
    </button>
  );
}
