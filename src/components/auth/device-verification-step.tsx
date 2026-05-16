'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { useLocale, useTranslations } from 'next-intl';

interface Props {
  challengeId: string;
  emailHint: string;
  expiresInMinutes: number;
  /** Called once the OTP verifies + a real session is set on the
   *  response. Parent typically does router.push + router.refresh. */
  onVerified: () => void;
}

const CODE_LEN = 6;

/**
 * 6-digit OTP entry step shown after /api/auth/signin returns
 * `needsVerification: true`. Six independent inputs with paste-aware
 * fan-out (paste a 6-digit code into any field → fills all six +
 * auto-submits). Auto-submits on the sixth keystroke too. Resend
 * button with a 30s cooldown that mirrors the server-side cap.
 */
export function DeviceVerificationStep({
  challengeId,
  emailHint,
  expiresInMinutes,
  onVerified,
}: Props) {
  const t = useTranslations('auth.deviceVerification');
  const locale = useLocale();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [digits, setDigits] = useState<string[]>(() =>
    Array(CODE_LEN).fill(''),
  );
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Focus the first input on mount so the user can start typing
  // immediately. `requestAnimationFrame` covers the case where the
  // parent unmounts the password form on the same render.
  useEffect(() => {
    requestAnimationFrame(() => inputs.current[0]?.focus());
  }, []);

  // Resend cooldown ticker. Server caps resends at 30s apart; the UI
  // mirrors so the button doesn't error on click.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const code = useMemo(() => digits.join(''), [digits]);
  const codeReady = code.length === CODE_LEN && /^\d{6}$/.test(code);

  const submitCode = useCallback(
    async (codeToSubmit: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch('/api/auth/verify-device', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ challengeId, code: codeToSubmit }),
        });
        const body = (await res.json().catch(() => null)) as
          | { error?: string; remainingAttempts?: number }
          | null;
        if (res.ok) {
          onVerified();
          return;
        }
        // Map known error codes to localized messages. Anything else
        // falls through to the generic "try again" string.
        const errKey = body?.error ?? 'invalid_code';
        if (errKey === 'invalid_code' && typeof body?.remainingAttempts === 'number') {
          setError(
            t('errors.invalidCodeWithCount', { remaining: body.remainingAttempts }),
          );
        } else if (errKey === 'too_many_attempts') {
          setError(t('errors.tooManyAttempts'));
        } else if (errKey === 'challenge_expired') {
          setError(t('errors.expired'));
        } else if (errKey === 'challenge_already_used') {
          setError(t('errors.alreadyUsed'));
        } else {
          setError(t('errors.generic'));
        }
        // Clear the inputs + refocus so the user can retype quickly.
        setDigits(Array(CODE_LEN).fill(''));
        requestAnimationFrame(() => inputs.current[0]?.focus());
      } finally {
        setSubmitting(false);
      }
    },
    [challengeId, onVerified, t],
  );

  function setDigit(i: number, value: string) {
    const v = value.replace(/\D/g, '').slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      // If the user typed something AND we're not at the last cell,
      // hop focus forward.
      if (v && i < CODE_LEN - 1) {
        requestAnimationFrame(() => inputs.current[i + 1]?.focus());
      }
      // Auto-submit the moment all six are filled. Use the freshly-
      // updated `next` array (state update hasn't flushed yet for
      // the comparison below).
      const joined = next.join('');
      if (joined.length === CODE_LEN && /^\d{6}$/.test(joined) && !submitting) {
        // Defer one tick so the input state reflects in the DOM first.
        requestAnimationFrame(() => submitCode(joined));
      }
      return next;
    });
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      // Back-fill: empty box + Backspace → step left and clear that box.
      e.preventDefault();
      setDigits((prev) => {
        const next = [...prev];
        next[i - 1] = '';
        return next;
      });
      requestAnimationFrame(() => inputs.current[i - 1]?.focus());
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      inputs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < CODE_LEN - 1) {
      e.preventDefault();
      inputs.current[i + 1]?.focus();
    } else if (e.key === 'Enter' && codeReady && !submitting) {
      e.preventDefault();
      submitCode(code);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = (e.clipboardData.getData('text') ?? '').replace(/\D/g, '');
    if (text.length === 0) return;
    e.preventDefault();
    const padded = text.slice(0, CODE_LEN).padEnd(CODE_LEN, '');
    const arr = padded.split('').map((c) => (c === '' ? '' : c));
    setDigits(arr);
    // Focus the last filled slot (or the first empty one).
    const lastIdx = Math.min(text.length, CODE_LEN) - 1;
    requestAnimationFrame(() => inputs.current[Math.max(0, lastIdx)]?.focus());
    if (text.length >= CODE_LEN && !submitting) {
      requestAnimationFrame(() => submitCode(arr.join('')));
    }
  }

  async function onResend() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/auth/resend-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId, locale }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; resendsRemaining?: number }
        | null;
      if (res.ok) {
        setInfo(t('resendSent'));
        setResendCooldown(30);
        // Clear the inputs so the user types the NEW code.
        setDigits(Array(CODE_LEN).fill(''));
        requestAnimationFrame(() => inputs.current[0]?.focus());
      } else if (body?.error === 'resend_limit_reached') {
        setError(t('errors.resendLimit'));
      } else if (body?.error === 'resend_cooldown') {
        setResendCooldown(30);
        setError(t('errors.resendCooldown'));
      } else if (body?.error === 'challenge_expired') {
        setError(t('errors.expired'));
      } else {
        setError(t('errors.generic'));
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-brand text-xl font-semibold tracking-tight">
          {t('heading')}
        </h2>
        <p className="mt-2 text-sm text-helper">
          {t('subheading', { email: emailHint, minutes: expiresInMinutes })}
        </p>
      </div>

      <div
        role="group"
        aria-label={t('codeAriaLabel')}
        className="flex justify-center gap-2"
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            pattern="\d"
            aria-label={t('digitAriaLabel', { index: i + 1 })}
            value={d}
            disabled={submitting}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
            className="h-11 w-10 rounded-lg border border-border-strong bg-surface text-center font-mono text-xl shadow-whisper outline-hidden focus:ring-3 focus:ring-action disabled:opacity-50 dark:bg-surface-deep dark:focus:ring-action-dark"
          />
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
        >
          {error}
        </div>
      )}
      {info && !error && (
        <p
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          {info}
        </p>
      )}

      <button
        type="button"
        disabled={!codeReady || submitting}
        onClick={() => submitCode(code)}
        className="btn-primary w-full disabled:opacity-50"
      >
        {submitting ? t('verifying') : t('verifyCta')}
      </button>

      <div className="text-center text-sm text-helper">
        {t('didNotGetCode')}{' '}
        <button
          type="button"
          onClick={onResend}
          disabled={resending || resendCooldown > 0}
          className="text-action underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-action-dark"
        >
          {resending
            ? t('resending')
            : resendCooldown > 0
            ? t('resendIn', { seconds: resendCooldown })
            : t('resendCta')}
        </button>
      </div>
    </div>
  );
}
