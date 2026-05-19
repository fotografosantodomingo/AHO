/**
 * AHO programmatic-SEO blog publisher worker.
 *
 * Cloudflare schedules this Worker via the cron trigger in
 * wrangler.toml (09:00 UTC daily). The scheduled handler fetches the
 * Pages app's `/api/cron/blog-publish` route with the shared
 * CRON_SECRET bearer token. The Pages route owns the 50% jitter
 * roll, topic selection, Anthropic generate, DB insert, and operator
 * email — keeping it there means Supabase + Anthropic + Brevo libs
 * aren't duplicated in the worker.
 *
 * Why a proxy instead of doing the work directly:
 *   - Same trust boundary as the rest of the Pages app.
 *   - Cron triggers fire `scheduled()`, not HTTP routes; Pages
 *     Functions don't natively support cron triggers.
 *   - Mirrors the pattern in `workers/ai-daily-rollup/`,
 *     `workers/ai-weekly-digest/`, `workers/listing-expiry/`.
 *
 * Manual trigger for back-fill / debugging:
 *   `GET /run?secret=<CRON_SECRET>`           — normal run (50% jitter applies)
 *   `GET /run?secret=...&force=1`             — skip the jitter, force a real publish
 *   `GET /run?secret=...&dry_run=1&force=1`   — generate + validate, no insert, no email
 *   `GET /run?secret=...&topic_key=K&force=1` — exact-topic, useful for one-off coverage
 */

interface Env {
  CRON_SECRET: string;
  AHO_PAGES_URL: string;
  LOG_LEVEL: string;
}

interface PublishSummary {
  ok: boolean;
  outcome?: string;
  topicKey?: string;
  slug?: string;
  title?: string;
  errorCode?: string;
  status?: number;
  details?: unknown;
}

async function runPublish(env: Env, queryParams?: URLSearchParams): Promise<PublishSummary> {
  if (!env.CRON_SECRET) {
    return { ok: false, errorCode: 'cron_secret_unconfigured' };
  }
  if (!env.AHO_PAGES_URL) {
    return { ok: false, errorCode: 'pages_url_unconfigured' };
  }
  const url = new URL('/api/cron/blog-publish', env.AHO_PAGES_URL);
  if (queryParams) {
    for (const [k, v] of queryParams.entries()) {
      if (k === 'secret') continue;
      url.searchParams.set(k, v);
    }
  }
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
      },
    });
  } catch (err) {
    return {
      ok: false,
      errorCode: 'fetch_threw',
      details: err instanceof Error ? err.message : String(err),
    };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorCode: 'pages_route_non_2xx',
      details: body,
    };
  }
  const payload = (body ?? {}) as PublishSummary;
  return { ok: payload.ok ?? true, ...payload, status: res.status };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const summary = await runPublish(env);
    if (summary.ok) {
      console.log(
        `[blog-publish] outcome=${summary.outcome ?? 'unknown'}${
          summary.slug ? ` slug=${summary.slug}` : ''
        }`,
      );
    } else {
      console.error('[blog-publish] failed', summary);
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/run') {
      return new Response('Not Found', { status: 404 });
    }
    const secret = url.searchParams.get('secret');
    if (!secret || secret !== env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
    const summary = await runPublish(env, url.searchParams);
    return new Response(JSON.stringify(summary, null, 2), {
      status: summary.ok ? 200 : 502,
      headers: { 'content-type': 'application/json' },
    });
  },
};
