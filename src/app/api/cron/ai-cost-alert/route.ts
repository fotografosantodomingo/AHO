import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { checkCronAuth } from '@/app/api/cron/meta-insights/route';
import { sendEmail } from '@/lib/email/brevo';
import { renderAiCostAlertEmail } from '@/lib/email/templates/ai-cost-alert';

export const runtime = 'edge';

/**
 * GET /api/cron/ai-cost-alert
 *
 * Daily AI cost alerting — Phase 5.5 final piece. Reads yesterday's
 * `ai_generation_log` rows, computes total spend + audits + avg per
 * audit, and emails the operator when either of two thresholds is
 * crossed:
 *
 *   - DAILY_TOTAL_CENTS_THRESHOLD ($50) — total daily spend across
 *     all Anthropic calls (import + drafter + listing_draft)
 *   - PER_AUDIT_CENTS_THRESHOLD ($1)    — avg cost per audit; only
 *     evaluated when totalAudits > 0
 *
 * If neither is crossed, the route returns 200 with `alerted: false`
 * and sends no email — quiet days stay quiet.
 *
 * Auth: bearer token via the shared checkCronAuth helper.
 *
 * Idempotency: NONE explicitly. Cron is daily; a single-day double-
 * fire would send two emails, which is annoying but not destructive.
 * If we later need multi-trigger-per-day cadence, swap to a
 * notifications table.
 */

const DAILY_TOTAL_CENTS_THRESHOLD = 5000; // $50
const PER_AUDIT_CENTS_THRESHOLD = 100; //   $1
// Hardcoded to the operator inbox for v1. Could become an env var
// `AHO_COST_ALERT_RECIPIENT` when ops scales beyond one person.
const RECIPIENT = 'info@advertisehomes.online';

interface AlertSummary {
  ok: boolean;
  alerted?: boolean;
  date?: string;
  totalCostUsd?: number;
  totalAudits?: number;
  totalCalls?: number;
  avgPerAuditUsd?: number;
  triggered?: Array<{ kind: 'daily_total' | 'per_audit'; threshold: number; actual: number }>;
  emailId?: string;
  errorCode?: string;
  errorMessage?: string;
}

async function handle(req: NextRequest): Promise<NextResponse<AlertSummary>> {
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

  // "Yesterday" defined in UTC since the cron itself runs in UTC.
  // Window: [yesterday 00:00 UTC, today 00:00 UTC).
  const now = new Date();
  const todayMidnightUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const yesterdayMidnightUtc = new Date(
    todayMidnightUtc.getTime() - 86_400_000,
  );
  const dateLabel = yesterdayMidnightUtc.toISOString().slice(0, 10);

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from('ai_generation_log')
    .select('audit_id, estimated_cost_usd_cents, created_at')
    .gte('created_at', yesterdayMidnightUtc.toISOString())
    .lt('created_at', todayMidnightUtc.toISOString());

  if (error) {
    return NextResponse.json(
      { ok: false, errorCode: 'db_error', errorMessage: error.message },
      { status: 500 },
    );
  }

  let totalCents = 0;
  const auditIds = new Set<string>();
  for (const r of rows ?? []) {
    totalCents += (r.estimated_cost_usd_cents as number) ?? 0;
    if (r.audit_id) auditIds.add(r.audit_id as string);
  }
  const totalAudits = auditIds.size;
  const totalCalls = rows?.length ?? 0;
  const avgPerAuditCents =
    totalAudits > 0 ? Math.round(totalCents / totalAudits) : 0;

  const triggered: NonNullable<AlertSummary['triggered']> = [];
  if (totalCents > DAILY_TOTAL_CENTS_THRESHOLD) {
    triggered.push({
      kind: 'daily_total',
      threshold: DAILY_TOTAL_CENTS_THRESHOLD / 100,
      actual: totalCents / 100,
    });
  }
  if (totalAudits > 0 && avgPerAuditCents > PER_AUDIT_CENTS_THRESHOLD) {
    triggered.push({
      kind: 'per_audit',
      threshold: PER_AUDIT_CENTS_THRESHOLD / 100,
      actual: avgPerAuditCents / 100,
    });
  }

  if (triggered.length === 0) {
    return NextResponse.json({
      ok: true,
      alerted: false,
      date: dateLabel,
      totalCostUsd: totalCents / 100,
      totalAudits,
      totalCalls,
      avgPerAuditUsd: avgPerAuditCents / 100,
    });
  }

  const rendered = renderAiCostAlertEmail({
    date: dateLabel,
    totalCostUsd: totalCents / 100,
    totalAudits,
    totalCalls,
    avgPerAuditUsd: avgPerAuditCents / 100,
    triggeredThresholds: triggered,
    dashboardUrl: 'https://advertisehomes.online/en/admin/audit-costs',
  });
  const result = await sendEmail({
    to: RECIPIENT,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  return NextResponse.json({
    ok: result.sent,
    alerted: true,
    date: dateLabel,
    totalCostUsd: totalCents / 100,
    totalAudits,
    totalCalls,
    avgPerAuditUsd: avgPerAuditCents / 100,
    triggered,
    emailId: result.id,
    errorMessage: result.error,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
