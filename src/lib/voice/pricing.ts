/**
 * Per-call cost computation for the AHO AI voice channel.
 *
 * Pure function. No env access. Edge-safe. Imported by the voice
 * Worker (via the converse() bridge route) at call-end to populate
 * `voice_calls.cost_cents`, and by the admin dashboard for per-agent
 * rollups.
 *
 * Cost model per AI_AGENT_PLAN §4d:
 *
 *   - Twilio talk: ~$0.014/min for US local numbers, varies by
 *     destination country. For inbound calls to a US Twilio number,
 *     the per-minute charge applies regardless of caller origin.
 *   - Deepgram Nova-3 STT: ~$0.0058/min (real-time streaming).
 *   - Claude Sonnet 4.5 inference: rolling average ~$0.05/min of
 *     conversation at our typical turn density (4-6 turns/min;
 *     ~200 input tokens + 80 output tokens per turn after the system
 *     prompt's prompt-caching kicks in).
 *   - ElevenLabs Flash v2.5 TTS: ~$0.06/min of generated audio.
 *
 *   Aggregated: ~$0.13/min "talk" cost + ~$0.014/min Twilio = ~$0.144/min.
 *   Over 30 min/month baseline → ~$4.32 variable + $1.15 number fixed
 *   = ~$5.50/agent/month total (per AI_AGENT_PLAN retail model).
 *
 * Per-market variance: Twilio's per-minute charges differ by
 * destination country (e.g., DE €0.018/min vs US $0.014/min); we
 * absorb this in the market-specific TWILIO_PER_MIN table.
 *
 * Returns integer US cents (the storage unit for voice_calls.cost_cents).
 */

export type VoiceMarket = 'us' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';

export interface VoiceCostInput {
  /** Wall-clock duration of the AI-handled segment, in seconds. */
  durationSeconds: number;
  /** Market dimension. Drives the Twilio per-minute rate. */
  market: VoiceMarket;
}

export interface VoiceCostBreakdown {
  /** Total in US cents (rounded up to the nearest cent). */
  totalCents: number;
  /** Components in US cents, for the admin dashboard rollup. */
  twilioCents: number;
  sttCents: number;
  llmCents: number;
  ttsCents: number;
}

/**
 * Twilio inbound per-minute rate in US cents per minute. Values from
 * Twilio's published per-country pricing (2026). When a market doesn't
 * appear here we fall back to the US rate — close enough for accounting
 * before the per-market Twilio sub-accounts come online.
 */
const TWILIO_PER_MIN: Record<VoiceMarket, number> = {
  us: 1.4,
  es: 1.85,
  pl: 2.1,
  pt: 1.75,
  de: 2.0,
  fr: 1.9,
  it: 1.95,
};

const STT_PER_MIN_CENTS = 0.58; // Deepgram Nova-3 ~$0.0058/min
const LLM_PER_MIN_CENTS = 5.0;  // Claude Sonnet 4.5 at our turn density
const TTS_PER_MIN_CENTS = 6.0;  // ElevenLabs Flash v2.5

/**
 * Estimate the all-in cost of a voice call in US cents.
 *
 * Negative or non-finite durations clamp to zero — handles the edge
 * case where the Worker sets duration before the start clock has
 * advanced (test environments, abandoned calls before "setup" event
 * fires).
 */
export function estimateVoiceCostCents(input: VoiceCostInput): VoiceCostBreakdown {
  const seconds = Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
    ? input.durationSeconds
    : 0;
  const minutes = seconds / 60;

  const twilioRate = TWILIO_PER_MIN[input.market] ?? TWILIO_PER_MIN.us;

  // Each component is computed as a floating-point cent value;
  // breakdowns are rounded individually for dashboard display, then
  // the total uses the unrounded sum so we don't accumulate
  // rounding error.
  const twilioRaw = minutes * twilioRate;
  const sttRaw = minutes * STT_PER_MIN_CENTS;
  const llmRaw = minutes * LLM_PER_MIN_CENTS;
  const ttsRaw = minutes * TTS_PER_MIN_CENTS;

  return {
    totalCents: Math.ceil(twilioRaw + sttRaw + llmRaw + ttsRaw),
    twilioCents: Math.ceil(twilioRaw),
    sttCents: Math.ceil(sttRaw),
    llmCents: Math.ceil(llmRaw),
    ttsCents: Math.ceil(ttsRaw),
  };
}

/**
 * Convenience wrapper returning just the integer cents total — what
 * the Worker writes to `voice_calls.cost_cents`.
 */
export function voiceCostCents(input: VoiceCostInput): number {
  return estimateVoiceCostCents(input).totalCents;
}
