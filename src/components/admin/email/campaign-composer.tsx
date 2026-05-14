'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SegmentDefinition } from '@/lib/email/segments';

interface Props {
  locale: string;
  segments: SegmentDefinition[];
}

/**
 * Campaign composer. Three-pane layout on desktop:
 *   - Form (left): name, subject, segment picker, HTML body textarea
 *   - Preview (right): rendered HTML in a sandboxed iframe
 *   - Action bar (bottom): Save draft / Send test to me / Send to segment
 *
 * Persistence is via a 2-step flow:
 *   1. "Save draft" / "Send" both POST /api/admin/email/campaigns
 *      first to create the email_campaigns row (or update if id known).
 *   2. "Send" then POSTs /api/email/send with the campaign id.
 *
 * Errors surface inline; success on Save returns the id which is held
 * in state so subsequent saves are updates.
 */
export function CampaignComposer({ locale, segments }: Props) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [segmentKey, setSegmentKey] = useState<string>(segments[0]?.key ?? '');
  const [htmlBody, setHtmlBody] = useState(SAMPLE_HTML);
  const [status, setStatus] = useState<'idle' | 'saving' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const selectedSegment = useMemo(
    () => segments.find((s) => s.key === segmentKey),
    [segmentKey, segments],
  );

  async function persist(): Promise<{ id: string } | null> {
    setErrorMsg(null);
    if (!name.trim() || !subject.trim() || !htmlBody.trim()) {
      setErrorMsg('Name, subject, and HTML body are required.');
      return null;
    }
    setStatus('saving');
    const res = await fetch('/api/admin/email/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: campaignId,
        name,
        subject,
        segment_key: segmentKey,
        html_body: htmlBody,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' }));
      setStatus('error');
      setErrorMsg(`Save failed: ${body.error ?? res.status}`);
      return null;
    }
    const data = (await res.json()) as { id: string };
    setCampaignId(data.id);
    setStatus('idle');
    return data;
  }

  async function saveDraft() {
    const r = await persist();
    if (r) {
      setResultMsg(`Draft saved · id ${r.id.slice(0, 8)}…`);
    }
  }

  async function sendTo(targetSegment: string) {
    const saved = await persist();
    if (!saved) return;
    // For test sends, override segment_key on the campaign first.
    if (targetSegment !== segmentKey) {
      await fetch('/api/admin/email/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: saved.id,
          name,
          subject,
          segment_key: targetSegment,
          html_body: htmlBody,
        }),
      });
    }
    setStatus('sending');
    const res = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaignId: saved.id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' }));
      setStatus('error');
      setErrorMsg(`Send failed: ${body.error ?? res.status}`);
      return;
    }
    const data = (await res.json()) as {
      recipientCount: number;
      sentCount: number;
      failedCount: number;
    };
    setStatus('sent');
    setResultMsg(
      `Sent ${data.sentCount}/${data.recipientCount} (${data.failedCount} failed)`,
    );
    if (targetSegment !== 'test_self') {
      startTransition(() => {
        router.push(`/${locale}/admin/email/${saved.id}`);
      });
    }
  }

  const busy = status === 'saving' || status === 'sending';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-label="Campaign form"
          className="space-y-3 rounded-card border border-border bg-surface p-5 dark:border-border-strong/40 dark:bg-surface-deep"
        >
          <Field label="Name (internal)">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="e.g. June 2026 — Pro upsell"
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm dark:bg-surface-dark"
            />
          </Field>
          <Field label="Subject (shown in inbox)">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="e.g. Save 8 hours/week with Pro Automation"
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm dark:bg-surface-dark"
            />
          </Field>
          <Field label="Segment">
            <select
              value={segmentKey}
              onChange={(e) => setSegmentKey(e.target.value)}
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm dark:bg-surface-dark"
            >
              {segments.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            {selectedSegment && (
              <p className="mt-1 text-xs text-helper">{selectedSegment.description}</p>
            )}
          </Field>
          <Field label="HTML body">
            <textarea
              value={htmlBody}
              onChange={(e) => setHtmlBody(e.target.value)}
              rows={18}
              className="w-full rounded-lg border border-border-strong bg-surface p-3 font-mono text-xs leading-relaxed dark:bg-surface-dark"
            />
            <p className="mt-1 text-xs text-helper">
              Inline-styled HTML only. A per-recipient unsubscribe footer is
              appended automatically at send time.
            </p>
          </Field>
        </section>

        <section
          aria-label="Preview"
          className="rounded-card border border-border bg-surface p-2 dark:border-border-strong/40 dark:bg-surface-deep"
        >
          <p className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            Preview
          </p>
          <iframe
            title="HTML preview"
            srcDoc={htmlBody}
            sandbox=""
            className="h-[640px] w-full rounded-lg border border-border-strong/40 bg-white"
          />
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={saveDraft}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium transition hover:bg-black/5 disabled:opacity-50 dark:bg-surface-deep dark:hover:bg-white/5"
        >
          {status === 'saving' ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={() => sendTo('test_self')}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium transition hover:bg-black/5 disabled:opacity-50 dark:bg-surface-deep dark:hover:bg-white/5"
        >
          Send test to me
        </button>
        <button
          type="button"
          onClick={() => sendTo(segmentKey)}
          disabled={busy || segmentKey === 'test_self'}
          className="inline-flex h-10 items-center rounded-lg bg-action px-6 text-sm font-semibold text-white shadow-whisper transition hover:opacity-90 disabled:opacity-50 dark:bg-action-dark dark:text-surface-deep"
        >
          {status === 'sending' ? 'Sending…' : `Send to "${selectedSegment?.label ?? segmentKey}"`}
        </button>
        {resultMsg && (
          <p className="ml-auto text-sm text-emerald-700 dark:text-emerald-300">
            {resultMsg}
          </p>
        )}
        {errorMsg && (
          <p role="alert" className="ml-auto text-sm text-red-600">
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
        {label}
      </span>
      {children}
    </label>
  );
}

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafaf9;color:#111827;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fafaf9;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
          <tr><td style="padding:32px 32px 16px 32px;">
            <h1 style="margin:0 0 8px 0;font-size:24px;line-height:1.25;">Hi there,</h1>
            <p style="margin:0 0 12px 0;color:#374151;line-height:1.6;">
              Replace this with your campaign copy. Inline styles only —
              external CSS doesn't survive Gmail / Outlook.
            </p>
            <p style="margin:24px 0;">
              <a href="https://advertisehomes.online/en/pricing" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                See pricing →
              </a>
            </p>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
