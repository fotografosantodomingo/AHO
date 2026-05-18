/**
 * Confidence + risk gating for the AHO AI customer-service agent.
 *
 * Spec: docs/AI_AGENT_PLAN.md §5.3.
 * Schema: src/db/migrations/0066_ai_conversations.sql
 *   (ai_conversation_messages.confidence numeric(3,2),
 *    intent text, risk_flags text[], approval_status text check (...)).
 *
 * ─── Why heuristic, not model-based, in v1 ──────────────────────────
 *
 * Per PO decision D2 = A, every channel is human-in-the-loop (HITL)
 * in v1 — the agent reviews every AI draft before send. That means
 * the gating gate is, in practice, ALWAYS returning `pending` for
 * non-escalate inputs in production right now. The confidence +
 * intent + risk-flag fields still get written into
 * `ai_conversation_messages` (the schema carries them; see migration
 * 0066) so we don't have to re-migrate when PO flips to D2 = B
 * (confidence-gated auto-send) in 4-6 weeks.
 *
 * Given that, v1 = HEURISTIC. Fast, deterministic, dependency-free,
 * no extra Anthropic round-trip per turn. The patterns are reviewable
 * in isolation as constants at the top of this file. False positives
 * route to HITL — which is the v1 default anyway — so we err toward
 * flagging.
 *
 * v2 (out of scope here): add a Claude Haiku-based classifier for
 * ambiguous cases (medium confidence + no clear risk pattern) so the
 * gate can elevate from "default HITL" to "auto-send" with higher
 * recall. The heuristic stays as the cheap first pass.
 *
 * ─── Fail-safe semantics ────────────────────────────────────────────
 *
 * This is a fail-SAFE gate — when in doubt, route to a human. Real-
 * estate liability around price / financing / discrimination is real
 * (CLAUDE.md hard rule context; risk register R1 in AI_AGENT_PLAN.md
 * §9). It is never wrong for this function to over-flag; it CAN be
 * wrong (in the legal sense) for it to under-flag. Treat any change
 * to the discrimination / legal / financial patterns as security-
 * sensitive and review with extra care.
 */

// ─── Types ────────────────────────────────────────────────────────────

export type Intent =
  | 'viewing-request'
  | 'price-question'
  | 'availability'
  | 'amenity-question'
  | 'location-question'
  | 'general-inquiry'
  | 'discrimination-risk'
  | 'legal-risk'
  | 'financial-risk'
  | 'commission-question'
  | 'price-negotiation'
  | 'escalate'
  | 'other';

export type RiskFlag =
  | 'discrimination'
  | 'legal'
  | 'financial'
  | 'commission'
  | 'price_negotiation'
  | 'none';

export type ApprovalDecision =
  | 'auto_send'
  | 'pending' // HITL required
  | 'escalate'; // Human takeover required (AI cannot draft a safe reply)

export interface GatingInput {
  /** The buyer's most recent message. Used for intent detection. */
  userMessage: string;
  /** The AI's drafted reply. Used for risk-flag detection. */
  assistantDraft: string;
  /** Per AHO tier policy. Per D5 = A, AI is bundled into Pro
   *  Automation; Super Pro is the auto-send tier. */
  tier: 'free' | 'pro_automation' | 'super_pro' | 'agency';
  /** D2 = A: every channel is HITL in v1. When PO flips to B
   *  (confidence-gated auto-send), this caller-passed flag flips
   *  to true and the gate honors confidence + intent + risk. */
  autoSendPolicyEnabled: boolean;
}

export interface GatingOutput {
  confidence: number; // 0.00-1.00; heuristic v1 = coarse buckets
  intent: Intent;
  riskFlags: RiskFlag[]; // empty array = ['none']-equivalent
  approvalStatus: ApprovalDecision;
  /** Free-text reason for the decision; written to audit_log
   *  payload for debugging + supervisor review. */
  reason: string;
}

// ─── Risk patterns ────────────────────────────────────────────────────
//
// All patterns are case-insensitive. Curated, reviewable lists — when
// the legal / compliance posture changes, this is the only file that
// has to move. Constants kept at the top of the file so a security
// reviewer can scan them without context-switching.

/**
 * Protected-class / Fair-Housing-Act-style signals. Matched against
 * EITHER the buyer's message OR the assistant's draft — if the buyer
 * raises a discriminatory ask, the AI must NOT comply silently, so we
 * flag the turn regardless of origin so the human reviewer sees it.
 *
 * Coverage areas (US Fair Housing Act + EU equivalents):
 *   - race / ethnicity
 *   - religion
 *   - national origin
 *   - family status (children, marital status)
 *   - disability (incl. service animals — federally protected)
 *   - sex / gender
 *
 * NOT a slur list (slurs are caught by general moderation); this is
 * the narrower set of EXCLUSIONARY phrasings ("only X", "no Y", "X
 * preferred") that show up in real-estate listing copy + buyer
 * preferences and cross the legal line.
 */
const DISCRIMINATION_PATTERNS: RegExp[] = [
  // Exclusionary "only X" / "X only" phrasings.
  /\bonly\s+(white|black|asian|hispanic|latino|jewish|muslim|christian|catholic|hindu|buddhist)\b/i,
  /\b(white|black|asian|hispanic|latino|jewish|muslim|christian|catholic|hindu|buddhist)\s+only\b/i,
  /\b(white|black|asian|hispanic|latino|jewish|muslim|christian|catholic|hindu|buddhist)\s+(families|tenants|buyers|applicants)\s+only\b/i,
  /\bonly\s+(families|people|tenants|buyers)\s+(of|from)\s+(a|the)?\s*(certain|specific|particular)/i,

  // Exclusionary "no X" phrasings (family status, disability, origin).
  /\bno\s+(kids|children|babies|minors)\b/i,
  /\bno\s+(single|unmarried|divorced)\s+(mothers|fathers|parents|women|men)\b/i,
  /\b(adults?[ -]only|no[ -]kids|child[ -]free)\b/i,
  /\bno\s+(wheelchair|disabled|handicap(ped)?)\b/i,
  /\bno\s+service\s+animals?\b/i,
  /\bno\s+(immigrants?|foreigners?|refugees?)\b/i,
  /\bno\s+(blacks?|whites?|asians?|hispanics?|latinos?|jews?|muslims?|christians?)\b/i,

  // "Preferred" / "ideally" — softer but still violation language.
  /\b(prefer(red|ence)?|ideal(ly)?)\s+(white|black|asian|hispanic|latino|jewish|muslim|christian|catholic|family|families|couple|single)\b/i,
  /\b(white|black|asian|hispanic|latino|jewish|muslim|christian|catholic)\s+(preferred|preference)\b/i,

  // Family-status: "perfect for a family" is fine; "only families" is not.
  /\bonly\s+(families|couples|singles)\b/i,
  /\b(families|couples|singles)\s+only\b/i,

  // "Traditional family" + similar coded phrasings.
  /\btraditional\s+(family|families|values)\s+(only|preferred|required)\b/i,

  // Direct asks from the buyer ("only families please", "I want X people").
  /\b(only|just)\s+(families|whites?|blacks?|asians?|hispanics?|christians?|muslims?|jews?|catholics?|singles?|couples?)\s+(please|in|here)?\b/i,
  /\b(no|without)\s+(children|kids|babies|minors|families|disabled|wheelchair)\s+(please|allowed|welcome)?\b/i,
];

/**
 * Legal-advice patterns. The AI must DEFER on contracts /
 * contingencies / disclosures / obligations — it can describe what a
 * listing's posted terms say (a fact lookup), but it cannot tell the
 * buyer what they SHOULD do or what someone MUST do.
 *
 * Run against the assistant's draft only — a buyer asking a legal
 * question is fine; the AI answering with legal advice is not.
 */
const LEGAL_ADVICE_PATTERNS: RegExp[] = [
  /\byou\s+should\s+sign\b/i,
  /\byou\s+must\s+sign\b/i,
  /\bthe\s+contract\s+requires\b/i,
  /\byou(?:'re|\s+are)\s+entitled\s+to\b/i,
  /\byou\s+have\s+no\s+obligation\s+to\b/i,
  /\bthe\s+seller\s+must\b/i,
  /\bthe\s+buyer\s+must\b/i,
  /\bthe\s+(seller|buyer)\s+is\s+(legally\s+)?required\s+to\b/i,
  /\byou\s+are\s+legally\s+(entitled|required|obligated)\b/i,
  /\bunder\s+(state|federal|local)\s+law\b/i,
  /\bthe\s+(contingency|disclosure|inspection)\s+(clause|requirement)\s+means\b/i,
  /\bwe\s+(can|will)\s+(waive|enforce)\s+the\b/i,
];

/**
 * Financial-specifics patterns. Mortgage, pre-approval, down payment,
 * closing costs, DTI, LTV, interest rates — the AI must not quote
 * specific numbers or offer financial advice. Buyers ask agents
 * these all the time; the right answer is "let me connect you with
 * Maria's preferred lender" or "Maria can walk you through specifics."
 *
 * Matched against EITHER side because seeing the topic on either side
 * means the conversation is touching territory that should get human
 * review. Buyer ask → AI should defer; AI offering → AI is over its
 * lane.
 */
const FINANCIAL_PATTERNS: RegExp[] = [
  /\bpre[ -]?approv(al|ed|e)\b/i,
  /\bdown\s+payment\s+of\b/i,
  /\byour\s+monthly\s+payment\b/i,
  /\binterest\s+rate\s+(of|is|at)\b/i,
  /\b(DTI|debt[ -]to[ -]income)\b/i,
  /\b(LTV|loan[ -]to[ -]value)\b/i,
  /\bclosing\s+costs?\s+(of|are|will\s+be)\s*\$?\s*[\d,]+/i,
  /\bmortgage\s+(rate|payment|of|will\s+be)\b/i,
  /\bescrow\s+(amount|of|will\s+be)\s*\$?\s*[\d,]+/i,
  /\bqualify\s+for\s+a\s+(loan|mortgage)\s+of\b/i,
  /\byour\s+credit\s+score\b/i,
  /\bAPR\s+of\b/i,
  /\b(30|15|20)[ -]year\s+(fixed|adjustable|ARM)\s+(at|rate)\b/i,
];

/**
 * Commission-discussion patterns. Buyer commission, listing
 * commission, rebates, splits — sensitive after the 2024 NAR
 * settlement reshaped how agent compensation is discussed in the US.
 * Always HITL.
 */
const COMMISSION_PATTERNS: RegExp[] = [
  /\b(the\s+)?commission\s+is\s+\d/i,
  /\bbuyer'?s?\s+agent\s+commission\b/i,
  /\bseller'?s?\s+agent\s+commission\b/i,
  /\blisting\s+(agent\s+)?commission\b/i,
  /\bcommission\s+(rate|split|percentage)\b/i,
  /\bcommission\s+of\s+\d/i,
  /\b\d+(\.\d+)?\s*%\s+commission\b/i,
  /\brebate\s+(of|will\s+be|is)\s*\$?\s*[\d.]+/i,
  /\bagent\s+rebate\b/i,
  /\bcooperating\s+(broker|agent)\s+(compensation|commission)\b/i,
];

/**
 * Price-negotiation patterns — the assistant offering to negotiate
 * or accept an offer. Hard refusal expected: the AI knows the asking
 * price (it can quote that) but cannot say "the seller will accept
 * $X" or "I can lower the price." That's the agent's call.
 *
 * Matched against the assistant draft only — a buyer making an offer
 * is fine and routes via intent='price-negotiation'; the AI
 * responding with negotiation language is what we flag.
 */
const PRICE_NEGOTIATION_PATTERNS: RegExp[] = [
  /\bthe\s+seller\s+will\s+accept\b/i,
  /\bthe\s+seller\s+would\s+accept\b/i,
  /\bI\s+can\s+lower\s+(the|that)\s+price\b/i,
  /\bwe\s+can\s+(lower|reduce|drop)\s+(the|that)\s+price\b/i,
  /\bwe\s+can\s+do\s+\$\s*[\d,]+/i,
  /\bI\s+can\s+do\s+\$\s*[\d,]+/i,
  /\bmake\s+an\s+offer\s+of\s+\$\s*[\d,]+/i,
  /\bI'?ll\s+accept\s+\$\s*[\d,]+/i,
  /\bwe'?ll\s+accept\s+\$\s*[\d,]+/i,
  /\bthe\s+price\s+is\s+negotiable\b/i,
  /\bwilling\s+to\s+negotiate\s+(down\s+)?to\s+\$\s*[\d,]+/i,
  /\bcounter[ -]offer\s+of\s+\$\s*[\d,]+/i,
];

// ─── Intent patterns ──────────────────────────────────────────────────
//
// First-match wins; the array is ordered with most-specific intents
// first. Buyer messages are short and direct most of the time, so a
// simple regex pass is good enough at v1.

const INTENT_PATTERNS: Array<{ intent: Intent; patterns: RegExp[] }> = [
  // Escalate is FIRST — if the buyer asks for a human, it overrides
  // everything else (including any of the risk topics below).
  {
    intent: 'escalate',
    patterns: [
      /\b(talk|speak|chat)\s+(to|with)\s+a?\s*(human|person|real\s+(agent|person)|maria|representative)\b/i,
      /\blet\s+me\s+(speak|talk)\s+(to|with)\s+(the\s+)?(agent|human|person|maria)\b/i,
      /\bI\s+want\s+(to\s+)?(talk|speak)\s+(to|with)\s+(a\s+)?(human|person|real\s+agent)\b/i,
      /\bno\s+(AI|bot|robot|automated)\b/i,
      /\bstop(\s+(the\s+)?(AI|bot))?\b/i,
      /\b(get|connect)\s+me\s+(to\s+)?(a\s+)?(human|real\s+(agent|person)|person)\b/i,
      /\bhuman\s+(please|now)\b/i,
    ],
  },
  // Commission BEFORE price — "what's the commission" is more
  // specific than the generic price patterns.
  {
    intent: 'commission-question',
    patterns: [
      /\b(what(?:'s|\s+is)?(\s+the)?|how\s+much\s+(is)?)\s+(the\s+)?commission\b/i,
      /\bbuyer'?s?\s+agent\s+commission\b/i,
      /\b(commission|rebate)\s+(rate|split|percentage)?\b/i,
      /\bdo\s+you\s+(charge|take)\s+(a\s+)?(commission|fee)\b/i,
    ],
  },
  // Price-negotiation BEFORE price-question — "I'll offer X" is a
  // negotiation, not a price question.
  {
    intent: 'price-negotiation',
    patterns: [
      /\bI'?ll\s+offer\s+\$?\s*[\d,]+/i,
      /\bmy\s+offer\s+is\s+\$?\s*[\d,]+/i,
      /\bwould\s+(they|the\s+seller)\s+accept\s+\$?\s*[\d,]+/i,
      /\bwill\s+(they|the\s+seller)\s+take\s+\$?\s*[\d,]+/i,
      /\bcan\s+(you|they|the\s+seller)\s+(go|come)\s+(down|lower)\b/i,
      /\bnegotiate\s+(the|on)\s+price\b/i,
      /\b(counter[ -]?offer|counteroffer)\b/i,
      /\bopen\s+to\s+offers?\b/i,
    ],
  },
  {
    intent: 'viewing-request',
    patterns: [
      /\bcan\s+I\s+(see|view|visit|tour)\b/i,
      /\bschedule\s+a\s+(tour|viewing|visit|showing)\b/i,
      /\bbook\s+a\s+(tour|viewing|visit|showing)\b/i,
      /\b(open\s+house|house\s+tour|home\s+tour)\b/i,
      /\bshowing\b/i,
      /\bvisit\s+(the\s+)?(property|house|home|place|listing)\b/i,
      /\bwhen\s+can\s+I\s+(see|visit|view)\b/i,
      /\b(I'?d\s+like\s+to|I\s+want\s+to)\s+(see|view|visit|tour)\b/i,
    ],
  },
  {
    intent: 'price-question',
    patterns: [
      /\bhow\s+much\s+(is\s+it|does\s+it\s+cost|is\s+the\s+(price|house|property))/i,
      /\bwhat(?:'s|\s+is)\s+the\s+(price|asking\s+price|cost)\b/i,
      /\b(is\s+)?the\s+price\s+(firm|negotiable|fixed)\b/i,
      /\basking\s+price\b/i,
      /\bprice\s+per\s+(sq(uare)?\s*(m|ft)|m2|sqm|sqft)\b/i,
    ],
  },
  {
    intent: 'availability',
    patterns: [
      /\bis\s+it\s+still\s+available\b/i,
      /\bstill\s+(on\s+the\s+market|available|for\s+sale|listed)\b/i,
      /\bhas\s+it\s+sold\b/i,
      /\b(is|has)\s+(this|it)\s+(been\s+)?(sold|under\s+contract|pending)\b/i,
      /\bwhen\s+(is\s+)?it\s+available\b/i,
      /\bavailable\s+(for\s+)?(rent|sale|purchase)\b/i,
    ],
  },
  {
    intent: 'amenity-question',
    patterns: [
      /\bdoes\s+it\s+have\b/i,
      /\bis\s+there\s+(a|an)\s+(parking|pool|garage|gym|elevator|garden|yard|terrace|balcony|basement)\b/i,
      /\bwhat\s+about\s+(parking|the\s+)?(pool|garage|gym|elevator|garden|yard|terrace|balcony|basement)\b/i,
      /\bhow\s+many\s+(bedrooms|bathrooms|bed|bath|rooms|parking\s+spaces?)\b/i,
      /\b(square\s+(feet|meters)|sq\s*ft|sqm|m2)\b/i,
      /\b(pet|dog|cat)s?\s+(allowed|friendly|welcome|ok|okay)\b/i,
    ],
  },
  {
    intent: 'location-question',
    patterns: [
      /\bwhere\s+is\s+(it|the\s+(property|house|listing))\b/i,
      /\bwhat\s+neighborhood\b/i,
      /\bwhich\s+neighborhood\b/i,
      /\bwhat\s+area\b/i,
      /\bnear(by)?\s+(schools?|stations?|metro|subway|airport|beach|downtown|shopping)\b/i,
      /\bdistance\s+to\b/i,
      /\bhow\s+(far|close)\s+(is\s+it\s+)?(from|to)\b/i,
      /\bwalking\s+distance\s+to\b/i,
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(text)) return true;
  }
  return false;
}

function detectIntent(userMessage: string): Intent {
  const trimmed = userMessage.trim();
  if (trimmed.length === 0) return 'other';
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (matchesAny(trimmed, patterns)) return intent;
  }
  return 'general-inquiry';
}

function detectRiskFlags(
  userMessage: string,
  assistantDraft: string,
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  // Discrimination — either side triggers (buyer asks, AI answers; both bad).
  if (
    matchesAny(userMessage, DISCRIMINATION_PATTERNS) ||
    matchesAny(assistantDraft, DISCRIMINATION_PATTERNS)
  ) {
    flags.push('discrimination');
  }

  // Legal advice — assistant draft only.
  if (matchesAny(assistantDraft, LEGAL_ADVICE_PATTERNS)) {
    flags.push('legal');
  }

  // Financial specifics — either side.
  if (
    matchesAny(userMessage, FINANCIAL_PATTERNS) ||
    matchesAny(assistantDraft, FINANCIAL_PATTERNS)
  ) {
    flags.push('financial');
  }

  // Commission — either side.
  if (
    matchesAny(userMessage, COMMISSION_PATTERNS) ||
    matchesAny(assistantDraft, COMMISSION_PATTERNS)
  ) {
    flags.push('commission');
  }

  // Price negotiation — assistant draft only (buyer offering is fine,
  // assistant accepting/negotiating is not).
  if (matchesAny(assistantDraft, PRICE_NEGOTIATION_PATTERNS)) {
    flags.push('price_negotiation');
  }

  return flags;
}

const SAFE_HIGH_CONFIDENCE_INTENTS: ReadonlySet<Intent> = new Set([
  'viewing-request',
  'availability',
  'amenity-question',
  'location-question',
]);

function computeConfidence(
  intent: Intent,
  riskFlags: RiskFlag[],
  assistantDraft: string,
): number {
  // Escalate is decisive — buyer asked for a human, the model's draft
  // doesn't matter.
  if (intent === 'escalate') return 0.2;

  // Any risk flag drops us to medium — even if the intent was safe,
  // the topic isn't.
  if (riskFlags.length > 0) return 0.5;

  const draftPresent = assistantDraft.trim().length > 0;

  if (SAFE_HIGH_CONFIDENCE_INTENTS.has(intent) && draftPresent) {
    return 0.95;
  }

  if (intent === 'price-question' && draftPresent) {
    return 0.85;
  }

  if (intent === 'general-inquiry') {
    return 0.7;
  }

  // Includes commission-question, price-negotiation, discrimination-
  // risk, legal-risk, financial-risk, other, and the safe intents
  // when the draft is empty.
  return 0.5;
}

// ─── Main ─────────────────────────────────────────────────────────────

export function classifyAssistantTurn(input: GatingInput): GatingOutput {
  const intent = detectIntent(input.userMessage);
  const riskFlags = detectRiskFlags(input.userMessage, input.assistantDraft);
  const confidence = computeConfidence(
    intent,
    riskFlags,
    input.assistantDraft,
  );

  const decision = decide(
    intent,
    riskFlags,
    confidence,
    input.tier,
    input.autoSendPolicyEnabled,
  );

  return {
    confidence,
    intent,
    riskFlags,
    approvalStatus: decision.status,
    reason: decision.reason,
  };
}

function decide(
  intent: Intent,
  riskFlags: RiskFlag[],
  confidence: number,
  tier: GatingInput['tier'],
  autoSendPolicyEnabled: boolean,
): { status: ApprovalDecision; reason: string } {
  // 1. Explicit human-request always wins.
  if (intent === 'escalate') {
    return {
      status: 'escalate',
      reason: `escalate: buyer requested human (intent=escalate)`,
    };
  }

  // 2. Auto-send policy disabled = D2=A default = always HITL.
  if (!autoSendPolicyEnabled) {
    return {
      status: 'pending',
      reason: `HITL: autoSend policy disabled (D2=A; intent=${intent}, tier=${tier})`,
    };
  }

  // 3. Any meaningful risk flag → HITL regardless of tier or confidence.
  //    (The schema's risk_flags default is '{}' — an empty array is the
  //    "no risk" signal. The 'none' sentinel is only present if
  //    explicitly added; we treat both as the same.)
  const hasMeaningfulRisk =
    riskFlags.length > 0 &&
    !(riskFlags.length === 1 && riskFlags[0] === 'none');
  if (hasMeaningfulRisk) {
    return {
      status: 'pending',
      reason: `HITL: risk flag(s) present (${riskFlags.join(',')}; intent=${intent}, tier=${tier})`,
    };
  }

  // 4. Tier policy per D5=A: free + pro_automation are HITL-only in
  //    v1 even when autoSend is enabled. Super Pro + Agency are the
  //    auto-send tiers.
  if (tier === 'free' || tier === 'pro_automation') {
    return {
      status: 'pending',
      reason: `HITL: tier ${tier} is HITL-only (per D5=A; intent=${intent}, confidence ${confidence.toFixed(2)})`,
    };
  }

  // 5. Confidence gate. >=0.85 = auto-send; otherwise HITL.
  if (confidence >= 0.85) {
    return {
      status: 'auto_send',
      reason: `auto_send: intent=${intent}, no risk flags, confidence ${confidence.toFixed(2)}, tier=${tier}, autoSend enabled`,
    };
  }

  return {
    status: 'pending',
    reason: `HITL: confidence ${confidence.toFixed(2)} below 0.85 threshold (intent=${intent}, tier=${tier})`,
  };
}
