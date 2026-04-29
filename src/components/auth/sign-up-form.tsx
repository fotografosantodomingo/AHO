'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { SignUpSchema, type SignUpInput } from '@/lib/auth/schemas';

const inputClass =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-100';

const ERROR_KEYS = ['min8', 'needsUppercase', 'needsNumber', 'mustAcceptTerms'] as const;
type KnownErrorKey = (typeof ERROR_KEYS)[number];

function isKnownErrorKey(key: string): key is KnownErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(key);
}

export function SignUpForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

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
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/${locale}`,
        data: {
          marketing_opt_in: values.marketingOptIn ?? false,
          locale,
        },
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
        <h2 className="text-xl font-semibold">{t('checkYourEmailHeading')}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('checkYourEmailBody', { email: submittedEmail })}
        </p>
      </div>
    );
  }

  // Pull out the password error message lookup so the JSX stays readable.
  const passwordErrorMessage = (() => {
    if (!errors.password?.message) return null;
    const key = errors.password.message;
    return isKnownErrorKey(key) ? t(`errors.${key}`) : t('errors.generic');
  })();

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
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? 'true' : undefined}
          aria-describedby="password-help password-error"
          {...register('password')}
          className={inputClass}
        />
        <p id="password-help" className="mt-1 text-xs text-zinc-500">
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
          className="mt-1 h-4 w-4 rounded border-zinc-300"
        />
        <label htmlFor="acceptTerms" className="text-sm">
          {t.rich('acceptTerms', {
            termsLink: (chunks) => (
              <a className="underline" href={`/${locale}/${locale === 'es' ? 'terminos' : 'terms'}`}>
                {chunks}
              </a>
            ),
            privacyLink: (chunks) => (
              <a className="underline" href={`/${locale}/${locale === 'es' ? 'privacidad' : 'privacy'}`}>
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
          className="mt-1 h-4 w-4 rounded border-zinc-300"
        />
        <label htmlFor="marketingOptIn" className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('marketingOptIn')}
        </label>
      </div>

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
        disabled={isSubmitting}
        className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {isSubmitting ? t('signingUp') : t('signUpCta')}
      </button>
    </form>
  );
}
