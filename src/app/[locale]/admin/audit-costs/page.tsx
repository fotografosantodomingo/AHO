import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI cost rollup — AHO Admin',
  robots: { index: false, follow: false },
};

/**
 * /admin/audit-costs — Phase 5.5 unit-economics read surface.
 *
 * The `ai_generation_log` table now captures every Anthropic call
 * (import + drafter + listing-draft). This page rolls it up three
 * ways so the operator can pull up the cost picture in 2 seconds
 * during an investor call or weekly review:
 *
 *   1. Daily summary (last 30 days) — total cost / total calls /
 *      audits / avg cost per audit, one row per day
 *   2. Per-market breakdown — total cost + avg-per-audit by market
 *   3. Last 20 individual audits — per-audit cost detail with
 *      source URL + locale + age
 *
 * Read-only. Service-role admin client bypasses RLS to read the
 * table (which has no read policy = deny-all to non-admin Postgres
 * roles). The /admin layout already gates this on is_admin + MFA.
 *
 * Numbers are USD. Stored as integer cents in the DB; we divide
 * by 100 at display time. No charts — three simple tables; the
 * operator + investors care about the numbers, not the bar graph.
 */

interface DailyRow {
  day: string;
  audits: number;
  calls: number;
  cost_cents: number;
  avg_cost_cents_per_audit: number;
}

interface MarketRow {
  market: string;
  audits: number;
  calls: number;
  cost_cents: number;
  avg_cost_cents_per_audit: number;
}

interface AuditRow {
  audit_id: string;
  source_url: string | null;
  source_locale: string | null;
  total_cost_cents: number;
  call_count: number;
  created_at: string;
}

interface TotalsRow {
  audits: number;
  calls: number;
  cost_cents: number;
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(cents < 100 ? 4 : 2)}`;
}

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default async function AdminAuditCostsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const admin = createAdminClient();

  // Pull the raw log rows for the time windows we need. We do the
  // rollups in TS because the SQL view layer isn't created yet and
  // PostgREST doesn't expose ad-hoc GROUP BY aggregations. At <100k
  // rows in the foreseeable future the in-memory rollup is fine; if
  // we cross that, swap in a SECURITY DEFINER view.
  const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data: rows } = await admin
    .from('ai_generation_log')
    .select('audit_id, purpose, model, market, estimated_cost_usd_cents, created_at')
    .gte('created_at', since30d)
    .order('created_at', { ascending: false });

  type LogRow = {
    audit_id: string | null;
    purpose: string;
    model: string;
    market: string | null;
    estimated_cost_usd_cents: number;
    created_at: string;
  };
  const logs: LogRow[] = rows ?? [];

  // Daily summary
  const byDay = new Map<string, { audits: Set<string>; calls: number; cost: number }>();
  for (const r of logs) {
    const day = r.created_at.slice(0, 10);
    const slot = byDay.get(day) ?? { audits: new Set(), calls: 0, cost: 0 };
    if (r.audit_id) slot.audits.add(r.audit_id);
    slot.calls += 1;
    slot.cost += r.estimated_cost_usd_cents;
    byDay.set(day, slot);
  }
  const dailyRows: DailyRow[] = Array.from(byDay.entries())
    .map(([day, s]) => ({
      day,
      audits: s.audits.size,
      calls: s.calls,
      cost_cents: s.cost,
      avg_cost_cents_per_audit: s.audits.size > 0 ? Math.round(s.cost / s.audits.size) : 0,
    }))
    .sort((a, b) => b.day.localeCompare(a.day));

  // Per-market (only draft calls have market; import calls are NULL).
  const byMarket = new Map<string, { audits: Set<string>; calls: number; cost: number }>();
  for (const r of logs) {
    if (!r.market) continue;
    const slot = byMarket.get(r.market) ?? { audits: new Set(), calls: 0, cost: 0 };
    if (r.audit_id) slot.audits.add(r.audit_id);
    slot.calls += 1;
    slot.cost += r.estimated_cost_usd_cents;
    byMarket.set(r.market, slot);
  }
  const marketRows: MarketRow[] = Array.from(byMarket.entries())
    .map(([market, s]) => ({
      market,
      audits: s.audits.size,
      calls: s.calls,
      cost_cents: s.cost,
      avg_cost_cents_per_audit: s.audits.size > 0 ? Math.round(s.cost / s.audits.size) : 0,
    }))
    .sort((a, b) => b.cost_cents - a.cost_cents);

  // Per-audit (last 20) — join ai_audits for source_url + locale.
  const byAudit = new Map<string, { cost: number; calls: number; created: string }>();
  for (const r of logs) {
    if (!r.audit_id) continue;
    const slot = byAudit.get(r.audit_id) ?? { cost: 0, calls: 0, created: r.created_at };
    slot.cost += r.estimated_cost_usd_cents;
    slot.calls += 1;
    if (r.created_at < slot.created) slot.created = r.created_at;
    byAudit.set(r.audit_id, slot);
  }
  const auditIds = Array.from(byAudit.keys()).slice(0, 50);
  const { data: auditMeta } = auditIds.length
    ? await admin
        .from('ai_audits')
        .select('id, source_url, source_locale')
        .in('id', auditIds)
    : { data: [] };
  const metaById = new Map(
    (auditMeta ?? []).map((a) => [
      a.id as string,
      {
        source_url: (a.source_url as string | null) ?? null,
        source_locale: (a.source_locale as string | null) ?? null,
      },
    ]),
  );
  const auditRows: AuditRow[] = Array.from(byAudit.entries())
    .map(([audit_id, s]) => ({
      audit_id,
      source_url: metaById.get(audit_id)?.source_url ?? null,
      source_locale: metaById.get(audit_id)?.source_locale ?? null,
      total_cost_cents: s.cost,
      call_count: s.calls,
      created_at: s.created,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);

  // Top-line totals — 7d + 30d windows
  const totals7d: TotalsRow = { audits: 0, calls: 0, cost_cents: 0 };
  const audits7d = new Set<string>();
  const totals30d: TotalsRow = { audits: 0, calls: 0, cost_cents: 0 };
  const audits30d = new Set<string>();
  for (const r of logs) {
    totals30d.calls += 1;
    totals30d.cost_cents += r.estimated_cost_usd_cents;
    if (r.audit_id) audits30d.add(r.audit_id);
    if (r.created_at >= since7d) {
      totals7d.calls += 1;
      totals7d.cost_cents += r.estimated_cost_usd_cents;
      if (r.audit_id) audits7d.add(r.audit_id);
    }
  }
  totals7d.audits = audits7d.size;
  totals30d.audits = audits30d.size;

  return (
    <main className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px]">
          AI cost rollup
        </h1>
        <p className="text-sm text-helper">
          From `ai_generation_log` — every Claude call we make. Cost computed at write time from per-model pricing snapshots in `src/lib/ai/cost.ts`; numbers below in USD.
        </p>
      </header>

      {/* Top-line tiles */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Cost last 7 days" value={usd(totals7d.cost_cents)} sub={`${totals7d.audits} audits / ${totals7d.calls} calls`} />
        <Tile label="Cost last 30 days" value={usd(totals30d.cost_cents)} sub={`${totals30d.audits} audits / ${totals30d.calls} calls`} />
        <Tile
          label="Avg cost per audit (7d)"
          value={usd(totals7d.audits > 0 ? Math.round(totals7d.cost_cents / totals7d.audits) : 0)}
          sub={totals7d.audits > 0 ? 'target: $0.30' : 'no audits yet'}
        />
        <Tile
          label="Avg cost per audit (30d)"
          value={usd(totals30d.audits > 0 ? Math.round(totals30d.cost_cents / totals30d.audits) : 0)}
          sub={totals30d.audits > 0 ? 'target: $0.30' : 'no audits yet'}
        />
      </section>

      {/* Daily summary */}
      <section className="space-y-3">
        <h2 className="font-brand text-lg font-semibold">Daily (last 30 days)</h2>
        {dailyRows.length === 0 ? (
          <p className="text-sm text-helper">No AI calls in the last 30 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              headers={['Day', 'Audits', 'Calls', 'Total cost', 'Avg / audit']}
              rows={dailyRows.map((r) => [
                r.day,
                String(r.audits),
                String(r.calls),
                usd(r.cost_cents),
                usd(r.avg_cost_cents_per_audit),
              ])}
            />
          </div>
        )}
      </section>

      {/* Per-market */}
      <section className="space-y-3">
        <h2 className="font-brand text-lg font-semibold">Per market (last 30 days)</h2>
        {marketRows.length === 0 ? (
          <p className="text-sm text-helper">No market-tagged calls in the last 30 days (only `audit_import` calls log without a market).</p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              headers={['Market', 'Audits', 'Calls', 'Total cost', 'Avg / audit (drafter only)']}
              rows={marketRows.map((r) => [
                r.market.toUpperCase(),
                String(r.audits),
                String(r.calls),
                usd(r.cost_cents),
                usd(r.avg_cost_cents_per_audit),
              ])}
            />
          </div>
        )}
      </section>

      {/* Per-audit recent */}
      <section className="space-y-3">
        <h2 className="font-brand text-lg font-semibold">Last 20 audits</h2>
        {auditRows.length === 0 ? (
          <p className="text-sm text-helper">No audits in the last 30 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              headers={['When', 'Audit ID', 'Source', 'Detected lang', 'Calls', 'Total cost']}
              rows={auditRows.map((r) => [
                relative(r.created_at),
                r.audit_id.slice(0, 8) + '…',
                r.source_url ? new URL(r.source_url).hostname : '—',
                r.source_locale ?? '—',
                String(r.call_count),
                usd(r.total_cost_cents),
              ])}
            />
          </div>
        )}
      </section>

      <p className="text-xs text-helper">
        Pricing snapshot: Haiku 4.5 $1/$5 per Mtok · Sonnet 4.6 $3/$15 per Mtok. Update <code>src/lib/ai/cost.ts</code> when Anthropic re-prices — past rows stay accurate-to-the-moment.
      </p>
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep">
      <p className="text-xs uppercase tracking-wider text-helper">{label}</p>
      <p className="mt-1 font-brand text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-helper">{sub}</p>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <table className="min-w-full divide-y divide-border text-sm">
      <thead className="text-left">
        <tr>
          {headers.map((h) => (
            <th
              key={h}
              className="px-3 py-2 font-brand text-[12px] font-semibold uppercase tracking-[0.13em] text-helper"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {rows.map((row, i) => (
          <tr key={i} className="transition hover:bg-black/5 dark:hover:bg-white/5">
            {row.map((cell, j) => (
              <td key={j} className="px-3 py-2 tabular-nums">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
