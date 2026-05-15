'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

interface SetupMfaCardProps {
  locale: string;
  isAdmin: boolean;
}

interface EnrollState {
  /** Server-issued factor id; needed for the verify call. */
  factorId: string;
  /** TOTP otpauth:// URI — feeds the QR code rendering. */
  uri: string;
  /** Plaintext secret — shown for users whose authenticator can't scan. */
  secret: string;
}

/**
 * TOTP enrollment widget.
 *
 * Calls supabase.auth.mfa.enroll() to mint an unverified factor +
 * otpauth URI, renders the QR (and the plaintext secret as a
 * fallback) for the user to add to their authenticator app, then
 * verifies the 6-digit code via supabase.auth.mfa.challenge() +
 * supabase.auth.mfa.verify(). On success we router.refresh() so the
 * server-side gate re-runs and lets the user through to /admin.
 *
 * QR rendering: `qrcode.react` renders an SVG client-side. Previous
 * impl used chart.googleapis.com/chart which Google retired in 2024;
 * that's the bug this replaces.
 */
export function SetupMfaCard({ locale, isAdmin }: SetupMfaCardProps) {
  const t = useTranslations('auth.mfa');
  const router = useRouter();
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // On mount, kick off the enrollment so the QR is ready when the
  // user starts scanning. If a previous unverified factor exists,
  // Supabase returns that one — no orphan rows.
  useEffect(() => {
    let cancelled = false;
    async function start() {
      const supabase = getSupabaseBrowserClient();
      // Look for an existing unverified totp factor first; reusing
      // it avoids piling up "totp-Sun-Apr-27" rows in auth.factors
      // every time the user reloads this page. Note that the
      // listFactors response splits factors: `data.totp` is the
      // VERIFIED set only; unverified rows live in `data.all`.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const existing = factors?.all?.find(
        (f) => f.factor_type === 'totp' && f.status === 'unverified',
      );
      if (existing) {
        // Supabase doesn't expose the otpauth URI for an existing
        // unverified factor through listFactors — only `enroll`
        // returns it. Easiest path: unenroll the stale row and re-
        // enroll fresh. The user hasn't completed setup so nothing
        // is lost.
        await supabase.auth.mfa.unenroll({ factorId: existing.id });
      }
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `AHO admin · ${new Date().toISOString().slice(0, 10)}`,
      });
      if (cancelled) return;
      if (enrollErr || !data) {
        setError(enrollErr?.message ?? t('errorGeneric'));
        return;
      }
      setEnroll({
        factorId: data.id,
        uri: data.totp.uri,
        secret: data.totp.secret,
      });
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function onVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enroll) return;
    setError(null);
    setWorking(true);
    try {
      const supabase = getSupabaseBrowserClient();
      // Two-step: challenge() opens a verify window, verify()
      // submits the user's 6-digit code against it.
      const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({
        factorId: enroll.factorId,
      });
      if (chalErr || !chal) {
        setError(chalErr?.message ?? t('errorGeneric'));
        return;
      }
      const { error: verErr } = await supabase.auth.mfa.verify({
        factorId: enroll.factorId,
        challengeId: chal.id,
        code: code.replace(/\s+/g, ''),
      });
      if (verErr) {
        setError(t('errorBadCode'));
        return;
      }
      setSuccess(true);
      // Re-run the server gate. For admins this redirects to /admin;
      // for non-admins they stay on /setup-mfa with the success
      // state.
      router.refresh();
      if (isAdmin) {
        // Brief settle so the success state is visible before the
        // navigation happens.
        setTimeout(() => router.push(`/${locale}/admin`), 600);
      }
    } finally {
      setWorking(false);
    }
  }

  if (success) {
    return (
      <div
        role="status"
        className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
      >
        {t('success')}
      </div>
    );
  }

  if (!enroll) {
    return (
      <p className="text-sm text-helper" aria-live="polite">
        {error ?? t('preparing')}
      </p>
    );
  }

  return (
    <form onSubmit={onVerify} className="space-y-4">
      <ol className="space-y-3 text-sm">
        <li>
          <p className="font-medium">{t('step1Title')}</p>
          <p className="text-helper">{t('step1Body')}</p>
        </li>
        <li>
          <p className="font-medium">{t('step2Title')}</p>
          <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <QRCodeSVG
              value={enroll.uri}
              size={200}
              level="M"
              aria-label={t('qrAlt')}
              className="rounded-md border border-border bg-white p-2"
            />
            <div className="text-xs text-helper">
              <p className="mb-1">{t('manualEntry')}</p>
              <code className="block break-all rounded bg-black/5 px-2 py-1 dark:bg-white/10">
                {enroll.secret}
              </code>
            </div>
          </div>
        </li>
        <li>
          <label htmlFor="totp-code" className="font-medium">
            {t('step3Title')}
          </label>
          <p className="text-helper">{t('step3Body')}</p>
          <input
            id="totp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
          />
        </li>
      </ol>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={working || code.length !== 6}
        className="btn-primary w-full disabled:opacity-50"
      >
        {working ? t('verifying') : t('verifyCta')}
      </button>
    </form>
  );
}
