import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SignInForm } from '@/components/auth/sign-in-form';
import { DotGrid, HeroGlow } from '@/components/ui/dot-grid';

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
    <main className="relative overflow-hidden">
      <DotGrid ellipse="60% 50%" />
      <HeroGlow />

      <div className="relative mx-auto flex min-h-[calc(100vh-12rem)] max-w-sm flex-col items-stretch px-6 py-16">
        <div className="rounded-card border border-border-strong/40 bg-surface p-7 shadow-whisper dark:bg-surface-deep">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            AHO
          </p>
          <h1 className="mt-2 font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {t('signInHeading')}
          </h1>
          <p className="mt-2 text-sm text-helper">
            {t('noAccountQuestion')}{' '}
            <a
              className="text-action underline-offset-2 hover:underline dark:text-action-dark"
              href={`/${locale}/${locale === 'es' ? 'registrarse' : 'signup'}`}
            >
              {t('createOne')}
            </a>
          </p>

          <div className="mt-6">
            <SignInForm
              next={
                next ??
                `/${locale}/${locale === 'es' ? 'panel' : 'dashboard'}`
              }
            />
          </div>

          <div className="mt-6 flex flex-col items-start gap-2 border-t border-border pt-5 text-sm">
            <a
              className="text-helper underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
              href={`/${locale}/${locale === 'es' ? 'recuperar-contrasena' : 'forgot-password'}`}
            >
              {t('forgotPasswordLink')}
            </a>
            <a
              className="text-helper underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
              href={`/${locale}/${locale === 'es' ? 'enlace-magico' : 'magic-link'}${
                next ? `?next=${encodeURIComponent(next)}` : ''
              }`}
            >
              {t('magicLinkAlt')}
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
