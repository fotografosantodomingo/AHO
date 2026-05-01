'use client';

import { useEffect, useState } from 'react';
import { CurrencyPicker } from '@/components/currency-picker';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';

interface NavItem {
  href: string;
  label: string;
}

interface Props {
  navItems: NavItem[];
  initialCurrency: string;
  isAuthed: boolean;
}

/**
 * Mobile drawer for the SiteHeader. Renders a hamburger button (visible
 * <md only) that toggles a full-width drawer with the same nav items
 * the desktop header shows, plus the currency picker, locale toggle,
 * and theme toggle.
 *
 * Hides automatically on md+ via Tailwind's responsive classes — the
 * desktop header in `<SiteHeader>` shows the same controls inline at
 * that breakpoint.
 *
 * Body scroll is locked while the drawer is open. Escape closes it.
 */
export function MegaMenuClient({
  navItems,
  initialCurrency,
  isAuthed,
}: Props) {
  const [open, setOpen] = useState(false);

  // Lock body scroll while drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border-2 border-border-strong bg-surface text-ink shadow-whisper transition hover:bg-surface-muted md:hidden dark:bg-surface-deep dark:text-ink-inverse dark:hover:bg-surface-dark"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="h-5 w-5"
        >
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          className="fixed inset-0 z-50 flex md:hidden"
        >
          {/* Stronger backdrop (60% black) so the drawer reads cleanly
              over busy page content underneath. */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer with explicit left border + shadow-2xl for clear
              visual separation. Solid backgrounds (no opacity). */}
          <div
            className="relative ml-auto flex h-full w-[88%] max-w-xs flex-col gap-4 border-l border-border-strong bg-surface p-6 shadow-2xl dark:bg-surface-deep"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <p className="font-brand text-base font-bold tracking-tight">AHO</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border-2 border-border-strong bg-surface text-base text-ink transition hover:bg-surface-muted dark:bg-surface-deep dark:text-ink-inverse dark:hover:bg-surface-dark"
              >
                ✕
              </button>
            </div>

            <nav aria-label="Primary mobile" className="flex flex-col">
              {navItems.map((item) => (
                <a
                  key={item.href + item.label}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="border-b border-border/60 py-3 text-base font-medium text-ink transition hover:text-action dark:text-ink-inverse dark:hover:text-action-dark"
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <CurrencyPicker initial={initialCurrency} persistToProfile={isAuthed} />
              <LocaleToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
