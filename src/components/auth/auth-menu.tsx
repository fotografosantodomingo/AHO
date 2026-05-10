import { getTranslations } from 'next-intl/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SignOutButton } from './sign-out-button';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

/**
 * Server Component header menu — renders sign-in / sign-up links when the
 * user is signed out, or the dashboard / account links + sign-out when
 * signed in.
 *
 * Reads the session from the server-side Supabase client. Pages that wrap
 * this in their layout get a free session refresh on every render (the
 * middleware also refreshes session cookies on every request, so the UI
 * stays accurate even on long-lived tabs).
 *
 * The `Dashboard` link always shows for signed-in users, regardless of
 * subscription state. The dashboard layout routes appropriately:
 *   - has org → see their listings
 *   - no org → bounce to /pricing (correct upgrade funnel)
 */
export async function AuthMenu({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'auth' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });
  const tDashboard = await getTranslations({ locale, namespace: 'dashboard' });
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <a
          className="hover:underline"
          href={localePath(locale, '/signin')}
        >
          {t('signInCta')}
        </a>
        <a
          className="btn-primary h-9 px-3"
          href={localePath(locale, '/signup')}
        >
          {t('signUpCta')}
        </a>
      </div>
    );
  }

  const dashboardHref = localePath(locale, '/dashboard');
  const savedSearchesHref = localePath(locale, '/saved-searches');
  const savedPropertiesHref = localePath(locale, '/saved-properties');

  return (
    <div className="flex items-center gap-3 text-sm">
      {/* Always-visible Dashboard link. The dashboard layout itself routes
          non-subscribers to /pricing — no need to gate the link by org
          membership. Saved-searches and saved-properties are parallel
          buyer-side links. */}
      <a className="hover:underline" href={dashboardHref}>
        {tNav('dashboard')}
      </a>
      <a className="hidden hover:underline lg:inline" href={savedPropertiesHref}>
        {tNav('savedProperties')}
      </a>
      <a className="hidden hover:underline lg:inline" href={savedSearchesHref}>
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
