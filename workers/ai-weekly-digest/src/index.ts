/**
 * AHO — AI weekly digest worker.
 *
 * Phase 4 of `docs/AI_CONVERSION_PLAN.md`. Cloudflare schedules this
 * Worker via the cron trigger in `wrangler.toml` (Mondays 09:00 UTC).
 * The scheduled handler fetches the Pages app's
 * `/api/cron/ai-weekly-digest` route with the shared CRON_SECRET
 * bearer token; the Pages route does the actual digest build + Brevo
 * sends.
 *
 * Same proxy pattern as `workers/ai-daily-rollup/` — kept thin so the
 * Supabase + Brevo + i18n machinery stays in the Pages app where the
 * rest of the team's tooling lives.
 *
 * Manual trigger for testing:
 *   `GET /run?secret=<CRON_SECRET>` runs the digest for the past 7 days.
 *   `GET /run?secret=...&dryRun=1` computes the per-org payloads
 *   WITHOUT sending — returns the recipient + subject for inspection.
 *
 * The "Mondays 09:00 UTC" timing is intentionally a v1 simplification:
 * 09:00 UTC is 11:00 Madrid (close enough), 10:00 London, 04:00 ET.
 * A "real per-timezone" version is v2 (see plan §6).
 */

interface Env {
  CRON_SECRET: string;
  AHO_PAGES_URL: string;
  LOG_LEVEL: string;
}

interface DigestSummary {
  ok: boolean;
  orgsConsidered?: number;
  emailsSent?: number;
  emailsSkippedZero?: number;
  emailsFailed?: number;
  errorCode?: string;
  errorMessage?: string;
  status?: number;
  details?: unknown;
}

async function runDigest(env: Env, dryRun?: boolean): Promise<DigestSummary> {
  if (!env.CRON_SECRET) {
    return { ok: false, errorCode: 'cron_secret_unconfigured' };
  }
  if (!env.AHO_PAGES_URL) {
    return { ok: false, errorCode: 'pages_url_unconfigured' };
  }
  const url = new URL('/api/cron/ai-weekly-digest', env.AHO_PAGES_URL);
  if (dryRun) url.searchParams.set('dryRun', '1');
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
  return body as DigestSummary;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runDigest(env).then((result) => {
        const {
          ok,
          orgsConsidered,
          emailsSent,
          emailsSkippedZero,
          emailsFailed,
          errorCode,
        } = result;
        console.log(
          `[aho-ai-weekly-digest] ok=${ok} considered=${orgsConsidered ?? '-'} sent=${emailsSent ?? '-'} skippedZero=${emailsSkippedZero ?? '-'} failed=${emailsFailed ?? '-'}${
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
      const dryRun = url.searchParams.get('dryRun') === '1';
      const result = await runDigest(env, dryRun);
      return new Response(JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      'aho-ai-weekly-digest — runs Mondays 09:00 UTC. Manual: GET /run?secret=...&dryRun=1',
      { status: 200 },
    );
  },
};
