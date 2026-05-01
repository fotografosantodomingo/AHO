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
 * Site-wide top header for /[locale]/* pages. Replaces the pre-A3 minimal
 * header. Layout (desktop ≥ md):
 *
 *   [AHO]   Buy · Rent · Sell · Find an agent · Help    [CurrencyPicker] [Auth] [Locale] [Theme]
 *
 * Mobile (< md): brand on the left, hamburger on the right opens a
 * drawer with the same nav links + the currency picker.
 *
 * Worldwide-shaped:
 *   - Currency picker mirrors the visitor's profile.preferred_currency
 *     (when signed in) or a cookie (anon). Defaults to USD per the
 *     `defaultCurrencyForLocale` rule.
 *   - Nav labels are i18n keys; same surface for every locale.
 *   - "Find an agent" points to /countries today (the agents directory
 *     is Batch A7 work — once shipped, this link swaps to /agents).
 */
export async function SiteHeader({ locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'nav' });

  // Resolve the visitor's preferred display currency for the picker's
  // initial value. Order: cookie → profile (auth) → locale default.
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
    // Header must never fail the layout. Anon-only fallback if Supabase
    // hiccups.
  }

  const initialCurrency =
    cookieCurrency?.toUpperCase() ||
    profileCurrency?.toUpperCase() ||
    defaultCurrencyForLocale(locale);

  // Path resolution: locale-prefix + path translations baked in.
  const searchPath = `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`;
  const pricingPath = `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`;
  const countriesPath = `/${locale}/${locale === 'es' ? 'paises' : 'countries'}`;

  const navItems: { href: string; label: string }[] = [
    { href: `${searchPath}?transaction=sale`, label: t('buy') },
    { href: `${searchPath}?transaction=rent`, label: t('rent') },
    { href: pricingPath, label: t('sell') },
    { href: countriesPath, label: t('findAgent') },
    { href: `/${locale}`, label: t('help') }, // Placeholder until /help ships in A10
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-border-strong/60 bg-surface/95 backdrop-blur-sm dark:bg-surface-deep/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        {/* Brand */}
        <a
          href={`/${locale}`}
          className="font-brand text-lg font-bold tracking-tight"
        >
          AHO
        </a>

        {/* Desktop nav */}
        <nav
          aria-label="Primary"
          className="hidden flex-1 items-center justify-center gap-5 text-sm md:flex"
        >
          {navItems.map((item) => (
            <a
              key={item.href + item.label}
              href={item.href}
              className="text-helper transition hover:text-ink dark:hover:text-ink-inverse"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Right cluster (desktop) */}
        <div className="hidden items-center gap-2 md:flex">
          <CurrencyPicker initial={initialCurrency} persistToProfile={isAuthed} />
          <AuthMenu locale={locale} />
          <LocaleToggle />
          <ThemeToggle />
        </div>

        {/* Mobile hamburger + minimum picker — drawer handled by Client component */}
        <MegaMenuClient
          navItems={navItems}
          initialCurrency={initialCurrency}
          isAuthed={isAuthed}
        />
      </div>
    </header>
  );
}
