import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { fetchModerationQueue } from '@/lib/reviews/queries';
import { AdminReviewsClient } from '@/components/reviews/admin-reviews-client';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Reviews · AHO',
  robots: { index: false, follow: false },
};

/**
 * /admin/reviews — moderation queue. Auth gate is in the parent admin
 * layout. Lists pending_moderation reviews + recently published, with
 * actions: Approve / Reject / Hide / Unhide. Open report counts are
 * shown alongside each review.
 */
export default async function AdminReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const reviews = await fetchModerationQueue();
  const t = await getTranslations({ locale, namespace: 'reviews' });

  return (
    <main className="space-y-6">
      <header>
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          {t('moderationHeading')}
        </h1>
        <p className="mt-1 text-sm text-helper">{t('moderationSubheading')}</p>
      </header>

      <AdminReviewsClient
        reviews={reviews}
        locale={typedLocale}
        labels={{
          empty: t('moderationEmpty'),
          approve: t('moderationApprove'),
          reject: t('moderationReject'),
          hide: t('moderationHide'),
          unhide: t('moderationUnhide'),
          reports: (count: number) =>
            count === 1
              ? t('moderationReports_one')
              : t('moderationReports', { count }),
        }}
      />
    </main>
  );
}
