import type { AgentMarket } from '@/lib/ai/agent-prompts';

/**
 * Map an ISO 3166-1 alpha-2 country code (typically
 * `organizations.headquarters_country`) to the `AgentMarket` bucket
 * the AI system prompt + cost-tracking layer use. Anything we don't
 * recognize falls back to `'us'` (English / pragmatic copy).
 *
 * Mirrors the locale → market heuristics in
 * `src/lib/social/market-prompts.ts` and is the single source of
 * truth for this mapping. Previously duplicated in:
 *   - src/app/api/ai-chat/route.ts
 *   - src/app/api/voice/twiml/route.ts
 *   - src/lib/ai/schedule-draft.ts
 *
 * Now consolidated. Callers import from here so the admin
 * /admin/ai-overview "Per-market split" tile uses the same bucketing
 * the prompt + cost layers see in production.
 */
export function countryToMarket(country: string | null | undefined): AgentMarket {
  if (!country) return 'us';
  const c = country.toUpperCase();
  if (c === 'ES') return 'es';
  if (c === 'PL') return 'pl';
  if (c === 'PT' || c === 'BR') return 'pt';
  if (c === 'DE' || c === 'AT' || c === 'CH') return 'de';
  if (c === 'FR') return 'fr';
  if (c === 'IT') return 'it';
  return 'us';
}
