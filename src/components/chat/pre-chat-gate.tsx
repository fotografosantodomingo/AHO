'use client';

/**
 * Pre-chat gate rendered INSIDE the per-agent <AiChatWidget> on
 * /properties/[slug] and /agents/[slug]. The visitor must provide
 * name + email + accept terms before they can send their first
 * message. On submit, the form POSTs to /api/newsletter which
 * upserts the contact into Brevo (with source='chat-widget' +
 * CONSENT_TS attribute for GDPR audit) and returns ok. The widget
 * then unlocks the chat UI.
 *
 * Acceptance is persisted to localStorage keyed by `aho:chat-gate:v1`
 * so returning visitors don't see the gate again on the same device.
 * The key bumps to v2 if we ever change the consent text materially.
 *
 * Per PO 2026-05-19: the gate applies to ALL visitors on /properties
 * + /agents (signed-in users included). The 30-second friction is the
 * cost of capturing the newsletter list. AHO Assistant (platform Q&A
 * on /pricing /docs /sell etc.) DOES NOT use this gate — different
 * intent + different widget.
 */

import { useState } from 'react';
import { useLocale } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

export interface GateResult {
  name: string;
  email: string;
}

export interface PreChatGateProps {
  /** Called once the visitor has accepted + the Brevo subscribe call
   *  has returned ok. Parent should then flip the gate-passed flag
   *  + render the message UI. */
  onAccepted: (result: GateResult) => void;
  /** Pre-fill name + email when the visitor is already authenticated
   *  (we still show the gate for the consent step, but the fields
   *  start populated from the profile). */
  prefill?: Partial<GateResult>;
  /** Localized strings the parent passes in (the chat widget already
   *  carries a `COPY` table per locale; gate copy lives alongside
   *  the chat copy to keep the widget self-contained). */
  copy: {
    heading: string;
    sub: string;
    nameLabel: string;
    namePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    /** Rendered with {terms} / {privacy} link placeholders — the
     *  component substitutes the localized routes. */
    consentText: string;
    consentTermsLabel: string;
    consentPrivacyLabel: string;
    submit: string;
    submitting: string;
    errorEmail: string;
    errorName: string;
    errorConsent: string;
    errorNetwork: string;
  };
}

const STORAGE_KEY = 'aho:chat-gate:v1';

/** localStorage helpers — return null on SSR / disabled storage. */
export function readStoredAcceptance(): GateResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: unknown; email?: unknown };
    if (typeof parsed.name === 'string' && typeof parsed.email === 'string') {
      return { name: parsed.name, email: parsed.email };
    }
    return null;
  } catch {
    return null;
  }
}

function persistAcceptance(value: GateResult): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* private mode / disabled — non-fatal, gate just re-prompts next visit */
  }
}

export function PreChatGate({ onAccepted, prefill, copy }: PreChatGateProps) {
  const locale = useLocale() as Locale;
  const [name, setName] = useState(prefill?.name ?? '');
  const [emailVal, setEmail] = useState(prefill?.email ?? '');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const termsHref = localePath(locale, '/terms');
  const privacyHref = localePath(locale, '/privacy');

  // The localized consentText carries the literal tokens {terms} +
  // {privacy} which we replace with anchor tags here. Splitting on
  // the tokens means a translator can move the link placement
  // around within the sentence freely.
  function renderConsent(): React.ReactNode {
    const parts = copy.consentText.split(/(\{terms\}|\{privacy\})/g);
    return parts.map((p, i) => {
      if (p === '{terms}') {
        return (
          <a
            key={i}
            href={termsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-action underline underline-offset-2 hover:opacity-80 dark:text-action-dark"
          >
            {copy.consentTermsLabel}
          </a>
        );
      }
      if (p === '{privacy}') {
        return (
          <a
            key={i}
            href={privacyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-action underline underline-offset-2 hover:opacity-80 dark:text-action-dark"
          >
            {copy.consentPrivacyLabel}
          </a>
        );
      }
      return <span key={i}>{p}</span>;
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Client-side guards mirror the server-side Zod schema on
    // /api/newsletter. The server is still the source of truth — a
    // malformed payload that slips past these returns 400.
    const trimmedName = name.trim();
    const trimmedEmail = emailVal.trim();
    if (!trimmedName) {
      setError(copy.errorName);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(copy.errorEmail);
      return;
    }
    if (!accepted) {
      setError(copy.errorConsent);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          locale,
          source: 'chat-widget',
        }),
      });
      // Match the route's contract: { ok: true } means the contact
      // either landed in Brevo or the route fell back to a soft-ok
      // (Brevo not configured). Either way the visitor's done their
      // part — let them into the chat.
      if (!res.ok) {
        setError(copy.errorNetwork);
        setSubmitting(false);
        return;
      }
      const result: GateResult = { name: trimmedName, email: trimmedEmail };
      persistAcceptance(result);
      onAccepted(result);
    } catch {
      setError(copy.errorNetwork);
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 px-4 py-3"
      noValidate
      aria-label={copy.heading}
    >
      <div>
        <p className="font-brand text-sm font-semibold tracking-tight">
          {copy.heading}
        </p>
        <p className="mt-1 text-xs text-helper">{copy.sub}</p>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-ink dark:text-ink-inverse">
          {copy.nameLabel}
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={copy.namePlaceholder}
          autoComplete="name"
          required
          disabled={submitting}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-hidden focus:border-action disabled:opacity-60 dark:border-border-strong/40 dark:bg-surface-dark"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-ink dark:text-ink-inverse">
          {copy.emailLabel}
        </span>
        <input
          type="email"
          value={emailVal}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={copy.emailPlaceholder}
          autoComplete="email"
          required
          disabled={submitting}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-hidden focus:border-action disabled:opacity-60 dark:border-border-strong/40 dark:bg-surface-dark"
        />
      </label>
      <label className="flex items-start gap-2 text-xs leading-relaxed">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          disabled={submitting}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border-border-strong"
        />
        <span className="text-helper">{renderConsent()}</span>
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="btn-primary inline-flex h-9 items-center justify-center px-3 text-sm font-semibold disabled:opacity-60"
      >
        {submitting ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
