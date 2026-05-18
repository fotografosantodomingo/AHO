/**
 * AHO — AI conversion stack daily rollup worker.
 *
 * Phase 1 of docs/AI_CONVERSION_PLAN.md. Cloudflare schedules this
 * Worker via the cron trigger in wrangler.toml (02:00 UTC daily); the
 * scheduled handler fetches the Pages app's `/api/cron/ai-daily-rollup`
 * route with the shared CRON_SECRET bearer token. The Pages route
 * does the actual aggregate — keeping it there means Supabase + auth
 * lib aren't duplicated here.
 *
 * Why a proxy instead of doing the rollup directly:
 *   - Same trust boundary as the rest of the Pages app.
 *   - Cron triggers fire `scheduled()`, not HTTP routes; Pages
 *     Functions don't natively support cron triggers.
 *   - Mirrors the pattern in `workers/audit-prune/`.
 *
 * Manual trigger for testing or back-fill:
 *   `GET /run?secret=<CRON_SECRET>` runs yesterday's rollup
 *   `GET /run?secret=...&day=YYYY-MM-DD` back-fills a specific day
 */

interface Env {
  CRON_SECRET: string;
  AHO_PAGES_URL: string;
  LOG_LEVEL: string;
}

interface RollupSummary {
  ok: boolean;
  dayProcessed?: string;
  rowsWritten?: number;
  errorCode?: string;
  errorMessage?: string;
  status?: number;
  details?: unknown;
}

async function runRollup(env: Env, day?: string): Promise<RollupSummary> {
  if (!env.CRON_SECRET) {
    return { ok: false, errorCode: 'cron_secret_unconfigured' };
  }
  if (!env.AHO_PAGES_URL) {
    return { ok: false, errorCode: 'pages_url_unconfigured' };
  }
  const url = new URL('/api/cron/ai-daily-rollup', env.AHO_PAGES_URL);
  if (day) url.searchParams.set('day', day);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
  } catch (err) {
    return {
      ok: false,
      errorCode: 'fetch_failed',
      details: err instanceof Error ? err.message : String(err),
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, errorCode: 'non_json_response', status: res.status };
  }
  if (!res.ok) return { ok: false, status: res.status, details: body };
  return body as RollupSummary;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runRollup(env).then((result) => {
        const { ok, dayProcessed, rowsWritten, errorCode } = result;
        console.log(
          `[aho-ai-daily-rollup] ok=${ok} day=${dayProcessed ?? '-'} rows=${rowsWritten ?? '-'}${
            errorCode ? ` errorCode=${errorCode}` : ''
          }`,
        );
      }),
    );
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/run') {
      const supplied = url.searchParams.get('secret') ?? '';
      if (
        !env.CRON_SECRET ||
        supplied.length !== env.CRON_SECRET.length ||
        supplied !== env.CRON_SECRET
      ) {
        return new Response('unauthorized', { status: 401 });
      }
      const day = url.searchParams.get('day') ?? undefined;
      const result = await runRollup(env, day);
      return new Response(JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      'aho-ai-daily-rollup — runs at 02:00 UTC daily. Manual: GET /run?secret=...&day=YYYY-MM-DD',
      { status: 200 },
    );
  },
};
