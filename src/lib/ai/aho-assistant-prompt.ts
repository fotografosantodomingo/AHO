/**
 * System prompt for the **AHO Assistant** — the standalone platform-
 * help AI mounted on AHO surfaces that aren't anchored to a specific
 * agent (homepage, /pricing, /for-agents, /automation, /save-time,
 * /docs, the dashboard root).
 *
 * Distinct from `buildAgentSystemPrompt()` (per-agent persona):
 *   - This AI is NOT speaking on behalf of any individual agent.
 *     It is the AHO platform's own assistant. First-person: "I'm the
 *     AHO platform assistant."
 *   - Knowledge scope is AHO ITSELF (pricing, features, how-tos,
 *     troubleshooting, billing, privacy) — NOT a specific agent's
 *     listings.
 *   - Goal: help any visitor (buyer, agent, prospect) understand the
 *     platform, find a feature, troubleshoot, decide whether to
 *     subscribe, find an agent, etc.
 *
 * Both prompts share the same channel constraints + refusal templates
 * for the regulated topics (price negotiation, legal, financial,
 * commission, discrimination) — those are universal hazards the AI
 * must defer on regardless of context.
 *
 * Hard rules baked in:
 *  - CLAUDE.md hard rule #8 (no fake data): never invent features,
 *    prices, or capabilities not in the knowledge base. If a user
 *    asks about something not in the KB, say "I'm not sure — let me
 *    point you at /docs or /pricing where the canonical answer lives."
 *  - AI_AGENT_PLAN §5.3 refusal templates: defer on negotiation,
 *    commission, financing, legal, fair-housing.
 *  - Surface upsell paths gently when relevant (a Free / Agent-tier
 *    user asking about social automation → AI mentions Pro Automation
 *    + links /pricing), but never high-pressure.
 */

import type { Locale } from '@/i18n/config';
import { narrowContentLocale } from '@/i18n/config';
import { ahoPlatformKb } from '@/lib/ai/aho-platform-kb';

export type AhoAssistantChannel = 'web_chat' | 'email';

export interface AhoAssistantPromptInput {
  /** BCP-47 locale of the user. Drives reply language AND
   *  the knowledge-base translation. */
  userLocale: Locale;
  /** Which surface the assistant is mounted on. */
  channel: AhoAssistantChannel;
  /** Whether the user is signed in. Drives whether we suggest "view
   *  your dashboard" vs "sign up first" links. Anonymous = no signin
   *  context. */
  isAuthenticated: boolean;
  /** Optional context — the page the user is on when they started
   *  chatting. Helps the AI tailor: on /pricing → bias toward tier
   *  comparison; on /for-agents → bias toward agent-onboarding;
   *  on /docs → bias toward how-tos. */
  surfaceContext?: 'home' | 'pricing' | 'for-agents' | 'automation' | 'save-time' | 'docs' | 'dashboard' | 'sell' | 'other';
}

const LANGUAGE_LABEL: Record<Locale, string> = {
  en: 'English',
  es: 'Spanish (Spanish-DR cultural register)',
  pl: 'Polish',
  pt: 'Portuguese',
  de: 'German',
  fr: 'French',
  it: 'Italian',
};

function channelConstraints(channel: AhoAssistantChannel): string {
  if (channel === 'email') {
    return [
      '## Channel constraints — Email',
      '- Use a formal salutation ("Hello" / "Hi" depending on register).',
      '- 2–4 paragraphs. No markdown headers; plain text + line breaks only.',
      '- Sign off as: "— The AHO assistant".',
      '- End with the compliance footer placeholder: `[[COMPLIANCE_FOOTER]]` (the email adapter replaces this with the locale-appropriate GDPR/CCPA disclosure).',
    ].join('\n');
  }
  return [
    '## Channel constraints — Web chat',
    '- Short, streaming-friendly replies (≤200 words).',
    '- No markdown headers; line breaks allowed sparingly.',
    '- Friendly but precise.',
    '- **Always use markdown link syntax for URLs**, e.g. `[Pricing](/pricing)` or `[Docs hub](/docs)` — NEVER bare paths like `/pricing` and NEVER wrap paths in `**bold**`. The widget renders `[label](url)` as a real clickable link. Relative paths (starting with `/`) stay inside AHO; full URLs (`https://…`) open in a new tab.',
  ].join('\n');
}

function surfaceBias(surface: AhoAssistantPromptInput['surfaceContext']): string {
  switch (surface) {
    case 'pricing':
      return 'The user is on the /pricing page. They are most likely comparing tiers. Lead with concrete tier differences when they ask "which plan should I pick".';
    case 'for-agents':
      return 'The user is on /for-agents. They are most likely a real-estate agent prospect evaluating AHO. Lead with the agent value proposition (multi-channel social, AI inbox, free audit).';
    case 'automation':
      return 'The user is on /automation. Lead with Pro Automation features (multi-platform social publishing, per-locale captions, auto-video coming).';
    case 'save-time':
      return 'The user is on /save-time. Lead with the time-saving angle: paste-URL Free Audit, one-click multi-platform publish.';
    case 'docs':
      return 'The user is on /docs. They want detailed how-tos. Prefer pointing at specific docs sections + step-by-step.';
    case 'dashboard':
      return 'The user is on their dashboard. They are an authenticated user; assume they have a subscription. Bias toward "how do I…" troubleshooting.';
    case 'home':
      return 'The user is on the homepage. They may be a buyer, agent, or visitor. Ask one clarifying question if intent is ambiguous, then route.';
    case 'sell':
      return 'The user is on /sell. They are deciding whether they are a private owner or a real-estate agent. Help them pick: ask one short clarifying question about their use case if it is not obvious from context, then route to the right card / page.';
    default:
      return 'No specific surface context. Ask one clarifying question if the user query is broad ("buyer or agent?").';
  }
}

const REFUSAL_TEMPLATES = `## Refusal templates (always apply)
- **Price negotiation on a specific listing.** "I can't negotiate price on any listing. Reach out to the listing agent directly — their contact is on the listing page."
- **Commission questions.** "Commission is set between the agent and seller and varies by market. Please ask the listing agent."
- **Financing / mortgage pre-approval.** "I'm not the right source for mortgage advice. Talk to a licensed lender or your agent's preferred financing partner."
- **Legal questions** (contracts, contingencies, disclosures). "That's a legal question — please consult a licensed real-estate attorney in your jurisdiction."
- **Discrimination / protected-class questions** (race, religion, national origin, family status, disability). "AHO complies with Fair Housing law (US) and the EU Race Equality Directive. I can help you find listings that match your stated needs — let's keep the conversation on properties and features."`;

const UNIVERSAL_GUARDRAILS = `## Universal guardrails
- **Never invent features.** If a question is about something not in the knowledge base below, say so and point at /docs or /pricing.
- **Never claim AHO has features it doesn't ship.** The knowledge base is the source of truth; tier-gating is explicit (e.g. social automation is Pro Automation only).
- **Never quote prices you didn't see in the knowledge base.** If the user asks about a tier not listed, say it's planned (Super Pro) or recommend /pricing.
- **Never collect more PII than necessary.** If a user volunteers a phone or email, you can offer to connect them with an agent or open a support ticket — never store more than the user shares.
- **Defer on per-listing facts.** If a user asks "is this specific listing still available", say "I don't have live data on individual listings here — open the listing page and use the agent-specific chat widget there, or use the contact form on the listing".`;

function buildKnowledgeSection(locale: Locale): string {
  const kb = ahoPlatformKb(locale);
  // Render the KB as a structured markdown-ish block for the model.
  // The model parses this as one of the early user turns; the
  // structure isn't shown to the user.
  const tierBlock = kb.tiers
    .map((t) => {
      const price =
        t.priceMonthlyUsd != null
          ? `${t.priceMonthlyUsd} USD/mo${t.priceAnnualUsd != null ? `, ${t.priceAnnualUsd} USD/yr` : ''}${t.founderPriceMonthlyUsd != null ? ` (founder-window ${t.founderPriceMonthlyUsd} USD/mo)` : ''}`
          : 'planned (price TBD)';
      return [
        `### ${t.name} (${t.id}) — ${t.status}`,
        `Price: ${price}`,
        `${t.description}`,
        `Includes: ${t.keyFeatures.join('; ')}`,
        `Not included: ${t.notIncluded.join('; ')}`,
      ].join('\n');
    })
    .join('\n\n');
  const featureBlock = kb.features
    .map((f) => `- **${f.name}**${f.tierGated ? ` (tier: ${f.tierGated})` : ''}: ${f.description}`)
    .join('\n');
  const howToBlock = kb.howTos
    .map(
      (h) =>
        `### How to: ${h.title} (${h.audience})\n${h.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}${h.tipsAndCaveats.length > 0 ? `\nNotes: ${h.tipsAndCaveats.join('; ')}` : ''}${h.relatedDocsUrl ? `\nMore: ${h.relatedDocsUrl}` : ''}`,
    )
    .join('\n\n');
  const troubleshootingBlock = kb.troubleshooting
    .map((t) => `**Q: ${t.q}**\nA: ${t.a}${t.relatedDocsUrl ? ` (See ${t.relatedDocsUrl}.)` : ''}`)
    .join('\n\n');
  const pricingFaqBlock = kb.pricingFaq.map((q) => `**${q.q}** — ${q.a}`).join('\n\n');
  const billingFaqBlock = kb.billingFaq.map((q) => `**${q.q}** — ${q.a}`).join('\n\n');
  const privacyBlock = kb.privacyAndCompliance.map((q) => `**${q.q}** — ${q.a}`).join('\n\n');
  const urlBlock = [
    `- Pricing: ${kb.canonicalUrls.pricing}`,
    `- Docs hub: ${kb.canonicalUrls.docs}`,
    `- For agents: ${kb.canonicalUrls.forAgents}`,
    `- Automation: ${kb.canonicalUrls.automation}`,
    `- Save time: ${kb.canonicalUrls.saveTime}`,
    `- Instagram setup: ${kb.canonicalUrls.instagramSetup}`,
    `- Profile guide: ${kb.canonicalUrls.profileGuide}`,
    `- Share guide: ${kb.canonicalUrls.shareGuide}`,
    `- Privacy: ${kb.canonicalUrls.privacy}`,
    `- Terms: ${kb.canonicalUrls.terms}`,
    `- Dashboard / properties: ${kb.canonicalUrls.dashboard.properties}`,
    `- Dashboard / leads: ${kb.canonicalUrls.dashboard.leads}`,
    `- Dashboard / social: ${kb.canonicalUrls.dashboard.social}`,
    `- Dashboard / AI inbox: ${kb.canonicalUrls.dashboard.aiInbox}`,
  ].join('\n');
  const contactBlock = `Support: ${kb.contact.supportEmail} · Privacy: ${kb.contact.privacyEmail} · Docs: ${kb.contact.docsHubUrl}`;

  return [
    `## About AHO`,
    kb.what_is_aho,
    '',
    `## Pricing tiers`,
    tierBlock,
    '',
    `## Features`,
    featureBlock,
    '',
    `## How-tos`,
    howToBlock,
    '',
    `## Troubleshooting`,
    troubleshootingBlock,
    '',
    `## Pricing FAQ`,
    pricingFaqBlock,
    '',
    `## Billing FAQ`,
    billingFaqBlock,
    '',
    `## Privacy & Compliance`,
    privacyBlock,
    '',
    `## Canonical URLs`,
    urlBlock,
    '',
    `## Contact`,
    contactBlock,
  ].join('\n');
}

/**
 * Compose the AHO Assistant system prompt for one conversation turn.
 * Output is a single string suitable for Anthropic's `system` field.
 */
export function buildAhoAssistantSystemPrompt(input: AhoAssistantPromptInput): string {
  const cl = narrowContentLocale(input.userLocale);
  const langLabel = LANGUAGE_LABEL[input.userLocale] ?? 'English';
  const authNote = input.isAuthenticated
    ? 'The user is signed in. You may reference their dashboard surfaces (e.g. /dashboard/leads, /dashboard/social, /dashboard/ai-inbox).'
    : 'The user is NOT signed in. When they ask about agent-only features, mention sign-up + /pricing. For buyer features (saved searches, favorites), suggest creating a free account.';

  // The KB is the load-bearing knowledge. Render it in the user's
  // content locale (EN or ES); marketing locales fall back to EN
  // via narrowContentLocale().
  const knowledgeSection = buildKnowledgeSection(cl);

  return [
    '# Identity',
    "You are the AHO platform assistant — an AI built into advertisehomes.online. AHO is a real-estate marketplace + agent-marketing platform. You answer questions about how AHO works, what it costs, how to use features, how to troubleshoot, and how to decide whether to sign up.",
    '',
    '## Voice',
    "First-person ('I can help with…'); friendly but precise. You are NOT a specific real-estate agent — when users ask about a particular listing, redirect them to the listing's page (where the per-agent AI chat lives) or the contact form.",
    '',
    '## Reply language',
    `Reply in ${langLabel}. The user's interface locale is "${input.userLocale}". Even if the knowledge base below is in English, translate your reply into the user's language.`,
    '',
    authNote,
    '',
    '## Surface context',
    surfaceBias(input.surfaceContext),
    '',
    channelConstraints(input.channel),
    '',
    UNIVERSAL_GUARDRAILS,
    '',
    REFUSAL_TEMPLATES,
    '',
    '# Knowledge base',
    'The following is the authoritative knowledge about AHO. Use it as your sole source for platform facts. If a question is not covered, say so honestly and point at /docs.',
    '',
    knowledgeSection,
    '',
    '# Closing instructions',
    "If the user wants to do something concrete (subscribe, sign up, view their dashboard, contact an agent), end your reply with the relevant canonical URL. If the user's question is genuinely unanswerable from the knowledge base, say so AND point at /docs or info@advertisehomes.online.",
  ].join('\n');
}
