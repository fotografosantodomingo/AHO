'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { EmailOnlySchema, type EmailOnlyInput } from '@/lib/auth/schemas';

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

interface MagicLinkFormProps {
  /** Where the magic link should land after sign-in. Defaults to `/`. */
  next?: string;
}

export function MagicLinkForm({ next }: MagicLinkFormProps) {
  const t = useTranslations('auth');
  const tMagic = useTranslations('auth.magic');
  const locale = useLocale();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

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
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : `/${locale}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: values.email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    });
    if (error) {
      setServerError(error.message);
      return;
    }
    setSubmittedEmail(values.email);
  }

  if (submittedEmail) {
    return (
      <div role="status" className="space-y-3">
        <h2 className="text-xl font-semibold">{tMagic('checkEmailHeading')}</h2>
        <p className="text-sm text-helper">
          {tMagic('checkEmailBody', { email: submittedEmail })}
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
        {isSubmitting ? tMagic('submitting') : tMagic('submit')}
      </button>
    </form>
  );
}
