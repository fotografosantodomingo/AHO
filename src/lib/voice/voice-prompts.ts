/**
 * Locale-aware TTS-friendly greeting + utterance builders for the
 * AHO AI voice channel.
 *
 * Pure functions. No env access. Edge-safe. Imported by the voice
 * Worker (via the converse() bridge route) when composing the opening
 * line + a handful of canned interjections (fallback when STT confidence
 * is low, "let me transfer you" preamble, etc).
 *
 * Constraints that drive the shape of these strings:
 *
 *   1. NO markdown. ConversationRelay synthesizes whatever text we
 *      send via ElevenLabs Flash v2.5 — stars and underscores get read
 *      aloud literally ("asterisk new asterisk").
 *   2. ≤15 words per sentence. Long sentences blow past the TTS
 *      buffering window and produce jarring audio mid-sentence. Short
 *      sentences let the AI feel naturally human.
 *   3. Locale-driven. Buyer dialed an English-market agent → English
 *      greeting; Polish-market agent → Polish greeting. This is the
 *      one place where market === reply language (we don't get a
 *      buyerLocale signal until the first 'prompt' event).
 *   4. Mentions the focus listing when we have one. If the buyer
 *      tapped a wa.me-style "call me about listing X" link, the
 *      Worker carries the listing title into the greeting.
 *
 * Per AI_AGENT_PLAN §4d sample: "Hi, this is Maria's AI assistant.
 * Are you calling about the villa in Santo Domingo?" — short enough
 * to fit one TTS chunk, friendly, anchors the conversation to the
 * specific listing.
 *
 * Constraint #2 (≤15 words/sentence) is enforced by a runtime check
 * in the unit tests; if you add a new locale, the tests fail loudly
 * until you trim.
 */

export type VoiceLocale = 'en' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';

export interface VoiceGreetingInput {
  /** Display info about the human agent the AI represents. */
  agent: {
    /** First name only — sounds more natural in greetings than full name. */
    firstName: string;
  };
  /** The buyer's locale. Drives the language of the greeting. */
  buyerLocale: VoiceLocale;
  /**
   * Optional focus listing the buyer is calling about. When present
   * the greeting names it. When absent the greeting is generic.
   */
  focusListing?: {
    /** Short, human-readable title — keep under 8 words to stay in budget. */
    title: string;
  };
}

/**
 * Build the AI's opening utterance — the very first thing the buyer
 * hears. Per CLAUDE.md hard rule #8 (no fake data), we don't invent
 * an agent persona; the AI is explicitly "{firstName}'s AI assistant"
 * so the buyer knows they're talking to an AI.
 */
export function buildVoiceGreeting(input: VoiceGreetingInput): string {
  const { agent, buyerLocale, focusListing } = input;
  const name = (agent.firstName ?? '').trim() || 'the agent';
  const title = focusListing?.title?.trim();

  switch (buyerLocale) {
    case 'es':
      return title
        ? `Hola, soy el asistente virtual de ${name}. ¿Llama por ${title}?`
        : `Hola, soy el asistente virtual de ${name}. ¿En qué puedo ayudarle hoy?`;
    case 'pl':
      return title
        ? `Dzień dobry, mówi asystent AI ${name}. Czy dzwoni Pan w sprawie ${title}?`
        : `Dzień dobry, mówi asystent AI ${name}. W czym mogę pomóc?`;
    case 'pt':
      return title
        ? `Olá, sou o assistente virtual de ${name}. Liga sobre ${title}?`
        : `Olá, sou o assistente virtual de ${name}. Como posso ajudar?`;
    case 'de':
      return title
        ? `Guten Tag, ich bin der KI-Assistent von ${name}. Rufen Sie wegen ${title} an?`
        : `Guten Tag, ich bin der KI-Assistent von ${name}. Wie kann ich helfen?`;
    case 'fr':
      return title
        ? `Bonjour, je suis l'assistant IA de ${name}. Vous appelez pour ${title}?`
        : `Bonjour, je suis l'assistant IA de ${name}. Comment puis-je vous aider?`;
    case 'it':
      return title
        ? `Salve, sono l'assistente AI di ${name}. Chiama per ${title}?`
        : `Salve, sono l'assistente AI di ${name}. Come posso aiutarla?`;
    case 'en':
    default:
      return title
        ? `Hi, this is ${name}'s AI assistant. Are you calling about ${title}?`
        : `Hi, this is ${name}'s AI assistant. How can I help you today?`;
  }
}

/**
 * Canned "I'm transferring you" preamble said BEFORE the warm-transfer
 * conference dials the agent's mobile. Locale-aware. Same ≤15-word
 * constraint.
 */
export function buildTransferPreamble(buyerLocale: VoiceLocale, agentFirstName: string): string {
  const name = (agentFirstName ?? '').trim() || 'the agent';
  switch (buyerLocale) {
    case 'es':
      return `Le paso con ${name} ahora. Un momento, por favor.`;
    case 'pl':
      return `Łączę z ${name}. Proszę chwilę poczekać.`;
    case 'pt':
      return `Passo para ${name}. Um momento, por favor.`;
    case 'de':
      return `Ich verbinde Sie mit ${name}. Einen Moment, bitte.`;
    case 'fr':
      return `Je vous passe ${name}. Un instant, s'il vous plaît.`;
    case 'it':
      return `Le passo ${name}. Un attimo, per favore.`;
    case 'en':
    default:
      return `Connecting you to ${name} now. One moment please.`;
  }
}

/**
 * Canned fallback when STT confidence is low (Twilio reports
 * confidence < ~0.55) or when the AI can't classify the intent. Used
 * to ask the buyer to repeat without sounding robotic.
 */
export function buildClarifyRequest(buyerLocale: VoiceLocale): string {
  switch (buyerLocale) {
    case 'es':
      return 'Disculpe, no le entendí bien. ¿Podría repetir, por favor?';
    case 'pl':
      return 'Przepraszam, nie zrozumiałem. Czy może Pan powtórzyć?';
    case 'pt':
      return 'Desculpe, não percebi. Pode repetir, por favor?';
    case 'de':
      return 'Entschuldigung, das habe ich nicht verstanden. Könnten Sie das wiederholen?';
    case 'fr':
      return "Pardon, je n'ai pas compris. Pourriez-vous répéter, s'il vous plaît?";
    case 'it':
      return 'Mi scusi, non ho capito. Potrebbe ripetere, per favore?';
    case 'en':
    default:
      return "Sorry, I didn't catch that. Could you repeat please?";
  }
}
