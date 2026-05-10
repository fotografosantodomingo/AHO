import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAdminMfaState } from '@/lib/auth/admin-mfa';
import { SetupMfaCard } from '@/components/auth/setup-mfa-card';

export const runtime = 'edge';

// Auth-dependent — must run per-request.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.mfa' });
  return {
    title: t('setupHeading'),
    robots: { index: false, follow: false },
  };
}

/**
 * MFA enrollment interstitial for admin accounts.
 *
 * Reachable as `/[locale]/setup-mfa`. Admin layout + dashboard layout
 * redirect here when the signed-in user has `is_admin = true` and no
 * verified TOTP factor. Once an admin successfully enrolls, this page
 * redirects to /admin (or to the dashboard for admins who also wear
 * the agent hat). Non-admin users who happen to land here also see
 * the form — MFA is opt-in for them but not blocked by the gate.
 *
 * Lives OUTSIDE the dashboard layout to avoid the gate redirect-
 * looping back to itself when the very page that satisfies the gate
 * is itself gated.
 */
export default async function SetupMfaPage({ params }: PageProps) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    const typedLocale = locale as Locale;
    redirect(
      `${localePath(typedLocale, '/signin')}?next=${encodeURIComponent(
        localePath(typedLocale, '/setup-mfa'),
      )}`,
    );
  }

  const mfa = await getAdminMfaState(supabase, userResult.user.id);
  // Admins who already have a factor: they shouldn't see this page —
  // bounce them to /admin. Non-admins (opt-in path) stay on the page
  // even after enrolling, since they may want to manage factors here
  // in a future iteration; v1 just shows a "you're set up" state.
  if (mfa.isAdmin && mfa.hasVerifiedFactor) {
    redirect(`/${locale}/admin`);
  }

  const t = await getTranslations({ locale, namespace: 'auth.mfa' });

  return (
    <main className="relative">
      <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-lg flex-col items-stretch px-6 py-16">
        <div className="rounded-card border border-border-strong/40 bg-surface p-7 shadow-whisper dark:bg-surface-deep">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            AHO · {t('badge')}
          </p>
          <h1 className="mt-2 font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {t('setupHeading')}
          </h1>
          <p className="mt-3 text-sm text-helper">
            {mfa.isAdmin ? t('introAdmin') : t('introOptional')}
          </p>
          <div className="mt-6">
            <SetupMfaCard locale={locale} isAdmin={mfa.isAdmin} />
          </div>
        </div>
      </div>
    </main>
  );
}
