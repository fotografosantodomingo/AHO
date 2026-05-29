'use client';

import { useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { SignUpSchema, type SignUpInput } from '@/lib/auth/schemas';
import { isPasswordPwned } from '@/lib/auth/hibp';
import {
  TurnstileWidget,
  isTurnstileConfigured,
  type TurnstileWidgetHandle,
} from './turnstile-widget';
import { GoogleSignInButton } from './google-signin-button';
import { PasswordInput } from '@/components/forms/password-input';
// LinkedInSignInButton temporarily hidden — see sign-in-form.tsx for context.
// import { LinkedInSignInButton } from './linkedin-signin-button';

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

const ERROR_KEYS = ['min8', 'needsUppercase', 'needsNumber', 'mustAcceptTerms', 'pwned'] as const;
type KnownErrorKey = (typeof ERROR_KEYS)[number];

function isKnownErrorKey(key: string): key is KnownErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(key);
}

export function SignUpForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [pwnedError, setPwnedError] = useState<boolean>(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRequired = isTurnstileConfigured();
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);

  const onCaptchaToken = useCallback((token: string) => setCaptchaToken(token), []);
  const onCaptchaExpire = useCallback(() => setCaptchaToken(null), []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: { marketingOptIn: false },
  });

  async function onSubmit(values: SignUpInput) {
    setServerError(null);
    setPwnedError(false);

    // HIBP breach check — defense-in-depth on top of the zod password
    // policy. If HIBP is unreachable we treat as not-pwned (fail-open) so
    // signup never blocks on a third-party outage.
    const pwn = await isPasswordPwned(values.password);
    if (pwn.pwned) {
      setPwnedError(true);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    // Post-confirmation landing: the user's localized dashboard. The
    // dashboard layout itself bounces non-subscribers to /pricing, so:
    //   - Subscribed agent → lands on dashboard (their listings)
    //   - Free user → bounced to /pricing (the right next step)
    // Either way we don't drop them on the marketing homepage.
    const dashPath = localePath(locale as Locale, '/dashboard');
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(dashPath)}`,
        // Supabase verifies the captcha token server-side against the
        // secret key configured in Project Settings → Auth → Captcha.
        // Without a configured provider this option is ignored, so it's
        // safe to always pass when present.
        ...(captchaToken ? { captchaToken } : {}),
        data: {
          marketing_opt_in: values.marketingOptIn ?? false,
          locale,
        },
      },
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
        <h2 className="text-xl font-semibold">{t('checkYourEmailHeading')}</h2>
        <p className="text-sm text-helper">
          {t('checkYourEmailBody', { email: submittedEmail })}
        </p>
      </div>
    );
  }

  // Pull out the password error message lookup so the JSX stays readable.
  const passwordErrorMessage = (() => {
    if (pwnedError) return t('errors.pwned');
    if (!errors.password?.message) return null;
    const key = errors.password.message;
    return isKnownErrorKey(key) ? t(`errors.${key}`) : t('errors.generic');
  })();

  const submitDisabled = isSubmitting || (turnstileRequired && !captchaToken);

  return (
    <div className="space-y-4">
      <GoogleSignInButton />
      {/* <LinkedInSignInButton /> — see import comment */}
      <div className="relative flex items-center gap-3 text-xs uppercase tracking-[0.13em] text-helper">
        <span className="h-px flex-1 bg-border-strong/40" aria-hidden="true" />
        <span>{t('orContinueWithEmail')}</span>
        <span className="h-px flex-1 bg-border-strong/40" aria-hidden="true" />
      </div>
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
        <PasswordInput
          id="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password || pwnedError ? 'true' : undefined}
          aria-describedby="password-help password-error"
          {...register('password')}
          className={inputClass}
        />
        <p id="password-help" className="mt-1 text-xs text-helper">
          {t('passwordHelp')}
        </p>
        {passwordErrorMessage && (
          <p id="password-error" className="mt-1 text-sm text-red-600">
            {passwordErrorMessage}
          </p>
        )}
      </div>

      <div className="flex items-start gap-2">
        <input
          id="acceptTerms"
          type="checkbox"
          {...register('acceptTerms')}
          className="mt-1 h-4 w-4 rounded-sm border-border-strong"
        />
        <label htmlFor="acceptTerms" className="text-sm">
          {t.rich('acceptTerms', {
            termsLink: (chunks) => (
              <a
                className="text-action underline-offset-2 hover:underline dark:text-action-dark"
                href={localePath(locale as Locale, '/terms')}
                target="_blank"
                rel="noopener"
              >
                {chunks}
              </a>
            ),
            privacyLink: (chunks) => (
              <a
                className="text-action underline-offset-2 hover:underline dark:text-action-dark"
                href={localePath(locale as Locale, '/privacy')}
                target="_blank"
                rel="noopener"
              >
                {chunks}
              </a>
            ),
          })}
        </label>
      </div>
      {errors.acceptTerms && (
        <p className="-mt-2 text-sm text-red-600">{t('errors.mustAcceptTerms')}</p>
      )}

      <div className="flex items-start gap-2">
        <input
          id="marketingOptIn"
          type="checkbox"
          {...register('marketingOptIn')}
          className="mt-1 h-4 w-4 rounded-sm border-border-strong"
        />
        <label htmlFor="marketingOptIn" className="text-sm text-helper">
          {t('marketingOptIn')}
        </label>
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
        disabled={submitDisabled}
        className="btn-primary w-full disabled:opacity-50"
      >
        {isSubmitting ? t('signingUp') : t('signUpCta')}
      </button>
      </form>
    </div>
  );
}
