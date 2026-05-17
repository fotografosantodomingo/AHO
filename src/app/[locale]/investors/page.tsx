import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

export const runtime = 'edge';
export const dynamic = 'force-static';

/**
 * /[locale]/investors — fundraise-outreach landing.
 *
 * EN-only content (most VCs read English regardless of home country);
 * the route exists in all locales so a /pl/investors or /de/investors
 * link still resolves cleanly. noindex (we don't want this in search;
 * it's a cold-outreach landing where the agent reaches investors with
 * the URL, not the other way around).
 *
 * Lean on purpose: hero pitch, the wedge demo CTA, the moat, the
 * roadmap, the ask, contact. Visitor can scan in 30 seconds, click
 * one of two CTAs (try the demo / email me), and be done.
 *
 * Built 2026-05-17 as part of the fundraise toolkit. Full pitch
 * narrative lives in `docs/PITCH_OUTLINE.md`.
 */

interface PageParams {
  locale: string;
}

export const metadata: Metadata = {
  title: 'AHO — investor brief',
  description:
    'Real-estate-agent social-media automation in 7 languages. Live working product. 60-second demo.',
  robots: { index: false, follow: false },
};

export default async function InvestorsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const forAgentsHref = localePath(typedLocale, '/for-agents');

  return (
    <main className="bg-surface text-ink" style={{ colorScheme: 'light' }}>
      <div className="mx-auto max-w-3xl px-4 py-12 md:py-20">
        {/* Hero */}
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action">
          AHO · investor brief · 2026-05
        </p>
        <h1 className="mt-3 font-brand text-3xl font-semibold tracking-tight md:text-[44px] md:leading-[1.1]">
          A real estate agent&apos;s full social-media campaign — in 60 seconds, in 7 languages.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-ink-muted md:text-lg">
          Live working product at <a href="https://advertisehomes.online" className="text-action underline-offset-2 hover:underline">advertisehomes.online</a>. Paste any listing URL → get 9 multilingual captions + 3 branded graphics + a one-click publish grid to Facebook, Instagram, and LinkedIn. No signup. No card. No slideware.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={forAgentsHref}
            className="btn-primary inline-flex h-12 items-center px-6 text-base font-semibold"
          >
            Try the 60-second demo →
          </Link>
          <a
            href="mailto:info@advertisehomes.online?subject=Investor%20intro%20%E2%80%94%20AHO"
            className="inline-flex h-12 items-center rounded-lg border border-border-strong px-6 text-base font-semibold transition hover:bg-black/5"
          >
            Email me — 15 min call
          </a>
        </div>

        {/* The wedge */}
        <section className="mt-16 md:mt-20">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]">
            The wedge
          </h2>
          <p className="mt-3 text-base text-ink-muted md:text-lg">
            ~3M real-estate agents globally need to publish each listing across multiple social channels in multiple languages. Today&apos;s path: ~45 minutes per listing — write captions, format per platform, design graphics, post one platform at a time. Existing tools (kvCORE, Lofty, Followup Boss) are CRM-first; social-publishing is bolted on.
          </p>
          <p className="mt-3 text-base text-ink-muted md:text-lg">
            AHO collapses that to one paste + one click. The agent does no writing.
          </p>
        </section>

        {/* The moat */}
        <section className="mt-16">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]">
            What&apos;s defensible
          </h2>
          <p className="mt-3 text-base text-ink-muted md:text-lg">
            Per-market context engine: Polish drafts are written in Polish like a Polish agent would write — using <em>metraż</em>, <em>stan deweloperski</em>, <em>RTV/AGD</em>. German drafts use <em>Wohnfläche</em>, <em>Energiebedarf</em>, <em>Baujahr</em>. Italian uses <em>trilocale</em>. Plus per-market visual treatment: DE renders Bauhaus white-and-charcoal, IT renders Tuscan beige-and-terracotta.
          </p>
          <p className="mt-3 text-base text-ink-muted md:text-lg">
            Vanilla ChatGPT defaults to English-flavored output regardless of locale. We engineered around that — 7 distinct market prompts, 7 distinct visual palettes, all shipping today.
          </p>
        </section>

        {/* Why now */}
        <section className="mt-16">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]">
            Why now
          </h2>
          <ol className="mt-4 space-y-3 text-base text-ink-muted md:text-lg">
            <li>
              <strong className="text-ink">Cheap multimodal AI (2024-26)</strong> — Claude Haiku 4.5 makes the wedge economic at ~$0.10-0.30 per audit. Wasn&apos;t possible in 2022.
            </li>
            <li>
              <strong className="text-ink">Real-estate-agent SaaS at $99/mo became normal</strong> — incumbents shifted from $300+/mo enterprise to mid-market in 2023.
            </li>
            <li>
              <strong className="text-ink">Cloudflare Containers GA (2026)</strong> — per-video Reels render at $0.05 instead of $0.50 via external services. Unit economics for the Super Pro auto-video tier work.
            </li>
          </ol>
        </section>

        {/* 90-day plan */}
        <section className="mt-16">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]">
            The 90-day plan
          </h2>
          <ul className="mt-4 space-y-2 text-base text-ink-muted md:text-lg">
            <li>✅ <strong className="text-ink">Weeks 1-3</strong> — Free Audit + Creative Factory + 1-click publish grid (shipped 2026-05-17)</li>
            <li>✅ <strong className="text-ink">Week 6</strong> — Multilingual context engine in 7 languages (shipped early)</li>
            <li>🟡 <strong className="text-ink">Weeks 4-5</strong> — Auto-video Reels engine (in progress)</li>
            <li>🟡 <strong className="text-ink">Weeks 7-9</strong> — Push to FB Ads Manager + Google Ads Manager (paid ad draft creation)</li>
          </ul>
          <p className="mt-4 text-sm text-helper">
            Day-90 target: 30 paying agents, $5k MRR, Super Pro tier live, first white-label agency conversation.
          </p>
        </section>

        {/* Business model */}
        <section className="mt-16">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]">
            Pricing tiers
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-card border border-border bg-surface-muted/50 p-5">
              <p className="font-brand text-lg font-semibold">Agent — $29/mo</p>
              <p className="mt-1 text-sm text-ink-muted">List on AHO marketplace</p>
            </div>
            <div className="rounded-card border border-border bg-surface-muted/50 p-5">
              <p className="font-brand text-lg font-semibold">Pro Automation — $99/mo</p>
              <p className="mt-1 text-sm text-ink-muted">+ one-click multi-platform social publish (the wedge converts here)</p>
            </div>
            <div className="rounded-card border border-action/30 bg-action/5 p-5">
              <p className="font-brand text-lg font-semibold">Super Pro — $199-249/mo</p>
              <p className="mt-1 text-sm text-ink-muted">+ auto-video Reels + paid-ad draft creation in Ads Manager</p>
            </div>
            <div className="rounded-card border border-border bg-surface-muted/50 p-5">
              <p className="font-brand text-lg font-semibold">White-label / MLS — custom</p>
              <p className="mt-1 text-sm text-ink-muted">Agency + portal partners (post-PMF)</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-helper">
            Per-audit AI cost ~$0.30 (instrumented + logged). At 50 audits/mo per agent at $200 ARPU = ~92% gross margin.
          </p>
        </section>

        {/* The ask */}
        <section className="mt-16 rounded-card border border-action/30 bg-action/5 p-8">
          <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]">
            What we&apos;re raising for
          </h2>
          <p className="mt-3 text-base text-ink-muted md:text-lg">
            Stage: pre-seed / seed. Use of funds: engineering velocity (auto-video, Ads Manager push, AI customer-service agent for the agents themselves), soft-beta cohort expansion across PL + DR + ES + DE + IT + FR, Meta + Google + LinkedIn API approval costs.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="mailto:info@advertisehomes.online?subject=Investor%20intro%20%E2%80%94%20AHO"
              className="btn-primary inline-flex h-12 items-center px-6 text-base font-semibold"
            >
              info@advertisehomes.online
            </a>
            <Link
              href={forAgentsHref}
              className="inline-flex h-12 items-center rounded-lg border border-border-strong bg-surface px-6 text-base font-semibold transition hover:bg-black/5"
            >
              See the demo first →
            </Link>
          </div>
        </section>

        {/* Honest disclosures */}
        <section className="mt-12 text-sm text-helper">
          <p className="font-medium text-ink-muted">Honest pre-revenue disclosures:</p>
          <ul className="mt-2 space-y-1">
            <li>· Stripe currently in TEST mode; first paying customer target is day 30.</li>
            <li>· Meta App Review in submission; live publishing for agents other than the founder enables when it lands.</li>
            <li>· Solo founder + AI co-development (Claude Code). Capital efficiency is the bet.</li>
          </ul>
        </section>

        <hr className="my-12 border-border" />

        <p className="text-xs text-helper">
          Built by Michal Babula · Dominican Republic / Poland · solo founder · advertisehomes.online
        </p>
      </div>
    </main>
  );
}
