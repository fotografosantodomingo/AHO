import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { BillingPortalButton } from '@/components/billing/billing-portal-button';
import { DashboardMobileNav } from '@/components/dashboard/dashboard-mobile-nav';

export const runtime = 'edge';

// Auth-dependent — must run per-request, not pre-rendered.
export const dynamic = 'force-dynamic';

/**
 * Dashboard layout — auth gate + sidebar nav.
 *
 *   - Not signed in → redirect to /signin?next=<dashboard-path>
 *   - Signed in but no org membership → redirect to /pricing
 *   - Signed in with org → render the dashboard shell
 *
 * The org check uses RLS: `organization_members.user_id = auth.uid()` is
 * always allowed for the user's own memberships. If the array is empty,
 * the user is Free / Registered and not yet an Agent — bounce them to
 * pricing rather than showing an empty dashboard.
 */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    const dashboardPath = `/${locale}/${locale === 'es' ? 'panel' : 'dashboard'}`;
    redirect(
      `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}?next=${encodeURIComponent(dashboardPath)}`,
    );
  }

  const { data: memberships } = await supabase
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', userResult.user.id);

  if (!memberships || memberships.length === 0) {
    // Registered user without an Agent subscription. Bounce to /pricing.
    redirect(`/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`);
  }

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const propertiesPath = `/${locale}/${locale === 'es' ? 'panel/propiedades' : 'dashboard/properties'}`;
  const analyticsPath = `/${locale}/${locale === 'es' ? 'panel/estadisticas' : 'dashboard/analytics'}`;
  const leadsPath = `/${locale}/${locale === 'es' ? 'panel/contactos' : 'dashboard/leads'}`;
  const reviewsPath = `/${locale}/${locale === 'es' ? 'panel/resenas' : 'dashboard/reviews'}`;
  const savedSearchesPath = `/${locale}/${
    locale === 'es' ? 'busquedas-guardadas' : 'saved-searches'
  }`;
  const profilePath = `/${locale}/${locale === 'es' ? 'panel/perfil' : 'dashboard/profile'}`;

  // Mobile nav items — same set as desktop sidebar, rendered through
  // a native-select dropdown via <DashboardMobileNav>. Order kept
  // identical to the sidebar for muscle memory.
  const navItems = [
    { href: propertiesPath, label: t('navListings') },
    { href: analyticsPath, label: t('navAnalytics') },
    { href: leadsPath, label: t('navLeads') },
    { href: reviewsPath, label: t('navReviews') },
    { href: savedSearchesPath, label: t('navSavedSearches') },
    { href: profilePath, label: t('navProfile') },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 md:grid-cols-[14rem_1fr] md:gap-8">
      {/* Mobile nav (< md): native-select dropdown — clean + compact +
          accessible. Replaces the prior horizontal-scroll row which got
          visually chaotic with 5+ items. Billing portal sits outside the
          dropdown as a trailing CTA. Desktop sidebar (md+) is the
          existing vertical column. */}
      <DashboardMobileNav
        items={navItems}
        ariaLabel={t('navAriaLabel')}
        trailing={<BillingPortalButton className="btn-secondary w-full" />}
      />

      <aside className="hidden border-r border-border pr-4 md:block">
        <nav
          className="flex flex-col space-y-1 text-sm"
          aria-label={t('navAriaLabel')}
        >
          <a
            href={propertiesPath}
            className="rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('navListings')}
          </a>
          <a
            href={analyticsPath}
            className="rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('navAnalytics')}
          </a>
          <a
            href={leadsPath}
            className="rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('navLeads')}
          </a>
          <a
            href={reviewsPath}
            className="rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('navReviews')}
          </a>
          <a
            href={savedSearchesPath}
            className="rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('navSavedSearches')}
          </a>
          <a
            href={profilePath}
            className="rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('navProfile')}
          </a>
          <BillingPortalButton />
        </nav>
      </aside>
      {/* `min-w-0` is the magic incantation: by default a grid track's
          `auto` min-width prevents children from shrinking below their
          intrinsic content width. Without it, a wide table inside
          children would force the whole grid to overflow horizontally
          past the viewport on mobile. With it, the table's wrapper
          `overflow-x-auto` actually constrains the scroll within the
          section. */}
      <section className="min-w-0">{children}</section>
    </div>
  );
}
