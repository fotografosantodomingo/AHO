/**
 * AHO — Listing expiry cron worker.
 *
 * Thin proxy. Cloudflare schedules this Worker via the cron trigger in
 * wrangler.toml; the scheduled handler fetches the Pages app's
 * `/api/cron/listing-expiry` route with the shared `CRON_SECRET`
 * bearer token. The Pages route does the actual work — three passes
 * driving the $5 private-owner listing lifecycle:
 *
 *   1. Day-55 renewal reminders (expires in ≤5 days, not yet emailed)
 *   2. Day-60 expiry: flip `properties.status` active → expired + email
 *   3. Orphan nudges: paid but never published (5–60 days post-purchase)
 *
 * Track E of docs/SELL_FUNNEL_PLAN.md.
 *
 * Why a proxy instead of doing the work directly:
 *   - The Pages route already has Supabase + Brevo + the email
 *     templates wired up. Duplicating any of that here would mean
 *     two places to keep in sync.
 *   - Cron triggers fire `scheduled()`, not HTTP routes; Pages
 *     Functions don't natively support cron triggers. A standalone
 *     Worker is the documented Cloudflare path. Same shape as
 *     `workers/audit-prune/`, `workers/meta-token-refresh/`, and
 *     `workers/saved-search-alerts/`.
 *
 * Manual trigger for testing / post-deploy smoke:
 *   GET /run?secret=<CRON_SECRET>  on the Worker URL
 *
 * fires the same logic as the scheduled handler and returns the Pages
 * route's JSON response inline (so `wrangler tail` shows the per-pass
 * counts).
 */

interface Env {
  CRON_SECRET: string;
  AHO_PAGES_URL: string;
  LOG_LEVEL: string;
}

interface ExpirySummary {
  ok: boolean;
  processed?: {
    reminded: number;
    expired: number;
    orphans: number;
  };
  errors?: {
    reminded: number;
    expired: number;
    orphans: number;
  };
  errorCode?: string;
  errorMessage?: string;
  status?: number;
  details?: unknown;
}

async function runExpiry(env: Env): Promise<ExpirySummary> {
  if (!env.CRON_SECRET) {
    return { ok: false, errorCode: 'cron_secret_unconfigured' };
  }
  if (!env.AHO_PAGES_URL) {
    return { ok: false, errorCode: 'pages_url_unconfigured' };
  }
  const url = new URL('/api/cron/listing-expiry', env.AHO_PAGES_URL).toString();
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
  return body as ExpirySummary;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runExpiry(env).then((result) => {
        const { ok, processed, errors, errorCode } = result;
        // Use console.error so `wrangler pages deployment tail` surfaces
        // this line reliably (CLAUDE.md: console.log is unreliable in
        // pretty-format tail output; console.error is the safe choice
        // for in-Edge instrumentation).
        console.error(
          `[aho-listing-expiry] ok=${ok}` +
            ` reminded=${processed?.reminded ?? '-'}` +
            ` expired=${processed?.expired ?? '-'}` +
            ` orphans=${processed?.orphans ?? '-'}` +
            ` errReminded=${errors?.reminded ?? '-'}` +
            ` errExpired=${errors?.expired ?? '-'}` +
            ` errOrphans=${errors?.orphans ?? '-'}` +
            (errorCode ? ` errorCode=${errorCode}` : ''),
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
      const result = await runExpiry(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      'aho-listing-expiry — runs at 04:00 UTC daily. Manual: GET /run?secret=...',
      { status: 200 },
    );
  },
};
