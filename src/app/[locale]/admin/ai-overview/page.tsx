import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createAdminClient } from '@/lib/supabase/admin';
import { countryToMarket } from '@/lib/ai/country-to-market';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI overview — AHO Admin',
  robots: { index: false, follow: false },
};

/**
 * /admin/ai-overview — Phase 3 cross-org AI conversion read surface.
 *
 * Mirrors /admin/audit-costs in style (server component, edge,
 * force-dynamic, service-role admin client to bypass RLS and aggregate
 * across orgs). The /admin layout already gates this on is_admin + MFA.
 *
 * Reads primarily from `ai_daily_stats` (org-level rows where
 * `agent_id IS NULL` give us cross-org rollups in a single indexed
 * scan). Per-tier adoption + per-market split need to dip into
 * `ai_conversations` since neither tier nor market is stored on the
 * daily-stats row — both rollups are small (last 30d) so the in-memory
 * group-by is cheap.
 *
 * Test-org filter (CLAUDE.md R11): every query joins
 * `organizations.slug` and we drop rows for `slug LIKE 'aho-test-org-%'`
 * client-side. Fixture orgs share the prod Supabase project, so
 * forgetting this filter would inflate every metric.
 *
 * No charts; tables only — mirrors audit-costs decision that the
 * operator + investors care about the numbers, not the bar graph.
 */

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(cents < 100 ? 4 : 2)}`;
}

function delta(current: number, prior: number): string {
  if (prior === 0) return current === 0 ? '—' : 'new';
  const change = ((current - prior) / prior) * 100;
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(0)}% vs prior 7d`;
}

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  pro_automation: 'Pro Automation',
  super_pro: 'Super Pro',
  agency: 'Agency',
  unknown: 'Unknown',
};

const KNOWN_TIERS = ['free', 'pro_automation', 'super_pro', 'agency', 'unknown'];

export default async function AdminAiOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const admin = createAdminClient();

  const now = Date.now();
  const since7dDate = new Date(now - 7 * 86_400_000);
  const since14dDate = new Date(now - 14 * 86_400_000);
  const since30dDate = new Date(now - 30 * 86_400_000);
  const since7dDay = since7dDate.toISOString().slice(0, 10);
  const since14dDay = since14dDate.toISOString().slice(0, 10);
  const since30dDay = since30dDate.toISOString().slice(0, 10);
  const since30dIso = since30dDate.toISOString();

  // ─── 1. Org-level daily stats (last 30d) ──────────────────────────
  // agent_id IS NULL rows hold per-org daily totals. We pull a 30d
  // window once and slice it locally for the 7d / 14d / 30d cuts.
  // Also join organizations to filter out fixture orgs (R11).
  const { data: orgStatsRaw } = await admin
    .from('ai_daily_stats')
    .select(
      'org_id, day, conversations, drafts_approved, drafts_edited, drafts_rejected, leads_captured, viewings_booked, cost_usd_cents, organizations!inner(slug, name, headquarters_country)',
    )
    .is('agent_id', null)
    .gte('day', since30dDay)
    .order('day', { ascending: false });

  type OrgDailyRow = {
    org_id: string;
    day: string;
    conversations: number | null;
    drafts_approved: number | null;
    drafts_edited: number | null;
    drafts_rejected: number | null;
    leads_captured: number | null;
    viewings_booked: number | null;
    cost_usd_cents: number | null;
    organizations: {
      slug: string;
      name: string;
      headquarters_country: string | null;
    } | null;
  };

  const orgStats: OrgDailyRow[] = ((orgStatsRaw ?? []) as unknown as OrgDailyRow[]).filter(
    (r) => r.organizations && !r.organizations.slug.startsWith('aho-test-org-'),
  );

  // ─── 2. Top-line totals (7d + prior 7d for delta + 30d + lifetime) ─
  let conv7 = 0;
  let conv7Prior = 0;
  let approved7 = 0;
  let edited7 = 0;
  let rejected7 = 0;
  let leads30 = 0;
  let conv30 = 0;
  const activeOrgs7 = new Set<string>();

  for (const r of orgStats) {
    const c = r.conversations ?? 0;
    const a = r.drafts_approved ?? 0;
    const e = r.drafts_edited ?? 0;
    const rej = r.drafts_rejected ?? 0;
    const leads = r.leads_captured ?? 0;
    if (r.day >= since7dDay) {
      conv7 += c;
      approved7 += a;
      edited7 += e;
      rejected7 += rej;
      if (c > 0) activeOrgs7.add(r.org_id);
    } else if (r.day >= since14dDay) {
      conv7Prior += c;
    }
    conv30 += c;
    leads30 += leads;
  }

  // Lifetime leads — separate query so we don't shoehorn it into the
  // 30d window. Org-level rows + test-org filter via inner join.
  const { data: leadsLifetimeRaw } = await admin
    .from('ai_daily_stats')
    .select('leads_captured, organizations!inner(slug)')
    .is('agent_id', null);
  type LifetimeRow = {
    leads_captured: number | null;
    organizations: { slug: string } | null;
  };
  const leadsLifetime = ((leadsLifetimeRaw ?? []) as unknown as LifetimeRow[])
    .filter((r) => r.organizations && !r.organizations.slug.startsWith('aho-test-org-'))
    .reduce((sum, r) => sum + (r.leads_captured ?? 0), 0);

  const reviewDenom = approved7 + edited7 + rejected7;
  const approvalRate7 = pct(approved7 + edited7, reviewDenom);
  const convToLead30 = pct(leads30, conv30);

  // ─── 3. Daily activity (last 30 days; sum across all orgs) ────────
  const byDay = new Map<string, { conversations: number; leads: number }>();
  for (const r of orgStats) {
    const slot = byDay.get(r.day) ?? { conversations: 0, leads: 0 };
    slot.conversations += r.conversations ?? 0;
    slot.leads += r.leads_captured ?? 0;
    byDay.set(r.day, slot);
  }
  const dailyRows = Array.from(byDay.entries())
    .map(([day, s]) => ({ day, conversations: s.conversations, leads: s.leads }))
    .sort((a, b) => b.day.localeCompare(a.day));

  // ─── 4. Per-tier adoption (last 30d) ──────────────────────────────
  const { data: tierBreakdownRaw } = await admin
    .from('ai_conversations')
    .select('tier_at_creation, org_id, id, organizations!inner(slug)')
    .gte('first_message_at', since30dIso);

  type TierConvRow = {
    tier_at_creation: string | null;
    org_id: string;
    id: string;
    organizations: { slug: string } | null;
  };

  const tierConvs = ((tierBreakdownRaw ?? []) as unknown as TierConvRow[]).filter(
    (r) => r.organizations && !r.organizations.slug.startsWith('aho-test-org-'),
  );

  const tierMap = new Map<string, { convs: number; orgs: Set<string> }>();
  for (const r of tierConvs) {
    const tier = r.tier_at_creation ?? 'unknown';
    const slot = tierMap.get(tier) ?? { convs: 0, orgs: new Set<string>() };
    slot.convs += 1;
    slot.orgs.add(r.org_id);
    tierMap.set(tier, slot);
  }
  const totalTierConvs = tierConvs.length;
  const tierRows = KNOWN_TIERS.map((tier) => {
    const slot = tierMap.get(tier);
    return {
      tier,
      label: TIER_LABELS[tier] ?? tier,
      conversations: slot?.convs ?? 0,
      orgs: slot?.orgs.size ?? 0,
      pctOfTotal: pct(slot?.convs ?? 0, totalTierConvs),
    };
  });
  // Catch any tier values not in KNOWN_TIERS (forward-compat).
  for (const [tier, slot] of tierMap.entries()) {
    if (!KNOWN_TIERS.includes(tier)) {
      tierRows.push({
        tier,
        label: tier,
        conversations: slot.convs,
        orgs: slot.orgs.size,
        pctOfTotal: pct(slot.convs, totalTierConvs),
      });
    }
  }

  // ─── 5. Per-market split (last 30d) ───────────────────────────────
  // Re-use the same conversation rows; we already pulled org_id and
  // need to join to organizations.headquarters_country. The query
  // above only selected org slug — re-query with country (or build a
  // small org→country map). Cheaper: one query for orgs we saw.
  const orgIdsSeen = Array.from(new Set(tierConvs.map((r) => r.org_id)));
  let orgCountryMap = new Map<string, string | null>();
  if (orgIdsSeen.length > 0) {
    const { data: orgsCountry } = await admin
      .from('organizations')
      .select('id, headquarters_country')
      .in('id', orgIdsSeen);
    orgCountryMap = new Map(
      (orgsCountry ?? []).map((o) => [
        o.id as string,
        (o.headquarters_country as string | null) ?? null,
      ]),
    );
  }
  const marketMap = new Map<string, number>();
  for (const r of tierConvs) {
    const country = orgCountryMap.get(r.org_id) ?? null;
    const market = countryToMarket(country);
    marketMap.set(market, (marketMap.get(market) ?? 0) + 1);
  }
  const marketRows = Array.from(marketMap.entries())
    .map(([market, count]) => ({
      market,
      conversations: count,
      pctOfTotal: pct(count, totalTierConvs),
    }))
    .sort((a, b) => b.conversations - a.conversations);

  // ─── 6. Top 10 active agents (last 30d) ───────────────────────────
  const { data: agentStatsRaw } = await admin
    .from('ai_daily_stats')
    .select(
      'org_id, agent_id, conversations, leads_captured, organizations!inner(slug, name)',
    )
    .not('agent_id', 'is', null)
    .gte('day', since30dDay);

  type AgentStatRow = {
    org_id: string;
    agent_id: string;
    conversations: number | null;
    leads_captured: number | null;
    organizations: { slug: string; name: string } | null;
  };

  const agentStats = ((agentStatsRaw ?? []) as unknown as AgentStatRow[]).filter(
    (r) => r.organizations && !r.organizations.slug.startsWith('aho-test-org-'),
  );

  const agentMap = new Map<
    string,
    { conversations: number; leads: number; orgId: string; orgName: string }
  >();
  for (const r of agentStats) {
    const slot = agentMap.get(r.agent_id) ?? {
      conversations: 0,
      leads: 0,
      orgId: r.org_id,
      orgName: r.organizations?.name ?? '—',
    };
    slot.conversations += r.conversations ?? 0;
    slot.leads += r.leads_captured ?? 0;
    agentMap.set(r.agent_id, slot);
  }
  const topAgentIds = Array.from(agentMap.entries())
    .sort((a, b) => b[1].conversations - a[1].conversations)
    .slice(0, 10);

  const agentIds = topAgentIds.map(([id]) => id);
  const { data: agentProfiles } = agentIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', agentIds)
    : { data: [] };
  const profileNameById = new Map(
    (agentProfiles ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? '—']),
  );
  const topAgentRows = topAgentIds.map(([agentId, slot]) => ({
    agentId,
    agentName: profileNameById.get(agentId) ?? '—',
    orgName: slot.orgName,
    conversations: slot.conversations,
    leads: slot.leads,
    conversionPct: pct(slot.leads, slot.conversations),
  }));

  // ─── 7. Cost-effectiveness ($ per lead, last 30d) ─────────────────
  let cost30Cents = 0;
  for (const r of orgStats) {
    cost30Cents += r.cost_usd_cents ?? 0;
  }
  const costPerLead = leads30 > 0 ? usd(Math.round(cost30Cents / leads30)) : '—';

  return (
    <main className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px]">
          AI overview
        </h1>
        <p className="text-sm text-helper">
          Cross-org rollup from `ai_daily_stats` (built nightly at 02:00 UTC by
          `/api/cron/ai-daily-rollup` from `ai_conversation_events`). Test-org
          fixtures filtered out. Numbers below in USD where applicable.
        </p>
      </header>

      {/* Top-line tiles */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Tile
          label="Conversations (7d)"
          value={conv7.toLocaleString()}
          sub={delta(conv7, conv7Prior)}
        />
        <Tile
          label="Active AI agents (7d)"
          value={activeOrgs7.size.toLocaleString()}
          sub={activeOrgs7.size === 0 ? 'no activity yet' : 'orgs with ≥1 chat'}
        />
        <Tile
          label="Approval rate (7d)"
          value={approvalRate7}
          sub={`${approved7 + edited7} approved / ${reviewDenom} reviewed`}
        />
        <Tile
          label="Conv→lead (30d)"
          value={convToLead30}
          sub={`${leads30} leads / ${conv30} chats`}
        />
        <Tile
          label="Total AI leads (lifetime)"
          value={leadsLifetime.toLocaleString()}
          sub="across all orgs"
        />
      </section>

      {/* Daily activity */}
      <section className="space-y-3">
        <h2 className="font-brand text-lg font-semibold">Daily activity (last 30 days)</h2>
        {dailyRows.length === 0 ? (
          <p className="text-sm text-helper">
            No AI activity in the last 30 days. The rollup cron runs at 02:00 UTC; if you
            just shipped events, the table populates after the next run.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              headers={['Day', 'Conversations', 'Leads captured', 'Conv→lead']}
              rows={dailyRows.map((r) => [
                r.day,
                String(r.conversations),
                String(r.leads),
                pct(r.leads, r.conversations),
              ])}
            />
          </div>
        )}
      </section>

      {/* Per-tier adoption */}
      <section className="space-y-3">
        <h2 className="font-brand text-lg font-semibold">Per-tier adoption (last 30d)</h2>
        {tierConvs.length === 0 ? (
          <p className="text-sm text-helper">No conversations in the last 30 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              headers={['Tier', 'Conversations', 'Distinct orgs', '% of total']}
              rows={tierRows
                .filter((r) => r.conversations > 0)
                .map((r) => [r.label, String(r.conversations), String(r.orgs), r.pctOfTotal])}
            />
          </div>
        )}
      </section>

      {/* Per-market split */}
      <section className="space-y-3">
        <h2 className="font-brand text-lg font-semibold">Per-market split (last 30d)</h2>
        {marketRows.length === 0 ? (
          <p className="text-sm text-helper">No conversations in the last 30 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              headers={['Market', 'Conversations', '% of total']}
              rows={marketRows.map((r) => [
                r.market.toUpperCase(),
                String(r.conversations),
                r.pctOfTotal,
              ])}
            />
          </div>
        )}
      </section>

      {/* Top 10 active agents */}
      <section className="space-y-3">
        <h2 className="font-brand text-lg font-semibold">Top 10 active agents (last 30d)</h2>
        {topAgentRows.length === 0 ? (
          <p className="text-sm text-helper">No per-agent activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              headers={['Agent', 'Org', 'Conversations', 'Leads', 'Conv→lead']}
              rows={topAgentRows.map((r) => [
                r.agentName,
                r.orgName,
                String(r.conversations),
                String(r.leads),
                r.conversionPct,
              ])}
            />
          </div>
        )}
      </section>

      {/* Cost-effectiveness */}
      <section className="space-y-3">
        <h2 className="font-brand text-lg font-semibold">Cost-effectiveness (last 30d)</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Tile
            label="AI cost (30d)"
            value={usd(cost30Cents)}
            sub="rolled up from ai_generation_log"
          />
          <Tile label="Leads captured (30d)" value={leads30.toLocaleString()} sub="across all orgs" />
          <Tile
            label="Cost per lead"
            value={costPerLead}
            sub={
              leads30 > 0
                ? '(estimated from ai_generation_log)'
                : 'no leads in window'
            }
          />
        </div>
      </section>

      <p className="text-xs text-helper">
        Source: <code>ai_daily_stats</code> (org-level rows where <code>agent_id IS NULL</code>) + <code>ai_conversations</code>
        {' '}for tier / market grouping. Test-org fixtures (<code>organizations.slug LIKE &apos;aho-test-org-%&apos;</code>)
        filtered out per CLAUDE.md R11.
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
