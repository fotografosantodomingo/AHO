import { getTranslations } from 'next-intl/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SignOutButton } from './sign-out-button';
import type { Locale } from '@/i18n/config';

/**
 * Server Component header menu — renders sign-in / sign-up links when the
 * user is signed out, or the user's email + sign-out button when signed in.
 *
 * Reads the session from the server-side Supabase client. Pages that wrap
 * this in their layout get a free session refresh on every render (the
 * middleware also refreshes session cookies on every request, so the UI
 * stays accurate even on long-lived tabs).
 */
export async function AuthMenu({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'auth' });
  const tDashboard = await getTranslations({ locale, namespace: 'dashboard' });
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <a
          className="hover:underline"
          href={`/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}`}
        >
          {t('signInCta')}
        </a>
        <a
          className="inline-flex h-9 items-center rounded-lg bg-surface-dark px-3 font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink"
          href={`/${locale}/${locale === 'es' ? 'registrarse' : 'signup'}`}
        >
          {t('signUpCta')}
        </a>
      </div>
    );
  }

  // Org membership check — when an agent has an org, surface the Dashboard
  // link in the header; otherwise show only the buyer-side links. RLS
  // returns just the user's own memberships so this is cheap.
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1);
  const hasOrg = !!memberships && memberships.length > 0;

  const dashboardHref = `/${locale}/${locale === 'es' ? 'panel' : 'dashboard'}`;
  const savedSearchesHref = `/${locale}/${
    locale === 'es' ? 'busquedas-guardadas' : 'saved-searches'
  }`;

  return (
    <div className="flex items-center gap-3 text-sm">
      {/* Secondary links hidden below `sm:` — header gets cramped on narrow
          viewports. Both surfaces are still reachable from the dashboard
          sidebar (when hasOrg) or the AuthMenu's "Saved searches" link
          on `sm+`. Mobile gets the essential: just Sign out. */}
      {hasOrg && (
        <a className="hidden hover:underline sm:inline" href={dashboardHref}>
          {tDashboard('navListings')}
        </a>
      )}
      <a className="hidden hover:underline sm:inline" href={savedSearchesHref}>
        {tDashboard('navSavedSearches')}
      </a>
      <span
        className="hidden max-w-[16ch] truncate text-helper sm:inline"
        title={user.email ?? ''}
      >
        {user.email}
      </span>
      <SignOutButton />
    </div>
  );
}
