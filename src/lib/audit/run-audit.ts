import 'server-only';
import { importFromUrl, type ImportedFacts } from '@/lib/listings/import-from-url';
import { generateDrafts, type DrafterResult } from '@/lib/social/ai-drafter';
import { formatPrice } from '@/lib/listings/format';
import type { Locale } from '@/i18n/config';
import { localeToMarket } from '@/lib/social/market-prompts';
import { logAiCall, type LogAiCallInput } from '@/lib/ai/log';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Free Audit orchestrator — Phase 1 of docs/SUPER_PRO_STAGE_1_PLAN.md.
 *
 * Composes the two existing primitives:
 *   1. `importFromUrl` — Claude Sonnet 4.6 scrapes the source portal,
 *      returns structured ImportedFacts.
 *   2. `generateDrafts` — Claude Haiku 4.5 drafts a caption per
 *      (locale × platform), one Anthropic round-trip per locale.
 *
 * Returns:
 *   - facts: the listing data extracted from the source URL
 *   - drafts: 3 locales × 3 platforms = 9 captions (some may be null
 *             if Haiku failed for a given platform; the preview page
 *             surfaces that as "AI unavailable — try again")
 *   - usage: total input/output tokens across all drafter calls so
 *            /api/audit/start can write them to ai_audits for unit
 *            economics (target ≤ $0.30/audit per the plan).
 *
 * Does NOT touch the database. The route handler that calls this is
 * responsible for inserting into ai_audits (it owns the admin client).
 *
 * Throws when importFromUrl fails (invalid URL, bot-block, no JSON-LD)
 * because the whole audit is meaningless without facts. Per-locale
 * drafter failures are NOT thrown — they're captured in the result so
 * partial captions still render on the preview page.
 */

/** Locales the agent can pick as the target language for a Free Audit.
 *  Single locale per audit since 2026-05-28 (PO directive) — was a
 *  fanout of 3 (en/es/pl) which wasted ~$0.01/audit + showed the agent
 *  languages they wouldn't publish in. The dropdown defaults to the
 *  agent's current page locale; they can switch before submitting. */
export const AUDIT_TARGET_LOCALES: readonly Locale[] = [
  'en',
  'es',
  'pl',
  'pt',
  'de',
  'fr',
  'it',
] as const;

export type AuditTargetLocale = (typeof AUDIT_TARGET_LOCALES)[number];

export interface AuditResult {
  facts: ImportedFacts;
  /** Drafts keyed by the agent's chosen target locale. Exactly one
   *  entry as of 2026-05-28; preview iterates `Object.keys(drafts)` so
   *  pre-migration audits with 3-locale fanouts still render. */
  drafts: Partial<Record<Locale, DrafterResult>>;
  /** The locale the agent picked. Persisted to ai_audits.target_locale
   *  so the preview page can render the matching single-locale block. */
  targetLocale: AuditTargetLocale;
  usage: { inputTokens: number; outputTokens: number };
  /** Per-Anthropic-call cost rows the caller should flush to
   *  ai_generation_log AFTER inserting the ai_audits row. We can't
   *  log them here because ai_generation_log.audit_id has a FK to
   *  ai_audits(id) and the audit row doesn't exist yet — silently
   *  fails with 23503 (logged in production 2026-05-18). The caller
   *  uses flushAuditLogs() below to write all rows in one shot. */
  pendingLogs: LogAiCallInput[];
}

/**
 * Flush the pendingLogs collected during runAudit. Call this AFTER
 * inserting the ai_audits row so the FK constraint on
 * ai_generation_log.audit_id is satisfied. Awaited per-call — Edge
 * runtime kills unawaited promises when the response is sent — but
 * each logAiCall has its own try/catch so a logging failure here
 * never bubbles into the user response.
 */
export async function flushAuditLogs(
  logs: LogAiCallInput[],
): Promise<void> {
  for (const entry of logs) {
    await logAiCall(entry);
  }
}

export async function runAudit(args: {
  url: string;
  apiKey: string;
  /** Pre-generated audit UUID — pass in so per-call logging in
   *  `ai_generation_log` can attribute each Anthropic call to the
   *  audit row that will be inserted with this same id by the route
   *  handler after runAudit returns. Optional for backward compat;
   *  when omitted the logs land with audit_id=NULL. */
  auditId?: string;
  /** Agent-chosen target locale for captions + title + creative
   *  overlay. Required since 2026-05-28 — was a fixed 3-locale fanout
   *  before. Validated by the route handler against AUDIT_TARGET_LOCALES. */
  targetLocale: AuditTargetLocale;
}): Promise<AuditResult> {
  const importResult = await importFromUrl({ url: args.url });
  const facts = importResult.facts;
  // Buffer the cost rows in memory rather than writing them now.
  // ai_generation_log.audit_id has a FK to ai_audits(id) and the
  // ai_audits row is inserted at the END of /api/audit/start — so
  // writing here gets the row silently rejected with FK violation
  // 23503 (diagnosed via wrangler tail 2026-05-18). The route
  // handler calls flushAuditLogs() AFTER the ai_audits insert.
  const pendingLogs: LogAiCallInput[] = [];
  pendingLogs.push({
    auditId: args.auditId ?? null,
    purpose: 'audit_import',
    model: importResult.model,
    market: null,
    inputTokens: importResult.usage.inputTokens,
    outputTokens: importResult.usage.outputTokens,
    latencyMs: importResult.latencyMs,
    errorCode: null,
  });
  // Roll the import tokens into the aggregate the orchestrator writes
  // to ai_audits.input_tokens / output_tokens so that legacy column
  // reads also see total-cost not just drafter-cost.
  let inputTokens = importResult.usage.inputTokens;
  let outputTokens = importResult.usage.outputTokens;

  // Pick the title for the agent's chosen target locale. For EN/ES the
  // importer already wrote both columns; for PL/PT/DE/FR/IT we fall
  // back to the EN title — the drafter prompt is per-market and will
  // adapt the caption tone regardless, and the title is rendered as
  // a label, not as ad copy, so EN-as-fallback reads as acceptable.
  // (A real Claude-translated title is a Phase 2 polish item; the
  // single Haiku call cost would be ~$0.0002 so it's noise, but it's
  // an extra round-trip we can defer until users ask for it.)
  function titleForTarget(): string {
    if (args.targetLocale === 'es') return facts.titleEs ?? facts.titleEn ?? 'Listing';
    return facts.titleEn ?? facts.titleEs ?? 'Listing';
  }

  const drafts: Partial<Record<Locale, DrafterResult>> = {};

  const priceCents = facts.priceCents ?? 0;
  const currency = facts.currency ?? 'USD';
  const priceFormatted =
    priceCents > 0 ? formatPrice(priceCents, currency, args.targetLocale) : '';

  // Single drafter call for the agent's chosen target locale. Was a
  // 3-locale fanout (en/es/pl) before 2026-05-28; PO clarified the
  // agent always knows what language they'll publish in, so generating
  // the other two wastes ~$0.007/audit and clutters the preview.
  const startedAt = Date.now();
  const result = await generateDrafts(
    {
      title: titleForTarget(),
      city: facts.city ?? '',
      countryDisplay: facts.countryCode ?? '',
      priceCents,
      currency,
      priceFormatted,
      bedrooms: facts.bedrooms ?? null,
      bathrooms: facts.bathrooms ?? null,
      areaSqm: facts.areaSqm ?? null,
      url: args.url,
      locale: args.targetLocale,
    },
    ['facebook', 'instagram', 'linkedin'],
    args.apiKey,
  );
  const latencyMs = Date.now() - startedAt;
  drafts[args.targetLocale] = result;
  if (result.usage) {
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
  }
  pendingLogs.push({
    auditId: args.auditId ?? null,
    purpose: 'audit_draft',
    model: HAIKU_MODEL,
    market: localeToMarket(args.targetLocale),
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    latencyMs,
    errorCode: result.errorCode ?? null,
  });

  return {
    facts,
    drafts,
    targetLocale: args.targetLocale,
    usage: { inputTokens, outputTokens },
    pendingLogs,
  };
}
