'use client';

import { useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';
import {
  TurnstileWidget,
  isTurnstileConfigured,
  type TurnstileWidgetHandle,
} from '@/components/auth/turnstile-widget';

interface ContactFormProps {
  propertyId: string;
}

const FormSchema = z.object({
  name: z.string().trim().min(1, { message: 'nameRequired' }).max(120),
  email: z.string().trim().email({ message: 'emailInvalid' }).max(200),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  message: z.string().trim().min(1, { message: 'messageRequired' }).max(4000),
  /**
   * Honeypot. A hidden field with the common-bait name `website` —
   * real users never see or fill it; most spam bots auto-fill every
   * field they discover. Server enforces empty-string-or-omitted via
   * `LeadCreateSchema.website` (max(0) rejection).
   */
  website: z.string().optional(),
});
type FormValues = z.infer<typeof FormSchema>;

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

const ERROR_KEYS = ['nameRequired', 'emailInvalid', 'emailRequired', 'messageRequired'] as const;
type KnownErrorKey = (typeof ERROR_KEYS)[number];
function isKnownErrorKey(k: string): k is KnownErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(k);
}

export function ContactForm({ propertyId }: ContactFormProps) {
  const t = useTranslations('contact');
  const locale = useLocale();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRequired = isTurnstileConfigured();
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const onCaptchaToken = useCallback(
    (token: string) => setCaptchaToken(token),
    [],
  );
  const onCaptchaExpire = useCallback(() => setCaptchaToken(null), []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        property_id: propertyId,
        source: 'form',
        contact_name: values.name,
        contact_email: values.email,
        contact_phone: values.phone || undefined,
        message: values.message,
        language: locale,
        // Honeypot — real users always send empty string; bots that
        // auto-fill every field will get rejected server-side via the
        // schema's `website: max(0)` rule.
        website: values.website ?? '',
        // Turnstile token — server verifies via Cloudflare siteverify
        // (src/lib/auth/turnstile-verify.ts). Single-use; reset widget
        // on any error so retries carry a fresh token.
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      }),
    });
    if (!res.ok) {
      setServerError('send_failed');
      // Reset widget so a retry gets a fresh token (Turnstile tokens
      // are one-shot — same fix as the auth forms in commit 604738a).
      setCaptchaToken(null);
      turnstileRef.current?.reset();
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div
        role="status"
        className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
      >
        {t('sent')}
      </div>
    );
  }

  function err(key: keyof FormValues): string | null {
    const m = errors[key]?.message;
    if (!m) return null;
    return isKnownErrorKey(m) ? t(`errors.${m}`) : t('errors.send_failed');
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
      {/* Honeypot. Hidden from real users via `aria-hidden` + the
          `sr-only`-equivalent positioning + `tabindex={-1}` so it's
          unreachable via Tab. Spam bots that scrape the DOM and fill
          every input get caught — server schema rejects any non-empty
          value as 400. Field name `website` is a common bait, well-
          worn enough that bots specifically target it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden opacity-0"
      >
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register('website')}
        />
      </div>
      <div>
        <label htmlFor="contact-name" className="block text-sm font-medium">
          {t('name')}
        </label>
        <input id="contact-name" type="text" autoComplete="name" {...register('name')} className={inputClass} />
        {err('name') && <p className="mt-1 text-sm text-red-600">{err('name')}</p>}
      </div>
      <div>
        <label htmlFor="contact-email" className="block text-sm font-medium">
          {t('email')}
        </label>
        <input id="contact-email" type="email" autoComplete="email" {...register('email')} className={inputClass} />
        {err('email') && <p className="mt-1 text-sm text-red-600">{err('email')}</p>}
      </div>
      <div>
        <label htmlFor="contact-phone" className="block text-sm font-medium">
          {t('phone')}
        </label>
        <input id="contact-phone" type="tel" autoComplete="tel" {...register('phone')} className={inputClass} />
      </div>
      <div>
        <label htmlFor="contact-message" className="block text-sm font-medium">
          {t('message')}
        </label>
        <textarea
          id="contact-message"
          rows={4}
          placeholder={t('messagePlaceholder')}
          {...register('message')}
          className={inputClass}
        />
        {err('message') && <p className="mt-1 text-sm text-red-600">{err('message')}</p>}
      </div>
      <TurnstileWidget
        ref={turnstileRef}
        onToken={onCaptchaToken}
        onExpire={onCaptchaExpire}
      />
      {serverError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          {t(`errors.${serverError}` as 'errors.send_failed')}
        </div>
      )}
      <button
        type="submit"
        disabled={isSubmitting || (turnstileRequired && !captchaToken)}
        className="btn-primary px-4 disabled:opacity-50"
      >
        {isSubmitting ? t('sending') : t('send')}
      </button>
    </form>
  );
}
