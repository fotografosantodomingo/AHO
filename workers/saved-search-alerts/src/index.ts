import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  renderDigest,
  type DigestProperty,
} from '../../../src/lib/saved-search/digest';

/**
 * AHO — saved-search digest worker.
 *
 * Cron-triggered Cloudflare Worker that walks every opted-in
 * `saved_searches` row, runs the saved filter against listings
 * published since the last notification, and dispatches a Brevo digest
 * if matches > 0.
 *
 * Why a separate Worker (not a Pages Function): Cloudflare Pages
 * Functions don't natively support cron triggers — only Workers do. The
 * Pages app and this Worker share the same Supabase database (read via
 * service-role; bypasses RLS so we can iterate everyone's saved
 * searches) and the same Brevo account.
 *
 * Idempotency: each row's `last_notified_at` is bumped to `now()` at
 * the end of every check, regardless of whether we sent. New listings
 * published between this run and the next cron get caught next time.
 * If we crash mid-iteration, only the saved-searches we DID process are
 * marked notified — the rest pick up next cycle.
 *
 * Hard rule #9 (CLAUDE.md): the first live cron run sends real
 * billable Brevo emails. The deploy ships with `DRY_RUN = "false"` ONLY
 * after PO greenlight. To stage safely, deploy with `DRY_RUN = "true"`
 * first; that path runs the full query + digest render and logs
 * recipients without calling Brevo.
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  BREVO_API_KEY: string;
  PUBLIC_SITE_URL: string;
  LOG_LEVEL: string;
  DRY_RUN: string;
}

interface SavedSearchRow {
  id: string;
  user_id: string;
  name: string | null;
  filters: Record<string, unknown>;
  locale: string;
  notify_email: boolean;
  last_notified_at: string | null;
  created_at: string;
}

type PropertyRow = DigestProperty;

interface ProfileRow {
  email: string;
  full_name: string | null;
}

const MAX_SAVED_PER_RUN = 100;
const MAX_MATCHES_PER_DIGEST = 10;
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL = 'info@advertisehomes.online';
const FROM_NAME = 'AHO';

export default {
  /**
   * Scheduled handler — invoked by the Cron Trigger declared in
   * wrangler.toml. The worker is otherwise dormant.
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDigestCycle(env));
  },

  /**
   * Manual / debug entrypoint. Same logic as scheduled but invokable
   * via `wrangler dev` or a `?secret=...` URL hit. The query-param
   * gate uses SUPABASE_SERVICE_ROLE_KEY itself as the shared secret —
   * non-trivial to guess and rotated whenever Supabase credentials
   * rotate. Returns a JSON summary so the operator can verify the run.
   */
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/run') {
      return new Response('aho-saved-search-alerts — POST /run?secret=<service-role-key>', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    if (url.searchParams.get('secret') !== env.SUPABASE_SERVICE_ROLE_KEY) {
      return new Response('forbidden', { status: 403 });
    }
    const summary = await runDigestCycle(env);
    return new Response(JSON.stringify(summary, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};

interface RunSummary {
  startedAt: string;
  finishedAt: string;
  dueCount: number;
  processed: number;
  emailsSent: number;
  errors: Array<{ savedSearchId: string; error: string }>;
  dryRun: boolean;
}

async function runDigestCycle(env: Env): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  const dryRun = env.DRY_RUN === 'true';
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const summary: RunSummary = {
    startedAt,
    finishedAt: '',
    dueCount: 0,
    processed: 0,
    emailsSent: 0,
    errors: [],
    dryRun,
  };

  const due = await pickDueSavedSearches(supabase);
  summary.dueCount = due.length;
  log(env, 'info', `cycle.start due=${due.length} dryRun=${dryRun}`);

  for (const row of due) {
    summary.processed += 1;
    try {
      const since = row.last_notified_at ?? row.created_at;
      const matches = await findMatches(supabase, row, since);

      // Always bump last_notified_at, even when matches=0, so the
      // next run uses today's window as its floor instead of replaying
      // the same empty range. If a listing publishes between now and
      // the next cron, the next cron will catch it.
      const newNotifiedAt = new Date().toISOString();

      if (matches.length === 0) {
        const { error: emptyBumpErr } = await supabase
          .from('saved_searches')
          .update({ last_notified_at: newNotifiedAt })
          .eq('id', row.id);
        if (emptyBumpErr) {
          console.error('[saved-search-alerts] empty-window bump failed', {
            code: emptyBumpErr.code,
            message: emptyBumpErr.message,
            details: emptyBumpErr.details,
            hint: emptyBumpErr.hint,
          });
        }
        continue;
      }

      const profile = await fetchProfile(supabase, row.user_id);
      if (!profile) {
        log(env, 'warn', `no profile for user_id=${row.user_id} — skipping`);
        continue;
      }

      const digest = renderDigest({
        recipientName: profile.full_name,
        savedSearchName: row.name,
        savedSearchId: row.id,
        locale: row.locale === 'es' ? 'es' : 'en',
        matches,
        siteUrl: env.PUBLIC_SITE_URL,
      });

      if (dryRun) {
        log(
          env,
          'info',
          `dryRun.send to=${profile.email} subject=${JSON.stringify(digest.subject)} matches=${matches.length}`,
        );
      } else {
        const result = await sendBrevo(env, {
          to: profile.email,
          subject: digest.subject,
          html: digest.html,
        });
        if (!result.sent) {
          summary.errors.push({ savedSearchId: row.id, error: result.error ?? 'send_failed' });
          continue; // Don't bump last_notified_at on send failure — retry next cycle.
        }
        summary.emailsSent += 1;
      }

      const { error: bumpErr } = await supabase
        .from('saved_searches')
        .update({ last_notified_at: newNotifiedAt })
        .eq('id', row.id);
      if (bumpErr) {
        console.error('[saved-search-alerts] notified-at bump failed', {
          code: bumpErr.code,
          message: bumpErr.message,
          details: bumpErr.details,
          hint: bumpErr.hint,
        });
      }
    } catch (e) {
      summary.errors.push({
        savedSearchId: row.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  summary.finishedAt = new Date().toISOString();
  log(
    env,
    'info',
    `cycle.end processed=${summary.processed} sent=${summary.emailsSent} errors=${summary.errors.length}`,
  );
  return summary;
}

async function pickDueSavedSearches(supabase: SupabaseClient): Promise<SavedSearchRow[]> {
  // Due = opted-in AND (never notified OR last notified > 20 hours ago).
  // The 20h floor protects against rapid-fire re-runs if the cron is
  // ever triggered manually mid-day for testing. The partial index in
  // migration 0033 covers this filter.
  const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('saved_searches')
    .select('id, user_id, name, filters, locale, notify_email, last_notified_at, created_at')
    .eq('notify_email', true)
    .or(`last_notified_at.is.null,last_notified_at.lt.${twentyHoursAgo}`)
    .order('last_notified_at', { ascending: true, nullsFirst: true })
    .limit(MAX_SAVED_PER_RUN);
  if (error) throw error;
  return (data ?? []) as SavedSearchRow[];
}

async function fetchProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileRow | null> {
  const { data } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

interface SavedFilters {
  q?: string;
  city?: string;
  country?: string;
  transaction?: string;
  beds_min?: number;
  min_price?: number;
  max_price?: number;
}

/**
 * Run a saved-search filter against properties published since
 * `since`. Mirrors the WHERE clauses in `src/lib/listings/search.ts`'s
 * `searchListings` but pared down — no locale-aware ranking, no image
 * preloading. Excludes RLS test-fixture orgs the same way the public
 * surfaces do.
 */
async function findMatches(
  supabase: SupabaseClient,
  saved: SavedSearchRow,
  since: string,
): Promise<PropertyRow[]> {
  const f = saved.filters as SavedFilters;
  let q = supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, title_en, title_es, city, country_code, price_cents, currency, bedrooms, bathrooms, area_sqm, transaction_type, published_at, organizations!inner(slug)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .gt('published_at', since)
    .not('organizations.slug', 'like', 'aho-test-org-%');

  if (f.city) q = q.ilike('city', `%${f.city}%`);
  if (f.country) q = q.eq('country_code', f.country.toUpperCase());
  if (f.transaction) q = q.eq('transaction_type', f.transaction);
  if (typeof f.beds_min === 'number' && f.beds_min > 0) q = q.gte('bedrooms', f.beds_min);
  if (typeof f.min_price === 'number' && f.min_price > 0)
    q = q.gte('price_cents', f.min_price * 100);
  if (typeof f.max_price === 'number' && f.max_price > 0)
    q = q.lte('price_cents', f.max_price * 100);
  if (f.q && f.q.trim().length > 0) {
    // Use ILIKE on title fields (no full-text — keeps the worker
    // dependency surface tiny). Same approximation as the public
    // search page when the FTS index isn't hit.
    const term = `%${f.q.trim()}%`;
    q = q.or(`title_en.ilike.${term},title_es.ilike.${term}`);
  }

  q = q.order('published_at', { ascending: false }).limit(MAX_MATCHES_PER_DIGEST);

  const { data, error } = await q;
  if (error) throw error;
  // Defensive fixture-slug check (mirror of the inner-join filter).
  return ((data ?? []) as PropertyRow[]).filter(
    (r) => !r.slug_en?.startsWith('aho-fixture-') && !r.slug_es?.startsWith('aho-fixture-'),
  );
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

interface SendResult {
  sent: boolean;
  error?: string;
}

async function sendBrevo(env: Env, args: SendArgs): Promise<SendResult> {
  if (!env.BREVO_API_KEY) {
    return { sent: false, error: 'no_api_key' };
  }
  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email: args.to }],
        subject: args.subject,
        htmlContent: args.html,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      return { sent: false, error: data.message ?? `http_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function log(env: Env, level: 'info' | 'warn' | 'error', message: string): void {
  const cur = env.LOG_LEVEL || 'info';
  const order = { info: 0, warn: 1, error: 2 } as const;
  if (order[level] < order[cur as 'info' | 'warn' | 'error']) return;
  console.log(`[saved-search-alerts] ${level} ${message}`);
}

