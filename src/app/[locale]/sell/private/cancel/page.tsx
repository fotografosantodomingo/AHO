import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

export const runtime = 'edge';
export const dynamic = 'force-static';

interface PageParams {
  locale: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const t = await getTranslations({ locale, namespace: 'sellPrivate' });
  return {
    title: t('cancel.heading'),
    robots: { index: false, follow: false },
  };
}

export default async function SellPrivateCancelPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'sellPrivate' });
  const privateLandingHref = localePath(typedLocale, '/sell/private');

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 md:py-24">
      <div className="rounded-card border border-border bg-surface p-8 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:p-12">
        <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-4xl">
          {t('cancel.heading')}
        </h1>
        <p className="mt-4 text-base text-ink-muted dark:text-ink-inverse-muted md:text-lg">
          {t('cancel.body')}
        </p>
        <div className="mt-8">
          <Link
            href={privateLandingHref}
            className="btn-primary inline-flex h-12 items-center px-6 text-base font-semibold"
          >
            ← {t('cancel.cta')}
          </Link>
        </div>
      </div>
    </main>
  );
}
