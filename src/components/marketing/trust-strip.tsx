/**
 * Inline trust-pill row used on the `/sell` identity-selection page.
 *
 * Renders a short pill row (3 items by default — "7 languages",
 * "Worldwide listings", "Meta Business Partner") with a small
 * paragraph below restating the real-listings policy from
 * CLAUDE.md hard rule #8 ("AHO does not seed demo listings or stock
 * photos. Every property is real.").
 *
 * Honest signals only — no fabricated testimonials, no agent counts,
 * no "trusted by" logos. Static + server-renderable.
 */
export interface TrustStripProps {
  /** Inline pills — typically 3 short labels. */
  pills: string[];
  /** One-line restatement of the no-fake-data policy. Optional but
   *  recommended for the /sell surface. */
  realOnly?: string;
}

export function TrustStrip({ pills, realOnly }: TrustStripProps) {
  return (
    <section
      aria-label="Trust signals"
      className="border-b border-border bg-surface-band/40 dark:bg-surface-deep/30"
    >
      <div className="mx-auto max-w-4xl px-6 py-12 md:py-14">
        <ul className="flex flex-wrap items-center justify-center gap-3">
          {pills.map((p, i) => (
            <li
              key={i}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-action dark:bg-action-dark"
              />
              <span className="font-medium tracking-tight">{p}</span>
            </li>
          ))}
        </ul>
        {realOnly ? (
          <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
            {realOnly}
          </p>
        ) : null}
      </div>
    </section>
  );
}
