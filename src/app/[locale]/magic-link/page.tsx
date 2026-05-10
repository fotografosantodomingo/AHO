import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sanitizeNext } from '@/lib/auth/redirect';
import { MagicLinkForm } from '@/components/auth/magic-link-form';
import { DotGrid } from '@/components/ui/dot-grid';

export const runtime = 'edge';

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
  const t = await getTranslations({ locale, namespace: 'auth.magic' });
  return {
    title: t('heading'),
    robots: { index: false, follow: false },
  };
}

export default async function MagicLinkPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { next } = await searchParams;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    redirect(sanitizeNext(next, locale));
  }

  const t = await getTranslations({ locale, namespace: 'auth.magic' });
  const tAuth = await getTranslations({ locale, namespace: 'auth' });
  const signInPath = localePath(locale as Locale, '/signin');

  return (
    <main className="relative overflow-hidden">
      <DotGrid ellipse="60% 50%" />

      <div className="relative mx-auto max-w-sm px-6 py-16">
        <div className="rounded-card border border-border-strong/40 bg-surface p-7 shadow-whisper dark:bg-surface-deep">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            AHO
          </p>
          <h1 className="mt-2 font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {t('heading')}
          </h1>
          <p className="mt-2 text-sm text-helper">{t('intro')}</p>

          <div className="mt-6">
            <MagicLinkForm next={next} />
          </div>

          <p className="mt-6 border-t border-border pt-5 text-sm">
            <a
              className="text-helper underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
              href={signInPath}
            >
              {tAuth('passwordSigninAlt')}
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
