'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/**
 * Newsletter signup form for the footer. Native HTML5 email validation
 * (type=email + required) plus server-side Zod via /api/newsletter.
 *
 * Three states:
 *   - idle    — input + Subscribe button
 *   - sending — button shows "…" with disabled input
 *   - done    — input + button hidden; replaced by a single confirmation
 *               line. Stays in this state for the rest of the session.
 *
 * The endpoint gracefully no-ops when Brevo env isn't set, so the success
 * state is honest in both wired-and-unwired modes — the user submitted
 * a valid email; whether Brevo received it depends on PO config.
 */
export function NewsletterForm() {
  const t = useTranslations('footer.newsletter');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'sending' || state === 'done') return;
    setState('sending');
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), locale }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p
        role="status"
        className="rounded-md bg-action/10 px-3 py-2 text-sm text-action dark:bg-action-dark/15 dark:text-action-dark"
      >
        {t('thanks')}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label htmlFor="footer-newsletter-email" className="sr-only">
        {t('label')}
      </label>
      <div className="flex gap-2">
        <input
          id="footer-newsletter-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state === 'sending'}
          placeholder={t('placeholder')}
          className="block h-10 flex-1 rounded-full border border-white/15 bg-white/5 px-4 text-sm text-ink-inverse placeholder:text-ink-inverse-muted/70 focus:border-action-dark focus:outline-hidden focus:ring-2 focus:ring-action-dark/40 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-surface px-5 text-sm font-medium text-action shadow-whisper transition hover:bg-surface-muted active:scale-95 disabled:opacity-60"
        >
          {state === 'sending' ? '…' : t('submit')}
        </button>
      </div>
      {state === 'error' && (
        <p role="alert" className="text-xs text-error">
          {t('error')}
        </p>
      )}
    </form>
  );
}
