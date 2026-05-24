'use client';

/**
 * AHO Assistant widget — platform-side chat for visitors who need
 * help with AHO ITSELF (not a specific listing/agent). Cousin of
 * `<AiChatWidget>` but:
 *   - No agentId / propertyId props (the AHO Assistant is platform-
 *     wide, not agent-anchored).
 *   - Stateless backend (`/api/aho-assistant` doesn't persist; client
 *     manages history in local state).
 *   - No HITL — replies stream directly. The AHO Assistant is
 *     answering Q&A about AHO; there's no human approver in the loop.
 *   - No lead-capture form. If the user wants an agent, the assistant
 *     directs them to /search or /agents/[slug].
 *
 * Mounted on:
 *   - / (homepage)
 *   - /pricing, /for-agents, /automation, /save-time
 *   - /docs
 *   - /dashboard layout shell (the dashboard root chrome)
 *
 * Pinned bottom-RIGHT so it doesn't collide with the per-agent
 * `<AiChatWidget>` (bottom-left on /properties/[slug] + /agents/[slug]).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatMessageBody } from './render-message';
import { ChatModePicker, type ChatModePickerCopy } from './chat-mode-picker';
import { VoiceControls, type VoiceControlsCopy, isVoiceSupported } from './voice-controls';
import {
  PreChatGate,
  readStoredAcceptance,
  type GateResult,
} from './pre-chat-gate';
import { GATE_COPY } from './pre-chat-gate-copy';

export type AhoAssistantLocale =
  | 'en'
  | 'es'
  | 'pl'
  | 'pt'
  | 'de'
  | 'fr'
  | 'it';

export type AhoAssistantSurface =
  | 'home'
  | 'pricing'
  | 'for-agents'
  | 'automation'
  | 'save-time'
  | 'docs'
  | 'dashboard'
  | 'sell'
  | 'other';

export interface AhoAssistantWidgetProps {
  userLocale: AhoAssistantLocale;
  /** Which AHO surface the widget is mounted on. Drives the system
   *  prompt's contextual bias (lead with pricing on /pricing, lead
   *  with onboarding on /for-agents, etc). */
  surfaceContext: AhoAssistantSurface;
  /** Whether the user is signed in. Lets the assistant reference
   *  dashboard surfaces vs. sign-up prompts. */
  isAuthenticated?: boolean;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  streaming?: boolean;
  /** ISO timestamp captured when the bubble first renders. Carried
   *  into the transcript email so the operator sees pacing. */
  at?: string;
}

/**
 * Best-effort transcript-to-email beacon. Called from the close-button
 * onClick and from a `pagehide` listener. Uses `navigator.sendBeacon`
 * when available (queues the POST + survives page unmount), falls
 * back to `fetch` with `keepalive: true` for the same survival
 * guarantee. Both call sites tolerate failure silently — operator
 * email might be missed in pathological cases but the chat itself
 * keeps working.
 */
function sendTranscriptBeacon(payload: unknown): void {
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
    /* widget already torn down — nothing else to do */
  }
}

/** Map our app locale codes to BCP-47 tags the Web Speech API expects
 *  for SR + TTS. Browser voice catalogs vary by OS; the API picks the
 *  closest match if the exact tag isn't installed. */
const USER_LOCALE_TO_BCP47: Record<string, string> = {
  en: 'en-US',
  es: 'es-DO',  // Spanish (Dominican Republic) — falls back to es-ES
  pl: 'pl-PL',
  pt: 'pt-PT',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
};

const COPY: Record<AhoAssistantLocale, {
  greeting: string;
  placeholder: string;
  send: string;
  open: string;
  close: string;
  errorGeneric: string;
  toolStub: (name: string) => string;
  modePicker: ChatModePickerCopy;
  voice: VoiceControlsCopy;
  switchToText: string;
  switchToVoice: string;
}> = {
  en: {
    greeting: "Hi! I'm the AHO assistant. Ask me about pricing, features, or how to get started.",
    placeholder: 'Type a question…',
    send: 'Send',
    open: 'Chat with the AHO assistant',
    close: 'Close chat',
    errorGeneric: 'Something went wrong. Try again in a moment.',
    toolStub: (name) => `(checking ${name.replace(/_/g, ' ')}…)`,
    modePicker: {
      heading: 'How would you like to chat?',
      sub: 'You can switch any time from the top of the chat.',
      textLabel: 'Text',
      textHint: 'Type your questions',
      voiceLabel: 'Voice',
      voiceHint: 'Talk hands-free',
      voiceUnsupported: 'Not supported in this browser',
    },
    voice: {
      tapToSpeak: 'Tap to speak',
      tapToStop: 'Tap to stop',
      listening: 'Listening…',
      thinking: 'Thinking…',
      speaking: 'Speaking',
      tapToInterrupt: 'Tap to interrupt',
      permissionDenied: "Mic permission denied. Switching to text.",
      unsupported: 'Voice is not supported in this browser. Use text instead.',
      switchToText: 'Switch to text',
    },
    switchToText: 'Text',
    switchToVoice: 'Voice',
  },
  es: {
    greeting: '¡Hola! Soy el asistente de AHO. Pregúntame sobre precios, funciones o cómo empezar.',
    placeholder: 'Escribe una pregunta…',
    send: 'Enviar',
    open: 'Chatear con el asistente de AHO',
    close: 'Cerrar chat',
    errorGeneric: 'Algo salió mal. Inténtalo de nuevo.',
    toolStub: (name) => `(consultando ${name.replace(/_/g, ' ')}…)`,
    modePicker: {
      heading: '¿Cómo prefieres chatear?',
      sub: 'Puedes cambiar en cualquier momento desde la parte superior del chat.',
      textLabel: 'Texto',
      textHint: 'Escribe tus preguntas',
      voiceLabel: 'Voz',
      voiceHint: 'Habla sin manos',
      voiceUnsupported: 'No disponible en este navegador',
    },
    voice: {
      tapToSpeak: 'Toca para hablar',
      tapToStop: 'Toca para detener',
      listening: 'Escuchando…',
      thinking: 'Pensando…',
      speaking: 'Hablando',
      tapToInterrupt: 'Toca para interrumpir',
      permissionDenied: 'Permiso de micrófono denegado. Cambiando a texto.',
      unsupported: 'La voz no está disponible en este navegador. Usa texto en su lugar.',
      switchToText: 'Cambiar a texto',
    },
    switchToText: 'Texto',
    switchToVoice: 'Voz',
  },
  pl: {
    greeting: 'Cześć! Jestem asystentem AHO. Zapytaj o ceny, funkcje lub jak zacząć.',
    placeholder: 'Wpisz pytanie…',
    send: 'Wyślij',
    open: 'Rozmawiaj z asystentem AHO',
    close: 'Zamknij czat',
    errorGeneric: 'Coś poszło nie tak. Spróbuj ponownie.',
    toolStub: (name) => `(sprawdzanie ${name.replace(/_/g, ' ')}…)`,
    modePicker: {
      heading: 'Jak chcesz rozmawiać?',
      sub: 'Możesz to zmienić w dowolnej chwili u góry czatu.',
      textLabel: 'Tekst',
      textHint: 'Wpisuj pytania',
      voiceLabel: 'Głos',
      voiceHint: 'Rozmawiaj bez rąk',
      voiceUnsupported: 'Nieobsługiwane w tej przeglądarce',
    },
    voice: {
      tapToSpeak: 'Dotknij, aby mówić',
      tapToStop: 'Dotknij, aby zatrzymać',
      listening: 'Słucham…',
      thinking: 'Myślę…',
      speaking: 'Mówię',
      tapToInterrupt: 'Dotknij, aby przerwać',
      permissionDenied: 'Brak dostępu do mikrofonu. Przełączam na tekst.',
      unsupported: 'Głos nie jest obsługiwany w tej przeglądarce. Użyj tekstu.',
      switchToText: 'Przełącz na tekst',
    },
    switchToText: 'Tekst',
    switchToVoice: 'Głos',
  },
  pt: {
    greeting: 'Oi! Sou o assistente da AHO. Pergunte sobre preços, recursos ou como começar.',
    placeholder: 'Digite uma pergunta…',
    send: 'Enviar',
    open: 'Conversar com o assistente da AHO',
    close: 'Fechar chat',
    errorGeneric: 'Algo deu errado. Tente novamente.',
    toolStub: (name) => `(consultando ${name.replace(/_/g, ' ')}…)`,
    modePicker: {
      heading: 'Como prefere conversar?',
      sub: 'Pode mudar a qualquer momento no topo do chat.',
      textLabel: 'Texto',
      textHint: 'Escreva as suas perguntas',
      voiceLabel: 'Voz',
      voiceHint: 'Fale sem mãos',
      voiceUnsupported: 'Não suportado neste navegador',
    },
    voice: {
      tapToSpeak: 'Toque para falar',
      tapToStop: 'Toque para parar',
      listening: 'A escutar…',
      thinking: 'A pensar…',
      speaking: 'A falar',
      tapToInterrupt: 'Toque para interromper',
      permissionDenied: 'Permissão do microfone negada. A mudar para texto.',
      unsupported: 'A voz não é suportada neste navegador. Use texto.',
      switchToText: 'Mudar para texto',
    },
    switchToText: 'Texto',
    switchToVoice: 'Voz',
  },
  de: {
    greeting: 'Hallo! Ich bin der AHO-Assistent. Frag mich nach Preisen, Funktionen oder wie du loslegst.',
    placeholder: 'Frage stellen…',
    send: 'Senden',
    open: 'Mit dem AHO-Assistenten chatten',
    close: 'Chat schließen',
    errorGeneric: 'Etwas ist schiefgegangen. Bitte erneut versuchen.',
    toolStub: (name) => `(prüfe ${name.replace(/_/g, ' ')}…)`,
    modePicker: {
      heading: 'Wie möchten Sie chatten?',
      sub: 'Sie können jederzeit oben im Chat wechseln.',
      textLabel: 'Text',
      textHint: 'Fragen eingeben',
      voiceLabel: 'Sprache',
      voiceHint: 'Freihändig sprechen',
      voiceUnsupported: 'In diesem Browser nicht unterstützt',
    },
    voice: {
      tapToSpeak: 'Tippen zum Sprechen',
      tapToStop: 'Tippen zum Stoppen',
      listening: 'Höre zu…',
      thinking: 'Denke nach…',
      speaking: 'Spreche',
      tapToInterrupt: 'Tippen zum Unterbrechen',
      permissionDenied: 'Mikrofon-Berechtigung verweigert. Wechsel zu Text.',
      unsupported: 'Sprache wird in diesem Browser nicht unterstützt. Verwenden Sie Text.',
      switchToText: 'Zu Text wechseln',
    },
    switchToText: 'Text',
    switchToVoice: 'Sprache',
  },
  fr: {
    greeting: "Bonjour ! Je suis l'assistant AHO. Posez-moi des questions sur les tarifs, fonctionnalités ou démarrage.",
    placeholder: 'Posez une question…',
    send: 'Envoyer',
    open: "Discuter avec l'assistant AHO",
    close: 'Fermer le chat',
    errorGeneric: "Une erreur s'est produite. Réessayez.",
    toolStub: (name) => `(vérification ${name.replace(/_/g, ' ')}…)`,
    modePicker: {
      heading: 'Comment voulez-vous discuter ?',
      sub: 'Vous pouvez changer à tout moment depuis le haut du chat.',
      textLabel: 'Texte',
      textHint: 'Tapez vos questions',
      voiceLabel: 'Voix',
      voiceHint: 'Parlez sans les mains',
      voiceUnsupported: 'Non pris en charge dans ce navigateur',
    },
    voice: {
      tapToSpeak: 'Appuyez pour parler',
      tapToStop: 'Appuyez pour arrêter',
      listening: 'En écoute…',
      thinking: 'Réflexion…',
      speaking: 'Parle',
      tapToInterrupt: 'Appuyez pour interrompre',
      permissionDenied: 'Accès au micro refusé. Passage au texte.',
      unsupported: "La voix n'est pas prise en charge dans ce navigateur. Utilisez le texte.",
      switchToText: 'Passer au texte',
    },
    switchToText: 'Texte',
    switchToVoice: 'Voix',
  },
  it: {
    greeting: "Ciao! Sono l'assistente AHO. Chiedi di prezzi, funzioni o come iniziare.",
    placeholder: 'Scrivi una domanda…',
    send: 'Invia',
    open: "Chatta con l'assistente AHO",
    close: 'Chiudi chat',
    errorGeneric: 'Qualcosa è andato storto. Riprova.',
    toolStub: (name) => `(controllo ${name.replace(/_/g, ' ')}…)`,
    modePicker: {
      heading: 'Come vuoi chattare?',
      sub: 'Puoi cambiare in qualsiasi momento dalla parte alta della chat.',
      textLabel: 'Testo',
      textHint: 'Scrivi le tue domande',
      voiceLabel: 'Voce',
      voiceHint: 'Parla a mani libere',
      voiceUnsupported: 'Non supportato in questo browser',
    },
    voice: {
      tapToSpeak: 'Tocca per parlare',
      tapToStop: 'Tocca per fermare',
      listening: 'In ascolto…',
      thinking: 'Sto pensando…',
      speaking: 'Sto parlando',
      tapToInterrupt: 'Tocca per interrompere',
      permissionDenied: 'Permesso microfono negato. Passaggio al testo.',
      unsupported: 'La voce non è supportata in questo browser. Usa il testo.',
      switchToText: 'Passa al testo',
    },
    switchToText: 'Testo',
    switchToVoice: 'Voce',
  },
};

function genId(): string {
  // Lightweight non-cryptographic id, plenty for client-side message keys.
  return Math.random().toString(36).slice(2, 10);
}

export function AhoAssistantWidget({
  userLocale,
  surfaceContext,
  isAuthenticated = false,
}: AhoAssistantWidgetProps) {
  const copy = COPY[userLocale] ?? COPY.en;
  const gateCopy = GATE_COPY[userLocale] ?? GATE_COPY.en;
  const [isOpen, setIsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Chat mode (text vs voice). null = the mode picker is showing.
  // Once the user picks, this persists for the session via localStorage
  // so reloads don't re-prompt. The header toggle re-writes it.
  const [chatMode, setChatMode] = useState<'text' | 'voice' | null>(null);
  const [chatModeInitialized, setChatModeInitialized] = useState(false);
  // BCP-47 locale for SR + TTS. Maps userLocale → regional voice tag.
  const voiceLocale = useMemo(() => USER_LOCALE_TO_BCP47[userLocale] ?? 'en-US', [userLocale]);
  // The text the voice controls should speak next (typically the most
  // recent assistant message in voice mode). When VoiceControls calls
  // onSpeakDone, we mark this ID as spoken so we don't re-speak it.
  const [voicePendingText, setVoicePendingText] = useState<string>('');
  const [voiceSpokenIds] = useState<Set<string>>(() => new Set());

  // Persist mode across reloads in the same session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem('aho:assistant-mode:v1');
      if (stored === 'text' || stored === 'voice') {
        setChatMode(stored);
      }
    } catch {
      /* private mode / storage disabled */
    }
    setChatModeInitialized(true);
  }, []);
  const pickMode = useCallback((m: 'text' | 'voice') => {
    setChatMode(m);
    try {
      window.localStorage.setItem('aho:assistant-mode:v1', m);
    } catch {
      /* noop */
    }
  }, []);

  // Pre-chat gate state. Same localStorage key as the per-agent
  // widget so a visitor who consented on /properties/[slug] doesn't
  // see the gate again on /pricing or /sell.
  const [gateInfo, setGateInfo] = useState<GateResult | null>(null);
  const [gateInitialized, setGateInitialized] = useState(false);
  useEffect(() => {
    setGateInfo(readStoredAcceptance());
    setGateInitialized(true);
  }, []);
  // Refs used by the transcript-shipper. The `messagesRef` keeps an
  // always-fresh snapshot of state for the `pagehide` listener (which
  // captures variables once at attach time + needs a way to read the
  // latest messages without re-attaching on every state change).
  // `transcriptSentRef` prevents double-firing if both the × button
  // AND the pagehide fire within the same shutdown window.
  const messagesRef = useRef<Msg[]>([]);
  const transcriptSentRef = useRef(false);
  const subscriberRef = useRef<GateResult | null>(null);
  useEffect(() => {
    subscriberRef.current = gateInfo;
  }, [gateInfo]);

  const greeting: Msg = useMemo(
    () => ({ id: 'greeting', role: 'assistant', body: copy.greeting }),
    [copy.greeting],
  );
  const [messages, setMessages] = useState<Msg[]>([greeting]);

  // Mirror messages into the ref every render so the close/unload
  // callbacks see the latest transcript without depending on stale
  // closure captures.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // VOICE MODE: when a new assistant message lands AND we're in voice
  // mode AND that message hasn't been spoken yet, feed its body to
  // VoiceControls for TTS. Skip the greeting (it'd play on every
  // open) and skip streaming-incomplete rows (wait for the full body).
  useEffect(() => {
    if (chatMode !== 'voice' || messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (!latest) return;
    if (latest.role !== 'assistant') return;
    if (latest.streaming) return;          // still streaming; wait
    if (latest.id === 'greeting') return;  // don't re-greet on every open
    if (voiceSpokenIds.has(latest.id)) return;
    setVoicePendingText(latest.body);
  }, [messages, chatMode, voiceSpokenIds]);

  const handleSpeakDone = useCallback(() => {
    // Mark the just-spoken message as consumed.
    const latest = messages[messages.length - 1];
    if (latest?.id) voiceSpokenIds.add(latest.id);
    setVoicePendingText('');
  }, [messages, voiceSpokenIds]);

  const handleVoiceFallback = useCallback(
    (_reason: 'unsupported' | 'permission_denied') => {
      // Either no browser support OR mic permission denied.
      // Fall back to text mode + persist so we don't re-prompt.
      pickMode('text');
    },
    [pickMode],
  );

  // Helper: build the payload + ship it. No-op when the visitor
  // didn't send a single message (just opened the chat + closed).
  const shipTranscript = useCallback(() => {
    if (transcriptSentRef.current) return;
    const snapshot = messagesRef.current;
    const hasUserTurn = snapshot.some((m) => m.role === 'user');
    if (!hasUserTurn) return;
    transcriptSentRef.current = true;
    sendTranscriptBeacon({
      source: 'aho-assistant',
      locale: userLocale,
      pageUrl: typeof window !== 'undefined' ? window.location.href : null,
      subscriber: subscriberRef.current,
      conversationId: null,
      messages: snapshot
        .filter((m) => m.id !== 'greeting')
        .map((m) => ({
          role: m.role,
          body: m.body,
          ...(m.at ? { at: m.at } : {}),
        })),
      endedAt: new Date().toISOString(),
    });
  }, [userLocale]);

  // Page-unload safety net — captures Cmd-W / tab-close / navigation
  // away while the chat is open. sendBeacon survives the unload; the
  // operator gets the transcript even when the visitor never clicks ×.
  useEffect(() => {
    const onPageHide = () => {
      if (isOpen) shipTranscript();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [isOpen, shipTranscript]);

  // Reset to the greeting when locale changes (rare; mostly when the
  // language toggle fires while the widget is mounted).
  useEffect(() => {
    setMessages([greeting]);
  }, [greeting]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const sendMessage = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim();
      if (!trimmed || sending) return;
      setError(null);

      const userId = genId();
      const assistantId = genId();
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', body: trimmed, at: new Date().toISOString() },
        { id: assistantId, role: 'assistant', body: '', streaming: true, at: new Date().toISOString() },
      ]);
      setDraft('');
      setSending(true);

      // Build the priorMessages payload (everything in the local
      // history EXCEPT the synthetic greeting + the row we just
      // appended for streaming).
      const priorMessages = messages
        .filter((m) => m.id !== 'greeting')
        .map((m) => ({ role: m.role, content: m.body }));

      try {
        const res = await fetch('/api/aho-assistant', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            userLocale,
            channel: 'web_chat',
            isAuthenticated,
            surfaceContext,
            userMessage: trimmed,
            priorMessages,
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

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frame parsing — split on blank line.
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let eventName: string | null = null;
            let dataStr = '';
            for (const line of raw.split('\n')) {
              if (line.startsWith('event: ')) {
                eventName = line.slice('event: '.length).trim();
              } else if (line.startsWith('data: ')) {
                dataStr += line.slice('data: '.length);
              }
            }
            if (!eventName || !dataStr) continue;
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(dataStr) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (eventName === 'text-delta') {
              const delta = (payload.delta ?? '') as string;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, body: m.body + delta } : m,
                ),
              );
            } else if (eventName === 'tool-call') {
              const name = (payload.name ?? '') as string;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        body: m.body ? `${m.body}\n${copy.toolStub(name)}` : copy.toolStub(name),
                      }
                    : m,
                ),
              );
            } else if (eventName === 'done') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, streaming: false } : m,
                ),
              );
            }
          }
        }
      } catch (err) {
        console.warn('[aho-assistant] stream error', err);
        setError(copy.errorGeneric);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, body: copy.errorGeneric, streaming: false }
              : m,
          ),
        );
      } finally {
        setSending(false);
      }
    },
    [copy, isAuthenticated, messages, sending, surfaceContext, userLocale],
  );

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={copy.open}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-action/30 bg-action text-base text-white shadow-lg transition hover:scale-105 dark:border-action-dark/40 dark:bg-action-dark"
      >
        <span aria-hidden="true" className="text-xl">?</span>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={copy.open}
      className="fixed bottom-5 right-5 z-40 flex h-[560px] w-[380px] flex-col overflow-hidden rounded-card border border-border bg-surface shadow-2xl dark:border-border-strong/40 dark:bg-surface-deep"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted/60 px-4 py-3 dark:border-border-strong/40 dark:bg-surface-deep">
        <div className="min-w-0 flex-1">
          <p className="font-brand text-sm font-semibold tracking-tight">AHO assistant</p>
          <p className="text-xs text-helper">Platform Q&amp;A · {userLocale.toUpperCase()}</p>
        </div>
        {/* Mode-switch toggle. Only shown once the gate is passed AND
            a mode has been picked; before that the picker handles
            selection. */}
        {gateInfo && chatMode && (
          <div
            role="tablist"
            aria-label="Chat mode"
            className="flex items-center rounded-full border border-border bg-surface p-0.5 text-xs dark:border-border-strong/40 dark:bg-surface-deep"
          >
            <button
              type="button"
              role="tab"
              aria-selected={chatMode === 'text'}
              onClick={() => pickMode('text')}
              className={`rounded-full px-2.5 py-1 font-semibold transition ${
                chatMode === 'text'
                  ? 'bg-emerald-600 text-white'
                  : 'text-ink-muted hover:bg-black/5 dark:text-ink-inverse-muted dark:hover:bg-white/5'
              }`}
            >
              {copy.switchToText}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chatMode === 'voice'}
              onClick={() => pickMode('voice')}
              disabled={!isVoiceSupported()}
              className={`rounded-full px-2.5 py-1 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                chatMode === 'voice'
                  ? 'bg-emerald-600 text-white'
                  : 'text-ink-muted hover:bg-black/5 dark:text-ink-inverse-muted dark:hover:bg-white/5'
              }`}
            >
              {copy.switchToVoice}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            shipTranscript();
            setIsOpen(false);
          }}
          aria-label={copy.close}
          className="rounded-full p-1 text-ink-muted transition hover:bg-black/5 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-white/5 dark:hover:text-ink-inverse"
        >
          ×
        </button>
      </header>
      {gateInitialized && !gateInfo ? (
        <div className="flex-1 overflow-y-auto">
          <PreChatGate
            onAccepted={(res) => setGateInfo(res)}
            copy={gateCopy}
          />
        </div>
      ) : gateInitialized && chatModeInitialized && !chatMode ? (
        // Gate passed but no mode picked yet → show the picker.
        // Persists the selection in localStorage so reloads skip this.
        <div className="flex-1 overflow-y-auto">
          <ChatModePicker copy={copy.modePicker} onPick={pickMode} />
        </div>
      ) : (
        <>
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === 'user'
                ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-action/10 px-3 py-2 text-ink dark:bg-action-dark/20 dark:text-ink-inverse'
                : 'mr-auto max-w-[90%] rounded-2xl rounded-bl-sm bg-surface-muted/60 px-3 py-2 text-ink dark:bg-surface-dark/60 dark:text-ink-inverse'
            }
          >
            <ChatMessageBody body={m.body} streaming={m.streaming} />
          </div>
        ))}
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
      {chatMode === 'voice' ? (
        <div className="border-t border-border bg-surface dark:border-border-strong/40 dark:bg-surface-deep">
          <VoiceControls
            voiceLocale={voiceLocale}
            onUserTranscript={(text) => void sendMessage(text)}
            speakText={voicePendingText}
            onSpeakDone={handleSpeakDone}
            disabled={sending}
            onUnrecoverable={handleVoiceFallback}
            copy={copy.voice}
          />
        </div>
      ) : (
        <form
          className="flex items-center gap-2 border-t border-border bg-surface px-3 py-3 dark:border-border-strong/40 dark:bg-surface-deep"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(draft);
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={copy.placeholder}
            disabled={sending}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-hidden focus:border-action disabled:opacity-60 dark:border-border-strong/40 dark:bg-surface-dark dark:text-ink-inverse"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            className="btn-primary inline-flex h-9 items-center px-3 text-sm font-semibold disabled:opacity-60"
          >
            {copy.send}
          </button>
        </form>
      )}
        </>
      )}
    </div>
  );
}
