'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
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
 * Mobile menu — full-screen overlay rendered via React Portal.
 *
 * The trigger button stays inside the SiteHeader where it visually
 * belongs; the overlay itself is portal'd into `document.body` so it
 * escapes the header's CSS containing block.
 *
 * **Why a portal is required:** the SiteHeader uses `backdrop-blur-sm`
 * to get the frosted-glass effect on scroll. Per CSS spec, any element
 * with `backdrop-filter` (or `transform`, `filter`, `perspective`,
 * `will-change`, `contain`) creates a containing block for
 * `position: fixed` descendants. Without the portal, our `fixed inset-0`
 * overlay would be clipped to the ~60px-tall header bounds — exactly
 * the bug the PO flagged 2026-05-01: "menu is there but it's like
 * underlayer, should be popping up above the page on top of everything."
 * Portaling to body makes the overlay's containing block the viewport,
 * which is what `fixed` was designed for.
 *
 * Layout:
 *   - Trigger: forest-green pill hamburger; high-contrast on both modes.
 *   - Click → full viewport overlay fades in. Covers everything.
 *   - Centered, large, tappable nav rows (h-14 = 56px).
 *   - Auth CTAs as prominent pill buttons below nav.
 *   - Currency picker pinned to the bottom.
 *   - Close: X button top-right, Escape key, or any nav-link click.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal="true" on the overlay
 *   - Escape closes
 *   - Body scroll locks while open
 *   - aria-expanded on the trigger
 *   - aria-hidden on the overlay when closed (invisible to AT)
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
  // `mounted` gates the portal target — `document.body` only exists in
  // the browser, so on the server-rendered first paint we skip the
  // portal entirely (the trigger button still renders fine).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const signInHref = localePath(locale, '/signin');
  const signUpHref = localePath(locale, '/signup');
  const dashboardHref = localePath(locale, '/dashboard');
  const savedSearchesHref = localePath(locale, '/saved-searches');
  const savedPropertiesHref = localePath(locale, '/saved-properties');

  const overlay = (
    <div
      id="mobile-menu-overlay"
      role="dialog"
      aria-modal="true"
      // `inert` (not just aria-hidden) when closed — Lighthouse
      // 'aria-hidden-focus' fails when an aria-hidden=true element
      // contains focusable descendants, because screen-reader users
      // can still tab into hidden content. `inert` removes the
      // descendants from the tab order AND the accessibility tree
      // in one shot. Older browsers fall back to aria-hidden.
      aria-hidden={!open}
      inert={!open}
      aria-label="Site navigation"
      className={`fixed inset-0 z-[60] flex flex-col bg-surface transition-opacity duration-200 ease-out md:hidden dark:bg-surface-deep ${
        open ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      {/* Top bar inside the overlay — wordmark left, X close right.
          Same height as the site header so the close X visually
          replaces the hamburger when transitioning. */}
      <div className="flex items-center justify-between border-b border-border-strong/40 px-4 py-3">
        <p className="inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="AHO — Advertise Homes Online"
            width={36}
            height={36}
            className="h-9 w-9 object-contain"
          />
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('closeMenu')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-action text-white shadow-lift transition-all hover:bg-action-active active:scale-95"
        >
          <X aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
        </button>
      </div>

      {/* Nav links — large + tappable. Each row 56px (h-14). */}
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

      {/* Currency picker pinned to the bottom. */}
      <div className="flex items-center justify-between gap-3 border-t border-border-strong/40 px-6 py-4">
        <span className="text-xs font-medium uppercase tracking-wider text-helper">
          {t('currency')}
        </span>
        <CurrencyPicker initial={initialCurrency} persistToProfile={isAuthed} />
      </div>
    </div>
  );

  return (
    <>
      {/* Hamburger trigger — stays inside the SiteHeader where it
          belongs visually. The overlay is portaled to body below so it
          escapes the header's backdrop-filter containing block. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('openMenu')}
        aria-expanded={open}
        aria-controls="mobile-menu-overlay"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-action text-white shadow-lift transition-all hover:bg-action-active active:scale-95 md:hidden"
      >
        <Menu aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
      </button>

      {/* Portal the overlay into <body> so `position: fixed` measures
          against the viewport, not the header (which has backdrop-blur
          and would otherwise contain us). Skipped on the server-rendered
          first paint — `mounted` flips true after hydration. */}
      {mounted && createPortal(overlay, document.body)}
    </>
  );
}
