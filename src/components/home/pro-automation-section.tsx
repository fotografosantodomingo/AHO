import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

interface Props {
  /** Path to /pricing in the active locale (computed in page.tsx). */
  pricingPath: string;
  /** next-intl namespace `home`'s locale, threaded so the server-side
   *  translator stays in sync with the rest of the page. */
  locale: string;
}

export async function ProAutomationSection({ pricingPath, locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'home' });

  return (
    <section className="bg-surface-band text-ink-inverse">
      <div className="section-pad">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-ink-inverse-muted">
          {t('proSocialEyebrow')}
        </p>
        <h2 className="mt-4 max-w-3xl font-brand text-3xl font-semibold tracking-tight md:text-[44px] md:leading-[1.12]">
          {t('proSocialHeading')}
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-inverse-muted">
          {t('proSocialBody')}
        </p>

        {/* Visual: AHO logo center + 3 platform pills connected by hairlines.
            Pure CSS — no SVG asset shipping needed; the band's forest-green
            background pulls the focus to the platform tokens. */}
        <div className="mt-12 flex flex-wrap items-center gap-3 md:gap-4">
          {[
            'Facebook',
            'Instagram',
            'LinkedIn',
          ].map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-2 rounded-full border border-ink-inverse/15 bg-white/5 px-4 py-2 text-sm font-medium tracking-tight text-ink-inverse backdrop-blur-sm"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-ink-inverse"
              />
              {label}
            </span>
          ))}
          <span
            aria-hidden="true"
            className="hidden h-px w-12 bg-ink-inverse/20 md:inline-block"
          />
          <span className="inline-flex items-center rounded-full border border-ink-inverse/30 bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-ink-inverse backdrop-blur-sm">
            AHO
          </span>
        </div>

        <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
          {([1, 2, 3] as const).map((n) => (
            <li
              key={n}
              className="rounded-card border border-ink-inverse/12 bg-white/5 p-6 backdrop-blur-sm"
            >
              <h3 className="font-brand text-lg font-semibold tracking-tight text-ink-inverse">
                {t(`proSocialFeat${n}Title` as 'proSocialFeat1Title')}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-inverse-muted">
                {t(`proSocialFeat${n}Body` as 'proSocialFeat1Body')}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-10">
          <Link
            href={`${pricingPath}?focus=pro_automation`}
            className="inline-flex items-center gap-2 rounded-lg bg-ink-inverse px-5 py-3 text-sm font-semibold text-surface-band shadow-lift transition hover:opacity-95"
          >
            {t('proSocialCta')} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
