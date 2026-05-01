import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { defaultCurrencyForLocale } from '@/lib/currency/rates';
import { AuthMenu } from '@/components/auth/auth-menu';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { CurrencyPicker } from '@/components/currency-picker';
import { MegaMenuClient } from '@/components/mega-menu-client';

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

  const searchPath = `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`;
  const pricingPath = `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`;
  const countriesPath = `/${locale}/${locale === 'es' ? 'paises' : 'countries'}`;

  const navItems: { href: string; label: string }[] = [
    { href: `${searchPath}?transaction=sale`, label: t('buy') },
    { href: `${searchPath}?transaction=rent`, label: t('rent') },
    { href: pricingPath, label: t('sell') },
    { href: countriesPath, label: t('findAgent') },
    { href: `/${locale}`, label: t('help') }, // Placeholder until /help ships
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-border-strong/40 bg-surface/95 backdrop-blur-sm dark:bg-surface-deep/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 md:px-6">
        {/* Left cluster: brand + theme + locale (always next to logo per
            DP-2b directive). Visible on every breakpoint. */}
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={`/${locale}`}
            className="font-brand text-lg font-bold tracking-tight transition-colors hover:text-action dark:hover:text-action-dark"
          >
            AHO
          </a>
          <ThemeToggle />
          <LocaleToggle />
        </div>

        {/* Center: primary nav (desktop only). */}
        <nav
          aria-label="Primary"
          className="hidden flex-1 items-center justify-center gap-5 text-sm md:flex"
        >
          {navItems.map((item) => (
            <a
              key={item.href + item.label}
              href={item.href}
              className="text-helper transition-colors hover:text-action dark:hover:text-action-dark"
            >
              {item.label}
            </a>
          ))}
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
