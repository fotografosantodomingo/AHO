import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Email · Campaign · AHO',
  robots: { index: false, follow: false },
};

interface MessageRow {
  email: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  bounce_reason: string | null;
  error_message: string | null;
}

/**
 * /admin/email/[id] — single-campaign view.
 *
 * Shows the campaign metadata + a per-recipient log table backed by
 * email_messages. Useful for verifying a send went through end-to-end
 * + auditing bounce reasons.
 */
export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  const supabase = await createServerSupabaseClient();
  const { data: campaign, error } = await supabase
    .from('email_campaigns')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !campaign) {
    notFound();
  }

  const { data: messageRows } = await supabase
    .from('email_messages')
    .select(
      'email, status, sent_at, delivered_at, opened_at, clicked_at, bounced_at, bounce_reason, error_message',
    )
    .eq('campaign_id', id)
    .order('email', { ascending: true })
    .limit(1000);
  const messages = (messageRows ?? []) as MessageRow[];

  const fmt = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <>
      <Link
        href={`/${locale}/admin/email`}
        className="text-sm text-helper hover:underline"
      >
        ← Back to campaigns
      </Link>

      <header className="space-y-2">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px]">
          {campaign.name}
        </h1>
        <p className="text-sm text-helper">
          Subject: <span className="font-medium text-ink">{campaign.subject}</span> ·
          Segment: <code className="text-xs">{campaign.segment_key}</code> ·
          Status: <span className="font-medium">{campaign.status}</span> ·
          Sent: {campaign.sent_at ? fmt.format(new Date(campaign.sent_at)) : 'not sent'}
        </p>
      </header>

      <section
        aria-label="Counters"
        className="grid grid-cols-2 gap-3 md:grid-cols-5"
      >
        <Tile label="Recipients" value={campaign.recipient_count} />
        <Tile label="Delivered" value={campaign.delivered_count} />
        <Tile label="Opened" value={campaign.opened_count} />
        <Tile label="Clicked" value={campaign.clicked_count} />
        <Tile label="Bounced" value={campaign.bounced_count} />
      </section>

      <section aria-label="HTML preview">
        <h2 className="mb-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          Sent HTML
        </h2>
        <iframe
          title="campaign html"
          srcDoc={campaign.html_body}
          sandbox=""
          className="h-[480px] w-full rounded-card border border-border-strong/40 bg-white"
        />
      </section>

      <section aria-label="Per-recipient log">
        <h2 className="mb-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          Recipients ({messages.length})
        </h2>
        {messages.length === 0 ? (
          <p className="text-sm text-helper">No messages yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-xs">
              <thead className="text-left">
                <tr>
                  {['Email', 'Status', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Bounce reason / error'].map(
                    (l) => (
                      <th
                        key={l}
                        className="px-3 py-2 font-brand font-semibold uppercase tracking-[0.13em] text-helper"
                      >
                        {l}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {messages.map((m) => (
                  <tr key={m.email}>
                    <td className="px-3 py-1.5 font-mono">{m.email}</td>
                    <td className="px-3 py-1.5">{m.status}</td>
                    <td className="px-3 py-1.5 text-helper">
                      {m.sent_at ? fmt.format(new Date(m.sent_at)) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-helper">
                      {m.delivered_at ? fmt.format(new Date(m.delivered_at)) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-helper">
                      {m.opened_at ? fmt.format(new Date(m.opened_at)) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-helper">
                      {m.clicked_at ? fmt.format(new Date(m.clicked_at)) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-red-600 dark:text-red-400">
                      {m.bounce_reason ?? m.error_message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 dark:border-border-strong/40 dark:bg-surface-deep">
      <p className="font-brand text-[11px] font-semibold uppercase tracking-[0.13em] text-helper">
        {label}
      </p>
      <p className="mt-1 font-brand text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
