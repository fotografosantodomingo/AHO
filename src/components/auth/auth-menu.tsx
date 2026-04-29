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
          className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-3 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          href={`/${locale}/${locale === 'es' ? 'registrarse' : 'signup'}`}
        >
          {t('signUpCta')}
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className="max-w-[16ch] truncate text-zinc-600 dark:text-zinc-400"
        title={user.email ?? ''}
      >
        {user.email}
      </span>
      <SignOutButton />
    </div>
  );
}
