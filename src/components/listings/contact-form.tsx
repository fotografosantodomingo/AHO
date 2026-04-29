'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';

interface ContactFormProps {
  propertyId: string;
}

const FormSchema = z.object({
  name: z.string().trim().min(1, { message: 'nameRequired' }).max(120),
  email: z.string().trim().email({ message: 'emailInvalid' }).max(200),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  message: z.string().trim().min(1, { message: 'messageRequired' }).max(4000),
});
type FormValues = z.infer<typeof FormSchema>;

const inputClass =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-100';

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
      }),
    });
    if (!res.ok) {
      setServerError('send_failed');
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
      {serverError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          {t(`errors.${serverError}` as 'errors.send_failed')}
        </div>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex h-10 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {isSubmitting ? t('sending') : t('send')}
      </button>
    </form>
  );
}
