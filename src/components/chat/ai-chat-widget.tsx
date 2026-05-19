'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatMessageBody } from './render-message';
import {
  PreChatGate,
  readStoredAcceptance,
  type GateResult,
  type PreChatGateProps,
} from './pre-chat-gate';

/**
 * AHO AI customer-service widget — Phase 2 web-chat surface.
 *
 * Renders a floating chat bubble bottom-LEFT (Tawk owns bottom-right
 * during the coexistence period; the Tawk-removal flip is a Phase 6
 * polish). When opened, shows a 380×560 panel with the agent's avatar
 * + name, a streaming message list, and an input box.
 *
 * Streams Server-Sent Events from POST /api/ai-chat:
 *   - event: conversation  → first event; carries conversationId + assistantMessageId
 *   - event: text-delta    → appended to the in-flight assistant turn
 *   - event: tool-call     → informational (shown as "(checking …)" stub)
 *   - event: done          → carries approvalStatus; finalizes the turn
 *
 * Per D2=A the v1 always lands as `approvalStatus='pending'` — the
 * buyer sees the AI reply IMMEDIATELY but with a subtle "awaiting
 * agent review" badge. When D2 flips to B, the badge disappears and
 * `auto_sent` rows render without the marker.
 *
 * Lead capture: after 3 buyer turns, the widget pops an inline form
 * that POSTs to /api/leads with `source='form'`.
 *
 * Session continuity: a per-buyer `sessionToken` (random uuid) +
 * `conversationId` are stashed in localStorage under
 * `aho:ai-chat:v1:<agentId>:<propertyId|->` so the convo survives page
 * navigation between /properties/[slug] and /agents/[slug].
 */

export type WidgetLocale =
  | 'en'
  | 'es'
  | 'pl'
  | 'pt'
  | 'de'
  | 'fr'
  | 'it';

export interface AiChatWidgetProps {
  agentId: string;
  agentName: string;
  agentAvatarUrl: string | null;
  propertyId?: string;
  buyerLocale: WidgetLocale;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  /** Present only on assistant rows after the server's `done` event. */
  approvalStatus?: 'pending' | 'auto_sent';
  /** True while the SSE stream is still flowing into this row. */
  streaming?: boolean;
  /** ISO timestamp captured at first render; carried into the
   *  operator transcript email for pacing visibility. */
  at?: string;
}

/**
 * Best-effort transcript-to-email beacon. Same shape + survival
 * guarantees as the helper in aho-assistant-widget.tsx (sendBeacon
 * with keepalive-fetch fallback). Duplicated here intentionally:
 * the per-agent widget carries a conversationId + agentName that
 * the AHO Assistant doesn't, so the payloads diverge enough that
 * an extracted helper would just shuttle args. If a third widget
 * ever needs the same plumbing, pull both into a shared
 * `src/lib/chat/transcript-beacon.ts`.
 */
function sendAgentTranscriptBeacon(payload: unknown): void {
  if (typeof window === 'undefined') return;
  const url = '/api/chat-transcript/email';
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, blob);
      return;
    }
  } catch {
    /* sendBeacon throws on huge payloads; fall through to fetch */
  }
  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: blob,
      keepalive: true,
    });
  } catch {
    /* widget already torn down */
  }
}

interface StoredSession {
  conversationId: string | null;
  sessionToken: string;
}

// ─── i18n — small inline copy table (no next-intl plumbing yet for the
// AI widget; the keys are stable enough to live here while we get the
// shape right). When the widget locks in we'll move these into
// messages/{locale}.json under `aiChat.*`.
const COPY: Record<WidgetLocale, {
  greeting: (name: string) => string;
  placeholder: string;
  send: string;
  open: string;
  close: string;
  awaitingReview: string;
  leadHeading: (name: string) => string;
  leadCta: string;
  leadEmailPlaceholder: string;
  leadPhonePlaceholder: string;
  leadSubmit: string;
  leadSkip: string;
  leadSubmitted: string;
  toolStub: (name: string) => string;
  errorGeneric: string;
  /** Pre-chat gate copy. The shape matches PreChatGateProps['copy']
   *  exactly — the widget passes this sub-object straight through. */
  gate: PreChatGateProps['copy'];
}> = {
  en: {
    greeting: (name) => `Hi! I'm ${name}'s AI assistant. How can I help you with this property?`,
    placeholder: 'Type a message…',
    send: 'Send',
    open: 'Chat with the AI assistant',
    close: 'Close chat',
    awaitingReview: 'awaiting agent review',
    leadHeading: (name) => `Want ${name} to follow up directly?`,
    leadCta: 'Drop your email or phone and they will reach out.',
    leadEmailPlaceholder: 'Email',
    leadPhonePlaceholder: 'Phone (optional)',
    leadSubmit: 'Send',
    leadSkip: 'Maybe later',
    leadSubmitted: "Thanks! We'll be in touch.",
    toolStub: (name) => `(checking ${name.replace(/_/g, ' ')}…)`,
    errorGeneric: 'Something went wrong. Try again in a moment.',
    gate: {
      heading: 'Before we start',
      sub: 'Tell us who you are so the agent can follow up if the conversation leads somewhere.',
      nameLabel: 'Name',
      namePlaceholder: 'Your full name',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      consentText:
        'I accept the {terms} and the {privacy}, and I agree to receive occasional newsletter updates from AHO. I can unsubscribe at any time.',
      consentTermsLabel: 'terms of service',
      consentPrivacyLabel: 'privacy policy',
      submit: 'Start chat',
      submitting: 'Starting…',
      errorEmail: 'Enter a valid email address.',
      errorName: 'Tell us your name.',
      errorConsent: 'Please accept the terms before continuing.',
      errorNetwork: 'Could not subscribe. Try again in a moment.',
    },
  },
  es: {
    greeting: (name) => `¡Hola! Soy el asistente IA de ${name}. ¿En qué puedo ayudarte con esta propiedad?`,
    placeholder: 'Escribe un mensaje…',
    send: 'Enviar',
    open: 'Chatear con el asistente IA',
    close: 'Cerrar chat',
    awaitingReview: 'pendiente de revisión del agente',
    leadHeading: (name) => `¿Quieres que ${name} te contacte directamente?`,
    leadCta: 'Deja tu correo o teléfono y se pondrán en contacto.',
    leadEmailPlaceholder: 'Correo electrónico',
    leadPhonePlaceholder: 'Teléfono (opcional)',
    leadSubmit: 'Enviar',
    leadSkip: 'Quizás más tarde',
    leadSubmitted: '¡Gracias! Te contactaremos pronto.',
    toolStub: (name) => `(consultando ${name.replace(/_/g, ' ')}…)`,
    errorGeneric: 'Algo salió mal. Inténtalo de nuevo en un momento.',
    gate: {
      heading: 'Antes de empezar',
      sub: 'Cuéntanos quién eres para que el agente pueda contactarte si la conversación lo amerita.',
      nameLabel: 'Nombre',
      namePlaceholder: 'Tu nombre completo',
      emailLabel: 'Correo electrónico',
      emailPlaceholder: 'tu@ejemplo.com',
      consentText:
        'Acepto los {terms} y la {privacy}, y autorizo recibir comunicaciones ocasionales del boletín de AHO. Puedo darme de baja cuando quiera.',
      consentTermsLabel: 'términos del servicio',
      consentPrivacyLabel: 'política de privacidad',
      submit: 'Empezar chat',
      submitting: 'Iniciando…',
      errorEmail: 'Introduce un correo electrónico válido.',
      errorName: 'Dinos cómo te llamas.',
      errorConsent: 'Acepta los términos antes de continuar.',
      errorNetwork: 'No se pudo suscribir. Inténtalo de nuevo en un momento.',
    },
  },
  pl: {
    greeting: (name) => `Cześć! Jestem asystentem AI ${name}. Jak mogę pomóc z tą nieruchomością?`,
    placeholder: 'Napisz wiadomość…',
    send: 'Wyślij',
    open: 'Czat z asystentem AI',
    close: 'Zamknij czat',
    awaitingReview: 'oczekuje na sprawdzenie agenta',
    leadHeading: (name) => `Czy ${name} ma się odezwać bezpośrednio?`,
    leadCta: 'Zostaw e-mail lub telefon, a agent się skontaktuje.',
    leadEmailPlaceholder: 'E-mail',
    leadPhonePlaceholder: 'Telefon (opcjonalnie)',
    leadSubmit: 'Wyślij',
    leadSkip: 'Może później',
    leadSubmitted: 'Dziękujemy! Wkrótce się odezwiemy.',
    toolStub: (name) => `(sprawdzanie ${name.replace(/_/g, ' ')}…)`,
    errorGeneric: 'Coś poszło nie tak. Spróbuj ponownie za chwilę.',
    gate: {
      heading: 'Zanim zaczniemy',
      sub: 'Powiedz, kim jesteś — agent skontaktuje się, jeśli rozmowa do czegoś doprowadzi.',
      nameLabel: 'Imię',
      namePlaceholder: 'Twoje imię i nazwisko',
      emailLabel: 'E-mail',
      emailPlaceholder: 'ty@przyklad.com',
      consentText:
        'Akceptuję {terms} oraz {privacy} i wyrażam zgodę na okresowe wiadomości z newslettera AHO. Mogę wypisać się w każdej chwili.',
      consentTermsLabel: 'regulamin',
      consentPrivacyLabel: 'politykę prywatności',
      submit: 'Rozpocznij czat',
      submitting: 'Łączenie…',
      errorEmail: 'Wpisz poprawny adres e-mail.',
      errorName: 'Powiedz, jak masz na imię.',
      errorConsent: 'Zaakceptuj regulamin, aby kontynuować.',
      errorNetwork: 'Nie udało się zapisać. Spróbuj ponownie za chwilę.',
    },
  },
  pt: {
    greeting: (name) => `Oi! Sou o assistente IA de ${name}. Como posso ajudar com este imóvel?`,
    placeholder: 'Escreva uma mensagem…',
    send: 'Enviar',
    open: 'Conversar com o assistente IA',
    close: 'Fechar chat',
    awaitingReview: 'aguardando revisão do agente',
    leadHeading: (name) => `Quer que ${name} entre em contato diretamente?`,
    leadCta: 'Deixe seu e-mail ou telefone e o agente entrará em contato.',
    leadEmailPlaceholder: 'E-mail',
    leadPhonePlaceholder: 'Telefone (opcional)',
    leadSubmit: 'Enviar',
    leadSkip: 'Talvez depois',
    leadSubmitted: 'Obrigado! Em breve entraremos em contato.',
    toolStub: (name) => `(verificando ${name.replace(/_/g, ' ')}…)`,
    errorGeneric: 'Algo deu errado. Tente novamente em instantes.',
    gate: {
      heading: 'Antes de começar',
      sub: 'Diga quem é você para o agente entrar em contato se a conversa exigir.',
      nameLabel: 'Nome',
      namePlaceholder: 'Seu nome completo',
      emailLabel: 'E-mail',
      emailPlaceholder: 'voce@exemplo.com',
      consentText:
        'Aceito os {terms} e a {privacy}, e autorizo o recebimento ocasional de comunicações da newsletter AHO. Posso cancelar a inscrição a qualquer momento.',
      consentTermsLabel: 'termos de serviço',
      consentPrivacyLabel: 'política de privacidade',
      submit: 'Começar chat',
      submitting: 'Iniciando…',
      errorEmail: 'Informe um e-mail válido.',
      errorName: 'Diga seu nome.',
      errorConsent: 'Aceite os termos para continuar.',
      errorNetwork: 'Não foi possível inscrever. Tente novamente em instantes.',
    },
  },
  de: {
    greeting: (name) => `Hallo! Ich bin der KI-Assistent von ${name}. Wie kann ich bei dieser Immobilie helfen?`,
    placeholder: 'Nachricht eingeben…',
    send: 'Senden',
    open: 'Chat mit dem KI-Assistenten',
    close: 'Chat schließen',
    awaitingReview: 'wartet auf Freigabe',
    leadHeading: (name) => `Soll ${name} sich direkt bei Ihnen melden?`,
    leadCta: 'E-Mail oder Telefonnummer hinterlassen, der Makler meldet sich.',
    leadEmailPlaceholder: 'E-Mail',
    leadPhonePlaceholder: 'Telefon (optional)',
    leadSubmit: 'Senden',
    leadSkip: 'Vielleicht später',
    leadSubmitted: 'Danke! Wir melden uns bei Ihnen.',
    toolStub: (name) => `(prüfe ${name.replace(/_/g, ' ')}…)`,
    errorGeneric: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
    gate: {
      heading: 'Bevor wir starten',
      sub: 'Sagen Sie uns, wer Sie sind, damit der Makler sich melden kann, falls das Gespräch weitergeht.',
      nameLabel: 'Name',
      namePlaceholder: 'Ihr vollständiger Name',
      emailLabel: 'E-Mail',
      emailPlaceholder: 'sie@beispiel.com',
      consentText:
        'Ich akzeptiere die {terms} und die {privacy} und erkläre mich mit gelegentlichen Newsletter-Updates von AHO einverstanden. Ich kann mich jederzeit abmelden.',
      consentTermsLabel: 'Nutzungsbedingungen',
      consentPrivacyLabel: 'Datenschutzerklärung',
      submit: 'Chat starten',
      submitting: 'Wird gestartet…',
      errorEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
      errorName: 'Bitte nennen Sie Ihren Namen.',
      errorConsent: 'Bitte akzeptieren Sie die Bedingungen, um fortzufahren.',
      errorNetwork: 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
    },
  },
  fr: {
    greeting: (name) => `Bonjour ! Je suis l'assistant IA de ${name}. Comment puis-je vous aider avec ce bien ?`,
    placeholder: 'Écrire un message…',
    send: 'Envoyer',
    open: "Discuter avec l'assistant IA",
    close: 'Fermer le chat',
    awaitingReview: "en attente de validation",
    leadHeading: (name) => `Vous souhaitez que ${name} vous recontacte directement ?`,
    leadCta: 'Laissez votre e-mail ou téléphone et il vous contactera.',
    leadEmailPlaceholder: 'E-mail',
    leadPhonePlaceholder: 'Téléphone (facultatif)',
    leadSubmit: 'Envoyer',
    leadSkip: 'Plus tard',
    leadSubmitted: 'Merci ! Nous vous recontacterons.',
    toolStub: (name) => `(vérification ${name.replace(/_/g, ' ')}…)`,
    errorGeneric: "Une erreur est survenue. Réessayez dans un instant.",
    gate: {
      heading: 'Avant de commencer',
      sub: "Dites-nous qui vous êtes pour que l'agent puisse vous recontacter si la conversation l'exige.",
      nameLabel: 'Nom',
      namePlaceholder: 'Votre nom complet',
      emailLabel: 'E-mail',
      emailPlaceholder: 'vous@exemple.com',
      consentText:
        "J'accepte les {terms} et la {privacy}, et j'autorise la réception occasionnelle de la newsletter AHO. Je peux me désinscrire à tout moment.",
      consentTermsLabel: "conditions d'utilisation",
      consentPrivacyLabel: 'politique de confidentialité',
      submit: 'Démarrer le chat',
      submitting: 'Démarrage…',
      errorEmail: 'Saisissez une adresse e-mail valide.',
      errorName: "Indiquez votre nom.",
      errorConsent: "Veuillez accepter les conditions pour continuer.",
      errorNetwork: "Inscription impossible. Réessayez dans un instant.",
    },
  },
  it: {
    greeting: (name) => `Ciao! Sono l'assistente IA di ${name}. Come posso aiutarti con questo immobile?`,
    placeholder: 'Scrivi un messaggio…',
    send: 'Invia',
    open: "Chatta con l'assistente IA",
    close: 'Chiudi chat',
    awaitingReview: 'in attesa di revisione',
    leadHeading: (name) => `Vuoi che ${name} ti ricontatti direttamente?`,
    leadCta: 'Lascia la tua e-mail o telefono e ti contatteranno.',
    leadEmailPlaceholder: 'E-mail',
    leadPhonePlaceholder: 'Telefono (opzionale)',
    leadSubmit: 'Invia',
    leadSkip: 'Forse dopo',
    leadSubmitted: 'Grazie! Ti contatteremo presto.',
    toolStub: (name) => `(verifica ${name.replace(/_/g, ' ')}…)`,
    errorGeneric: 'Qualcosa è andato storto. Riprova tra poco.',
    gate: {
      heading: 'Prima di iniziare',
      sub: 'Dicci chi sei così l\'agente può ricontattarti se la conversazione lo richiede.',
      nameLabel: 'Nome',
      namePlaceholder: 'Il tuo nome completo',
      emailLabel: 'E-mail',
      emailPlaceholder: 'tu@esempio.com',
      consentText:
        'Accetto i {terms} e la {privacy}, e autorizzo a ricevere occasionalmente la newsletter di AHO. Posso disiscrivermi in qualsiasi momento.',
      consentTermsLabel: 'termini di servizio',
      consentPrivacyLabel: 'informativa sulla privacy',
      submit: 'Inizia chat',
      submitting: 'Avvio…',
      errorEmail: 'Inserisci un indirizzo e-mail valido.',
      errorName: 'Dicci come ti chiami.',
      errorConsent: 'Accetta i termini per continuare.',
      errorNetwork: 'Iscrizione non riuscita. Riprova tra poco.',
    },
  },
};

function generateUuid(): string {
  // Edge runtime + modern browsers both support crypto.randomUUID; fall
  // back to a simple v4 only when not present (older Safari, etc.).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function storageKey(agentId: string, propertyId?: string): string {
  return `aho:ai-chat:v1:${agentId}:${propertyId ?? '-'}`;
}

function loadSession(agentId: string, propertyId?: string): StoredSession {
  if (typeof window === 'undefined') {
    return { conversationId: null, sessionToken: generateUuid() };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(agentId, propertyId));
    if (raw) {
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed && typeof parsed.sessionToken === 'string') {
        return parsed;
      }
    }
  } catch {
    // ignore (Safari private mode / storage disabled)
  }
  return { conversationId: null, sessionToken: generateUuid() };
}

function saveSession(
  agentId: string,
  propertyId: string | undefined,
  session: StoredSession,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(agentId, propertyId), JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function AiChatWidget({
  agentId,
  agentName,
  agentAvatarUrl,
  propertyId,
  buyerLocale,
}: AiChatWidgetProps) {
  const copy = COPY[buyerLocale] ?? COPY.en;
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadSending, setLeadSending] = useState(false);
  const [leadDismissed, setLeadDismissed] = useState(false);
  // Pre-chat gate state. Visitor must provide name + email + accept
  // T&Cs before the message UI mounts. Initialized from localStorage
  // on mount (NOT during render — `readStoredAcceptance` touches
  // window which is undefined during SSR). Returning visitors on the
  // same device skip the gate transparently.
  const [gateInfo, setGateInfo] = useState<GateResult | null>(null);
  const [gateInitialized, setGateInitialized] = useState(false);
  useEffect(() => {
    setGateInfo(readStoredAcceptance());
    setGateInitialized(true);
  }, []);
  // Transcript-shipping refs — same pattern as the AHO Assistant.
  // messagesRef + subscriberRef provide the always-fresh snapshot
  // the pagehide listener reads; transcriptSentRef de-dupes within
  // a single shutdown window.
  const messagesRef = useRef<Message[]>([]);
  const transcriptSentRef = useRef(false);
  const subscriberRef = useRef<GateResult | null>(null);
  useEffect(() => {
    subscriberRef.current = gateInfo;
  }, [gateInfo]);

  const sessionRef = useRef<StoredSession>({ conversationId: null, sessionToken: '' });
  const initialGreeting = useMemo<Message>(
    () => ({
      id: 'greeting',
      role: 'assistant',
      body: copy.greeting(agentName),
    }),
    [copy, agentName],
  );
  const [messages, setMessages] = useState<Message[]>([initialGreeting]);

  // Initialize session once on mount + re-initialize if agent/property changes
  useEffect(() => {
    sessionRef.current = loadSession(agentId, propertyId);
    setMessages([initialGreeting]);
    setLeadSubmitted(false);
    setLeadDismissed(false);
  }, [agentId, propertyId, initialGreeting]);

  // Keep the transcript-ref synced so the pagehide listener reads
  // the latest snapshot without stale-closure issues.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Build + ship the transcript. Skipped when the visitor never
  // typed (greeting-only sessions aren't worth emailing). Includes
  // the conversation_id so the operator can cross-reference the
  // dashboard /admin/ai-overview view.
  const shipTranscript = useCallback(() => {
    if (transcriptSentRef.current) return;
    const snapshot = messagesRef.current;
    const hasUserTurn = snapshot.some((m) => m.role === 'user');
    if (!hasUserTurn) return;
    transcriptSentRef.current = true;
    sendAgentTranscriptBeacon({
      source: 'per-agent',
      locale: buyerLocale,
      pageUrl: typeof window !== 'undefined' ? window.location.href : null,
      subscriber: subscriberRef.current,
      conversationId: sessionRef.current.conversationId,
      agentName,
      messages: snapshot
        .filter((m) => m.id !== initialGreeting.id)
        .map((m) => ({
          role: m.role,
          body: m.body,
          ...(m.at ? { at: m.at } : {}),
        })),
      endedAt: new Date().toISOString(),
    });
  }, [agentName, buyerLocale, initialGreeting.id]);

  // pagehide: catch tab-close / navigation away while chat is open.
  useEffect(() => {
    const onPageHide = () => {
      if (isOpen) shipTranscript();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [isOpen, shipTranscript]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  // HITL polling — every 5s while the widget is open AND the
  // conversation is established, fetch the server's view of the
  // thread from /api/ai-chat/poll. The buyer-side endpoint is gated
  // by the per-conversation `buyer_session_token` so the same
  // anonymous browser sees only its own conversation.
  //
  // Why poll instead of WebSockets / SSE-push: Cloudflare Pages
  // anonymous-browser server-push is fiddly; a 5s poll is dirt-cheap
  // (~$0 at our volumes), survives refresh / network drops without
  // state, and absorbs the agent's approve / edit / reject without
  // any extra plumbing on the dashboard side.
  //
  // Reconciliation strategy is intentionally coarse: we replace the
  // local non-greeting / non-streaming rows with the server set.
  // - "Greeting" rows (id = 'greeting') stay; they're synthetic.
  // - "Streaming" rows (streaming: true) stay; the SSE is still
  //   landing deltas into them. The poll is paused effectively when
  //   sending=true.
  // - Everything else is replaced by the server view. Rejected rows
  //   are server-side filtered out (the buyer never sees a draft
  //   the agent killed).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        // Re-read sessionRef on every tick so we pick up the
        // conversationId after the first SSE round-trip lands it.
        const convoId = sessionRef.current.conversationId;
        const sessionToken = sessionRef.current.sessionToken;
        if (!convoId || !sessionToken || sending) return; // skip; retry next tick

        const url = `/api/ai-chat/poll?conversationId=${encodeURIComponent(convoId)}&sessionToken=${encodeURIComponent(sessionToken)}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok: boolean;
          messages?: Array<{
            id: string;
            role: 'user' | 'assistant' | 'system' | 'tool';
            body: string;
            approval_status: 'pending' | 'approved' | 'auto_sent' | 'rejected' | null;
            created_at: string;
          }>;
        };
        if (!data.ok || !Array.isArray(data.messages) || cancelled) return;

        setMessages((prev) => {
          // Keep the greeting + any streaming-in-progress rows
          // unchanged.
          const keep = prev.filter(
            (m) => m.id === 'greeting' || m.streaming === true,
          );
          // Convert the server rows that aren't tool / system into
          // widget Message rows.
          const serverMessages: Message[] = data
            .messages!.filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              body: m.body,
              approvalStatus:
                m.role === 'assistant'
                  ? m.approval_status === 'pending'
                    ? 'pending'
                    : 'auto_sent'
                  : undefined,
            }));
          return [...keep, ...serverMessages];
        });
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[ai-chat-widget] poll error', err);
        }
      } finally {
        if (!cancelled) timerId = setTimeout(tick, 5000);
      }
    };

    // Start the first tick after 5s so the local optimistic-insert
    // flow lands first without contention.
    timerId = setTimeout(tick, 5000);

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [isOpen, sending]);

  const userTurnCount = messages.filter((m) => m.role === 'user').length;
  const shouldShowLeadCapture =
    userTurnCount >= 3 && !leadSubmitted && !leadDismissed;

  const submitLead = useCallback(async () => {
    if (!propertyId) {
      // Without a property anchor /api/leads can't write the row
      // (property_id is non-null in the leads table). Just dismiss the
      // capture banner so the conversation stays open.
      setLeadDismissed(true);
      return;
    }
    if (!leadEmail.trim() && !leadPhone.trim()) {
      return;
    }
    setLeadSending(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          source: 'form',
          contact_name: undefined,
          contact_email: leadEmail.trim() || undefined,
          contact_phone: leadPhone.trim() || undefined,
          message: `Captured via AI chat widget. Buyer wants direct follow-up from ${agentName}.`,
          language: buyerLocale,
          website: '',
        }),
      });
      if (res.ok) {
        setLeadSubmitted(true);
      } else {
        // Soft-fail: hide the form anyway so the buyer can keep
        // chatting. We log to console for the dev investigating.
        console.warn('[ai-chat-widget] lead submit non-ok', res.status);
        setLeadDismissed(true);
      }
    } catch (err) {
      console.warn('[ai-chat-widget] lead submit error', err);
      setLeadDismissed(true);
    } finally {
      setLeadSending(false);
    }
  }, [agentName, buyerLocale, leadEmail, leadPhone, propertyId]);

  const sendMessage = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim();
      if (!trimmed || sending) return;
      setError(null);

      const userId = generateUuid();
      const assistantId = generateUuid();
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', body: trimmed, at: new Date().toISOString() },
        { id: assistantId, role: 'assistant', body: '', streaming: true, at: new Date().toISOString() },
      ]);
      setDraft('');
      setSending(true);

      try {
        const res = await fetch('/api/ai-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversationId: sessionRef.current.conversationId,
            agentId,
            propertyId,
            buyerLocale,
            userMessage: trimmed,
            sessionToken: sessionRef.current.sessionToken,
          }),
        });

        if (!res.ok || !res.body) {
          setError(copy.errorGeneric);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, body: copy.errorGeneric, streaming: false }
                : m,
            ),
          );
          return;
        }

        // Parse SSE frames out of the streaming body. Frames are
        // separated by `\n\n`; each frame is `event: <name>\ndata: <json>`.
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Drain whole frames out of the buffer.
          let frameEnd = buffer.indexOf('\n\n');
          while (frameEnd !== -1) {
            const frame = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);
            frameEnd = buffer.indexOf('\n\n');

            const lines = frame.split('\n');
            let eventName = 'message';
            let dataStr = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) eventName = line.slice(7);
              else if (line.startsWith('data: ')) dataStr = line.slice(6);
            }
            if (!dataStr) continue;
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(dataStr) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (eventName === 'conversation') {
              const convoId = (payload.conversationId ?? null) as string | null;
              if (convoId && convoId !== sessionRef.current.conversationId) {
                sessionRef.current = {
                  ...sessionRef.current,
                  conversationId: convoId,
                };
                saveSession(agentId, propertyId, sessionRef.current);
              }
            } else if (eventName === 'text-delta') {
              const delta = (payload.delta ?? '') as string;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, body: m.body + delta }
                    : m,
                ),
              );
            } else if (eventName === 'tool-call') {
              const name = (payload.name ?? '') as string;
              // Render an inline stub so the buyer sees something is
              // happening; the actual answer arrives in subsequent
              // text-delta events.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        body: m.body
                          ? `${m.body}\n${copy.toolStub(name)}`
                          : copy.toolStub(name),
                      }
                    : m,
                ),
              );
            } else if (eventName === 'done') {
              const approvalStatus =
                (payload.approvalStatus ?? 'pending') === 'auto_sent'
                  ? ('auto_sent' as const)
                  : ('pending' as const);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, approvalStatus, streaming: false }
                    : m,
                ),
              );
            } else if (eventName === 'error') {
              setError(copy.errorGeneric);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        body: m.body || copy.errorGeneric,
                        streaming: false,
                      }
                    : m,
                ),
              );
            }
          }
        }

        // Defensive: clear `streaming` if no `done` event arrived.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.streaming ? { ...m, streaming: false } : m,
          ),
        );
      } catch (err) {
        console.warn('[ai-chat-widget] send error', err);
        setError(copy.errorGeneric);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, body: m.body || copy.errorGeneric, streaming: false }
              : m,
          ),
        );
      } finally {
        setSending(false);
      }
    },
    [agentId, buyerLocale, copy, propertyId, sending],
  );

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void sendMessage(draft);
  };

  return (
    <>
      {/* Floating launcher — bottom-LEFT so Tawk (bottom-right) can
          continue to run during the coexistence period. */}
      {!isOpen && (
        <button
          type="button"
          aria-label={copy.open}
          onClick={() => setIsOpen(true)}
          className="fixed bottom-5 left-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-action text-white shadow-lg transition hover:scale-105 active:scale-95 dark:bg-action-dark dark:text-surface-deep"
        >
          {agentAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agentAvatarUrl}
              alt=""
              className="h-12 w-12 rounded-full border-2 border-white object-cover"
            />
          ) : (
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          )}
        </button>
      )}

      {/* Open panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label={`Chat with ${agentName}`}
          className="fixed bottom-5 left-5 z-40 flex h-[560px] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-card border border-border bg-surface shadow-2xl dark:bg-surface-deep"
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 dark:bg-surface-deep">
            {agentAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agentAvatarUrl}
                alt={agentName}
                className="h-10 w-10 rounded-full border border-border object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-action/10 font-brand text-sm font-semibold text-action dark:bg-action-dark/15 dark:text-action-dark"
              >
                {agentName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? '')
                  .join('') || '·'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-brand text-sm font-semibold tracking-tight">
                {agentName}
              </p>
              <p className="text-xs text-helper">AI assistant</p>
            </div>
            <button
              type="button"
              aria-label={copy.close}
              onClick={() => {
                shipTranscript();
                setIsOpen(false);
              }}
              className="rounded-md p-1.5 text-helper transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Pre-chat gate. Wait for the localStorage probe to settle
              (gateInitialized) before deciding what to render — this
              avoids a brief "gate flash" on returning visitors during
              the first paint. */}
          {gateInitialized && !gateInfo ? (
            <div className="flex-1 overflow-y-auto">
              <PreChatGate
                onAccepted={(res) => setGateInfo(res)}
                copy={copy.gate}
              />
            </div>
          ) : (
            <>

          {/* Message list */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3"
          >
            <ul className="space-y-3">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={
                      m.role === 'user'
                        ? 'inline-block max-w-[85%] rounded-2xl rounded-br-sm bg-action px-3 py-2 text-sm text-white dark:bg-action-dark dark:text-surface-deep'
                        : 'inline-block max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-2 text-sm text-ink shadow-whisper dark:bg-surface-deep dark:text-ink-inverse'
                    }
                  >
                    <ChatMessageBody body={m.body} streaming={m.streaming} />
                    {m.role === 'assistant' && m.approvalStatus === 'pending' && (
                      // Per D2=A: surface that the human will review.
                      // When D2 flips to B and auto_sent rows arrive,
                      // this badge disappears for those messages.
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-helper">
                        · {copy.awaitingReview}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Lead-capture inline form. Shown after 3 buyer turns
                unless the buyer has already submitted or dismissed. */}
            {shouldShowLeadCapture && (
              <div className="mt-4 rounded-card border border-dashed border-border-strong/60 bg-surface-muted/40 p-3 dark:bg-surface-dark/40">
                <p className="text-sm font-medium">
                  {copy.leadHeading(agentName)}
                </p>
                <p className="mt-1 text-xs text-helper">{copy.leadCta}</p>
                {leadSubmitted ? (
                  <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
                    {copy.leadSubmitted}
                  </p>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitLead();
                    }}
                    className="mt-3 space-y-2"
                  >
                    <input
                      type="email"
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      placeholder={copy.leadEmailPlaceholder}
                      className="block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                    />
                    <input
                      type="tel"
                      value={leadPhone}
                      onChange={(e) => setLeadPhone(e.target.value)}
                      placeholder={copy.leadPhonePlaceholder}
                      className="block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setLeadDismissed(true)}
                        className="text-xs text-helper underline-offset-2 hover:underline"
                      >
                        {copy.leadSkip}
                      </button>
                      <button
                        type="submit"
                        disabled={leadSending || (!leadEmail.trim() && !leadPhone.trim())}
                        className="inline-flex h-8 items-center rounded-lg bg-action px-3 text-xs font-semibold text-white shadow-whisper transition hover:opacity-95 disabled:opacity-50 dark:bg-action-dark dark:text-surface-deep"
                      >
                        {copy.leadSubmit}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
              >
                {error}
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={onSubmit}
            className="border-t border-border bg-surface p-3 dark:bg-surface-deep"
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={copy.placeholder}
                disabled={sending}
                className="flex-1 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action disabled:opacity-50 dark:bg-surface-deep dark:focus:ring-action-dark"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="inline-flex h-9 items-center rounded-lg bg-action px-4 text-sm font-semibold text-white shadow-whisper transition hover:opacity-95 disabled:opacity-50 dark:bg-action-dark dark:text-surface-deep"
              >
                {copy.send}
              </button>
            </div>
          </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
