'use client';

import { isVoiceSupported } from './voice-controls';

/**
 * Shown AFTER the pre-chat gate (name + email captured) and BEFORE
 * the first message: "How would you like to chat?" with two big tiles
 * for Text and Voice. If the browser doesn't support Web Speech API,
 * the voice tile is replaced with a disabled state explaining why
 * (and the parent auto-defaults to text).
 *
 * Visitors can switch modes any time via the toggle in the chat
 * header — this picker only shows on first entry to make the choice
 * intentional + reduce surprise when a voice-loving user hits text-only.
 */

export interface ChatModePickerCopy {
  heading: string;
  sub: string;
  textLabel: string;
  textHint: string;
  voiceLabel: string;
  voiceHint: string;
  voiceUnsupported: string;
}

export function ChatModePicker({
  copy,
  onPick,
}: {
  copy: ChatModePickerCopy;
  onPick: (mode: 'text' | 'voice') => void;
}) {
  const voiceOk = isVoiceSupported();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 py-8">
      <div className="text-center">
        <h3 className="font-brand text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {copy.heading}
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{copy.sub}</p>
      </div>

      <div className="grid w-full max-w-sm grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Text mode */}
        <button
          type="button"
          onClick={() => onPick('text')}
          className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-5 text-center transition hover:border-emerald-500 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-400 dark:hover:bg-emerald-950/30"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition group-hover:bg-emerald-100 group-hover:text-emerald-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-emerald-900 dark:group-hover:text-emerald-200">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </span>
          <span className="text-base font-semibold text-slate-900 dark:text-slate-100">{copy.textLabel}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{copy.textHint}</span>
        </button>

        {/* Voice mode */}
        {voiceOk ? (
          <button
            type="button"
            onClick={() => onPick('voice')}
            className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-5 text-center transition hover:border-emerald-500 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-400 dark:hover:bg-emerald-950/30"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition group-hover:bg-emerald-100 group-hover:text-emerald-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-emerald-900 dark:group-hover:text-emerald-200">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </span>
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">{copy.voiceLabel}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{copy.voiceHint}</span>
          </button>
        ) : (
          <div
            aria-disabled="true"
            className="flex cursor-not-allowed flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center opacity-60 dark:border-slate-700 dark:bg-slate-900"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </span>
            <span className="text-base font-semibold text-slate-500 dark:text-slate-400">{copy.voiceLabel}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">{copy.voiceUnsupported}</span>
          </div>
        )}
      </div>
    </div>
  );
}
