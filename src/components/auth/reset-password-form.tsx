'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { ResetPasswordSchema, type ResetPasswordInput } from '@/lib/auth/schemas';
import { isPasswordPwned } from '@/lib/auth/hibp';

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

const ERROR_KEYS = ['min8', 'needsUppercase', 'needsNumber', 'pwned'] as const;
type KnownErrorKey = (typeof ERROR_KEYS)[number];
function isKnownErrorKey(k: string): k is KnownErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(k);
}

/**
 * Reset-password form. Expects the user to arrive with a recovery session
 * already established by `/auth/callback?type=recovery`. If no session exists
 * (link expired, used twice, direct nav), we surface a friendly "request a
 * new one" CTA rather than a confusing form.
 *
 * MFA gate: Supabase Auth requires an AAL2 session (MFA-verified) to call
 * updateUser({ password }) when the user has a verified TOTP factor. The
 * recovery callback only establishes AAL1, so we check the AAL state on
 * mount; if the user has MFA enrolled, we render a 6-digit TOTP challenge
 * BEFORE the password form, mfa.verify() it to upgrade the session, then
 * unblock the password form.
 */
export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const tReset = useTranslations('auth.reset');
  const tMfa = useTranslations('auth.mfa');
  const locale = useLocale();
  const router = useRouter();

  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaWorking, setMfaWorking] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pwnedError, setPwnedError] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setHasSession(false);
        return;
      }
      setHasSession(true);
      // AAL gate: when nextLevel='aal2' AND currentLevel='aal1', the user
      // has enrolled MFA but this session is single-factor. Sensitive ops
      // (updateUser password/email) require AAL2; we challenge inline.
      const { data: aal } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === 'aal2' && aal?.currentLevel === 'aal1') {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.[0];
        if (totp) {
          setMfaFactorId(totp.id);
          setNeedsMfa(true);
        }
      }
    })();
  }, []);

  async function onMfaSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!mfaFactorId) return;
    setMfaError(null);
    setMfaWorking(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });
      if (chalErr || !chal) {
        setMfaError(tMfa('errorGeneric'));
        return;
      }
      const { error: verErr } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: chal.id,
        code: mfaCode.replace(/\s+/g, ''),
      });
      if (verErr) {
        setMfaError(tMfa('errorBadCode'));
        return;
      }
      // Session is now AAL2 — unlock the password form.
      setNeedsMfa(false);
      setMfaCode('');
    } finally {
      setMfaWorking(false);
    }
  }

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(ResetPasswordSchema),
  });

  async function onSubmit(values: ResetPasswordInput) {
    setServerError(null);
    setPwnedError(false);

    // HIBP breach check (defense-in-depth; fails open on network error).
    const pwn = await isPasswordPwned(values.password);
    if (pwn.pwned) {
      setPwnedError(true);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setServerError(error.message);
      return;
    }
    setSuccess(true);
    // Land them in the dashboard. Fall back to home if the dashboard would
    // bounce (no org membership).
    setTimeout(() => {
      router.push(localePath(locale as Locale, '/dashboard'));
    }, 1200);
  }

  if (hasSession === null) {
    return <div className="text-sm text-helper">…</div>;
  }

  if (!hasSession) {
    const forgotPath = localePath(locale as Locale, '/forgot-password');
    return (
      <div role="status" className="space-y-3">
        <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">
          {tReset('noSession')}
        </p>
        <a
          className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
          href={forgotPath}
        >
          {tReset('requestNewLink')}
        </a>
      </div>
    );
  }

  if (success) {
    return (
      <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
        {tReset('success')}
      </div>
    );
  }

  if (needsMfa) {
    return (
      <form onSubmit={onMfaSubmit} className="space-y-4" noValidate>
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {tReset('mfaRequired')}
        </div>
        <div>
          <label htmlFor="mfa-code" className="block text-sm font-medium">
            {tMfa('step3Title')}
          </label>
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            className={inputClass}
          />
        </div>
        {mfaError && (
          <p role="alert" className="text-sm text-red-600">{mfaError}</p>
        )}
        <button
          type="submit"
          disabled={mfaWorking || mfaCode.length !== 6}
          className="btn-primary w-full disabled:opacity-50"
        >
          {mfaWorking ? tMfa('verifying') : tMfa('verifyCta')}
        </button>
      </form>
    );
  }

  const passwordErr = (() => {
    if (pwnedError) return t('errors.pwned');
    const m = errors.password?.message;
    if (!m) return null;
    return isKnownErrorKey(m) ? t(`errors.${m}`) : t('errors.generic');
  })();

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          {tReset('newPassword')}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? 'true' : undefined}
          aria-describedby="password-help password-error"
          {...register('password')}
          className={inputClass}
        />
        <p id="password-help" className="mt-1 text-xs text-helper">
          {t('passwordHelp')}
        </p>
        {passwordErr && (
          <p id="password-error" className="mt-1 text-sm text-red-600">{passwordErr}</p>
        )}
      </div>
      {serverError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          {serverError}
        </div>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="btn-primary w-full disabled:opacity-50"
      >
        {isSubmitting ? tReset('submitting') : tReset('submit')}
      </button>
    </form>
  );
}
