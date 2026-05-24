'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice mode UI for the AI chat widget.
 *
 * Uses the browser-native Web Speech API:
 *   - SpeechRecognition (STT) — Chrome, Edge, Safari, mobile Safari (with caveats)
 *   - SpeechSynthesis (TTS) — all major browsers
 *
 * No external API key. No backend changes — voice transcriptions go
 * through the SAME `/api/ai-chat` endpoint as text messages; the AI
 * reply text gets read aloud via TTS.
 *
 * State machine:
 *   idle      → user can tap the big mic icon to start listening
 *   listening → SR is capturing; animated pulse ring; interim
 *               transcript shows as the user speaks
 *   thinking  → user stopped speaking; transcript sent to chat
 *               endpoint; waiting for AI response
 *   speaking  → AI response playing via TTS; tap to interrupt
 *
 * Fallback: if neither `SpeechRecognition` nor `webkitSpeechRecognition`
 * is in `window`, the component renders an "unsupported — use text"
 * message and the parent should switch to text mode. The parent can
 * pre-check `isVoiceSupported()` to avoid even mounting this.
 */

export interface VoiceControlsCopy {
  tapToSpeak: string;
  tapToStop: string;
  listening: string;
  thinking: string;
  speaking: string;
  tapToInterrupt: string;
  permissionDenied: string;
  unsupported: string;
  switchToText: string;
}

interface Props {
  /** BCP-47 locale tag for SR + TTS, e.g. 'en-US', 'es-DO', 'de-DE'. */
  voiceLocale: string;
  /** Submit the final transcript as if the user typed + sent it. */
  onUserTranscript: (text: string) => void;
  /** Text the parent wants spoken (typically the latest approved AI
   *  reply). Pass empty string when nothing should be spoken. The
   *  component watches this and triggers TTS on change. */
  speakText: string;
  /** Called when TTS has finished playing speakText (or was
   *  interrupted) — parent uses this to mark the speech as consumed
   *  so the next AI message can be queued. */
  onSpeakDone?: () => void;
  /** Disable user-initiated listening (e.g. while the parent is
   *  awaiting an HTTP response). Component will still finish TTS. */
  disabled?: boolean;
  /** Bail-out: parent re-renders in text mode if voice fails. */
  onUnrecoverable?: (reason: 'unsupported' | 'permission_denied') => void;
  copy: VoiceControlsCopy;
}

/** Static check the parent can use before mounting this component. */
export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const hasSR =
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  const hasTTS = 'speechSynthesis' in window;
  return hasSR && hasTTS;
}

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

export function VoiceControls({
  voiceLocale,
  onUserTranscript,
  speakText,
  onSpeakDone,
  disabled,
  onUnrecoverable,
  copy,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [interim, setInterim] = useState<string>('');
  const [supported] = useState(() => isVoiceSupported());

  // SpeechRecognition is event-driven; we keep it in a ref so we can
  // start/stop imperatively without re-creating on every render.
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Track whether the current speakText has already been consumed so
  // we don't double-play on parent re-renders.
  const lastSpokenRef = useRef<string>('');

  // ─── 1. Initialize SpeechRecognition ────────────────────────────
  useEffect(() => {
    if (!supported) {
      onUnrecoverable?.('unsupported');
      return;
    }
    const SR =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
        .webkitSpeechRecognition;
    if (!SR) {
      onUnrecoverable?.('unsupported');
      return;
    }
    const rec = new SR() as SpeechRecognitionLike;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = voiceLocale;

    rec.onresult = (e: SpeechRecognitionEventLike) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const alt = r[0];
        if (!alt) continue;
        if (r.isFinal) finalText += alt.transcript;
        else interimText += alt.transcript;
      }
      if (interimText) setInterim(interimText);
      if (finalText.trim()) {
        // Final transcript captured — submit it to chat + transition.
        setInterim('');
        setPhase('thinking');
        onUserTranscript(finalText.trim());
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEventLike) => {
      // Common errors: 'not-allowed' (mic permission denied), 'no-speech'
      // (silence timeout), 'aborted', 'network', 'audio-capture'.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        onUnrecoverable?.('permission_denied');
      }
      setInterim('');
      setPhase('idle');
    };

    rec.onend = () => {
      // If we ended naturally without a final result, drop back to idle.
      setPhase((p) => (p === 'listening' ? 'idle' : p));
    };

    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        /* may already be stopped */
      }
      recognitionRef.current = null;
    };
    // We only set up the recognition once per locale change. Other
    // deps are stable handlers captured in the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceLocale, supported]);

  // ─── 2. TTS effect — speak when speakText changes ───────────────
  useEffect(() => {
    if (!supported) return;
    if (!speakText || speakText === lastSpokenRef.current) return;
    lastSpokenRef.current = speakText;

    // Cancel anything already speaking so the new utterance plays.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(speakText);
    utterance.lang = voiceLocale;
    // Try to pick a voice that matches the locale (best-effort —
    // browser voice catalogs vary wildly).
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.lang.toLowerCase().startsWith(voiceLocale.toLowerCase().slice(0, 2)));
    if (match) utterance.voice = match;

    utterance.onstart = () => setPhase('speaking');
    utterance.onend = () => {
      setPhase('idle');
      onSpeakDone?.();
    };
    utterance.onerror = () => {
      setPhase('idle');
      onSpeakDone?.();
    };
    window.speechSynthesis.speak(utterance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakText, voiceLocale, supported]);

  // ─── 3. Cleanup on unmount: cancel any speech ──────────────────
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleTap = useCallback(() => {
    if (disabled || !recognitionRef.current) return;
    if (phase === 'speaking') {
      // Tap interrupts speech.
      window.speechSynthesis.cancel();
      setPhase('idle');
      onSpeakDone?.();
      return;
    }
    if (phase === 'listening') {
      try {
        recognitionRef.current.stop();
      } catch {
        /* noop */
      }
      setPhase('idle');
      return;
    }
    // idle or thinking → start a new listening session.
    if (phase === 'thinking') return; // don't allow re-listen while AI is replying
    setInterim('');
    try {
      recognitionRef.current.start();
      setPhase('listening');
    } catch {
      // Some browsers throw if start() is called while already running.
      setPhase('idle');
    }
  }, [disabled, phase, onSpeakDone]);

  if (!supported) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
      >
        {copy.unsupported}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-6">
      <button
        type="button"
        onClick={handleTap}
        disabled={disabled || phase === 'thinking'}
        aria-label={phase === 'listening' ? copy.tapToStop : copy.tapToSpeak}
        className={`group relative flex h-28 w-28 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
          phase === 'listening'
            ? 'bg-red-500 hover:bg-red-600'
            : phase === 'speaking'
              ? 'bg-emerald-500 hover:bg-emerald-600'
              : phase === 'thinking'
                ? 'bg-slate-400'
                : 'bg-emerald-600 hover:bg-emerald-700'
        }`}
      >
        {/* Animated outer ring: listening = pulse ring; speaking = breathing ring */}
        {phase === 'listening' && (
          <>
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-40" />
            <span className="absolute -inset-2 animate-pulse rounded-full bg-red-500/30" />
          </>
        )}
        {phase === 'speaking' && (
          <span className="absolute -inset-1 animate-pulse rounded-full bg-emerald-500/40" />
        )}
        {phase === 'thinking' && (
          <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-white" />
        )}

        {/* Icon: mic / waveform / spinner */}
        <span className="relative z-10 flex items-center justify-center text-white">
          {phase === 'speaking' ? (
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12h2l2 8 4-16 4 12 2-4h4" />
            </svg>
          ) : phase === 'thinking' ? (
            <span className="text-xs uppercase tracking-wider">…</span>
          ) : (
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </span>
      </button>

      {/* Phase label + interim transcript */}
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {phase === 'listening' && copy.listening}
          {phase === 'thinking' && copy.thinking}
          {phase === 'speaking' && copy.speaking}
          {phase === 'idle' && copy.tapToSpeak}
        </p>
        {phase === 'listening' && interim && (
          <p className="mt-2 max-w-xs text-xs italic text-slate-500 dark:text-slate-400">
            &ldquo;{interim}&rdquo;
          </p>
        )}
        {phase === 'speaking' && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {copy.tapToInterrupt}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Web Speech API type shims (browser-only; not in lib.dom.d.ts) ─

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string; confidence: number };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}
