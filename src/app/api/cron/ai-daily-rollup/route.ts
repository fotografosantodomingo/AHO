import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { checkCronAuth } from '@/app/api/cron/meta-insights/route';

export const runtime = 'edge';

/**
 * GET /api/cron/ai-daily-rollup
 *
 * Phase 1 of `docs/AI_CONVERSION_PLAN.md`. Rolls yesterday's
 * `ai_conversation_events` rows into the `ai_daily_stats` table that
 * the dashboard analytics tab + the admin /admin/ai-overview view
 * read from. UPSERT pattern keeps the job idempotent — re-running it
 * for the same day overwrites the row, never duplicates.
 *
 * Auth: bearer token via the shared `checkCronAuth` helper; matched
 * against `CRON_SECRET` server env. Fired by `workers/ai-daily-rollup/`
 * at 02:00 UTC daily.
 *
 * Output: JSON summary { ok, rowsWritten, dayProcessed }.
 *
 * Why a rollup vs ad-hoc query: the dashboard tab needs sub-100ms
 * read latency for the agent's "this week" tiles; a `GROUP BY` over
 * 30 days of raw events would scale poorly past a few hundred orgs.
 * The rollup is small (~one row per active agent per day) and
 * indexed by `(org_id, day)`.
 *
 * Manual back-fill: pass `?day=YYYY-MM-DD` to rollup a specific day.
 * Combined with the bearer auth this is the recovery primitive when
 * the cron misses a night.
 */

interface RollupSummary {
  ok: boolean;
  dayProcessed?: string;
  rowsWritten?: number;
  errorCode?: string;
  errorMessage?: string;
}

const AI_EVENT_KINDS = [
  'started',
  'message_user',
  'draft_pending',
  'approved',
  'edited',
  'auto_sent',
  'rejected',
  'escalated',
  'lead_captured',
  'viewing_booked',
  'abandoned',
] as const;

type EventKind = (typeof AI_EVENT_KINDS)[number];

interface EventRow {
  org_id: string;
  agent_id: string | null;
  channel: 'web_chat' | 'email' | 'whatsapp' | 'voice';
  kind: EventKind;
  conversation_id: string;
}

interface AggregateRow {
  conversations: Set<string>; // distinct conversation IDs touched
  user_messages: number;
  drafts_pending: number;
  drafts_approved: number;
  drafts_edited: number;
  drafts_auto_sent: number;
  drafts_rejected: number;
  escalations: number;
  leads_captured: number;
  viewings_booked: number;
  channel_counts: Record<string, number>;
}

function emptyAgg(): AggregateRow {
  return {
    conversations: new Set<string>(),
    user_messages: 0,
    drafts_pending: 0,
    drafts_approved: 0,
    drafts_edited: 0,
    drafts_auto_sent: 0,
    drafts_rejected: 0,
    escalations: 0,
    leads_captured: 0,
    viewings_booked: 0,
    channel_counts: {},
  };
}

function bumpAgg(agg: AggregateRow, evt: EventRow) {
  agg.conversations.add(evt.conversation_id);
  agg.channel_counts[evt.channel] = (agg.channel_counts[evt.channel] ?? 0) + 1;
  switch (evt.kind) {
    case 'message_user':
      agg.user_messages++;
      break;
    case 'draft_pending':
      agg.drafts_pending++;
      break;
    case 'approved':
      agg.drafts_approved++;
      break;
    case 'edited':
      agg.drafts_edited++;
      break;
    case 'auto_sent':
      agg.drafts_auto_sent++;
      break;
    case 'rejected':
      agg.drafts_rejected++;
      break;
    case 'escalated':
      agg.escalations++;
      break;
    case 'lead_captured':
      agg.leads_captured++;
      break;
    case 'viewing_booked':
      agg.viewings_booked++;
      break;
    default:
      // 'started' / 'abandoned' don't contribute to any specific
      // counter, but they DO contribute to `conversations` via the
      // shared set add at the top of this function.
      break;
  }
}

async function handle(req: NextRequest): Promise<NextResponse<RollupSummary>> {
  const env = serverEnv();
  const auth = checkCronAuth({
    authorizationHeader: req.headers.get('authorization'),
    expectedSecret: env.CRON_SECRET,
  });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, errorCode: auth.errorCode },
      { status: auth.status },
    );
  }

  // Day to roll up — defaults to YESTERDAY in UTC. `?day=YYYY-MM-DD`
  // lets the operator back-fill a missed day manually.
  const url = new URL(req.url);
  const dayParam = url.searchParams.get('day');
  let day: Date;
  if (dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
    day = new Date(`${dayParam}T00:00:00.000Z`);
  } else {
    day = new Date();
    day.setUTCDate(day.getUTCDate() - 1);
    day.setUTCHours(0, 0, 0, 0);
  }
  const dayIso = day.toISOString().slice(0, 10);
  const nextDay = new Date(day);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const admin = createAdminClient();

  // Pull all events in the [day, day+1) window. Page through if the
  // count exceeds the default 1000-row limit.
  const allRows: EventRow[] = [];
  let pageFrom = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin
      .from('ai_conversation_events')
      .select('org_id, agent_id, channel, kind, conversation_id')
      .gte('created_at', day.toISOString())
      .lt('created_at', nextDay.toISOString())
      .range(pageFrom, pageFrom + pageSize - 1);
    if (error) {
      console.error('[ai-daily-rollup] event fetch error', {
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { ok: false, errorCode: 'event_fetch_failed', errorMessage: error.message },
        { status: 500 },
      );
    }
    if (!data || data.length === 0) break;
    allRows.push(...(data as unknown as EventRow[]));
    if (data.length < pageSize) break;
    pageFrom += pageSize;
  }

  if (allRows.length === 0) {
    return NextResponse.json({ ok: true, dayProcessed: dayIso, rowsWritten: 0 });
  }

  // Aggregate keyed by (org_id, agent_id). agent_id NULL is reserved
  // for the org-level rollup row — we DOUBLE-INSERT each event into
  // both the per-agent bucket AND the org-level bucket so the
  // dashboard can query either with a single indexed scan.
  const perAgent = new Map<string, AggregateRow>(); // key: `${org_id}::${agent_id}`
  const perOrg = new Map<string, AggregateRow>(); // key: `${org_id}`
  for (const evt of allRows) {
    const perAgentKey = `${evt.org_id}::${evt.agent_id ?? 'null'}`;
    const perOrgKey = evt.org_id;
    if (!perAgent.has(perAgentKey)) perAgent.set(perAgentKey, emptyAgg());
    if (!perOrg.has(perOrgKey)) perOrg.set(perOrgKey, emptyAgg());
    bumpAgg(perAgent.get(perAgentKey)!, evt);
    bumpAgg(perOrg.get(perOrgKey)!, evt);
  }

  // Build the UPSERT payloads.
  const upsertRows: Array<Record<string, unknown>> = [];
  for (const [key, agg] of perAgent.entries()) {
    const [org_id, agent_id_raw] = key.split('::');
    const agent_id = agent_id_raw === 'null' ? null : agent_id_raw;
    upsertRows.push({
      org_id,
      agent_id,
      day: dayIso,
      conversations: agg.conversations.size,
      user_messages: agg.user_messages,
      drafts_pending: agg.drafts_pending,
      drafts_approved: agg.drafts_approved,
      drafts_edited: agg.drafts_edited,
      drafts_auto_sent: agg.drafts_auto_sent,
      drafts_rejected: agg.drafts_rejected,
      escalations: agg.escalations,
      leads_captured: agg.leads_captured,
      viewings_booked: agg.viewings_booked,
      channel_counts: agg.channel_counts,
      intent_counts: {},
      risk_flag_counts: {},
    });
  }
  // Org-level rows (agent_id = NULL).
  for (const [org_id, agg] of perOrg.entries()) {
    upsertRows.push({
      org_id,
      agent_id: null,
      day: dayIso,
      conversations: agg.conversations.size,
      user_messages: agg.user_messages,
      drafts_pending: agg.drafts_pending,
      drafts_approved: agg.drafts_approved,
      drafts_edited: agg.drafts_edited,
      drafts_auto_sent: agg.drafts_auto_sent,
      drafts_rejected: agg.drafts_rejected,
      escalations: agg.escalations,
      leads_captured: agg.leads_captured,
      viewings_booked: agg.viewings_booked,
      channel_counts: agg.channel_counts,
      intent_counts: {},
      risk_flag_counts: {},
    });
  }

  // Upsert per the unique index (org_id, coalesce(agent_id, '0...'::uuid), day).
  // supabase-js doesn't expose the COALESCE-keyed unique constraint
  // by name, so we do a manual "delete-then-insert" for the day to
  // keep the operation idempotent without depending on conflict-target
  // syntax.
  const orgIds = Array.from(new Set(upsertRows.map((r) => r.org_id as string)));
  const { error: deleteErr } = await admin
    .from('ai_daily_stats')
    .delete()
    .in('org_id', orgIds)
    .eq('day', dayIso);
  if (deleteErr) {
    console.error('[ai-daily-rollup] pre-insert delete error', {
      code: deleteErr.code,
      message: deleteErr.message,
    });
    return NextResponse.json(
      { ok: false, errorCode: 'delete_failed', errorMessage: deleteErr.message },
      { status: 500 },
    );
  }
  const { error: insertErr } = await admin.from('ai_daily_stats').insert(upsertRows);
  if (insertErr) {
    console.error('[ai-daily-rollup] insert error', {
      code: insertErr.code,
      message: insertErr.message,
    });
    return NextResponse.json(
      { ok: false, errorCode: 'insert_failed', errorMessage: insertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    dayProcessed: dayIso,
    rowsWritten: upsertRows.length,
  });
}

export async function GET(req: NextRequest): Promise<NextResponse<RollupSummary>> {
  return handle(req);
}
