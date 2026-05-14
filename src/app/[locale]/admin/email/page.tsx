import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Email · AHO',
  robots: { index: false, follow: false },
};

interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  segment_key: string;
  status: string;
  recipient_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  sent_at: string | null;
  created_at: string;
}

/**
 * /admin/email — campaign list + KPI tiles.
 *
 * Aggregates per-status counts across all campaigns from the past 30
 * days. Tiles use the existing campaign counter columns; per-campaign
 * rates compute on the fly from the table.
 */
export default async function AdminEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('email_campaigns')
    .select(
      'id, name, subject, segment_key, status, recipient_count, delivered_count, opened_count, clicked_count, bounced_count, sent_at, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error.message}
      </p>
    );
  }
  const campaigns = (data ?? []) as CampaignRow[];

  // KPI tiles (last 30 days, status=sent)
  const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = campaigns.filter(
    (c) => c.sent_at && new Date(c.sent_at) > last30 && c.status === 'sent',
  );
  const totalSent = recent.reduce((a, c) => a + c.recipient_count, 0);
  const totalDelivered = recent.reduce((a, c) => a + c.delivered_count, 0);
  const totalOpened = recent.reduce((a, c) => a + c.opened_count, 0);
  const totalClicked = recent.reduce((a, c) => a + c.clicked_count, 0);
  const totalBounced = recent.reduce((a, c) => a + c.bounced_count, 0);

  const fmtDate = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px]">
          Email · Campaigns ({campaigns.length})
        </h1>
        <Link
          href={`/${locale}/admin/email/new`}
          className="inline-flex h-9 items-center rounded-lg bg-action px-4 text-sm font-semibold text-white shadow-whisper transition hover:opacity-90 dark:bg-action-dark dark:text-surface-deep"
        >
          + New campaign
        </Link>
      </div>

      <section
        aria-label="Last 30 days KPIs"
        className="grid grid-cols-2 gap-3 md:grid-cols-5"
      >
        <Tile label="Sent" value={totalSent} />
        <Tile
          label="Delivered"
          value={totalDelivered}
          rate={totalSent ? totalDelivered / totalSent : null}
        />
        <Tile
          label="Opened"
          value={totalOpened}
          rate={totalDelivered ? totalOpened / totalDelivered : null}
        />
        <Tile
          label="Clicked"
          value={totalClicked}
          rate={totalDelivered ? totalClicked / totalDelivered : null}
        />
        <Tile
          label="Bounced"
          value={totalBounced}
          rate={totalSent ? totalBounced / totalSent : null}
        />
      </section>

      {campaigns.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          No campaigns yet. Click <em>New campaign</em> to create your first one.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="text-left">
              <tr>
                {['Name', 'Subject', 'Segment', 'Status', 'Recipients', 'Delivered', 'Opened', 'Sent at', ''].map(
                  (l) => (
                    <th
                      key={l}
                      className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
                    >
                      {l}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  className="transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-helper">{c.subject}</td>
                  <td className="px-3 py-2 font-mono text-xs text-helper">
                    {c.segment_key}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.recipient_count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.delivered_count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.opened_count}
                  </td>
                  <td className="px-3 py-2 text-helper">
                    {c.sent_at ? fmtDate.format(new Date(c.sent_at)) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/${locale}/admin/email/${c.id}`}
                      className="text-sm font-medium text-action hover:underline dark:text-action-dark"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Tile({ label, value, rate }: { label: string; value: number; rate?: number | null }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 dark:border-border-strong/40 dark:bg-surface-deep">
      <p className="font-brand text-[11px] font-semibold uppercase tracking-[0.13em] text-helper">
        {label}
      </p>
      <p className="mt-1 font-brand text-2xl font-semibold tabular-nums">{value}</p>
      {rate != null && (
        <p className="mt-1 text-xs text-helper">
          {Number.isFinite(rate) ? `${(rate * 100).toFixed(1)}%` : '—'}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'sent'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : status === 'sending'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : status === 'failed'
          ? 'bg-red-500/10 text-red-700 dark:text-red-300'
          : 'bg-action/10 text-action dark:text-action-dark';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status}
    </span>
  );
}
