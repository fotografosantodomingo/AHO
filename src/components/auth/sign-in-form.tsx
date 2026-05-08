'use client';

import { useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SignInSchema, type SignInInput } from '@/lib/auth/schemas';
import {
  TurnstileWidget,
  isTurnstileConfigured,
  type TurnstileWidgetHandle,
} from './turnstile-widget';

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

interface SignInFormProps {
  /** Where to send the user after a successful sign-in. Defaults to `/`. */
  next?: string;
}

export function SignInForm({ next = '/' }: SignInFormProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRequired = isTurnstileConfigured();
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);

  const onCaptchaToken = useCallback((token: string) => setCaptchaToken(token), []);
  const onCaptchaExpire = useCallback(() => setCaptchaToken(null), []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(SignInSchema),
  });

  async function onSubmit(values: SignInInput) {
    setServerError(null);
    // POST to /api/auth/signin instead of calling Supabase directly. The
    // route layers the email-keyed progressive lockout (5/10/20 failure
    // tiers — see src/lib/auth/lockout.ts) on top of Supabase's own
    // signInWithPassword call. The cookie-aware server client on the
    // route side persists the session via Set-Cookie on the response,
    // so a router.refresh() after success is enough to make the rest
    // of the app see the new auth state.
    const res = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: values.email,
        password: values.password,
        ...(captchaToken ? { captchaToken } : {}),
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | {
            error?: string;
            reason?: string;
            retryAfter?: string;
            message?: string;
          }
        | null;
      if (res.status === 429 && body?.error === 'locked_out') {
        const reasonKey = body.reason ?? 'cooldown_1m';
        const minutes = body.retryAfter
          ? Math.max(
              1,
              Math.ceil((new Date(body.retryAfter).getTime() - Date.now()) / 60000),
            )
          : undefined;
        setServerError(
          t(`lockout.${reasonKey}`, {
            minutes: minutes ?? 1,
          }),
        );
      } else {
        setServerError(body?.message ?? t('errors.generic'));
      }
      // Turnstile tokens are one-shot — Cloudflare rejects re-submission of
      // the same token with `invalid-input-response`. After a failed attempt
      // (wrong password, account locked, etc.) the user typically wants to
      // retry; reset the widget so it issues a fresh token before the next
      // submit. Bug logged 2026-05-02.
      setCaptchaToken(null);
      turnstileRef.current?.reset();
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          {t('email')}
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={errors.email ? 'true' : undefined}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email')}
          className={inputClass}
        />
        {errors.email && (
          <p id="email-error" className="mt-1 text-sm text-red-600">
            {t('errors.emailInvalid')}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          {t('password')}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={errors.password ? 'true' : undefined}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...register('password')}
          className={inputClass}
        />
        {errors.password && (
          <p id="password-error" className="mt-1 text-sm text-red-600">
            {t('errors.passwordRequired')}
          </p>
        )}
      </div>

      <TurnstileWidget
        ref={turnstileRef}
        onToken={onCaptchaToken}
        onExpire={onCaptchaExpire}
      />

      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
        >
          {serverError}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || (turnstileRequired && !captchaToken)}
        className="btn-primary w-full disabled:opacity-50"
      >
        {isSubmitting ? t('signingIn') : t('signInCta')}
      </button>
    </form>
  );
}
