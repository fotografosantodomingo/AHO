import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { fetchOwnReviews } from '@/lib/reviews/queries';
import { AgentReviewsClient } from '@/components/reviews/agent-reviews-client';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Reviews · Dashboard · AHO',
  robots: { index: false, follow: false },
};

/**
 * /{locale}/dashboard/reviews — agent's review inbox.
 *
 * Shows every review about the signed-in agent at every status, so they
 * can see what's pending moderation and reply to published ones. Reads
 * via the reviews_agent_select_own RLS policy from 0016.
 */
export default async function AgentReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    redirect(
      `/${locale}/${
        typedLocale === 'es' ? 'iniciar-sesion' : 'signin'
      }?next=${encodeURIComponent(
        `/${locale}/${typedLocale === 'es' ? 'panel/resenas' : 'dashboard/reviews'}`,
      )}`,
    );
  }

  const reviews = await fetchOwnReviews(userResult.user.id);
  const t = await getTranslations({ locale, namespace: 'reviews' });

  return (
    <main className="space-y-6">
      <header>
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          {t('dashboardHeading')}
        </h1>
        <p className="mt-1 text-sm text-helper">{t('dashboardSubheading')}</p>
      </header>

      <AgentReviewsClient
        reviews={reviews}
        locale={typedLocale}
        labels={{
          empty: t('dashboardEmpty'),
          statusPending_verification: t('dashboardStatusLabel_pending_verification'),
          statusPending_moderation: t('dashboardStatusLabel_pending_moderation'),
          statusPublished: t('dashboardStatusLabel_published'),
          statusRejected: t('dashboardStatusLabel_rejected'),
          statusHidden: t('dashboardStatusLabel_hidden'),
          replyHeading: t('agentReplyHeading'),
          replyPlaceholder: t('agentReplyEditPlaceholder'),
          replySubmit: t('agentReplyButton'),
          replyUpdate: t('agentReplyUpdate'),
          replyClear: t('agentReplyClear'),
          replySaved: t('agentReplySaved'),
        }}
      />
    </main>
  );
}
