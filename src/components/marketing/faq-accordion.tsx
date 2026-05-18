/**
 * Native-`<details>` FAQ accordion. Zero JS — works without hydration,
 * keyboard-accessible by browser default. Reusable across landing
 * surfaces: pass a heading + Q/A array; the component renders one
 * styled card with a vertically-divided list of `<details>` rows.
 *
 * Per `landing-page.tsx` precedent: the closed marker is a chevron
 * `›` that rotates 90° via `group-open:` so the visual affordance
 * matches the rest of the marketing chrome. `summary` carries the
 * question; the answer paragraph reveals on open.
 */
export interface FaqItem {
  q: string;
  a: string;
}

export interface FaqAccordionProps {
  /** Section heading rendered above the accordion. */
  heading: string;
  /** Q+A pairs in display order. */
  items: FaqItem[];
  /** Optional id for the section heading — useful for in-page anchors. */
  headingId?: string;
}

export function FaqAccordion({
  heading,
  items,
  headingId = 'faq-heading',
}: FaqAccordionProps) {
  return (
    <section aria-labelledby={headingId} className="border-b border-border">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
        <h2
          id={headingId}
          className="font-brand text-2xl font-semibold tracking-tight md:text-3xl"
        >
          {heading}
        </h2>
        <div className="mt-8 divide-y divide-border rounded-card border border-border bg-surface shadow-whisper dark:divide-border-strong/30 dark:border-border-strong/40 dark:bg-surface-deep">
          {items.map((item, i) => (
            <details key={i} className="group px-5 py-4">
              <summary className="cursor-pointer list-none font-medium leading-snug marker:hidden">
                <span className="mr-2 inline-block text-helper transition-transform group-open:rotate-90">
                  ›
                </span>
                {item.q}
              </summary>
              <p className="mt-3 whitespace-pre-line pl-6 text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
