/**
 * AHO — Instagram drift cron worker.
 *
 * Thin proxy. Cloudflare schedules this Worker via the cron trigger in
 * wrangler.toml; the scheduled handler fetches the Pages app's
 * `/api/cron/instagram-drift` route with the shared `CRON_SECRET`
 * bearer token. The Pages route does all the work (scan agents,
 * call Meta Graph /me/accounts, detect newly-linked IG, send email).
 *
 * Phase 3 of docs/INSTAGRAM_SHARING_PLAN.md.
 *
 * Manual trigger for testing: `GET /run?secret=<CRON_SECRET>` on the
 * Worker URL fires the scheduled logic and returns the Pages route's
 * JSON response inline (useful for `wrangler tail` + post-deploy
 * smoke without waiting for the cron clock).
 */

interface Env {
  CRON_SECRET: string;
  AHO_PAGES_URL: string;
  LOG_LEVEL: string;
}

interface DriftSummary {
  ok: boolean;
  scanned?: number;
  detected?: number;
  emailed?: number;
  skipped?: number;
  errorCode?: string;
  errorMessage?: string;
  status?: number;
  details?: unknown;
}

async function runDrift(env: Env): Promise<DriftSummary> {
  if (!env.CRON_SECRET) {
    return { ok: false, errorCode: 'cron_secret_unconfigured' };
  }
  if (!env.AHO_PAGES_URL) {
    return { ok: false, errorCode: 'pages_url_unconfigured' };
  }
  const url = new URL('/api/cron/instagram-drift', env.AHO_PAGES_URL).toString();
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
  return body as DriftSummary;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runDrift(env).then((result) => {
        const { ok, scanned, detected, emailed, skipped, errorCode } = result;
        console.log(
          `[aho-instagram-drift] ok=${ok} scanned=${scanned ?? '-'} detected=${detected ?? '-'} emailed=${emailed ?? '-'} skipped=${skipped ?? '-'}${
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
      const result = await runDrift(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      'aho-instagram-drift — runs at 04:30 UTC daily. Manual: GET /run?secret=...',
      { status: 200 },
    );
  },
};
