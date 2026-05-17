import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { estimateCostUsdCents } from '@/lib/ai/cost';

/**
 * Per-call AI usage logger — writes one row into `ai_generation_log`
 * for every Anthropic API request the server makes.
 *
 * **Always await** the call. Cloudflare Edge runtime kills unawaited
 * promises when the request handler returns, which produced 0 rows
 * in production during the 2026-05-17 QA pass. The helper has its
 * own try/catch so the await won't propagate a logging failure to
 * the caller — it just keeps the promise alive long enough to land.
 *
 * Why an explicit helper instead of inline supabase.from(...).insert(...):
 *   - Cost is computed here from the price table in `cost.ts`, so the
 *     caller never has to think about it.
 *   - Schema knowledge stays in one place; if we add a column (e.g.
 *     request_id for Anthropic tracing later) every caller picks it up.
 *   - Errors are caught + console.error'd here so a logging-write
 *     failure NEVER cascades into a user-facing failure.
 */

export interface LogAiCallInput {
  /** Optional FK to ai_audits — set for audit-triggered calls; NULL
   *  for /api/social/ai-draft on real listings. */
  auditId?: string | null;
  purpose: 'audit_import' | 'audit_draft' | 'listing_draft';
  /** Verbatim Anthropic model id, e.g. 'claude-haiku-4-5-20251001'. */
  model: string;
  /** Market dim from market-prompts.ts for draft calls; NULL for imports. */
  market?: 'us' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it' | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** NULL on success; set on categorized failure (timeout / rate_limited
   *  / malformed_json / refusal / etc.) so we can see the failure mix
   *  in cost rollups. */
  errorCode?: string | null;
}

export async function logAiCall(input: LogAiCallInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const cost = estimateCostUsdCents(
      input.model,
      input.inputTokens,
      input.outputTokens,
    );
    await admin.from('ai_generation_log').insert({
      audit_id: input.auditId ?? null,
      purpose: input.purpose,
      model: input.model,
      market: input.market ?? null,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      estimated_cost_usd_cents: cost,
      latency_ms: input.latencyMs,
      error_code: input.errorCode ?? null,
    });
  } catch (err) {
    // Never let a logging-write failure cascade into user-facing
    // failure. Drop the row + log the error; the audit / draft response
    // returns successfully regardless.
    console.error('[ai-log] insert failed', err);
  }
}
