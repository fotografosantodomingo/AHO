'use client';

import { useState, useTransition } from 'react';

/**
 * Day-4 social-grid component for the listing edit page. Generates
 * captions for the published listing across 3 platforms × 7 locales =
 * 21 variants, each with the listing's permanent AHO URL embedded.
 *
 * Per docs/CONTENT_HUB_VISION.md:
 *   - One click → 21 calls in parallel to /api/ai/copywriter
 *   - Each cell fills in independently as the call returns (~5-8s)
 *   - Each cell's "Copy" button copies the ready-to-paste string
 *     (body + URL + hashtags) to the clipboard for FB/IG/LinkedIn
 *
 * Visible only when the listing is published (status='active') AND
 * the org is on Pro Automation. Both gates are server-checked by the
 * API route as well.
 */

const PLATFORMS = [
  { id: 'fb_feed', label: 'Facebook' },
  { id: 'ig_feed', label: 'Instagram' },
  { id: 'linkedin', label: 'LinkedIn' },
] as const;
type Platform = (typeof PLATFORMS)[number]['id'];

const LOCALES = [
  { id: 'en', flag: '🇬🇧', label: 'English' },
  { id: 'es', flag: '🇪🇸', label: 'Español' },
  { id: 'pl', flag: '🇵🇱', label: 'Polski' },
  { id: 'pt', flag: '🇵🇹', label: 'Português' },
  { id: 'de', flag: '🇩🇪', label: 'Deutsch' },
  { id: 'fr', flag: '🇫🇷', label: 'Français' },
  { id: 'it', flag: '🇮🇹', label: 'Italiano' },
] as const;
type LocaleId = (typeof LOCALES)[number]['id'];

interface Caption {
  text: string;
  characterCount: number;
  hashtags: string[];
  readyToPaste: string;
}

type CellState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'done'; captions: Caption[] }
  | { status: 'error'; message: string };

interface Props {
  propertyId: string;
  /** Number of variants per (platform, locale) cell. Default 1 keeps
   *  the grid scannable at 21 cells; users who want A/B-test variants
   *  can request more per cell from the playground. */
  variantsPerCell?: number;
}

function makeKey(platform: Platform, locale: LocaleId): string {
  return `${platform}::${locale}`;
}

export function SocialGrid({ propertyId, variantsPerCell = 1 }: Props) {
  const [, startTransition] = useTransition();
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [generating, setGenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function generateCell(platform: Platform, locale: LocaleId): Promise<void> {
    const key = makeKey(platform, locale);
    setCells((c) => ({ ...c, [key]: { status: 'pending' } }));
    try {
      const res = await fetch('/api/ai/copywriter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          locale,
          platform,
          count: variantsPerCell,
        }),
      });
      const json = (await res.json()) as
        | { captions: Caption[] }
        | { error: string; details?: unknown; currentStatus?: string };
      if (!res.ok || !('captions' in json)) {
        const errMsg =
          'error' in json
            ? `${json.error}${'currentStatus' in json && json.currentStatus ? ` (status: ${json.currentStatus})` : ''}`
            : `HTTP ${res.status}`;
        setCells((c) => ({ ...c, [key]: { status: 'error', message: errMsg } }));
        return;
      }
      setCells((c) => ({
        ...c,
        [key]: { status: 'done', captions: json.captions },
      }));
    } catch (e) {
      setCells((c) => ({
        ...c,
        [key]: {
          status: 'error',
          message: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }

  function generateAll(): void {
    setGenerating(true);
    setCopiedKey(null);
    // Reset every cell to idle so a re-run clears prior content.
    const fresh: Record<string, CellState> = {};
    for (const p of PLATFORMS) {
      for (const l of LOCALES) {
        fresh[makeKey(p.id, l.id)] = { status: 'pending' };
      }
    }
    setCells(fresh);

    const tasks: Array<Promise<void>> = [];
    for (const p of PLATFORMS) {
      for (const l of LOCALES) {
        tasks.push(generateCell(p.id, l.id));
      }
    }
    void Promise.allSettled(tasks).finally(() => {
      startTransition(() => setGenerating(false));
    });
  }

  async function copyCell(key: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      /* clipboard refused */
    }
  }

  const hasAnyDone = Object.values(cells).some((c) => c.status === 'done');

  return (
    <section
      aria-labelledby="social-grid-heading"
      className="space-y-4 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-helper">
            Pro Automation · Content Hub
          </p>
          <h2
            id="social-grid-heading"
            className="mt-1 font-brand text-xl font-semibold tracking-tight md:text-[24px]"
          >
            Generate 21 social posts
          </h2>
          <p className="mt-1 text-sm text-helper">
            One click → 3 platforms × 7 languages = 21 ready-to-paste posts. Every variant
            includes the link to this listing on AHO. Tone: investment angle.
          </p>
        </div>
        <button
          type="button"
          onClick={generateAll}
          disabled={generating}
          className="btn-primary inline-flex h-10 items-center px-5 disabled:opacity-50"
        >
          {generating ? 'Generating…' : hasAnyDone ? 'Regenerate all' : 'Generate'}
        </button>
      </header>

      {Object.keys(cells).length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong/60 px-4 py-6 text-center text-sm text-helper">
          Click <strong>Generate</strong> to fill the grid. Each cell takes ~5-8s; cells appear as
          they finish.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-2">
            <thead>
              <tr>
                <th className="w-32 text-left text-xs font-semibold uppercase tracking-wider text-helper">
                  Locale
                </th>
                {PLATFORMS.map((p) => (
                  <th
                    key={p.id}
                    className="text-left text-xs font-semibold uppercase tracking-wider text-helper"
                  >
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LOCALES.map((l) => (
                <tr key={l.id}>
                  <td className="align-top">
                    <div className="flex items-center gap-2 pt-3">
                      <span aria-hidden="true" className="text-xl">
                        {l.flag}
                      </span>
                      <span className="text-sm font-medium">{l.label}</span>
                    </div>
                  </td>
                  {PLATFORMS.map((p) => {
                    const key = makeKey(p.id, l.id);
                    const cell = cells[key] ?? { status: 'idle' };
                    return (
                      <td
                        key={p.id}
                        className="min-w-[280px] max-w-[400px] align-top"
                      >
                        <Cell
                          state={cell}
                          isCopied={copiedKey === key}
                          onCopy={() =>
                            cell.status === 'done' && cell.captions[0]
                              ? copyCell(key, cell.captions[0].readyToPaste)
                              : undefined
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Cell({
  state,
  isCopied,
  onCopy,
}: {
  state: CellState;
  isCopied: boolean;
  onCopy: () => void;
}) {
  if (state.status === 'idle') {
    return (
      <div className="h-full rounded-card border border-dashed border-border-strong/40 p-3 text-xs text-helper">
        —
      </div>
    );
  }
  if (state.status === 'pending') {
    return (
      <div className="h-full animate-pulse space-y-2 rounded-card border border-border bg-surface-muted/40 p-3">
        <div className="h-3 w-full rounded bg-border-strong/30" />
        <div className="h-3 w-5/6 rounded bg-border-strong/30" />
        <div className="h-3 w-3/4 rounded bg-border-strong/30" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div
        role="alert"
        className="h-full rounded-card border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300"
      >
        {state.message}
      </div>
    );
  }
  const cap = state.captions[0];
  if (!cap) {
    return (
      <div className="h-full rounded-card border border-border bg-surface p-3 text-xs text-helper dark:bg-surface-deep">
        (empty)
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-3 dark:bg-surface-deep">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{cap.text}</p>
      {cap.hashtags.length > 0 && (
        <p className="text-xs text-helper">{cap.hashtags.slice(0, 4).join(' ')}</p>
      )}
      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="text-[11px] text-helper">{cap.characterCount} chars</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-7 items-center rounded-md border border-border-strong bg-surface px-2 text-[11px] transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
        >
          {isCopied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
