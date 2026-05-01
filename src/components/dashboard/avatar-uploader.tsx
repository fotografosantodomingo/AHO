'use client';

import { useRef, useState, type ChangeEvent } from 'react';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 2_000_000;

interface Labels {
  upload: string;
  replace: string;
  remove: string;
  uploading: string;
  tooLarge: string;
  badType: string;
  failed: string;
}

interface Props {
  current: string;
  onChange: (next: string) => void;
  labels: Labels;
}

/**
 * File-picker avatar uploader. Validates type + size client-side (mirror
 * of the server allowlist), POSTs the chosen file to /api/me/avatar as
 * multipart, and on success calls `onChange(newUrl)` so the parent
 * profile form can submit the URL alongside the rest of the form.
 *
 * Removing clears the parent's value (and submitting the form persists
 * `avatar_url: null`); we don't issue DELETE here — the parent form is
 * the single write boundary for profile updates.
 */
export function AvatarUploader({ current, onChange, labels }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      setError(labels.badType);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(labels.tooLarge);
      return;
    }
    setPending(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/me/avatar', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setError(labels.failed);
        return;
      }
      const data = (await res.json()) as { ok: boolean; avatarUrl?: string };
      if (data.ok && data.avatarUrl) {
        onChange(data.avatarUrl);
      } else {
        setError(labels.failed);
      }
    } catch {
      setError(labels.failed);
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="mt-1 flex items-start gap-4">
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current}
          alt=""
          className="h-20 w-20 rounded-full border border-border object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-border-strong/60 bg-surface-muted text-helper dark:bg-surface-dark"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.314 0-8 1.343-8 4v2h16v-2c0-2.657-4.686-4-8-4Z" />
          </svg>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED.join(',')}
          onChange={onPick}
          className="sr-only"
          id="avatar-file-input"
        />
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor="avatar-file-input"
            className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-border-strong px-3 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5 ${
              pending ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {pending ? labels.uploading : current ? labels.replace : labels.upload}
          </label>
          {current && !pending && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-helper transition hover:text-ink dark:hover:text-ink-inverse"
            >
              {labels.remove}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
