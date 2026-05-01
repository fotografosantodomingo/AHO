'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  buildAllCaptions,
  type SharePlatform,
  type ShareInput,
} from '@/lib/social/share-templates';

interface Props {
  /** Listing-level data threaded through to the caption builders. The
   *  page resolves locale-specific title + country display name + the
   *  absolute base URL (without UTM params) before passing them down. */
  share: ShareInput;
}

const PLATFORMS: SharePlatform[] = ['facebook', 'instagram', 'linkedin', 'whatsapp'];

const PLATFORM_LABEL: Record<SharePlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
};

/**
 * Manual social share — Phase 3 of the social-distribution spec. Opens a
 * modal with platform-specific pre-formatted captions + copy buttons + a
 * direct WhatsApp share-to-anyone deep-link.
 *
 * Available to ALL paid tiers (not gated on Pro Automation) since this is
 * the manual stopgap that runs while Phase 4+ OAuth + auto-posting waits
 * on Meta + LinkedIn app review. Pro Automation customers can still use
 * this until their auto-posting flow ships.
 */
export function ManualShareModule({ share }: Props) {
  const t = useTranslations('manualShare');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SharePlatform>('facebook');
  const [copiedAt, setCopiedAt] = useState<number | null>(null);

  const captions = useMemo(() => buildAllCaptions(share), [share]);

  // Esc closes the modal — small affordance that matches native dialogs.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAt(Date.now());
      // Reset the "Copied!" pill after 2s.
      setTimeout(() => setCopiedAt(null), 2000);
    } catch {
      // Older browsers — silently fall through; the user can still
      // select-all manually inside the textarea.
    }
  }

  const activeCaption = captions[active];

  return (
    <section className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {t('eyebrow')}
          </p>
          <h2 className="mt-1 font-brand text-lg font-semibold tracking-tight">
            {t('heading')}
          </h2>
          <p className="mt-1 text-sm text-ink-muted dark:text-ink-inverse-muted">
            {t('body')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setActive('facebook');
          }}
          className="btn-primary shrink-0"
        >
          {t('openButton')}
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-share-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex w-full max-w-2xl flex-col rounded-card border border-border bg-surface shadow-lg dark:bg-surface-deep"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2
                id="manual-share-heading"
                className="font-brand text-lg font-semibold tracking-tight"
              >
                {t('modalHeading')}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('close')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-helper transition hover:bg-black/5 hover:text-ink dark:hover:bg-white/10 dark:hover:text-ink-inverse"
              >
                ✕
              </button>
            </header>

            {/* Platform tabs */}
            <div
              role="tablist"
              aria-label={t('tablistLabel')}
              className="flex gap-1 border-b border-border px-4 pt-3"
            >
              {PLATFORMS.map((p) => {
                const isActive = active === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActive(p)}
                    className={
                      isActive
                        ? 'rounded-t-lg border-b-2 border-action px-3 py-2 text-sm font-semibold text-action dark:border-action-dark dark:text-action-dark'
                        : 'rounded-t-lg border-b-2 border-transparent px-3 py-2 text-sm text-helper transition hover:text-ink dark:hover:text-ink-inverse'
                    }
                  >
                    {PLATFORM_LABEL[p]}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 p-6">
              <p className="text-xs text-helper">
                {t(`tip.${active}` as 'tip.facebook')}
              </p>

              <textarea
                readOnly
                value={activeCaption}
                rows={10}
                aria-label={t('captionLabel')}
                className="w-full resize-none rounded-lg border border-border-strong bg-surface-muted p-3 font-mono text-[13px] leading-relaxed text-ink shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-dark dark:text-ink-inverse dark:focus:ring-action-dark"
                onFocus={(e) => e.currentTarget.select()}
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => copy(activeCaption)}
                  className="btn-primary"
                >
                  {copiedAt ? t('copied') : t('copyCaption')}
                </button>

                {active === 'whatsapp' && (
                  <a
                    href={captions.whatsappShareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary"
                  >
                    {t('openWhatsApp')}
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
