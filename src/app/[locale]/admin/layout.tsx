import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { adminMfaSetupPath, getAdminMfaState } from '@/lib/auth/admin-mfa';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Shared shell for the /admin/* tree. Centralizes the auth gate (signed-in
 * + is_admin) and renders the tab nav so every sub-page (Listings / Orgs /
 * Leads) inherits the same chrome.
 *
 * Auth gate behaviors:
 *   - Anon                → redirect to /signin?next=<this URL>
 *   - Signed-in + !admin  → redirect to dashboard (no 403; non-admins
 *                           don't need to know /admin exists)
 *   - Signed-in + admin   → render the tab nav + child page
 *
 * Robots: noindex,nofollow set per-page on metadata; /admin is also
 * Disallow:'d in /robots.txt.
 */

interface NavItem {
  href: string;
  label: string;
}

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    const typedLocale = locale as Locale;
    redirect(
      `${localePath(typedLocale, '/signin')}?next=${encodeURIComponent(
        localePath(typedLocale, '/admin'),
      )}`,
    );
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userResult.user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    // Don't bounce non-admin signed-in users through /dashboard — that
    // surface re-redirects "no Agent subscription" users to /pricing,
    // which produces a confusing /admin → /precios chain. Send them to
    // the locale homepage instead. Admins who need access run the
    // bootstrap SQL from PROGRESS.md "Admin path + first-admin
    // bootstrap".
    redirect(`/${locale}`);
  }

  // MFA gate — admins without a verified factor are bounced to the
  // setup interstitial. Non-admins are unaffected (and never reach
  // this layout). The gate also covers /admin/* deep links, since
  // every admin page mounts under this layout.
  const mfa = await getAdminMfaState(supabase, userResult.user.id);
  if (mfa.enrollmentRequired) {
    redirect(adminMfaSetupPath(locale));
  }

  // English-only nav labels — admin surface is internal and doesn't need
  // localization (per `src/i18n/config.ts` PATHNAMES comment: "platform
  // admins are us, not localized").
  const tabs: NavItem[] = [
    { href: `/${locale}/admin`, label: 'Listings' },
    { href: `/${locale}/admin/orgs`, label: 'Orgs' },
    { href: `/${locale}/admin/leads`, label: 'Leads' },
    { href: `/${locale}/admin/users`, label: 'Users' },
    { href: `/${locale}/admin/reviews`, label: 'Reviews' },
    { href: `/${locale}/admin/email`, label: 'Email' },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <header className="space-y-3">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          Admin
        </p>
        <nav className="flex flex-wrap gap-1" aria-label="Admin sections">
          {tabs.map((tab) => (
            <a
              key={tab.href}
              href={tab.href}
              className="inline-flex h-8 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
