import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { BillingPortalButton } from '@/components/billing/billing-portal-button';

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
  const leadsPath = `/${locale}/${locale === 'es' ? 'panel/contactos' : 'dashboard/leads'}`;
  const reviewsPath = `/${locale}/${locale === 'es' ? 'panel/resenas' : 'dashboard/reviews'}`;
  const savedSearchesPath = `/${locale}/${
    locale === 'es' ? 'busquedas-guardadas' : 'saved-searches'
  }`;
  const profilePath = `/${locale}/${locale === 'es' ? 'panel/perfil' : 'dashboard/profile'}`;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 md:grid-cols-[14rem_1fr] md:gap-8">
      {/* Sidebar nav. On mobile (< md): horizontal scrollable row with no
          right border (the divider would float at an awkward height when
          the layout is stacked). On md+: fixed 14rem left column with a
          right border separating from content. */}
      <aside className="border-b border-border pb-3 md:border-b-0 md:border-r md:pb-0 md:pr-4">
        <nav
          className="flex gap-1 overflow-x-auto text-sm md:flex-col md:space-y-1 md:overflow-x-visible"
          aria-label="Dashboard sections"
        >
          <a
            href={propertiesPath}
            className="shrink-0 rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5 md:block"
          >
            {t('navListings')}
          </a>
          <a
            href={leadsPath}
            className="shrink-0 rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5 md:block"
          >
            {t('navLeads')}
          </a>
          <a
            href={reviewsPath}
            className="shrink-0 rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5 md:block"
          >
            {t('navReviews')}
          </a>
          <a
            href={savedSearchesPath}
            className="shrink-0 rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5 md:block"
          >
            {t('navSavedSearches')}
          </a>
          <a
            href={profilePath}
            className="shrink-0 rounded-lg px-3 py-2 transition hover:bg-black/5 dark:hover:bg-white/5 md:block"
          >
            {t('navProfile')}
          </a>
          <BillingPortalButton />
        </nav>
      </aside>
      <section>{children}</section>
    </div>
  );
}
