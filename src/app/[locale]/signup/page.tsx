import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SignUpForm } from '@/components/auth/sign-up-form';

export const runtime = 'edge';

// Auth-dependent — the redirect for already-signed-in users must run per-request.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return {
    title: t('signUpHeading'),
    robots: { index: false, follow: false },
  };
}

export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations({ locale, namespace: 'auth' });

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('signUpHeading')}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {t('haveAccountQuestion')}{' '}
        <a
          className="underline"
          href={`/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}`}
        >
          {t('signInCta')}
        </a>
      </p>

      <div className="mt-6">
        <SignUpForm />
      </div>
    </main>
  );
}
