import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { importOne } from '@/lib/listings/photo-import-pipeline';

export const runtime = 'edge';

/**
 * POST /api/cron/photo-import-retry
 *
 * Hourly sweeper for the `photo_import_failures` dead-letter table.
 * The user-facing import endpoint already retries each URL up to 3
 * times in a single call before giving up and writing a dead-letter
 * row (migration 0037). That covers in-call CDN blips, but not the
 * "503 at 14:00 / clear at 14:30" pattern — forcing the agent to
 * manually retry every transient failure is bad UX.
 *
 * This cron walks the unresolved rows and re-attempts. It's bounded:
 *
 *   - Picks at most BATCH_SIZE rows per invocation (oldest first by
 *     last_failed_at), to fit inside the Edge wall-time budget.
 *   - Skips rows with attempts >= MAX_ATTEMPTS — those have hit the
 *     give-up threshold and stay surfaced in the agent UI for a
 *     human to look at. We deliberately don't add a `gave_up_at`
 *     column: the existing `attempts` counter is enough; once a row
 *     hits MAX_ATTEMPTS it falls out of the work queue but stays in
 *     the table for audit and for the agent's "needs attention" UI.
 *   - Skips rows whose last_failed_at is too recent (COOLDOWN_MIN)
 *     so back-to-back cron ticks don't double-hammer a CDN.
 *
 * Auth: bearer token via CRON_SECRET. Both GET and POST accept the
 * same gate so an external scheduler can use either verb. Missing or
 * mismatched secret yields 401 with no body details.
 *
 * Schedule recommendation: hourly (`0 * * * *`). Cloudflare Pages
 * Functions don't support native cron triggers, so the canonical
 * scheduler is either:
 *   (a) a tiny dedicated Worker with `[triggers] crons = ["0 * * * *"]`
 *       that fetches this URL with the bearer; or
 *   (b) a GitHub Actions workflow on a `schedule:` trigger curling the
 *       URL with the bearer from a repo secret.
 * Either lets the cron live alongside the app code without standing
 * up paid Workers infra.
 */

/**
 * Max work per invocation. ~50 rows × <3s per row (most fail quickly
 * on the same error code) keeps us well inside the Edge function's
 * ~30s wall time even on a slow batch.
 */
const BATCH_SIZE = 50;

/**
 * Give-up threshold. A row that has failed 5 times — counting the
 * 1 from the original POST plus up to 4 cron retries — stops being
 * picked up by the cron. The agent still sees it in the UI and can
 * manually re-trigger via the existing failures route. Picked over
 * a separate `gave_up_at` column because the `attempts` counter is
 * already monotonically non-decreasing (record_photo_import_failure
 * increments on conflict) so the threshold is naturally idempotent.
 */
const MAX_ATTEMPTS = 5;

/**
 * How long after a failure we leave the row alone before re-trying.
 * 15 minutes is short enough that an hourly cron retries 3-4× per
 * day (matches the "503 at 14:00, clear at 14:30" use case) and long
 * enough that two cron ticks landing close together don't both hit
 * the same row.
 */
const COOLDOWN_MINUTES = 15;

/**
 * One row of the dead-letter table as fetched by this cron. Mirrors
 * what we SELECT below — kept narrow on purpose so the unit-test
 * planner can be exercised with plain literals.
 */
export interface FailureRow {
  id: string;
  property_id: string;
  source_url: string;
  attempts: number;
  last_failed_at: string;
}

/**
 * Property-context lookup. The cron needs alt-text bases + the org_id
 * for logging; both come from the same `properties` SELECT the user
 * route does.
 */
export interface PropertyContext {
  id: string;
  org_id: string;
  title_en: string | null;
  title_es: string | null;
  city: string | null;
}

export type RetryAction =
  /** Row is over the threshold — leave it for the agent. */
  | { kind: 'skip_gave_up'; rowId: string }
  /** Row's cooldown hasn't elapsed yet — try again next tick. */
  | { kind: 'skip_cooldown'; rowId: string }
  /** Try again now. */
  | { kind: 'retry'; rowId: string; propertyId: string; sourceUrl: string };

/**
 * Pure planner for the cron loop. Given a fixture batch of failure
 * rows + the current time + the configured thresholds, decide what
 * to do with each one. Extracted so the unit test can pin the
 * decision matrix without spinning up Supabase or fetch.
 */
export function planRetryActions(args: {
  rows: ReadonlyArray<FailureRow>;
  now: Date;
  maxAttempts: number;
  cooldownMs: number;
}): RetryAction[] {
  const cutoff = args.now.getTime() - args.cooldownMs;
  return args.rows.map((row) => {
    if (row.attempts >= args.maxAttempts) {
      return { kind: 'skip_gave_up', rowId: row.id };
    }
    const lastFailedAt = Date.parse(row.last_failed_at);
    if (Number.isFinite(lastFailedAt) && lastFailedAt > cutoff) {
      return { kind: 'skip_cooldown', rowId: row.id };
    }
    return {
      kind: 'retry',
      rowId: row.id,
      propertyId: row.property_id,
      sourceUrl: row.source_url,
    };
  });
}

interface CronSummary {
  processed: number;
  resolved: number;
  failed: number;
  gave_up: number;
}

/**
 * Bearer-token gate. Returns null on success, a NextResponse on
 * failure. Pulled out so both GET and POST share the exact same
 * check and error shape.
 */
function authorize(req: NextRequest): NextResponse | null {
  const expected = serverEnv().CRON_SECRET;
  if (!expected) {
    // Misconfiguration — fail closed. Better to 401 the scheduler
    // and notice in logs than to silently let unauthenticated calls
    // through during a partial deploy.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match || match[1] !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

async function runSweep(): Promise<CronSummary> {
  const env = serverEnv();
  if (!env.R2_BUCKET_PROPERTY_IMAGES) {
    // Same short-circuit as the user route — without R2 we can't do
    // anything useful. Return zeros rather than 500: the scheduler
    // doesn't need to alert on this.
    return { processed: 0, resolved: 0, failed: 0, gave_up: 0 };
  }
  const supabase = createAdminClient();

  // Pick the oldest unresolved failures still under the give-up
  // threshold, with a cooldown filter. ORDER BY last_failed_at ASC so
  // long-suffering rows get the first slot in the budget.
  const cooldownMs = COOLDOWN_MINUTES * 60_000;
  const cooldownCutoff = new Date(Date.now() - cooldownMs).toISOString();
  const { data: rowsRaw, error: selErr } = await supabase
    .from('photo_import_failures')
    .select('id, property_id, source_url, attempts, last_failed_at')
    .is('resolved_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .lt('last_failed_at', cooldownCutoff)
    .order('last_failed_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (selErr) {
    console.warn(`[cron/photo-import-retry] select failed: ${selErr.message}`);
    throw new Error('select_failed');
  }
  const rows = (rowsRaw ?? []) as FailureRow[];

  // Plan locally with the pure helper. The cooldown check above is
  // partially redundant with the SELECT filter, but the SELECT can
  // race with a concurrent failure-recording call that bumps
  // last_failed_at; planning again at decision time keeps us safe.
  const actions = planRetryActions({
    rows,
    now: new Date(),
    maxAttempts: MAX_ATTEMPTS,
    cooldownMs,
  });

  const summary: CronSummary = { processed: 0, resolved: 0, failed: 0, gave_up: 0 };

  for (const action of actions) {
    if (action.kind === 'skip_gave_up') {
      summary.gave_up += 1;
      continue;
    }
    if (action.kind === 'skip_cooldown') {
      // Rows that snuck in via the race above; don't count them as
      // processed because we deliberately did nothing.
      continue;
    }
    summary.processed += 1;

    // Property context — needed for alt-text + position math. RLS is
    // off (service-role) so this just works.
    const { data: prop, error: propErr } = await supabase
      .from('properties')
      .select('id, org_id, title_en, title_es, city')
      .eq('id', action.propertyId)
      .maybeSingle();
    if (propErr || !prop) {
      console.warn(
        `[cron/photo-import-retry] property lookup failed for ${action.propertyId}: ${propErr?.message ?? 'not found'}`,
      );
      // Bump attempts so we don't loop on a deleted property forever.
      const { error: bumpErr } = await supabase.rpc('record_photo_import_failure', {
        p_property_id: action.propertyId,
        p_source_url: action.sourceUrl,
        p_error_code: 'property_lookup_failed',
        p_attempts: 1,
      });
      if (bumpErr) {
        console.warn('[cron/photo-import-retry] attempt-bump RPC failed', {
          propertyId: action.propertyId,
          code: bumpErr.code,
          message: bumpErr.message,
        });
      }
      summary.failed += 1;
      continue;
    }
    const propTyped = prop as PropertyContext;

    const { count, error: countErr } = await supabase
      .from('property_images')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', action.propertyId);
    if (countErr) {
      console.warn(
        `[cron/photo-import-retry] count failed for ${action.propertyId}: ${countErr.message}`,
      );
      summary.failed += 1;
      continue;
    }
    const startCount = count ?? 0;
    const altBaseEn =
      propTyped.title_en ?? propTyped.title_es ?? `Listing in ${propTyped.city ?? ''}`.trim();
    const altBaseEs =
      propTyped.title_es ?? propTyped.title_en ?? `Inmueble en ${propTyped.city ?? ''}`.trim();

    const result = await importOne(
      { supabase, r2Bucket: env.R2_BUCKET_PROPERTY_IMAGES },
      {
        url: action.sourceUrl,
        propertyId: action.propertyId,
        position: startCount,
        altTextEn: `${altBaseEn} — ${startCount + 1}`,
        altTextEs: `${altBaseEs} — ${startCount + 1}`,
        uploadedVia: 'import-photos-cron',
        // The pipeline calls resolve_photo_import_failure on success;
        // that's exactly what we want here.
        resolveOnSuccess: true,
      },
    );

    if (result.ok) {
      summary.resolved += 1;
      continue;
    }

    // Failure path: bump attempts + refresh last_failed_at so the
    // 15-minute cooldown applies to the next tick. We pass
    // p_attempts: 1 because the SQL helper adds it to the existing
    // counter; passing the whole `result.attempts` would over-count
    // the in-call retries against the give-up threshold.
    summary.failed += 1;
    const { error: rpcErr } = await supabase.rpc('record_photo_import_failure', {
      p_property_id: action.propertyId,
      p_source_url: action.sourceUrl,
      p_error_code: result.errorCode ?? 'unknown',
      p_attempts: 1,
    });
    if (rpcErr) {
      console.warn(
        `[cron/photo-import-retry] record_photo_import_failure failed for ${action.sourceUrl}: ${rpcErr.message}`,
      );
    }
  }

  return summary;
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  try {
    const summary = await runSweep();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Some schedulers (notably GitHub Actions running curl without
// -X POST) default to GET. Accepting both with the same auth gate
// removes that footgun.
export async function GET(req: NextRequest) {
  return POST(req);
}
