import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { ReviewVerifyClient } from '@/components/reviews/review-verify-client';

export const runtime = 'edge';

/**
 * Public landing page for the verification link in the review-confirmation
 * email. The token comes in via the URL; the page renders a Client
 * Component that POSTs to /api/reviews/verify on mount and shows the
 * resulting state (success / expired / invalid / network).
 *
 * Indexability: noindex — these URLs are token-bearing and should never
 * be crawled.
 */

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function ReviewVerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'reviews' });

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-brand text-2xl font-semibold tracking-tight">
        {t('verifyHeading')}
      </h1>
      <ReviewVerifyClient
        token={token}
        labels={{
          checking: t('verifyChecking'),
          success: t('verifySuccess'),
          expired: t('verifyExpired'),
          invalid: t('verifyInvalid'),
        }}
      />
    </main>
  );
}
