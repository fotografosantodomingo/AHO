'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile widget — invisible-or-managed bot challenge.
 *
 * Usage: place inside the auth form, pass an `onToken` callback. The
 * parent disables submit until a token is received and includes the
 * token in the auth request (Supabase honors `options.captchaToken` if
 * the project's Auth → Captcha provider is configured to Turnstile with
 * the matching secret key).
 *
 * No-op when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset — in dev / preview
 * environments without Turnstile, the form works without any challenge.
 * Production deploys must set the key for the protection to apply.
 *
 * The Turnstile script is loaded once via a `<script src>` injection
 * (idempotent — re-uses the existing tag if mounted earlier). Widget is
 * rendered explicitly via `window.turnstile.render()` so we control
 * lifecycle (cleanup on unmount, reset on token expiry).
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'invisible';
          appearance?: 'always' | 'execute' | 'interaction-only';
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    // Re-use existing tag if some earlier mount already injected it.
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_SRC}"]`);
    if (existing) {
      // Either it's loaded (window.turnstile already set, handled above)
      // or it's still loading — wait for it.
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('turnstile_load_failed')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('turnstile_load_failed')), { once: true });
    document.head.appendChild(script);
  });
  return scriptPromise;
}

interface TurnstileWidgetProps {
  /** Called with the verification token. Token is single-use; resets after submit. */
  onToken: (token: string) => void;
  /** Called when the user fails the challenge or it errors. */
  onError?: () => void;
  /** Called when an issued token expires (typically 5 minutes). */
  onExpire?: () => void;
  /** Theme — defaults to auto (matches user's system preference). */
  theme?: 'light' | 'dark' | 'auto';
}

export function TurnstileWidget({
  onToken,
  onError,
  onExpire,
  theme = 'auto',
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onToken,
          'error-callback': () => {
            setError('challenge_failed');
            onError?.();
          },
          'expired-callback': onExpire,
          theme,
        });
      })
      .catch(() => {
        if (!cancelled) setError('challenge_load_failed');
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore cleanup errors
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, onToken, onError, onExpire, theme]);

  // Site-key not configured — no-op. Form works without the challenge.
  if (!siteKey) return null;

  return (
    <div className="my-2">
      <div ref={containerRef} id={`turnstile-${id}`} />
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error === 'challenge_load_failed'
            ? 'Could not load the bot-challenge. Try refreshing.'
            : 'Bot challenge failed. Try again.'}
        </p>
      )}
    </div>
  );
}

/** Helper for forms: returns true iff Turnstile is configured and required. */
export function isTurnstileConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
}
