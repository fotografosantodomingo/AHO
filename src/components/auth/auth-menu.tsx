import { getTranslations } from 'next-intl/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SignOutButton } from './sign-out-button';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

/**
 * Server Component header menu — sign-in / sign-up CTAs for anon
 * visitors, or a bare Sign Out button for signed-in users.
 *
 * Per PO 2026-05-16: the right-hand cluster on the header is just
 * the sign-out affordance; the email-address chip + the inline
 * Dashboard / Saved-properties / Saved-searches links have moved
 * into the main nav (under "Real estate agent" and "Save"
 * dropdowns) so the header reads as one coherent menu rather than
 * two competing clusters.
 */
export async function AuthMenu({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'auth' });
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

  return <SignOutButton />;
}
