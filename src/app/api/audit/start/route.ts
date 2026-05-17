import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { runAudit } from '@/lib/audit/run-audit';
import { checkRateLimit } from '@/lib/rate-limit/kv';

export const runtime = 'edge';

/**
 * POST /api/audit/start
 *
 * Phase 1 of docs/SUPER_PRO_STAGE_1_PLAN.md — the Free Audit entry
 * point. Anonymous body: {url}. Returns {auditId} on success; the
 * client redirects to /[locale]/preview/[auditId] which renders the
 * 9 captions + listing facts.
 *
 * Pipeline:
 *   1. Validate URL
 *   2. KV rate-limit per IP (5 / hour anon) — defense against bot
 *      scrapers re-pasting the same portal listings to burn our
 *      Anthropic spend.
 *   3. runAudit() → importFromUrl + generateDrafts × 3 locales
 *   4. INSERT into ai_audits via service-role client
 *   5. Return {auditId}
 *
 * Throws are caught and mapped to JSON: { error: code, hint?: string }
 * so the widget can show user-readable failure states (bad URL, portal
 * blocks bots, AI temporarily unavailable).
 *
 * Cost guardrail: each Claude call already has max_tokens caps; the
 * orchestrator writes usage back so we observe per-audit cost in
 * ai_audits.input_tokens / output_tokens and can alert when the
 * average creeps above the $0.30/audit target.
 */

const BodySchema = z.object({
  url: z.string().url('Must be a valid URL').max(2048),
});

type ErrorCode =
  | 'invalid_input'
  | 'rate_limited'
  | 'invalid_url'
  | 'bot_blocked'
  | 'no_facts'
  | 'ai_unavailable'
  | 'db_error'
  | 'internal_error';

function fail(status: number, error: ErrorCode, hint?: string) {
  return NextResponse.json({ ok: false, error, hint }, { status });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return fail(400, 'invalid_input', err instanceof Error ? err.message : String(err));
  }

  // Per-IP rate limit. We deliberately don't gate the audit on
  // signed-in state — the Free Audit IS the lead-gen wedge that
  // brings cold visitors in. But that openness needs anti-abuse:
  // 5 audits per IP per hour caps the worst-case Anthropic burn at
  // ~$1.50/IP/hour even if someone scripts the form.
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const rl = await checkRateLimit(ip, {
    namespace: 'audit-start',
    windowSeconds: 3600,
    max: 5,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: 'rate_limited' as ErrorCode,
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } },
    );
  }

  const env = serverEnv();
  if (!env.ANTHROPIC_API_KEY) {
    return fail(503, 'ai_unavailable', 'AI provider not configured');
  }

  // Pre-generate the audit's UUID so the per-call AI logging in
  // runAudit can attribute every Anthropic request to this audit's
  // id BEFORE the row exists. Postgres accepts an explicit id on
  // insert when the column has DEFAULT gen_random_uuid(); we just
  // override the default with our pre-gen.
  const auditId = crypto.randomUUID();

  let auditResult;
  try {
    auditResult = await runAudit({
      url: body.url,
      apiKey: env.ANTHROPIC_API_KEY,
      auditId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Map known importFromUrl failure messages to user-friendly codes.
    if (/invalid url|http or https|internal address/i.test(msg)) {
      return fail(400, 'invalid_url', msg);
    }
    if (/bot|cloudflare|captcha/i.test(msg)) {
      return fail(422, 'bot_blocked', 'The source portal blocks scrapers — paste the listing details manually instead.');
    }
    if (/no facts|json-ld|missing/i.test(msg)) {
      return fail(422, 'no_facts', "Couldn't extract listing details from that page.");
    }
    console.error('[audit.start] runAudit failed', msg);
    return fail(500, 'internal_error', msg);
  }

  // INSERT via admin client — RLS denies anon writes, so this bypass
  // is the intended path. The orchestrator returns facts + drafts +
  // usage; we serialize the per-locale DrafterResult into a single
  // JSON column so the preview page can render whatever's there.
  const admin = createAdminClient();
  const ipHash = ip === 'unknown' ? null : await sha256Hex(ip);
  const { error: insertErr } = await admin
    .from('ai_audits')
    .insert({
      id: auditId,
      source_url: body.url,
      source_locale: auditResult.facts.detectedLanguage,
      facts: auditResult.facts,
      drafts: auditResult.drafts,
      input_tokens: auditResult.usage.inputTokens,
      output_tokens: auditResult.usage.outputTokens,
      client_ip_hash: ipHash,
    });

  if (insertErr) {
    console.error('[audit.start] insert failed', insertErr);
    return fail(500, 'db_error', insertErr.message);
  }

  return NextResponse.json({ ok: true, auditId });
}
