'use client';

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

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
          'error-callback'?: (code?: string) => void;
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
  /** Called with the verification token. Token is single-use; the form
   *  must call `.reset()` after each submit attempt (success or fail)
   *  so a fresh token is issued before the next submit. */
  onToken: (token: string) => void;
  /** Called when the user fails the challenge or it errors. */
  onError?: () => void;
  /** Called when an issued token expires (typically 5 minutes). */
  onExpire?: () => void;
  /** Theme — defaults to auto (matches user's system preference). */
  theme?: 'light' | 'dark' | 'auto';
  /** Visibility mode. Default `always` matches the historical sign-up /
   *  magic-link / contact-form behaviour (visible widget). Set
   *  `interaction-only` for a Hostinger-style silent flow — Cloudflare
   *  runs the check in the background and only inserts a visible
   *  challenge if the request looks risky. PO directive 2026-05-10 for
   *  the sign-in form. */
  appearance?: 'always' | 'execute' | 'interaction-only';
}

export interface TurnstileWidgetHandle {
  /** Force the widget to discard the current token and issue a new one.
   *  Required after every submit attempt — Turnstile tokens are
   *  one-shot; resubmitting the same one returns
   *  `invalid-input-response`. PO-reported 2026-05-02. */
  reset: () => void;
}

export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  TurnstileWidgetProps
>(function TurnstileWidget(
  { onToken, onError, onExpire, theme = 'auto', appearance = 'always' },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.reset(widgetIdRef.current);
          } catch {
            // ignore — widget may have unmounted between submit + reset
          }
        }
      },
    }),
    [],
  );

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;

    // Defer the Turnstile script load past the initial render-critical
    // window. The script itself is ~50 KB + executes 200-500 ms on the
    // main thread during widget initialization — blocking INP on listing
    // pages where the form is below the fold. requestIdleCallback runs
    // when the browser is idle (typically post-LCP); setTimeout(0)
    // fallback for browsers without rIC (Safari <16.4). Either way the
    // load happens off the initial-paint critical path.
    const start = () => {
      if (cancelled) return;
      loadTurnstileScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            callback: onToken,
            'error-callback': (code) => {
              // Turnstile passes an error code string (e.g. '110200' = domain
              // not allowed, '300xxx' = challenge failed, '600010' = bad
              // sitekey). Log + surface so we can actually diagnose vs. a
              // generic "try again".
              console.warn('[turnstile] error-callback', code);
              setError(code || 'challenge_failed');
              onError?.();
            },
            'expired-callback': onExpire,
            theme,
            appearance,
          });
        })
        .catch(() => {
          if (!cancelled) setError('challenge_load_failed');
        });
    };

    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleWin = window as IdleWindow;
    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (typeof idleWin.requestIdleCallback === 'function') {
      idleHandle = idleWin.requestIdleCallback(start, { timeout: 3000 });
    } else {
      timeoutHandle = setTimeout(start, 1500);
    }

    return () => {
      cancelled = true;
      if (idleHandle != null && typeof idleWin.cancelIdleCallback === 'function') {
        idleWin.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore cleanup errors
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, onToken, onError, onExpire, theme, appearance]);

  // Site-key not configured — no-op. Form works without the challenge.
  if (!siteKey) return null;

  return (
    <div className="my-2">
      <div ref={containerRef} id={`turnstile-${id}`} />
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error === 'challenge_load_failed'
            ? 'Could not load the bot-challenge. Try refreshing.'
            : `Bot challenge failed (${error}). Try again.`}
        </p>
      )}
    </div>
  );
});

/** Helper for forms: returns true iff Turnstile is configured and required. */
export function isTurnstileConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
}
