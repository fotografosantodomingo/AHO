import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { BillingPortalButton } from '@/components/billing/billing-portal-button';

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

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[14rem_1fr] gap-8 px-6 py-8">
      <aside className="border-r border-zinc-200 pr-4 dark:border-zinc-800">
        <nav className="space-y-1 text-sm">
          <a
            href={propertiesPath}
            className="block rounded-md px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            {t('navListings')}
          </a>
          <a
            href={leadsPath}
            className="block rounded-md px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            {t('navLeads')}
          </a>
          <BillingPortalButton />
        </nav>
      </aside>
      <section>{children}</section>
    </div>
  );
}
