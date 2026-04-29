import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SignInForm } from '@/components/auth/sign-in-form';

export const runtime = 'edge';

// Auth-dependent — the redirect for already-signed-in users must run per-request.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return {
    title: t('signInHeading'),
    robots: { index: false, follow: false },
  };
}

export default async function SignInPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { next } = await searchParams;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  // If already signed in, bounce to the destination.
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    redirect(next ?? `/${locale}`);
  }

  const t = await getTranslations({ locale, namespace: 'auth' });

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('signInHeading')}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {t('noAccountQuestion')}{' '}
        <a
          className="underline"
          href={`/${locale}/${locale === 'es' ? 'registrarse' : 'signup'}`}
        >
          {t('createOne')}
        </a>
      </p>

      <div className="mt-6">
        <SignInForm next={next ?? `/${locale}`} />
      </div>

      <div className="mt-6 flex flex-col items-start gap-2 text-sm">
        <a
          className="underline text-zinc-600 dark:text-zinc-400"
          href={`/${locale}/${locale === 'es' ? 'recuperar-contrasena' : 'forgot-password'}`}
        >
          {t('forgotPasswordLink')}
        </a>
        <a
          className="underline text-zinc-600 dark:text-zinc-400"
          href={`/${locale}/${locale === 'es' ? 'enlace-magico' : 'magic-link'}${
            next ? `?next=${encodeURIComponent(next)}` : ''
          }`}
        >
          {t('magicLinkAlt')}
        </a>
      </div>
    </main>
  );
}
