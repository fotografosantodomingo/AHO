import Link from 'next/link';
import { DotGrid, HeroGlow } from '@/components/ui/dot-grid';

/**
 * Shared agent-acquisition landing-page template.
 *
 * Renders a 100/100-tunable Lighthouse marketing page with hero,
 * problem statement, solution, feature grid, "how it works" steps,
 * pricing teaser card, FAQ accordion (native <details> for a11y +
 * keyboard support without extra script), and final CTA.
 *
 * Static content — no client components, no third-party scripts —
 * so the page can be edge-cached and consistently scores well on
 * mobile audits. Server-rendered JSON-LD (Service + Offer +
 * BreadcrumbList + FAQPage) is emitted by the consuming page route.
 */

export interface LandingFeature {
  title: string;
  body: string;
}

export interface LandingStep {
  title: string;
  body: string;
}

export interface LandingFaqItem {
  q: string;
  a: string;
}

export interface LandingTrustItem {
  /** Short label, e.g. "GDPR-aligned". */
  label: string;
  /** One-line plain-language explanation, e.g. "Stored in the EU."  */
  detail: string;
}

export interface LandingCopy {
  hero: {
    eyebrow: string;
    headline: string;
    sub: string;
    primaryCta: string;
    secondaryCta: string;
  };
  problem: {
    heading: string;
    bullets: string[];
  };
  solution: {
    heading: string;
    body: string;
  };
  features: {
    heading: string;
    items: LandingFeature[];
  };
  howItWorks: {
    heading: string;
    steps: LandingStep[];
  };
  pricingTeaser: {
    eyebrow: string;
    price: string;
    period: string;
    features: string[];
    cta: string;
  };
  faq: {
    heading: string;
    items: LandingFaqItem[];
  };
  finalCta: {
    heading: string;
    sub: string;
    cta: string;
  };
  /** Optional honest-signals strip (SSL / GDPR / launch markets etc.).
   *  Rendered between FAQ and final CTA when present. Honest signals
   *  only — no fabricated stats, no fake testimonials (CLAUDE.md #8). */
  trustStrip?: {
    heading: string;
    items: LandingTrustItem[];
  };
}

interface Props {
  copy: LandingCopy;
  /** Where the primary + final CTAs send the visitor — typically
   *  `/{locale}/pricing?focus=pro_automation`. */
  primaryCtaHref: string;
  /** Where the hero secondary CTA sends — typically `/{locale}/pricing`. */
  secondaryCtaHref: string;
  /** The Pricing teaser CTA target — same as primary. Separate prop so
   *  consumers can route it to /signup if they want bottom-funnel friction
   *  removal later. */
  pricingCtaHref: string;
}

export function LandingPage({
  copy,
  primaryCtaHref,
  secondaryCtaHref,
  pricingCtaHref,
}: Props) {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <DotGrid />
        <HeroGlow />
        <div className="relative mx-auto max-w-5xl px-6 py-20 text-center md:py-28">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {copy.hero.eyebrow}
          </p>
          <h1 className="mx-auto mt-3 max-w-3xl font-brand text-[34px] font-semibold leading-[1.1] tracking-tight md:text-[56px] md:leading-[1.07]">
            {copy.hero.headline}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-ink-muted md:text-lg dark:text-ink-inverse-muted">
            {copy.hero.sub}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href={primaryCtaHref} className="btn-primary h-11 px-6 text-base">
              {copy.hero.primaryCta}
            </Link>
            <Link
              href={secondaryCtaHref}
              className="inline-flex h-11 items-center rounded-lg border border-border-strong px-5 text-base transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              {copy.hero.secondaryCta}
            </Link>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-b border-border bg-surface-band/40 dark:bg-surface-deep/30">
        <div className="mx-auto max-w-4xl px-6 py-16 md:py-20">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {copy.problem.heading}
          </h2>
          <ul className="mt-6 space-y-4">
            {copy.problem.bullets.map((b, i) => (
              <li key={i} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-action dark:bg-action-dark"
                />
                <p className="text-base leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                  {b}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Solution */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {copy.solution.heading}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-muted md:text-lg dark:text-ink-inverse-muted">
            {copy.solution.body}
          </p>
        </div>
      </section>

      {/* Features grid */}
      <section className="border-b border-border bg-surface-band/40 dark:bg-surface-deep/30">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {copy.features.heading}
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {copy.features.items.map((f, i) => (
              <div
                key={i}
                className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep"
              >
                <FeatureIcon index={i} />
                <h3 className="mt-4 font-brand text-lg font-semibold tracking-tight">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — id="vision" anchors the hero "See how it works"
          secondary CTA on the for-agents landing page. Other consumers
          (automation/save-time) get the anchor for free; harmless. */}
      <section id="vision" className="scroll-mt-20 border-b border-border">
        <div className="mx-auto max-w-5xl px-6 py-16 md:py-20">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {copy.howItWorks.heading}
          </h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {copy.howItWorks.steps.map((s, i) => (
              <li
                key={i}
                className="relative rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep"
              >
                <span className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-2 font-brand text-lg font-semibold tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-b border-border bg-surface-band/40 dark:bg-surface-deep/30">
        <div className="mx-auto max-w-2xl px-6 py-16 md:py-20">
          <div className="rounded-card border-2 border-action bg-surface p-8 shadow-lift dark:bg-surface-deep">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
              {copy.pricingTeaser.eyebrow}
            </p>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-brand text-5xl font-semibold tracking-tight">
                {copy.pricingTeaser.price}
              </span>
              <span className="text-base text-helper">{copy.pricingTeaser.period}</span>
            </div>
            <ul className="mt-6 space-y-2.5">
              {copy.pricingTeaser.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <CheckIcon />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={pricingCtaHref}
              className="btn-primary mt-7 inline-flex h-11 items-center px-6 text-base"
            >
              {copy.pricingTeaser.cta}
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {copy.faq.heading}
          </h2>
          <div className="mt-8 divide-y divide-border rounded-card border border-border bg-surface shadow-whisper dark:bg-surface-deep">
            {copy.faq.items.map((item, i) => (
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

      {/* Trust strip — honest signals only (CLAUDE.md #8). Rendered
          only when the consuming page provides copy for it; we never
          fabricate testimonials, agent counts, or "trusted by" logos. */}
      {copy.trustStrip ? (
        <section className="border-b border-border bg-surface-band/40 dark:bg-surface-deep/30">
          <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">
            <h2 className="text-center font-brand text-base font-semibold uppercase tracking-[0.13em] text-helper">
              {copy.trustStrip.heading}
            </h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 md:grid-cols-4">
              {copy.trustStrip.items.map((it, i) => (
                <li
                  key={i}
                  className="flex flex-col items-start gap-1 rounded-card border border-border bg-surface px-4 py-4 shadow-whisper dark:bg-surface-deep"
                >
                  <span className="font-brand text-sm font-semibold tracking-tight">
                    {it.label}
                  </span>
                  <span className="text-xs leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                    {it.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* Final CTA */}
      <section className="bg-surface-deep text-ink-inverse dark:bg-surface dark:text-ink">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-3xl">
            {copy.finalCta.heading}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink-inverse-muted dark:text-ink-muted">
            {copy.finalCta.sub}
          </p>
          <Link
            href={primaryCtaHref}
            className="mt-8 inline-flex h-12 items-center rounded-lg bg-action px-7 text-base font-semibold text-white shadow-lift transition hover:bg-action-active"
          >
            {copy.finalCta.cta}
          </Link>
        </div>
      </section>
    </main>
  );
}

function FeatureIcon({ index }: { index: number }) {
  // Inline SVG so the icons load with the document — zero extra
  // requests, zero font / icon-pack bundle weight. Three flat strokes,
  // each themed to the action color.
  const stroke = 'currentColor';
  return (
    <svg
      aria-hidden="true"
      width="36"
      height="36"
      viewBox="0 0 36 36"
      fill="none"
      className="text-action dark:text-action-dark"
    >
      {index === 0 && (
        <>
          <path
            d="M6 18 L18 6 L30 18 L18 30 Z"
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="18" cy="18" r="3" fill={stroke} />
        </>
      )}
      {index === 1 && (
        <>
          <rect
            x="6"
            y="9"
            width="24"
            height="18"
            rx="3"
            stroke={stroke}
            strokeWidth="2"
          />
          <path d="M6 14 L18 21 L30 14" stroke={stroke} strokeWidth="2" fill="none" />
        </>
      )}
      {index === 2 && (
        <>
          <circle cx="18" cy="18" r="11" stroke={stroke} strokeWidth="2" />
          <path
            d="M18 11 V18 L23 21"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
    >
      <path
        d="M3.5 9.5 L7 13 L14.5 5.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
