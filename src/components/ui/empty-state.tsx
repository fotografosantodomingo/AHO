import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** Heading line — short, ideally < 8 words. */
  heading: string;
  /** Body explanation — one or two sentences. */
  body?: string;
  /** Primary CTA. Use `<a>` or a Client-Component button as children. */
  primaryCta?: ReactNode;
  /** Secondary CTA. Same idea. */
  secondaryCta?: ReactNode;
  /** Icon glyph (emoji-free per project convention) — keep optional. */
  icon?: ReactNode;
  /** Padding scale. `sm` for inline/section; `md` for full-page; `lg` for hero. */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Centralized empty-state pattern. Replaces the hand-rolled empties
 * that were drifting visually across surfaces (agent profile, city
 * landing, search no-results, dashboard listings, saved-searches).
 *
 * Rules per the real-only-data project principle:
 *   - Empty must look like real emptiness, not a marketing page.
 *   - Dashed border so the surface reads as "placeholder, not chrome."
 *   - At most one or two CTAs; copy is honest about why it's empty.
 */
export function EmptyState({
  heading,
  body,
  primaryCta,
  secondaryCta,
  icon,
  size = 'md',
}: EmptyStateProps) {
  const padding =
    size === 'lg' ? 'py-16' : size === 'sm' ? 'py-8 px-6' : 'py-12 px-6';

  return (
    <div
      className={`rounded-card border border-dashed border-border-strong/60 bg-surface/30 text-center dark:bg-surface-deep/30 ${padding}`}
    >
      {icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-helper shadow-whisper dark:bg-surface-deep">
          {icon}
        </div>
      )}
      <h2 className="font-brand text-xl font-semibold tracking-tight">
        {heading}
      </h2>
      {body && (
        <p className="mx-auto mt-3 max-w-md text-sm text-helper">{body}</p>
      )}
      {(primaryCta || secondaryCta) && (
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          {primaryCta}
          {secondaryCta}
        </div>
      )}
    </div>
  );
}
