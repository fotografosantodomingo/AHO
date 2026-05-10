'use client';

import { useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { EmailOnlySchema, type EmailOnlyInput } from '@/lib/auth/schemas';
import {
  TurnstileWidget,
  isTurnstileConfigured,
  type TurnstileWidgetHandle,
} from './turnstile-widget';

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const tForgot = useTranslations('auth.forgot');
  const locale = useLocale();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRequired = isTurnstileConfigured();
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const onCaptchaToken = useCallback((token: string) => setCaptchaToken(token), []);
  const onCaptchaExpire = useCallback(() => setCaptchaToken(null), []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmailOnlyInput>({
    resolver: zodResolver(EmailOnlySchema),
  });

  async function onSubmit(values: EmailOnlyInput) {
    setServerError(null);
    const supabase = getSupabaseBrowserClient();
    const resetPath = localePath(locale as Locale, '/reset-password');
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(resetPath)}`,
      // Required when Supabase Auth → Captcha is enabled. Ignored
      // server-side when no provider is configured.
      ...(captchaToken ? { captchaToken } : {}),
    });
    if (error) {
      setServerError(error.message);
      // Reset Turnstile after each failed submit (one-shot tokens).
      setCaptchaToken(null);
      turnstileRef.current?.reset();
      return;
    }
    setSubmittedEmail(values.email);
  }

  if (submittedEmail) {
    return (
      <div role="status" className="space-y-3">
        <h2 className="text-xl font-semibold">{tForgot('checkEmailHeading')}</h2>
        <p className="text-sm text-helper">
          {tForgot('checkEmailBody', { email: submittedEmail })}
        </p>
      </div>
    );
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
          {...register('email')}
          className={inputClass}
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-600">{t('errors.emailInvalid')}</p>
        )}
      </div>
      <TurnstileWidget
        ref={turnstileRef}
        onToken={onCaptchaToken}
        onExpire={onCaptchaExpire}
      />
      {serverError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          {serverError}
        </div>
      )}
      <button
        type="submit"
        disabled={isSubmitting || (turnstileRequired && !captchaToken)}
        className="btn-primary w-full disabled:opacity-50"
      >
        {isSubmitting ? tForgot('submitting') : tForgot('submit')}
      </button>
    </form>
  );
}
