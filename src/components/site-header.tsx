import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { defaultCurrencyForLocale } from '@/lib/currency/rates';
import { AuthMenu } from '@/components/auth/auth-menu';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { CurrencyPicker } from '@/components/currency-picker';
import { MegaMenuClient } from '@/components/mega-menu-client';
import { AhoLogo } from '@/components/aho-logo';

const CURRENCY_COOKIE = 'aho_currency';

interface Props {
  locale: Locale;
}

/**
 * Site-wide top header. DP-2b layout (Starbucks-inspired):
 *
 *   Mobile (< md):
 *     [AHO]  [Theme]  [Locale]                          [Hamburger]
 *
 *   Desktop (≥ md):
 *     [AHO]  [Theme]  [Locale]   ─nav─                  [Currency] [Auth]
 *
 * Theme + locale sit immediately next to the logo on every breakpoint,
 * per the DP-2b PO directive. They were previously buried in the right
 * cluster on desktop and inside the drawer on mobile — both made quick
 * personalization (toggle theme, switch language) needlessly hard.
 *
 * All header controls are ≥44×44 px touch targets.
 *
 * Worldwide-shaped:
 *   - Currency picker mirrors profile.preferred_currency (signed-in)
 *     or a cookie (anon). Defaults via `defaultCurrencyForLocale`.
 *   - Nav labels are i18n keys.
 *   - "Find an agent" → /countries (until the agents directory ships).
 */
export async function SiteHeader({ locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'nav' });

  const cookieStore = await cookies();
  const cookieCurrency = cookieStore.get(CURRENCY_COOKIE)?.value;

  let profileCurrency: string | null = null;
  let isAuthed = false;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: userResult } = await supabase.auth.getUser();
    if (userResult.user) {
      isAuthed = true;
      const { data: profile } = await supabase
        .from('profiles')
        .select('preferred_currency')
        .eq('id', userResult.user.id)
        .maybeSingle();
      profileCurrency = (profile?.preferred_currency as string | null) ?? null;
    }
  } catch {
    // Header must never break the layout. Fall back to anon view.
  }

  const initialCurrency =
    cookieCurrency?.toUpperCase() ||
    profileCurrency?.toUpperCase() ||
    defaultCurrencyForLocale(locale);

  const searchPath = localePath(locale, '/search');
  // "Sell" in the nav routes to the identity-selection page now
  // (per docs/SELL_FUNNEL_PLAN.md). The pricing page stays as the
  // agent-tier deep link reachable from the Agent card on /sell.
  const sellPath = localePath(locale, '/sell');
  const countriesPath = localePath(locale, '/countries');
  const dashboardPath = localePath(locale, '/dashboard');
  const savedPropertiesPath = localePath(locale, '/saved-properties');
  const savedSearchesPath = localePath(locale, '/saved-searches');

  // Two shapes per the 2026-05-16 PO menu redesign:
  // - Anonymous keeps the prior 4-item flat marketing nav.
  // - Authed gets dropdown groups so "Real estate agent" wraps the
  //   user's Dashboard (room to grow with future agent-area pages)
  //   and "Save" wraps both buyer-side saved-* surfaces. The flat
  //   email-chip + duplicate links on the right move into this nav.
  type NavItem =
    | { kind: 'link'; href: string; label: string }
    | { kind: 'dropdown'; label: string; items: { href: string; label: string }[] };

  const homePath = `/${locale}`;
  const navItems: NavItem[] = isAuthed
    ? [
        { kind: 'link', href: homePath, label: t('home') },
        {
          kind: 'dropdown',
          label: t('realEstateAgent'),
          items: [{ href: dashboardPath, label: t('dashboard') }],
        },
        { kind: 'link', href: `${searchPath}?transaction=sale`, label: t('buy') },
        { kind: 'link', href: `${searchPath}?transaction=rent`, label: t('rent') },
        { kind: 'link', href: countriesPath, label: t('findAgent') },
        {
          kind: 'dropdown',
          label: t('save'),
          items: [
            { href: savedPropertiesPath, label: t('savedProperties') },
            { href: savedSearchesPath, label: t('savedSearches') },
          ],
        },
      ]
    : [
        { kind: 'link', href: homePath, label: t('home') },
        { kind: 'link', href: `${searchPath}?transaction=sale`, label: t('buy') },
        { kind: 'link', href: `${searchPath}?transaction=rent`, label: t('rent') },
        { kind: 'link', href: sellPath, label: t('sell') },
        { kind: 'link', href: countriesPath, label: t('findAgent') },
      ];

  return (
    <header className="sticky top-0 z-30 border-b border-border-strong/40 bg-surface/95 backdrop-blur-sm dark:bg-surface-deep/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 md:px-6">
        {/* Left cluster: brand + theme + locale (always next to logo per
            DP-2b directive). Visible on every breakpoint. */}
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={`/${locale}`}
            className="inline-flex items-center gap-2 font-brand text-2xl font-bold tracking-tight transition-colors hover:text-action dark:hover:text-action-dark"
            aria-label="AHO — Advertise Homes Online"
          >
            {/* Inline SVG (currentColor) so the leaf-mark inherits the
                anchor's text color — light-mode ink on warm cream,
                light ink on the dark surface in dark mode. No
                separate light/dark assets needed. */}
            <AhoLogo className="h-7 w-7" ariaLabel="AHO leaf mark" />
            <span>AHO</span>
          </a>
          <ThemeToggle />
          <LocaleToggle />
        </div>

        {/* Center: primary nav (desktop only). Dropdowns are CSS-only
            (group-hover + group-focus-within) so the header stays a
            server component. The py-2 on the trigger and the absent
            mt-* on the panel keep the hover path contiguous so the
            cursor doesn't slip into a dead gap and dismiss the menu. */}
        <nav
          aria-label={t('primaryAria')}
          className="hidden flex-1 items-center justify-center gap-5 text-sm md:flex"
        >
          {navItems.map((item) =>
            item.kind === 'link' ? (
              <a
                key={item.href + item.label}
                href={item.href}
                className="text-helper transition-colors hover:text-action dark:hover:text-action-dark"
              >
                {item.label}
              </a>
            ) : (
              <div key={`group-${item.label}`} className="group relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  className="inline-flex items-center gap-1 py-2 text-helper transition-colors hover:text-action dark:hover:text-action-dark"
                >
                  {item.label}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 12 12"
                    className="h-3 w-3"
                  >
                    <path
                      d="M3 4.5L6 7.5L9 4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div
                  role="menu"
                  className="invisible absolute left-1/2 top-full z-50 min-w-[200px] -translate-x-1/2 rounded-card border border-border bg-surface p-1 opacity-0 shadow-lift transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:bg-surface-deep"
                >
                  {item.items.map((sub) => (
                    <a
                      key={sub.href}
                      href={sub.href}
                      role="menuitem"
                      className="block rounded-md px-3 py-2 text-sm text-helper transition-colors hover:bg-black/5 hover:text-action dark:hover:bg-white/5 dark:hover:text-action-dark"
                    >
                      {sub.label}
                    </a>
                  ))}
                </div>
              </div>
            ),
          )}
        </nav>

        {/* Right cluster (desktop only): currency + auth. */}
        <div className="hidden items-center gap-3 md:flex">
          <CurrencyPicker initial={initialCurrency} persistToProfile={isAuthed} />
          <AuthMenu locale={locale} />
        </div>

        {/* Mobile hamburger + drawer (handles nav + currency + auth on
            < md). Theme + locale are no longer inside the drawer — they
            live in the left cluster above. */}
        <MegaMenuClient
          locale={locale}
          navItems={navItems}
          initialCurrency={initialCurrency}
          isAuthed={isAuthed}
        />
      </div>
    </header>
  );
}
