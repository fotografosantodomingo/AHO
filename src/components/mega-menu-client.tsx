'use client';

import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { CurrencyPicker } from '@/components/currency-picker';

interface NavItem {
  href: string;
  label: string;
}

interface Props {
  locale: Locale;
  navItems: NavItem[];
  initialCurrency: string;
  isAuthed: boolean;
}

/**
 * Mobile menu — full-screen overlay style.
 *
 * Replaces the previous side-drawer pattern (PO-flagged 2026-05-01: drawer
 * wasn't reliably popping on click; visual style felt cramped). New shape:
 *
 *   - Hamburger pill button (forest-green; high-contrast on both modes).
 *   - Click → full viewport overlay fades + scales in. Covers everything.
 *   - Centered, large, tappable nav links (text-xl).
 *   - Auth CTAs as prominent pill buttons.
 *   - Currency picker pinned to the bottom.
 *   - Close: X button top-right, Escape key, or click on the corner X.
 *
 * Why full-screen vs. side-drawer:
 *   1. Robustness — opacity + scale transitions are simpler than
 *      `translate-x` + pointer-events gating; fewer edge cases where the
 *      drawer fails to pop.
 *   2. Touch targets — full-screen lets us size each nav link 48px+ high
 *      with breathing room, the way modern mobile apps do.
 *   3. Visual hierarchy — when the menu is open, the menu IS the page;
 *      no peeking site content competing for attention.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal="true" on the overlay
 *   - Escape closes
 *   - Body scroll locks while open
 *   - aria-expanded on the trigger
 *   - aria-hidden on the overlay when closed (so it's invisible to AT)
 */
export function MegaMenuClient({
  locale,
  navItems,
  initialCurrency,
  isAuthed,
}: Props) {
  const t = useTranslations('nav');
  const tAuth = useTranslations('auth');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const signInHref = `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}`;
  const signUpHref = `/${locale}/${locale === 'es' ? 'registrarse' : 'signup'}`;
  const dashboardHref = `/${locale}/${locale === 'es' ? 'panel' : 'dashboard'}`;
  const savedSearchesHref = `/${locale}/${locale === 'es' ? 'busquedas-guardadas' : 'saved-searches'}`;
  const savedPropertiesHref = `/${locale}/${locale === 'es' ? 'inmuebles-guardados' : 'saved-properties'}`;

  return (
    <>
      {/* Hamburger trigger — forest-green pill so it's never invisible
          against the header background in either mode. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-menu-overlay"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-action text-white shadow-lift transition-all hover:bg-action-active active:scale-95 md:hidden"
      >
        <Menu aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
      </button>

      {/* Full-screen overlay. Always mounted; opacity + pointer-events
          gate visibility. `pointer-events-none` when closed prevents
          intercepting taps elsewhere on the page. */}
      <div
        id="mobile-menu-overlay"
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label="Site navigation"
        className={`fixed inset-0 z-50 flex flex-col bg-surface transition-opacity duration-200 ease-out md:hidden dark:bg-surface-deep ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* Top bar inside the overlay — wordmark left, X close right.
            Same height as the site header so the close X visually
            replaces the hamburger when transitioning. */}
        <div className="flex items-center justify-between border-b border-border-strong/40 px-4 py-3">
          <p className="font-brand text-lg font-bold tracking-tight">AHO</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-action text-white shadow-lift transition-all hover:bg-action-active active:scale-95"
          >
            <X aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>

        {/* Nav links — centered, large, tappable. Each row is 56px tall
            for comfortable thumb reach. The arrow on the right is a
            touch-affordance signal (consistent with iOS list rows). */}
        <nav
          aria-label="Primary mobile"
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => (
              <li key={item.href + item.label}>
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex h-14 items-center justify-between rounded-xl px-4 text-lg font-medium text-ink transition-colors hover:bg-surface-warm/60 active:bg-surface-warm dark:text-ink-inverse dark:hover:bg-surface-dark/60 dark:active:bg-surface-dark"
                >
                  <span>{item.label}</span>
                  <span aria-hidden="true" className="text-helper">→</span>
                </a>
              </li>
            ))}
          </ul>

          {/* Auth section — divider + prominent CTAs. */}
          <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6">
            {isAuthed ? (
              <>
                <a
                  href={dashboardHref}
                  onClick={() => setOpen(false)}
                  className="btn-primary h-14 w-full text-base"
                >
                  {t('dashboard')}
                </a>
                <a
                  href={savedPropertiesHref}
                  onClick={() => setOpen(false)}
                  className="btn-secondary h-12 w-full"
                >
                  {t('savedProperties')}
                </a>
                <a
                  href={savedSearchesHref}
                  onClick={() => setOpen(false)}
                  className="btn-secondary h-12 w-full"
                >
                  {t('savedSearches')}
                </a>
              </>
            ) : (
              <>
                <a
                  href={signUpHref}
                  onClick={() => setOpen(false)}
                  className="btn-primary h-14 w-full text-base"
                >
                  {tAuth('signUpCta')}
                </a>
                <a
                  href={signInHref}
                  onClick={() => setOpen(false)}
                  className="btn-secondary h-12 w-full"
                >
                  {tAuth('signInCta')}
                </a>
              </>
            )}
          </div>
        </nav>

        {/* Currency picker pinned to the bottom — quick-access without
            taking up nav real estate. */}
        <div className="flex items-center justify-between gap-3 border-t border-border-strong/40 px-6 py-4">
          <span className="text-xs font-medium uppercase tracking-wider text-helper">
            {t('currency')}
          </span>
          <CurrencyPicker initial={initialCurrency} persistToProfile={isAuthed} />
        </div>
      </div>
    </>
  );
}
