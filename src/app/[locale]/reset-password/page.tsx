import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.reset' });
  return {
    title: t('heading'),
    robots: { index: false, follow: false },
  };
}

/**
 * Reset-password page — reached after clicking the recovery link in the
 * email. By the time the user lands here, `/auth/callback?type=recovery`
 * has already established a recovery session via `verifyOtp`. The form
 * checks for that session and either renders the password form or surfaces
 * a "request a new link" CTA if the session is missing (link expired or used).
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.reset' });

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('intro')}</p>

      <div className="mt-6">
        <ResetPasswordForm />
      </div>
    </main>
  );
}
