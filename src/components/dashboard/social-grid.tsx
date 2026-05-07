'use client';

import { useState, useTransition } from 'react';
import type { Locale } from '@/i18n/config';

/**
 * Day-4 social-row component for the listing edit page. Generates ONE
 * caption per platform (Facebook / Instagram / LinkedIn) in the
 * agent's currently-active UI locale.
 *
 * PO directive 2026-05-07: agents post in one language — their own.
 * Generating 21 variants across 7 locales was overkill; the typical
 * workflow is "I'm a Polish agent with a Polish-language listing —
 * give me three posts (FB, IG, LinkedIn) in Polish." If the agent
 * later wants another language, they switch their UI locale and
 * click Regenerate.
 *
 * Each card has its own Regenerate button so a single weak variant
 * doesn't force re-running all three. Copy button puts the
 * ready-to-paste blob (body + AHO URL + hashtags) on the clipboard.
 */

const PLATFORMS = [
  { id: 'fb_feed', label: 'Facebook', emoji: '📘' },
  { id: 'ig_feed', label: 'Instagram', emoji: '📷' },
  { id: 'linkedin', label: 'LinkedIn', emoji: '💼' },
] as const;
type Platform = (typeof PLATFORMS)[number]['id'];

interface Caption {
  text: string;
  characterCount: number;
  hashtags: string[];
  readyToPaste: string;
}

type CellState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'done'; caption: Caption }
  | { status: 'error'; message: string };

interface Props {
  propertyId: string;
  /** Agent's active UI locale — drives which language the captions
   *  come back in. Pulled from the route's `[locale]` segment. */
  locale: Locale;
}

export function SocialGrid({ propertyId, locale }: Props) {
  const [, startTransition] = useTransition();
  const [cells, setCells] = useState<Record<Platform, CellState>>({
    fb_feed: { status: 'idle' },
    ig_feed: { status: 'idle' },
    linkedin: { status: 'idle' },
  });
  const [generating, setGenerating] = useState(false);
  const [copiedPlatform, setCopiedPlatform] = useState<Platform | null>(null);

  async function generateOne(platform: Platform): Promise<void> {
    setCells((c) => ({ ...c, [platform]: { status: 'pending' } }));
    try {
      const res = await fetch('/api/ai/copywriter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          locale,
          platform,
          count: 1,
        }),
      });
      const json = (await res.json()) as
        | { captions: Caption[] }
        | { error: string; details?: unknown; currentStatus?: string };
      if (!res.ok || !('captions' in json) || json.captions.length === 0) {
        const errMsg =
          'error' in json
            ? `${json.error}${'currentStatus' in json && json.currentStatus ? ` (status: ${json.currentStatus})` : ''}`
            : `HTTP ${res.status}`;
        setCells((c) => ({
          ...c,
          [platform]: { status: 'error', message: errMsg },
        }));
        return;
      }
      const caption = json.captions[0]!;
      setCells((c) => ({ ...c, [platform]: { status: 'done', caption } }));
    } catch (e) {
      setCells((c) => ({
        ...c,
        [platform]: {
          status: 'error',
          message: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }

  function generateAll(): void {
    setGenerating(true);
    setCopiedPlatform(null);
    void Promise.allSettled(
      PLATFORMS.map((p) => generateOne(p.id)),
    ).finally(() => {
      startTransition(() => setGenerating(false));
    });
  }

  async function copyCell(platform: Platform, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPlatform(platform);
      setTimeout(
        () => setCopiedPlatform((p) => (p === platform ? null : p)),
        1500,
      );
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
            Generate 3 social posts
          </h2>
          <p className="mt-1 text-sm text-helper">
            One caption per platform — Facebook, Instagram, LinkedIn — in your active language ({locale.toUpperCase()}). Tone: investment angle. Each post links back to this listing on AHO.
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

      <div className="grid gap-4 md:grid-cols-3">
        {PLATFORMS.map((p) => {
          const cell = cells[p.id];
          return (
            <PlatformCard
              key={p.id}
              platform={p}
              cell={cell}
              isCopied={copiedPlatform === p.id}
              onCopy={() =>
                cell.status === 'done'
                  ? copyCell(p.id, cell.caption.readyToPaste)
                  : undefined
              }
              onRegenerate={() => generateOne(p.id)}
            />
          );
        })}
      </div>
    </section>
  );
}

function PlatformCard({
  platform,
  cell,
  isCopied,
  onCopy,
  onRegenerate,
}: {
  platform: { id: Platform; label: string; emoji: string };
  cell: CellState;
  isCopied: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
}) {
  return (
    <article className="flex h-full flex-col rounded-card border border-border bg-surface p-4 dark:bg-surface-deep">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl">
            {platform.emoji}
          </span>
          <span className="text-sm font-semibold">{platform.label}</span>
        </div>
        {cell.status === 'done' && (
          <button
            type="button"
            onClick={onRegenerate}
            className="text-[11px] text-helper underline-offset-2 hover:underline"
            title="Regenerate just this card"
          >
            Regenerate
          </button>
        )}
      </header>

      {cell.status === 'idle' && (
        <p className="text-sm text-helper">
          Click <strong>Generate</strong> to fill this card.
        </p>
      )}

      {cell.status === 'pending' && (
        <div className="animate-pulse space-y-2">
          <div className="h-3 w-full rounded bg-border-strong/30" />
          <div className="h-3 w-5/6 rounded bg-border-strong/30" />
          <div className="h-3 w-3/4 rounded bg-border-strong/30" />
          <div className="h-3 w-2/3 rounded bg-border-strong/30" />
        </div>
      )}

      {cell.status === 'error' && (
        <p
          role="alert"
          className="rounded-card border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300"
        >
          {cell.message}
        </p>
      )}

      {cell.status === 'done' && (
        <div className="flex flex-1 flex-col gap-2">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {cell.caption.text}
          </p>
          {cell.caption.hashtags.length > 0 && (
            <p className="text-xs text-helper">
              {cell.caption.hashtags.join(' ')}
            </p>
          )}
          <div className="mt-auto flex items-center justify-between pt-2">
            <span className="text-[11px] text-helper">
              {cell.caption.characterCount} chars
            </span>
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-3 text-xs transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
            >
              {isCopied ? 'Copied ✓' : 'Copy post'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
