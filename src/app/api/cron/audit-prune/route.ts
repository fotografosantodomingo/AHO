import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { checkCronAuth } from '@/app/api/cron/meta-insights/route';

export const runtime = 'edge';

/**
 * GET /api/cron/audit-prune
 *
 * Phase 5.5 follow-on — periodic cleanup of unclaimed Free Audit rows
 * whose `expires_at` has passed. Per the 0059 migration the table has
 * a 7-day TTL via `expires_at default now() + interval '7 days'`;
 * actual pruning needed an explicit job.
 *
 * Targeting policy:
 *   - expires_at < now()
 *   - claimed_by_user_id IS NULL
 *     (claimed audits survive — they belong to a real user and the
 *      preview URL keeps working past the TTL)
 *
 * Side effect on ai_generation_log: the FK there is ON DELETE SET NULL,
 * so cost history is preserved for unit-economics — only the audit_id
 * link gets nulled when its audit row goes away. No cascading delete.
 *
 * Auth: bearer token via the shared `checkCronAuth` helper; matched
 * against `CRON_SECRET` server env. External scheduler hits this with
 * `Authorization: Bearer ${CRON_SECRET}` (the standalone Worker in
 * `workers/audit-prune/` is the prod scheduler).
 *
 * Output: JSON summary. `deleted` is the count of rows the prune
 * actually removed; useful for the cron operator + future
 * "audit table is growing too fast" alerting.
 */

interface PruneSummary {
  ok: boolean;
  deleted?: number;
  errorCode?: string;
  errorMessage?: string;
}

async function handle(req: NextRequest): Promise<NextResponse<PruneSummary>> {
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

  const admin = createAdminClient();
  // Delete unclaimed audits past TTL. Use .select() to get the rows
  // affected so the response can report a count — postgrest-js DELETE
  // returns the deleted rows when chained with `.select()`.
  const { data, error } = await admin
    .from('ai_audits')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .is('claimed_by_user_id', null)
    .select('id');

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'db_error',
        errorMessage: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    deleted: data?.length ?? 0,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
