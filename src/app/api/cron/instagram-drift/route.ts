import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { checkCronAuth } from '@/app/api/cron/meta-insights/route';
import { META_GRAPH_BASE } from '@/lib/oauth/meta';
import { sendEmail } from '@/lib/email/brevo';
import { renderInstagramNewlyLinkedEmail } from '@/lib/email/templates/instagram-newly-linked';

export const runtime = 'edge';

/**
 * GET /api/cron/instagram-drift
 *
 * Phase 3 of `docs/INSTAGRAM_SHARING_PLAN.md` — daily friction
 * remover. The most common reason an agent's Instagram doesn't
 * publish is that they linked IG Business to their FB Page in
 * Meta Business Suite AFTER their last AHO OAuth grant, so the
 * `ig:{id}` row never landed in `ad_platform_tokens` even though
 * Meta itself now sees the link.
 *
 * This job iterates agents with Meta user-level tokens, fetches
 * `/me/accounts` from Meta Graph with their token, detects FB
 * Pages that report an `instagram_business_account` but DON'T have
 * a corresponding `ig:{ig_id}` token row, and emails the agent
 * once per (user, ig_id) prompting them to click "Reconnect" on
 * the AHO Social dashboard.
 *
 * Idempotency: `meta_drift_notifications` table records each
 * (user_id, ig_id) pair we've notified. UNIQUE constraint prevents
 * the same notification twice. Re-notifications after the agent
 * disconnects + re-links require a manual DELETE from the table —
 * intentional friction so we don't spam.
 *
 * Auth: bearer token via the shared checkCronAuth helper.
 *
 * Output: per-user JSON summary in a `summaries` array, plus
 * top-line counts: scanned (users) / detected (drift events) /
 * emailed (new notifications sent) / skipped (already notified).
 */

interface UserTokenRow {
  user_id: string;
  external_account_id: string;
  display_name: string | null;
}

interface MetaPageWithIg {
  id: string;
  name?: string;
  instagram_business_account?: { id: string; username?: string; name?: string };
}

interface DriftSummary {
  user_id: string;
  user_email: string | null;
  detected: number;
  emailed: number;
  skipped: number;
  errors: string[];
}

interface CronSummary {
  ok: boolean;
  scanned?: number;
  detected?: number;
  emailed?: number;
  skipped?: number;
  errorCode?: string;
  errorMessage?: string;
  summaries?: DriftSummary[];
}

async function handle(req: NextRequest): Promise<NextResponse<CronSummary>> {
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
  if (!env.AHO_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json(
      { ok: false, errorCode: 'token_key_not_configured' },
      { status: 503 },
    );
  }

  const admin = createAdminClient();

  // Load every Meta user-level token row (not page:, not ig:).
  // These are the agents whose accounts we can call /me/accounts on.
  const { data: tokenRows, error: tokenErr } = await admin
    .from('ad_platform_tokens')
    .select('user_id, external_account_id, display_name')
    .eq('platform', 'meta')
    .is('revoked_at', null);
  if (tokenErr) {
    return NextResponse.json(
      { ok: false, errorCode: 'db_error', errorMessage: tokenErr.message },
      { status: 500 },
    );
  }
  const userLevel: UserTokenRow[] = (tokenRows ?? []).filter(
    (r) =>
      !(r.external_account_id as string)?.startsWith('page:') &&
      !(r.external_account_id as string)?.startsWith('ig:'),
  ) as UserTokenRow[];

  const summaries: DriftSummary[] = [];
  let totalDetected = 0;
  let totalEmailed = 0;
  let totalSkipped = 0;

  for (const row of userLevel) {
    const summary: DriftSummary = {
      user_id: row.user_id,
      user_email: null,
      detected: 0,
      emailed: 0,
      skipped: 0,
      errors: [],
    };

    // Decrypt the user-level token to call /me/accounts. Reuse the
    // same RPC the publish + test-connection paths use.
    const { data: tokenPlain, error: dErr } = await admin.rpc(
      'get_decrypted_access_token',
      {
        p_user_id: row.user_id,
        p_platform: 'meta',
        p_external_account_id: row.external_account_id,
        p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
      },
    );
    if (dErr || !tokenPlain) {
      summary.errors.push(`decrypt: ${dErr?.message ?? 'null'}`);
      summaries.push(summary);
      continue;
    }

    // Pull pages + linked IG accounts from Meta.
    let pages: MetaPageWithIg[];
    try {
      const url = new URL(`${META_GRAPH_BASE}/me/accounts`);
      url.searchParams.set(
        'fields',
        'id,name,instagram_business_account{id,username,name}',
      );
      url.searchParams.set('access_token', tokenPlain as string);
      const res = await fetch(url.toString());
      if (!res.ok) {
        summary.errors.push(`graph: HTTP ${res.status}`);
        summaries.push(summary);
        continue;
      }
      const body = (await res.json()) as { data?: MetaPageWithIg[] };
      pages = body.data ?? [];
    } catch (e) {
      summary.errors.push(
        `graph fetch: ${e instanceof Error ? e.message : String(e)}`,
      );
      summaries.push(summary);
      continue;
    }

    // Detect newly-linked IG accounts: Pages with
    // instagram_business_account in the response but no matching
    // ig:{id} row in ad_platform_tokens for this user.
    const linkedIg = pages
      .filter((p) => !!p.instagram_business_account?.id)
      .map((p) => ({
        igId: p.instagram_business_account!.id,
        igUsername: p.instagram_business_account?.username ?? null,
        pageName: p.name ?? null,
      }));
    if (linkedIg.length === 0) {
      summaries.push(summary);
      continue;
    }

    const { data: existingIg } = await admin
      .from('ad_platform_tokens')
      .select('external_account_id')
      .eq('user_id', row.user_id)
      .eq('platform', 'meta')
      .is('revoked_at', null);
    const existingIgIds = new Set(
      (existingIg ?? [])
        .map((r) => r.external_account_id as string)
        .filter((id) => id?.startsWith('ig:'))
        .map((id) => id.slice('ig:'.length)),
    );
    const drifted = linkedIg.filter((ig) => !existingIgIds.has(ig.igId));
    summary.detected = drifted.length;
    totalDetected += drifted.length;
    if (drifted.length === 0) {
      summaries.push(summary);
      continue;
    }

    // Resolve the agent's email (RLS-free admin read) — for sending.
    const { data: userResult } = await admin.auth.admin.getUserById(row.user_id);
    const email = userResult.user?.email ?? null;
    summary.user_email = email;
    if (!email) {
      summary.errors.push('no_email');
      summaries.push(summary);
      continue;
    }
    const fullName =
      (userResult.user?.user_metadata?.full_name as string | undefined) ?? null;

    for (const ig of drifted) {
      // Idempotency check — UNIQUE constraint also protects against
      // race; we check first for the user-friendly "skipped" count.
      const { data: priorRow } = await admin
        .from('meta_drift_notifications')
        .select('id')
        .eq('user_id', row.user_id)
        .eq('ig_id', ig.igId)
        .maybeSingle();
      if (priorRow) {
        summary.skipped += 1;
        totalSkipped += 1;
        continue;
      }

      const reconnectUrl =
        'https://advertisehomes.online/en/dashboard/social';
      const rendered = renderInstagramNewlyLinkedEmail({
        agentName: fullName,
        igUsername: ig.igUsername,
        pageName: ig.pageName,
        reconnectUrl,
      });
      const result = await sendEmail({
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      if (!result.sent) {
        summary.errors.push(`send: ${result.error ?? 'unknown'}`);
        continue;
      }
      // Record notification so we don't email again.
      await admin.from('meta_drift_notifications').insert({
        user_id: row.user_id,
        ig_id: ig.igId,
        ig_username: ig.igUsername,
      });
      summary.emailed += 1;
      totalEmailed += 1;
    }

    summaries.push(summary);
  }

  return NextResponse.json({
    ok: true,
    scanned: userLevel.length,
    detected: totalDetected,
    emailed: totalEmailed,
    skipped: totalSkipped,
    summaries,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
