/**
 * AHO — AI cost alert cron worker.
 *
 * Thin proxy. Cloudflare schedules this Worker via the cron trigger
 * in wrangler.toml; the scheduled handler fetches the Pages app's
 * `/api/cron/ai-cost-alert` route with the shared `CRON_SECRET`
 * bearer token. The Pages route does the actual work (sum
 * yesterday's ai_generation_log + threshold check + send email).
 *
 * Quiet-by-default: only emails when one of the thresholds is
 * crossed; otherwise scheduled() returns silently.
 *
 * Manual trigger: `GET /run?secret=<CRON_SECRET>` for post-deploy
 * smoke + dry-run testing.
 */

interface Env {
  CRON_SECRET: string;
  AHO_PAGES_URL: string;
  LOG_LEVEL: string;
}

interface AlertSummary {
  ok: boolean;
  alerted?: boolean;
  date?: string;
  totalCostUsd?: number;
  totalAudits?: number;
  totalCalls?: number;
  avgPerAuditUsd?: number;
  errorCode?: string;
  errorMessage?: string;
  status?: number;
  details?: unknown;
}

async function runAlert(env: Env): Promise<AlertSummary> {
  if (!env.CRON_SECRET) {
    return { ok: false, errorCode: 'cron_secret_unconfigured' };
  }
  if (!env.AHO_PAGES_URL) {
    return { ok: false, errorCode: 'pages_url_unconfigured' };
  }
  const url = new URL('/api/cron/ai-cost-alert', env.AHO_PAGES_URL).toString();
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
  return body as AlertSummary;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runAlert(env).then((result) => {
        const { ok, alerted, date, totalCostUsd, totalAudits, errorCode } = result;
        console.log(
          `[aho-ai-cost-alert] ok=${ok} date=${date ?? '-'} alerted=${alerted ?? '-'} usd=${totalCostUsd ?? '-'} audits=${totalAudits ?? '-'}${
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
      const result = await runAlert(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      'aho-ai-cost-alert — runs at 05:00 UTC daily. Manual: GET /run?secret=...',
      { status: 200 },
    );
  },
};
