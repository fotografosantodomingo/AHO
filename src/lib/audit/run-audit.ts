import 'server-only';
import { importFromUrl, type ImportedFacts } from '@/lib/listings/import-from-url';
import { generateDrafts, type DrafterResult } from '@/lib/social/ai-drafter';
import { formatPrice } from '@/lib/listings/format';
import type { Locale } from '@/i18n/config';
import { localeToMarket } from '@/lib/social/market-prompts';
import { logAiCall } from '@/lib/ai/log';

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

/** Locales we draft captions in for the Free Audit preview. Per the
 *  plan's Phase 1 deliverable: "9 captions = 3 platforms × 3 locales
 *  (EN / ES / PL)". PL drafts currently fall back to EN content per
 *  the drafter's `narrowContentLocale` rule — Phase 5 (Multilingual
 *  Context Engine) replaces that with real per-market PL prompts. */
export const AUDIT_DRAFT_LOCALES: readonly Locale[] = ['en', 'es', 'pl'] as const;

export type AuditDraftLocale = (typeof AUDIT_DRAFT_LOCALES)[number];

export interface AuditResult {
  facts: ImportedFacts;
  drafts: Record<AuditDraftLocale, DrafterResult>;
  usage: { inputTokens: number; outputTokens: number };
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
}): Promise<AuditResult> {
  const importResult = await importFromUrl({ url: args.url });
  const facts = importResult.facts;
  // Phase 5.5: log the importFromUrl Sonnet call so daily cost
  // rollups reflect TOTAL audit cost (import + drafters), not just
  // the drafter portion. Fire-and-forget; logging failure never
  // cascades into a user-facing failure.
  void logAiCall({
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

  // Pick title per locale — facts.titleEn / titleEs come from the
  // import step (Claude already translated). For PL we fall back to EN
  // because the importer doesn't translate to PL today.
  function titleFor(locale: AuditDraftLocale): string {
    if (locale === 'es') return facts.titleEs ?? facts.titleEn ?? 'Listing';
    return facts.titleEn ?? facts.titleEs ?? 'Listing';
  }

  const drafts = {} as Record<AuditDraftLocale, DrafterResult>;

  // Sequential rather than parallel. Three locales × ~3-4 KB of JSON
  // payload per call would otherwise burst Anthropic's rate limiter
  // for cold accounts. Total wall time ≈ 6-9s, which still keeps the
  // whole audit under the 60s acceptance bar in the plan.
  for (const locale of AUDIT_DRAFT_LOCALES) {
    const priceCents = facts.priceCents ?? 0;
    const currency = facts.currency ?? 'USD';
    const priceFormatted =
      priceCents > 0 ? formatPrice(priceCents, currency, locale) : '';

    // city + countryDisplay are required strings on PostInput/DrafterInput
    // even though the source might be missing them; pass empty so the
    // drafter prompt's "omit null fields" rule kicks in cleanly.
    const startedAt = Date.now();
    const result = await generateDrafts(
      {
        title: titleFor(locale),
        city: facts.city ?? '',
        countryDisplay: facts.countryCode ?? '',
        priceCents,
        currency,
        priceFormatted,
        bedrooms: facts.bedrooms ?? null,
        bathrooms: facts.bathrooms ?? null,
        areaSqm: facts.areaSqm ?? null,
        url: args.url,
        locale,
      },
      ['facebook', 'instagram', 'linkedin'],
      args.apiKey,
    );
    const latencyMs = Date.now() - startedAt;
    drafts[locale] = result;
    if (result.usage) {
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
    }
    // Per-call cost + usage log — Phase 5.5 unit-economics observability.
    // Fire-and-forget; helper swallows its own errors so a logging
    // failure never propagates into the user-facing audit response.
    void logAiCall({
      auditId: args.auditId ?? null,
      purpose: 'audit_draft',
      model: HAIKU_MODEL,
      market: localeToMarket(locale),
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      latencyMs,
      errorCode: result.errorCode ?? null,
    });
  }

  return {
    facts,
    drafts,
    usage: { inputTokens, outputTokens },
  };
}
