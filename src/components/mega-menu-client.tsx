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
 * Mobile drawer for the SiteHeader. DP-2b refresh:
 *
 *   - 44×44 hamburger button (≥ touch-target rule); icon swaps to X
 *     when the drawer is open.
 *   - Drawer mounts always; transforms from `translate-x-full` →
 *     `translate-x-0` on `open`, with a 320 ms cubic-bezier slide.
 *     `pointer-events-none` and `aria-hidden` gate it when closed so
 *     it doesn't intercept tab focus or pointer events.
 *   - Backdrop fades in over the same duration; clicking it closes.
 *   - Theme + locale toggles are no longer in the drawer — they live
 *     beside the AHO logo per the DP-2b PO directive. Drawer keeps
 *     the nav items, currency picker, and auth CTAs.
 *   - Auth section: when signed-out, two pill CTAs (Sign in + Sign up).
 *     When signed-in, a Dashboard link + Sign out — handled inline so
 *     the drawer doesn't depend on AuthMenu (which is a Server Component
 *     and can't be trivially nested inside this client component).
 *
 * Body scroll locks while open; Escape closes.
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
      {/* Hamburger button. Bumped to a forest-green pill so it ALWAYS
          reads against the white header (light mode) and the dark
          forest header (dark mode) — neither contrast is ambiguous.
          The previous neutral-bg hamburger blended into the header bg
          on light mode (both white) and looked invisible to the PO. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="mobile-drawer"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-action text-white shadow-lift transition-all hover:bg-action-active active:scale-95 md:hidden"
      >
        {open ? (
          <X aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
        ) : (
          <Menu aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
        )}
      </button>

      {/* Backdrop — always mounted; fades via opacity + pointer-events. */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Drawer — always mounted; transforms via translate-x.
          DP-3: tokens auto-pivot now (`bg-surface` = white in light,
          lifted dark forest in dark; `text-ink` = warm-black in light,
          cream in dark). No more bilingual class chains or inline-style
          backstops. */}
      <div
        id="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label="Site navigation"
        className={`fixed top-0 right-0 bottom-0 z-50 flex w-[88%] max-w-sm flex-col gap-5 overflow-y-auto border-l-2 border-border-strong bg-surface p-6 text-ink shadow-2xl transition-transform duration-[320ms] ease-[cubic-bezier(0.4,0,0.2,1)] md:hidden ${
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border pb-4">
          <p className="font-brand text-lg font-bold tracking-tight">AHO</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-all hover:border-action active:scale-95 dark:bg-surface-deep dark:text-ink-inverse dark:hover:border-action-dark"
          >
            <X aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>

        <nav aria-label="Primary mobile" className="flex flex-col">
          {navItems.map((item) => (
            <a
              key={item.href + item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className="-mx-2 flex items-center justify-between rounded-lg border-b border-border/50 px-2 py-3.5 text-base font-medium text-ink transition-colors hover:bg-surface-warm/60 hover:text-action dark:text-ink-inverse dark:hover:bg-surface-dark dark:hover:text-action-dark"
            >
              <span>{item.label}</span>
              <span aria-hidden="true" className="text-helper">→</span>
            </a>
          ))}
        </nav>

        {/* Auth section — pill CTAs (signed-out) OR account links (signed-in). */}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {isAuthed ? (
            <>
              <a
                href={dashboardHref}
                onClick={() => setOpen(false)}
                className="btn-primary w-full"
              >
                {t('dashboard')}
              </a>
              <a
                href={savedPropertiesHref}
                onClick={() => setOpen(false)}
                className="btn-secondary w-full"
              >
                {t('savedProperties')}
              </a>
              <a
                href={savedSearchesHref}
                onClick={() => setOpen(false)}
                className="btn-secondary w-full"
              >
                {t('savedSearches')}
              </a>
            </>
          ) : (
            <>
              <a
                href={signUpHref}
                onClick={() => setOpen(false)}
                className="btn-primary w-full"
              >
                {tAuth('signUpCta')}
              </a>
              <a
                href={signInHref}
                onClick={() => setOpen(false)}
                className="btn-secondary w-full"
              >
                {tAuth('signInCta')}
              </a>
            </>
          )}
        </div>

        {/* Currency picker pinned to the bottom — quick-access without
            taking up nav real estate. Theme + locale moved out (now in
            the top bar beside the logo). */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-xs font-medium uppercase tracking-wider text-helper">
            {t('currency')}
          </span>
          <CurrencyPicker initial={initialCurrency} persistToProfile={isAuthed} />
        </div>
      </div>
    </>
  );
}
