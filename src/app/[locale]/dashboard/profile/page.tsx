import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ProfileForm } from '@/components/dashboard/profile-form';

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

  return (
    <main className="space-y-6">
      <header>
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          {t('heading')}
        </h1>
        <p className="mt-1 text-sm text-helper">{t('subheading')}</p>
      </header>
      <ProfileForm initial={initial} />
    </main>
  );
}
