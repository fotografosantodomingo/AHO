/**
 * WhatsApp template registry — v1.
 *
 * Phase 4 of docs/AI_AGENT_PLAN.md. The PRE-APPROVED template pack
 * we submit to Meta as part of the WABA onboarding. Templates are
 * GLOBAL per (name, language) — every agent on the platform shares
 * the same approved template body, with the agent name + listing +
 * time injected as runtime parameters via the {{1}}, {{2}}, {{3}}
 * placeholders.
 *
 * v1 ships ONE template across 7 locales: `viewing_reminder`.
 * Justification:
 *   - It's strictly transactional (Meta utility category) — least
 *     likely to be auto-recategorized as marketing (R3 in
 *     docs/RISKS.md).
 *   - It's the highest-friction inflight message a buyer cares
 *     about: viewing confirmations need to land regardless of the
 *     24-hour service window.
 *   - It's the same shape across every language; translation work
 *     is low.
 *
 * Phase 4 polish adds:
 *   - `listing_status_change` (price drop / new photo / sold) —
 *     utility category, opt-in via the wa.me click.
 *   - `agent_introduction` (after a wa.me click outside the service
 *     window) — service / utility hybrid; pending Meta clarification
 *     on the category split.
 *   - `saved_search_match` — MARKETING category, gated to explicit
 *     opt-in capture during the first conversation (per Meta's
 *     marketing-template eligibility rules).
 *
 * Translation principle: keep the body strictly factual, use the
 * formal/polite register in every locale (German "Sie"; French
 * "vous"; Polish "Pan/Pani"). The {{1}} parameter is always the
 * buyer's name; {{2}} is the listing title; {{3}} is the formatted
 * date+time.
 *
 * Pure module — no I/O, no network. The actual submission-to-Meta
 * flow lives in workers/whatsapp-webhook (or the agent-onboarding
 * UI Phase 4 polish PR); this file is the source of truth for what
 * to submit.
 */

import type { Locale } from '@/i18n/config';

export type WhatsappTemplateCategory =
  | 'marketing'
  | 'utility'
  | 'authentication'
  | 'service';

export interface WhatsappTemplate {
  /** Meta template name. snake_case; globally unique within the WABA. */
  name: string;
  /** BCP-47 language tag matching the Locale union. */
  language: Locale;
  category: WhatsappTemplateCategory;
  /** Template body with {{1}}, {{2}}, ... placeholders. */
  body_template: string;
  /** Human-readable description of each parameter, in order. Used
   *  by the agent dashboard preview UI. */
  params: ReadonlyArray<{ index: number; description: string }>;
}

const VIEWING_PARAMS = [
  { index: 1, description: 'Buyer first name' },
  { index: 2, description: 'Listing title' },
  { index: 3, description: 'Formatted date + time (e.g. Sat, May 24 at 3pm)' },
] as const;

/**
 * v1 template pack — `viewing_reminder` × 7 locales.
 *
 * Each entry is what we POST to the Meta WABA Templates API on
 * agent onboarding. Approval is async (15 min – 48 h per Meta docs);
 * status tracked in `public.whatsapp_templates.approval_status`.
 */
export const WHATSAPP_TEMPLATES_V1: ReadonlyArray<WhatsappTemplate> = [
  {
    name: 'viewing_reminder',
    language: 'en',
    category: 'utility',
    body_template:
      'Hi {{1}}, your viewing of {{2}} is confirmed for {{3}}. Reply here if you need to reschedule.',
    params: VIEWING_PARAMS,
  },
  {
    name: 'viewing_reminder',
    language: 'es',
    category: 'utility',
    body_template:
      'Hola {{1}}, tu visita a {{2}} está confirmada para {{3}}. Responde aquí si necesitas reprogramar.',
    params: VIEWING_PARAMS,
  },
  {
    name: 'viewing_reminder',
    language: 'pl',
    category: 'utility',
    body_template:
      'Dzień dobry {{1}}, oglądanie nieruchomości {{2}} jest potwierdzone na {{3}}. Odpisz tutaj, jeśli chcesz zmienić termin.',
    params: VIEWING_PARAMS,
  },
  {
    name: 'viewing_reminder',
    language: 'pt',
    category: 'utility',
    body_template:
      'Olá {{1}}, a sua visita a {{2}} está confirmada para {{3}}. Responda aqui se precisar de remarcar.',
    params: VIEWING_PARAMS,
  },
  {
    name: 'viewing_reminder',
    language: 'de',
    category: 'utility',
    body_template:
      'Hallo {{1}}, Ihre Besichtigung von {{2}} ist für {{3}} bestätigt. Antworten Sie hier, falls Sie den Termin verschieben möchten.',
    params: VIEWING_PARAMS,
  },
  {
    name: 'viewing_reminder',
    language: 'fr',
    category: 'utility',
    body_template:
      'Bonjour {{1}}, votre visite de {{2}} est confirmée pour le {{3}}. Répondez ici si vous souhaitez la reprogrammer.',
    params: VIEWING_PARAMS,
  },
  {
    name: 'viewing_reminder',
    language: 'it',
    category: 'utility',
    body_template:
      'Salve {{1}}, la sua visita a {{2}} è confermata per {{3}}. Risponda qui se ha bisogno di riprogrammarla.',
    params: VIEWING_PARAMS,
  },
];

/**
 * Lookup a template by (name, language). Returns undefined for an
 * un-registered combo; callers should treat that as a "submit the
 * 7-language pack first" error in the agent dashboard.
 */
export function findTemplate(args: {
  name: string;
  language: Locale;
}): WhatsappTemplate | undefined {
  return WHATSAPP_TEMPLATES_V1.find(
    (t) => t.name === args.name && t.language === args.language,
  );
}

/**
 * Render a template body by substituting positional parameters.
 * Used by the send adapter (Phase 4 polish PR) and by the agent
 * dashboard preview UI.
 *
 * Throws on parameter-count mismatch — Meta rejects renders with
 * missing parameters, so failing loudly here is correct.
 */
export function renderTemplate(args: {
  template: WhatsappTemplate;
  values: ReadonlyArray<string>;
}): string {
  if (args.values.length !== args.template.params.length) {
    throw new Error(
      `whatsapp template ${args.template.name}/${args.template.language} expected ${args.template.params.length} params, got ${args.values.length}`,
    );
  }
  let out = args.template.body_template;
  args.values.forEach((value, idx) => {
    const token = `{{${idx + 1}}}`;
    out = out.split(token).join(value);
  });
  return out;
}
