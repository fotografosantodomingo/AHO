import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { DotGrid, HeroGlow } from '@/components/ui/dot-grid';

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
    <main className="relative overflow-hidden">
      <DotGrid ellipse="60% 50%" />
      <HeroGlow />

      <div className="relative mx-auto max-w-sm px-6 py-16">
        <div className="rounded-card border border-border-strong/40 bg-surface p-7 shadow-whisper dark:bg-surface-deep">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            AHO
          </p>
          <h1 className="mt-2 font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {t('signUpHeading')}
          </h1>
          <p className="mt-2 text-sm text-helper">
            {t('haveAccountQuestion')}{' '}
            <a
              className="text-action underline-offset-2 hover:underline dark:text-action-dark"
              href={localePath(locale as Locale, '/signin')}
            >
              {t('signInCta')}
            </a>
          </p>

          <div className="mt-6">
            <SignUpForm />
          </div>
        </div>
      </div>
    </main>
  );
}
