/**
 * Two-column feature-comparison table — used on /sell to compare the
 * private $5 tier against the agent $29-$99/mo tier. Reusable: accepts
 * column headers + rows as props so /pricing can render the same
 * primitive with different columns later.
 *
 * Pure server component (no client JS). Renders as a real `<table>` on
 * desktop and a stacked card list on mobile so the comparison stays
 * scannable on small screens without horizontal scrolling.
 *
 * The "value" cells accept plain strings. If a cell is empty, the row
 * still renders so the table doesn't fragment — pass a dash (`—`) or
 * `false` to express "not included" explicitly.
 */
import type { ReactNode } from 'react';
export interface TierComparisonRow {
  /** Left-column label (e.g. "AI captions in 7 languages"). */
  feature: string;
  /** First plan's value for this row — string or boolean. */
  private: string | boolean;
  /** Second plan's value for this row — string or boolean. */
  agent: string | boolean;
}

export interface TierComparisonProps {
  /** Section heading rendered above the table. */
  heading: string;
  /** Header label for the first plan column (e.g. "Private $5"). */
  colPrivate: string;
  /** Header label for the second plan column (e.g. "Agent $29-99/mo"). */
  colAgent: string;
  /** Feature rows in display order. */
  rows: TierComparisonRow[];
}

function renderCell(v: string | boolean): ReactNode {
  if (v === true) {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <CheckIcon />
        <span className="sr-only">Included</span>
      </span>
    );
  }
  if (v === false) {
    return (
      <span
        aria-label="Not included"
        className="text-helper"
      >
        —
      </span>
    );
  }
  return <span className="text-sm">{v}</span>;
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="text-action dark:text-action-dark"
    >
      <path
        d="M13 4L6 11L3 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TierComparison({
  heading,
  colPrivate,
  colAgent,
  rows,
}: TierComparisonProps) {
  return (
    <section
      aria-labelledby="tier-comparison-heading"
      className="border-b border-border"
    >
      <div className="mx-auto max-w-5xl px-6 py-16 md:py-20">
        <h2
          id="tier-comparison-heading"
          className="font-brand text-2xl font-semibold tracking-tight md:text-3xl"
        >
          {heading}
        </h2>

        {/* Desktop: real table */}
        <div className="mt-8 hidden overflow-hidden rounded-card border border-border bg-surface shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:block">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-surface-band/40 dark:bg-surface-deep/40">
                <th
                  scope="col"
                  className="px-5 py-4 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
                >
                  Feature
                </th>
                <th
                  scope="col"
                  className="px-5 py-4 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
                >
                  {colPrivate}
                </th>
                <th
                  scope="col"
                  className="px-5 py-4 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
                >
                  {colAgent}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-border last:border-b-0 dark:border-border-strong/30"
                >
                  <th
                    scope="row"
                    className="px-5 py-4 align-top font-medium tracking-tight"
                  >
                    {row.feature}
                  </th>
                  <td className="px-5 py-4 align-top text-ink-muted dark:text-ink-inverse-muted">
                    {renderCell(row.private)}
                  </td>
                  <td className="px-5 py-4 align-top text-ink-muted dark:text-ink-inverse-muted">
                    {renderCell(row.agent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: stacked card list */}
        <ul className="mt-8 space-y-3 md:hidden">
          {rows.map((row, i) => (
            <li
              key={i}
              className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep"
            >
              <p className="font-medium tracking-tight">{row.feature}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="font-brand text-[11px] font-semibold uppercase tracking-[0.13em] text-helper">
                    {colPrivate}
                  </dt>
                  <dd className="mt-1 text-ink-muted dark:text-ink-inverse-muted">
                    {renderCell(row.private)}
                  </dd>
                </div>
                <div>
                  <dt className="font-brand text-[11px] font-semibold uppercase tracking-[0.13em] text-helper">
                    {colAgent}
                  </dt>
                  <dd className="mt-1 text-ink-muted dark:text-ink-inverse-muted">
                    {renderCell(row.agent)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
