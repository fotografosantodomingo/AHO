import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { MagicLinkForm } from '@/components/auth/magic-link-form';

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
    redirect(next ?? `/${locale}`);
  }

  const t = await getTranslations({ locale, namespace: 'auth.magic' });
  const tAuth = await getTranslations({ locale, namespace: 'auth' });
  const signInPath = `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}`;

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('intro')}</p>

      <div className="mt-6">
        <MagicLinkForm next={next} />
      </div>

      <p className="mt-6 text-sm">
        <a className="underline" href={signInPath}>
          {tAuth('passwordSigninAlt')}
        </a>
      </p>
    </main>
  );
}
