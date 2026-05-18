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
}

const COPY: Record<AhoAssistantLocale, {
  greeting: string;
  placeholder: string;
  send: string;
  open: string;
  close: string;
  errorGeneric: string;
  toolStub: (name: string) => string;
}> = {
  en: {
    greeting: "Hi! I'm the AHO assistant. Ask me about pricing, features, or how to get started.",
    placeholder: 'Type a question…',
    send: 'Send',
    open: 'Chat with the AHO assistant',
    close: 'Close chat',
    errorGeneric: 'Something went wrong. Try again in a moment.',
    toolStub: (name) => `(checking ${name.replace(/_/g, ' ')}…)`,
  },
  es: {
    greeting: '¡Hola! Soy el asistente de AHO. Pregúntame sobre precios, funciones o cómo empezar.',
    placeholder: 'Escribe una pregunta…',
    send: 'Enviar',
    open: 'Chatear con el asistente de AHO',
    close: 'Cerrar chat',
    errorGeneric: 'Algo salió mal. Inténtalo de nuevo.',
    toolStub: (name) => `(consultando ${name.replace(/_/g, ' ')}…)`,
  },
  pl: {
    greeting: 'Cześć! Jestem asystentem AHO. Zapytaj o ceny, funkcje lub jak zacząć.',
    placeholder: 'Wpisz pytanie…',
    send: 'Wyślij',
    open: 'Rozmawiaj z asystentem AHO',
    close: 'Zamknij czat',
    errorGeneric: 'Coś poszło nie tak. Spróbuj ponownie.',
    toolStub: (name) => `(sprawdzanie ${name.replace(/_/g, ' ')}…)`,
  },
  pt: {
    greeting: 'Oi! Sou o assistente da AHO. Pergunte sobre preços, recursos ou como começar.',
    placeholder: 'Digite uma pergunta…',
    send: 'Enviar',
    open: 'Conversar com o assistente da AHO',
    close: 'Fechar chat',
    errorGeneric: 'Algo deu errado. Tente novamente.',
    toolStub: (name) => `(consultando ${name.replace(/_/g, ' ')}…)`,
  },
  de: {
    greeting: 'Hallo! Ich bin der AHO-Assistent. Frag mich nach Preisen, Funktionen oder wie du loslegst.',
    placeholder: 'Frage stellen…',
    send: 'Senden',
    open: 'Mit dem AHO-Assistenten chatten',
    close: 'Chat schließen',
    errorGeneric: 'Etwas ist schiefgegangen. Bitte erneut versuchen.',
    toolStub: (name) => `(prüfe ${name.replace(/_/g, ' ')}…)`,
  },
  fr: {
    greeting: "Bonjour ! Je suis l'assistant AHO. Posez-moi des questions sur les tarifs, fonctionnalités ou démarrage.",
    placeholder: 'Posez une question…',
    send: 'Envoyer',
    open: "Discuter avec l'assistant AHO",
    close: 'Fermer le chat',
    errorGeneric: "Une erreur s'est produite. Réessayez.",
    toolStub: (name) => `(vérification ${name.replace(/_/g, ' ')}…)`,
  },
  it: {
    greeting: "Ciao! Sono l'assistente AHO. Chiedi di prezzi, funzioni o come iniziare.",
    placeholder: 'Scrivi una domanda…',
    send: 'Invia',
    open: "Chatta con l'assistente AHO",
    close: 'Chiudi chat',
    errorGeneric: 'Qualcosa è andato storto. Riprova.',
    toolStub: (name) => `(controllo ${name.replace(/_/g, ' ')}…)`,
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
  const [isOpen, setIsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const greeting: Msg = useMemo(
    () => ({ id: 'greeting', role: 'assistant', body: copy.greeting }),
    [copy.greeting],
  );
  const [messages, setMessages] = useState<Msg[]>([greeting]);

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
        { id: userId, role: 'user', body: trimmed },
        { id: assistantId, role: 'assistant', body: '', streaming: true },
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
        <div>
          <p className="font-brand text-sm font-semibold tracking-tight">AHO assistant</p>
          <p className="text-xs text-helper">Platform Q&amp;A · {userLocale.toUpperCase()}</p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          aria-label={copy.close}
          className="rounded-full p-1 text-ink-muted transition hover:bg-black/5 hover:text-ink dark:text-ink-inverse-muted dark:hover:bg-white/5 dark:hover:text-ink-inverse"
        >
          ×
        </button>
      </header>
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
            <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
          </div>
        ))}
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
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
    </div>
  );
}
