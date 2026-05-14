import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { SEGMENTS } from '@/lib/email/segments';
import { CampaignComposer } from '@/components/admin/email/campaign-composer';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Email · New campaign · AHO',
  robots: { index: false, follow: false },
};

/**
 * /admin/email/new — composer.
 *
 * Server Component shell that renders the Client composer with the
 * segment list. The Client side handles draft persistence, segment
 * pick, live HTML preview, and the three actions:
 *
 *   - Save draft        → POST /api/admin/email/campaigns (create)
 *   - Send test to me   → POST /api/email/send with segment=test_self
 *                          (creates a one-off campaign first if needed)
 *   - Send to segment   → POST /api/email/send with the real segment
 */
export default async function NewCampaignPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  // Fetch admin-uploaded audiences and append as segment options.
  const supabase = await createServerSupabaseClient();
  const { data: audienceRows } = await supabase
    .from('email_audiences')
    .select('id, name, contact_count')
    .order('created_at', { ascending: false });
  const audienceSegments = (audienceRows ?? []).map((a) => ({
    key: `audience:${a.id}`,
    label: `Custom list: ${a.name} (${a.contact_count})`,
    description: `Resolved from the uploaded audience "${a.name}".`,
    rpcName: 'segment_email_audience',
  }));

  return (
    <>
      <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px]">
        New email campaign
      </h1>
      <CampaignComposer
        locale={locale}
        segments={[...SEGMENTS, ...audienceSegments]}
      />
    </>
  );
}
