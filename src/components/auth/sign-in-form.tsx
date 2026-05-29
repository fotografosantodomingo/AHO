'use client';

import { useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { SignInSchema, type SignInInput } from '@/lib/auth/schemas';
import {
  TurnstileWidget,
  isTurnstileConfigured,
  type TurnstileWidgetHandle,
} from './turnstile-widget';
import { DeviceVerificationStep } from './device-verification-step';
import { GoogleSignInButton } from './google-signin-button';
import { PasswordInput } from '@/components/forms/password-input';
// LinkedInSignInButton temporarily hidden — LinkedIn dev app authorized
// redirect URLs not yet saved in the LinkedIn dashboard. The button +
// underlying provider config (Supabase external_linkedin_oidc_enabled)
// stay wired; flip back on by re-importing + uncommenting <LinkedInSignInButton />
// below once https://lqujtquofsdsxtujvjtl.supabase.co/auth/v1/callback
// is in the LinkedIn app's Auth tab. PO_ACTIONS §2b tracks.
// import { LinkedInSignInButton } from './linkedin-signin-button';

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

interface SignInFormProps {
  /** Where to send the user after a successful sign-in. Defaults to `/`. */
  next?: string;
}

interface ChallengeState {
  challengeId: string;
  emailHint: string;
  expiresInMinutes: number;
}

/**
 * Two-screen sign-in. Screen 1 is the password form. On submit, the
 * server validates the credential and either:
 *   - returns 200 → trusted device path; we router.push(next)
 *   - returns 202 with { needsVerification, challengeId } → swap the
 *     form for the OTP step and let the user enter the code that just
 *     hit their inbox.
 *
 * Visible Turnstile widget is gone (PO directive 2026-05-10), but it
 * still renders off-screen so a token flows up — Supabase's
 * project-level captcha enforcement is unchanged. Only sign-up + magic
 * link still show a visible challenge.
 */
export function SignInForm({ next = '/' }: SignInFormProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const locale = useLocale();
  const [serverError, setServerError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
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
    const res = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: values.email,
        password: values.password,
        locale,
        ...(captchaToken ? { captchaToken } : {}),
      }),
    });

    if (res.status === 202) {
      // New device or IP change → server issued an OTP challenge
      // instead of a session. Swap to the verification step.
      const body = (await res.json()) as ChallengeState;
      setChallenge(body);
      return;
    }

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

  // Render the OTP step when the server has issued a challenge. The
  // password form is unmounted to free focus for the code input.
  if (challenge) {
    return (
      <DeviceVerificationStep
        challengeId={challenge.challengeId}
        emailHint={challenge.emailHint}
        expiresInMinutes={challenge.expiresInMinutes}
        onVerified={() => {
          router.push(next);
          router.refresh();
        }}
      />
    );
  }

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

      {/* Turnstile in `interaction-only` mode (PO directive 2026-05-10:
          drop the visible challenge in favour of the OTP-on-new-device
          flow). Cloudflare runs the bot check in the background and
          only inserts a visible widget if the request looks risky.
          For most sign-ins the user sees nothing here. The token still
          flows to Supabase, so project-level captcha enforcement is
          unchanged.
          Earlier attempt used absolute off-screen positioning, which
          (a) didn't actually hide the widget when Cloudflare forced a
          managed challenge — it would render zero-sized and 110200 —
          and (b) couldn't be E2E-tested headlessly because the
          off-screen iframe failed to mount. `interaction-only` is
          Cloudflare's official "invisible Turnstile" pattern and is
          headless-detectable but degrades cleanly to a visible chip
          when needed (which is the desired safety-net behaviour). */}
      <TurnstileWidget
        ref={turnstileRef}
        onToken={onCaptchaToken}
        onExpire={onCaptchaExpire}
        appearance="interaction-only"
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
    </div>
  );
}
