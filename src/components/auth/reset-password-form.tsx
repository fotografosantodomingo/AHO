'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { ResetPasswordSchema, type ResetPasswordInput } from '@/lib/auth/schemas';

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

const ERROR_KEYS = ['min8', 'needsUppercase', 'needsNumber'] as const;
type KnownErrorKey = (typeof ERROR_KEYS)[number];
function isKnownErrorKey(k: string): k is KnownErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(k);
}

/**
 * Reset-password form. Expects the user to arrive with a recovery session
 * already established by `/auth/callback?type=recovery`. If no session exists
 * (link expired, used twice, direct nav), we surface a friendly "request a
 * new one" CTA rather than a confusing form.
 */
export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const tReset = useTranslations('auth.reset');
  const locale = useLocale();
  const router = useRouter();

  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(ResetPasswordSchema),
  });

  async function onSubmit(values: ResetPasswordInput) {
    setServerError(null);
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
      router.push(`/${locale}/${locale === 'es' ? 'panel' : 'dashboard'}`);
    }, 1200);
  }

  if (hasSession === null) {
    return <div className="text-sm text-helper">…</div>;
  }

  if (!hasSession) {
    const forgotPath = `/${locale}/${locale === 'es' ? 'recuperar-contrasena' : 'forgot-password'}`;
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

  const passwordErr = (() => {
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
        className="w-full rounded-lg bg-surface-dark px-4 py-2.5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink disabled:opacity-50"
      >
        {isSubmitting ? tReset('submitting') : tReset('submit')}
      </button>
    </form>
  );
}
