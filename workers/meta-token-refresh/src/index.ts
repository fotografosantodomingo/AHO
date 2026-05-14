/**
 * AHO — Meta token-refresh cron worker.
 *
 * Thin proxy. Cloudflare schedules this Worker via the cron trigger in
 * wrangler.toml; the scheduled handler fetches the Pages app's
 * `/api/cron/meta-token-refresh` route with the shared `CRON_SECRET`
 * bearer token. The Pages route does all the real work (read tokens,
 * decrypt, exchange, upsert) — keeping the heavy lifting in the
 * Pages app means Meta + Supabase libs aren't duplicated here.
 *
 * Phase G of docs/SOCIAL_AUTOMATION_PLAN.md.
 *
 * Why a proxy instead of doing the work directly:
 *   - The Pages route already exists, is tested, and ships in source
 *     control alongside `src/lib/oauth/meta.ts` + the SECURITY DEFINER
 *     decrypt RPCs. Duplicating it here would mean two places to keep
 *     in sync.
 *   - Cron triggers fire `scheduled()`, not HTTP routes; Pages
 *     Functions don't natively support cron triggers. A standalone
 *     Worker is the documented Cloudflare path. Same shape as
 *     `workers/saved-search-alerts/`.
 *
 * Manual trigger for testing: `GET /run?secret=<CRON_SECRET>` on the
 * Worker URL fires the same logic as the scheduled handler and returns
 * the Pages route's JSON response inline (useful for `wrangler tail` +
 * post-deploy smoke).
 */

interface Env {
  CRON_SECRET: string;
  AHO_PAGES_URL: string;
  LOG_LEVEL: string;
}

interface RefreshSummary {
  ok: boolean;
  scanned?: number;
  refreshed?: number;
  failed?: number;
  errorCode?: string;
  status?: number;
  details?: unknown;
}

async function runRefresh(env: Env): Promise<RefreshSummary> {
  if (!env.CRON_SECRET) {
    return { ok: false, errorCode: 'cron_secret_unconfigured' };
  }
  if (!env.AHO_PAGES_URL) {
    return { ok: false, errorCode: 'pages_url_unconfigured' };
  }
  const url = new URL(
    '/api/cron/meta-token-refresh',
    env.AHO_PAGES_URL,
  ).toString();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errorCode: 'fetch_failed', details: message };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      ok: false,
      errorCode: 'non_json_response',
      status: res.status,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      details: body,
    };
  }
  // Pass the Pages route's response through verbatim — it already has
  // the shape { ok, scanned, refreshed, failed, summaries }.
  return body as RefreshSummary;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runRefresh(env).then((result) => {
        const { ok, scanned, refreshed, failed, errorCode } = result;
        console.log(
          `[aho-meta-token-refresh] ok=${ok} scanned=${scanned ?? '-'} refreshed=${refreshed ?? '-'} failed=${failed ?? '-'}${
            errorCode ? ` errorCode=${errorCode}` : ''
          }`,
        );
      }),
    );
  },

  /**
   * Optional HTTP entrypoint for manual triggering during development +
   * post-deploy smoke tests. Gated on the same CRON_SECRET so only the
   * operator can invoke it.
   */
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
      const result = await runRefresh(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      'aho-meta-token-refresh — runs at 04:00 UTC daily. Manual: GET /run?secret=...',
      { status: 200 },
    );
  },
};
