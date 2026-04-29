import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.error' });
  return {
    title: t('heading'),
    robots: { index: false, follow: false },
  };
}

export default async function AuthErrorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { locale } = await params;
  const { reason } = await searchParams;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.error' });
  const signInPath = `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}`;

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t('body')}</p>

      {reason && (
        <details className="mt-4 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
          <summary className="cursor-pointer text-zinc-500">
            {t('details', { reason: '' }).replace(/[:：]\s*$/, '')}
          </summary>
          <p className="mt-2 break-words font-mono text-zinc-700 dark:text-zinc-300">
            {reason}
          </p>
        </details>
      )}

      <a
        href={signInPath}
        className="mt-6 inline-flex h-10 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        {t('tryAgainCta')}
      </a>
    </main>
  );
}
