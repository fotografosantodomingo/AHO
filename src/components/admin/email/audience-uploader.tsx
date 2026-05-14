'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ParsedRow {
  name: string;
  country: string;
  email: string;
  _lineNumber: number;
}

interface RowError {
  lineNumber: number;
  message: string;
  raw: string;
}

interface Props {
  locale: string;
}

const TEMPLATE_CSV = `name,country,email
Maria Lopez,DO,maria.lopez@example.com
John Smith,US,john.smith@example.com
Anna Müller,DE,anna.mueller@example.com
`;

/**
 * CSV uploader for marketing audiences. Three states:
 *   1. Idle — drop / pick CSV file
 *   2. Preview — parsed rows + errors shown; user reviews + confirms
 *      GDPR-style consent checkbox + clicks Import
 *   3. Done — import succeeded; show counts + link to audience
 *
 * The CSV is parsed in the browser (no upload to a /parse endpoint).
 * Required headers: name, country, email — any order. Other columns
 * are ignored. UTF-8 expected; BOM stripped.
 */
export function AudienceUploader({ locale }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<RowError[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleFile(file: File) {
    setParseErrors([]);
    setParsedRows([]);
    setStatus(null);
    setErrorMsg(null);
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorMsg('File must be a .csv. Save the spreadsheet as CSV before uploading.');
      return;
    }
    const text = await file.text();
    const { rows, errors } = parseCsv(text);
    setParsedRows(rows);
    setParseErrors(errors);
    if (!name) {
      setName(file.name.replace(/\.csv$/i, ''));
    }
  }

  async function handleImport() {
    if (parsedRows.length === 0) {
      setErrorMsg('No valid rows to import.');
      return;
    }
    if (!name.trim()) {
      setErrorMsg('Audience name is required.');
      return;
    }
    if (!consent) {
      setErrorMsg('Please confirm the consent statement before importing.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setStatus('Uploading…');
    try {
      const res = await fetch('/api/admin/email/audiences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          contacts: parsedRows.map((r) => ({
            email: r.email,
            full_name: r.name || null,
            country_code: r.country || null,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'unknown' }));
        setErrorMsg(`Import failed: ${body.error ?? res.status}`);
        setStatus(null);
        return;
      }
      const data = (await res.json()) as { inserted: number; duplicatesSkipped: number; audienceId: string };
      setStatus(`✓ Imported ${data.inserted} contacts (${data.duplicatesSkipped} duplicates skipped). Redirecting…`);
      setTimeout(() => {
        router.push(`/${locale}/admin/email/audiences`);
      }, 1500);
    } catch (e) {
      setErrorMsg(`Import failed: ${e instanceof Error ? e.message : 'network error'}`);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aho-contacts-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section
        aria-label="Audience metadata"
        className="space-y-3 rounded-card border border-border bg-surface p-5 dark:border-border-strong/40 dark:bg-surface-deep"
      >
        <h2 className="font-brand text-base font-semibold">1. Name the audience</h2>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-helper">
            Audience name (internal)
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Real estate agents — Dominican Republic Q2 2026"
            maxLength={200}
            className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted dark:bg-surface-deep dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-helper">
            Description (optional)
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Source of the list, date acquired, anything that helps you remember why this exists"
            maxLength={2000}
            rows={2}
            className="w-full rounded-lg border border-border-strong bg-surface p-3 text-sm text-ink placeholder:text-ink-muted dark:bg-surface-deep dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted"
          />
        </label>
      </section>

      <section
        aria-label="CSV file"
        className="space-y-3 rounded-card border border-border bg-surface p-5 dark:border-border-strong/40 dark:bg-surface-deep"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-brand text-base font-semibold">2. Upload CSV</h2>
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-xs font-medium text-action hover:underline dark:text-action-dark"
          >
            Download template ↓
          </button>
        </div>
        <p className="text-xs text-helper">
          Required headers: <code>name</code>, <code>country</code>, <code>email</code>.
          Country must be the 2-letter ISO code (DO, US, ES, PL, …) or empty.
          Other columns are ignored.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          className="block text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-border-strong file:bg-surface file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-black/5 dark:file:bg-surface-deep dark:hover:file:bg-white/5"
        />
        {parsedRows.length > 0 && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <p className="font-semibold text-emerald-700 dark:text-emerald-300">
              ✓ Parsed {parsedRows.length} contact{parsedRows.length === 1 ? '' : 's'}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-helper">Preview first 10</summary>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-helper">
                    <th className="pr-3">name</th>
                    <th className="pr-3">country</th>
                    <th>email</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="font-mono">
                      <td className="pr-3 py-0.5">{r.name || '—'}</td>
                      <td className="pr-3 py-0.5">{r.country || '—'}</td>
                      <td className="py-0.5">{r.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 10 && (
                <p className="mt-1 text-xs text-helper">…and {parsedRows.length - 10} more</p>
              )}
            </details>
          </div>
        )}
        {parseErrors.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
            <p className="font-semibold text-red-700 dark:text-red-300">
              ⚠ {parseErrors.length} row{parseErrors.length === 1 ? '' : 's'} skipped
            </p>
            <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-red-900 dark:text-red-200">
              {parseErrors.slice(0, 20).map((e) => (
                <li key={e.lineNumber}>
                  Line {e.lineNumber}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section
        aria-label="Consent"
        className="space-y-3 rounded-card border border-amber-500/30 bg-amber-500/5 p-5"
      >
        <h2 className="font-brand text-base font-semibold text-amber-900 dark:text-amber-100">
          3. Consent (GDPR / CAN-SPAM)
        </h2>
        <p className="text-sm text-amber-900 dark:text-amber-100">
          AHO's email send infrastructure is shared with transactional emails.
          Bulk emailing contacts who did not opt in to receive marketing from
          you exposes both your sender reputation and AHO's domain reputation
          to spam complaints + blocklisting.
        </p>
        <label className="flex items-start gap-3 text-sm text-amber-900 dark:text-amber-100">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-amber-500/50"
          />
          <span>
            I confirm that every contact in this CSV has explicitly opted in to
            receive marketing emails from me, and I have a record of that
            consent. I understand AHO will include an unsubscribe link in every
            send, and that unsubscribes are permanent.
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleImport}
          disabled={busy || parsedRows.length === 0 || !consent || !name.trim()}
          className="inline-flex h-10 items-center rounded-lg bg-action px-6 text-sm font-semibold text-white shadow-whisper transition hover:opacity-90 disabled:opacity-50 dark:bg-action-dark dark:text-surface-deep"
        >
          {busy ? 'Importing…' : `Import ${parsedRows.length} contact${parsedRows.length === 1 ? '' : 's'}`}
        </button>
        {status && (
          <p className="ml-auto text-sm text-emerald-700 dark:text-emerald-300">{status}</p>
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

/**
 * Minimal CSV parser. Handles:
 *   - quoted values with embedded commas + escaped double quotes ("")
 *   - UTF-8 BOM
 *   - LF or CRLF line endings
 *   - empty trailing lines
 *
 * Required headers (case-insensitive): name, country, email. Other
 * columns are silently ignored. Rows missing email are skipped.
 */
function parseCsv(text: string): { rows: ParsedRow[]; errors: RowError[] } {
  const stripped = text.replace(/^﻿/, '');
  const lines = stripped.split(/\r?\n/);
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  if (lines.length === 0) return { rows, errors };

  const headerCells = parseCsvLine(lines[0] ?? '').map((c) => c.toLowerCase().trim());
  const nameIdx = headerCells.indexOf('name');
  const countryIdx = headerCells.indexOf('country');
  const emailIdx = headerCells.indexOf('email');
  if (emailIdx === -1) {
    errors.push({
      lineNumber: 1,
      message: 'Missing required header: "email". Header row must contain at least: name, country, email',
      raw: lines[0] ?? '',
    });
    return { rows, errors };
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const email = (cells[emailIdx] ?? '').trim().toLowerCase();
    if (!email) {
      errors.push({ lineNumber: i + 1, message: 'Empty email', raw: line });
      continue;
    }
    if (!isValidEmail(email)) {
      errors.push({ lineNumber: i + 1, message: `Invalid email: ${email}`, raw: line });
      continue;
    }
    rows.push({
      name: nameIdx >= 0 ? (cells[nameIdx] ?? '').trim() : '',
      country: countryIdx >= 0 ? (cells[countryIdx] ?? '').trim() : '',
      email,
      _lineNumber: i + 1,
    });
  }

  return { rows, errors };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else if (ch === '"' && cur === '') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  cells.push(cur);
  return cells;
}

function isValidEmail(s: string): boolean {
  // Same pragmatic regex used elsewhere in the codebase — RFC-compliant
  // is overkill for client-side sanity checking.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 320;
}
