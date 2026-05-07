import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ProfileForm } from '@/components/dashboard/profile-form';
import { DangerZone } from '@/components/dashboard/danger-zone';
import { FaqEditor } from '@/components/dashboard/faq-editor';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * /{locale}/dashboard/profile (paths: /en/dashboard/profile, /es/panel/perfil).
 *
 * Editable agent profile. Same shape as the public agent-profile page
 * shows on /agents/{slug} — every field exposed here also surfaces
 * publicly (with the exception of phone numbers, which are gated behind
 * the SECURITY DEFINER `get_listing_contact` RPC and only on
 * active+published listings).
 *
 * Auth: signed-in users only. The dashboard layout already handles the
 * org-membership gate; profile edit is permitted for any authenticated
 * profile (Free + Registered + Agent tiers all have profile rows).
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    redirect(
      `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}?next=${encodeURIComponent(
        `/${locale}/${locale === 'es' ? 'panel/perfil' : 'dashboard/profile'}`,
      )}`,
    );
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'full_name, phone, whatsapp_phone, avatar_url, bio, website_url, facebook_url, instagram_url, linkedin_url, specialties, languages_spoken, city, country_code',
    )
    .eq('id', userResult.user.id)
    .maybeSingle();

  const t = await getTranslations({ locale, namespace: 'profileForm' });

  const initial = {
    full_name: profile?.full_name ?? null,
    phone: profile?.phone ?? null,
    whatsapp_phone: profile?.whatsapp_phone ?? null,
    avatar_url: profile?.avatar_url ?? null,
    bio: profile?.bio ?? null,
    website_url: profile?.website_url ?? null,
    facebook_url: profile?.facebook_url ?? null,
    instagram_url: profile?.instagram_url ?? null,
    linkedin_url: profile?.linkedin_url ?? null,
    specialties: (profile?.specialties as string[] | null) ?? [],
    languages_spoken: (profile?.languages_spoken as string[] | null) ?? [],
    city: profile?.city ?? null,
    country_code: profile?.country_code ?? null,
  };

  const userEmail = userResult.user.email ?? '';

  // FAQ editor is shown to org owners/managers only — Free/Registered
  // tier users have no org, so no FAQs to manage. Resolve manage-rights
  // here and pass the existing rows down. PO directive 2026-05-06: FAQs
  // were on a separate /dashboard/faqs page; they belong on the profile
  // page bottom because they ARE part of the agent's public profile.
  const { data: membership } = await supabase
    .from('organization_members')
    .select('org_id, role, organizations!inner(slug)')
    .eq('user_id', userResult.user.id)
    .in('role', ['owner', 'manager'])
    .limit(1)
    .maybeSingle();

  const orgId = (membership?.org_id as string | undefined) ?? null;
  const orgField = membership?.organizations as
    | { slug: string }
    | { slug: string }[]
    | null
    | undefined;
  const orgSlug =
    (Array.isArray(orgField) ? orgField[0]?.slug : orgField?.slug) ?? null;

  const { data: faqRows } = orgId
    ? await supabase
        .from('agent_faqs')
        .select('id, question_en, question_es, answer_en, answer_es, sort_order')
        .eq('org_id', orgId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
    : { data: null };

  const tFaqs = await getTranslations({ locale, namespace: 'dashboardFaqs' });

  return (
    <main className="space-y-10">
      <section className="space-y-6">
        <header>
          <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
            {t('heading')}
          </h1>
          <p className="mt-1 text-sm text-helper">{t('subheading')}</p>
        </header>
        <ProfileForm initial={initial} />
      </section>

      {orgId && (
        <section aria-labelledby="faqs-heading" className="space-y-4">
          <header className="space-y-1">
            <h2
              id="faqs-heading"
              className="font-brand text-xl font-semibold tracking-tight"
            >
              {tFaqs('heading')}
            </h2>
            <p className="max-w-2xl text-sm text-helper">{tFaqs('subheading')}</p>
            {orgSlug && (
              <p className="text-xs text-helper">
                {tFaqs('publishedTo')}{' '}
                <a
                  href={`/${locale}/${locale === 'es' ? 'agentes' : 'agents'}/${orgSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-action underline-offset-2 hover:underline dark:text-action-dark"
                >
                  {locale === 'es' ? 'tu perfil público' : 'your public profile'}
                </a>
              </p>
            )}
          </header>
          <FaqEditor
            orgId={orgId}
            locale={locale as Locale}
            initialFaqs={(faqRows ?? []).map((r) => ({
              id: r.id as string,
              questionEn: (r.question_en as string | null) ?? '',
              questionEs: (r.question_es as string | null) ?? '',
              answerEn: (r.answer_en as string | null) ?? '',
              answerEs: (r.answer_es as string | null) ?? '',
              sortOrder: r.sort_order as number,
            }))}
          />
        </section>
      )}

      <DangerZone email={userEmail} locale={locale as Locale} />
    </main>
  );
}
