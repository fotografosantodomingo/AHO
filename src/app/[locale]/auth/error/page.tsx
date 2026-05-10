import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { DotGrid } from '@/components/ui/dot-grid';

export const runtime = 'edge';

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
  const signInPath = localePath(locale as Locale, '/signin');

  return (
    <main className="relative overflow-hidden">
      <DotGrid ellipse="60% 50%" />

      <div className="relative mx-auto max-w-sm px-6 py-16">
        <div className="rounded-card border border-border-strong/40 bg-surface p-7 shadow-whisper dark:bg-surface-deep">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-warn">
            {t('eyebrow')}
          </p>
          <h1 className="mt-2 font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {t('heading')}
          </h1>
          <p className="mt-3 text-sm text-helper">
            {reason === 'pkce_browser_mismatch' ? t('bodyPkceMismatch') : t('body')}
          </p>

          {reason && (
            <details className="mt-4 rounded-card border border-border p-3 text-xs">
              <summary className="cursor-pointer text-helper">
                {t('details', { reason: '' }).replace(/[:：]\s*$/, '')}
              </summary>
              <p className="mt-2 break-words font-mono text-ink-muted dark:text-ink-inverse-muted">
                {reason}
              </p>
            </details>
          )}

          <a
            href={signInPath}
            className="btn-primary mt-6"
          >
            {t('tryAgainCta')}
          </a>
        </div>
      </div>
    </main>
  );
}
