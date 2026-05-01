import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { formatPrice } from '@/lib/listings/format';
import {
  parseFeatures,
  computeSectionPresence,
  type PropertyFeatures,
} from '@/lib/listings/features';

interface Props {
  features: unknown;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  lotSizeSqm: number | null;
  yearBuilt: number | null;
  propertyType: string;
  amenities: string[];
  currency: string;
  neighborhood: string | null;
  city: string;
  stateRegion: string | null;
  locale: Locale;
}

/**
 * Facts & Features structured sections for /properties/[slug].
 *
 * Seven categories per the v1 spec: Interior / Property / Construction /
 * Utilities / Community / Location / Financial. All fields optional;
 * empty sections collapse entirely (no header rendered).
 *
 * Worldwide-shaped: every label uses a locale-neutral i18n key. No
 * country-specific aliases (no HOA → strata branching). Imperial unit
 * fallback (sqft alongside m²) is deferred to v1.5 — schema is m²-only
 * for now.
 *
 * The component is a Server Component so labels resolve at render time
 * via getTranslations. Fields display as label/value rows; multi-value
 * arrays (flooring, amenities) render as comma-separated chips.
 */
export async function FactsAndFeatures({
  features,
  bedrooms,
  bathrooms,
  areaSqm,
  lotSizeSqm,
  yearBuilt,
  propertyType,
  amenities,
  currency,
  neighborhood,
  city,
  stateRegion,
  locale,
}: Props) {
  const t = await getTranslations({ locale, namespace: 'property' });
  const f = parseFeatures(features);

  const presence = computeSectionPresence(
    f,
    bedrooms != null || bathrooms != null || areaSqm != null,
    lotSizeSqm != null || yearBuilt != null || !!propertyType,
  );

  // Nothing in any section → don't render the F&F block at all.
  const anySection =
    presence.interior ||
    presence.property ||
    presence.construction ||
    presence.utilities ||
    presence.community ||
    presence.location ||
    presence.financial;
  if (!anySection) return null;

  const numberFmt = new Intl.NumberFormat(locale === 'es' ? 'es-DO' : 'en-US');
  const fmtArea = (m2: number) => `${numberFmt.format(m2)} m²`;
  const fmtMeters = (m: number) =>
    m >= 1000
      ? `${numberFmt.format(Math.round(m / 100) / 10)} km`
      : `${numberFmt.format(m)} m`;

  const fmtMoney = (cents: number) => formatPrice(cents, currency, locale);

  const sectionClass =
    'rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep';
  const headingClass =
    'font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper';
  const rowsClass = 'mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2';

  return (
    <section
      aria-labelledby="ff-heading"
      className="mt-12 space-y-4"
    >
      <h2 id="ff-heading" className="font-brand text-xl font-semibold tracking-tight">
        {t('factsHeading')}
      </h2>

      {presence.interior && (
        <div className={sectionClass}>
          <p className={headingClass}>{t('factsSectionInterior')}</p>
          <dl className={rowsClass}>
            {bedrooms != null && (
              <Row label={t('factsField.bedrooms')} value={String(bedrooms)} />
            )}
            {bathrooms != null && (
              <Row label={t('factsField.bathrooms')} value={String(bathrooms)} />
            )}
            {areaSqm != null && (
              <Row label={t('factsField.area')} value={fmtArea(areaSqm)} />
            )}
            {f.parkingSpaces != null && (
              <Row
                label={t('factsField.parkingSpaces')}
                value={String(f.parkingSpaces)}
              />
            )}
            {f.parkingType && (
              <Row
                label={t('factsField.parkingType')}
                value={t(`featuresEnum.parkingType.${f.parkingType}`)}
              />
            )}
            {f.heatingFuel && (
              <Row
                label={t('factsField.heating')}
                value={t(`featuresEnum.heatingFuel.${f.heatingFuel}`)}
              />
            )}
            {f.cooling && (
              <Row
                label={t('factsField.cooling')}
                value={t(`featuresEnum.cooling.${f.cooling}`)}
              />
            )}
            {f.flooring && f.flooring.length > 0 && (
              <Row label={t('factsField.flooring')} value={f.flooring.join(', ')} />
            )}
            {f.laundryInUnit !== undefined && (
              <Row
                label={t('factsField.laundryInUnit')}
                value={f.laundryInUnit ? t('factsBool.yes') : t('factsBool.no')}
              />
            )}
            {f.furnished !== undefined && (
              <Row
                label={t('factsField.furnished')}
                value={f.furnished ? t('factsBool.yes') : t('factsBool.no')}
              />
            )}
            {f.balcony !== undefined && (
              <Row
                label={t('factsField.balcony')}
                value={f.balcony ? t('factsBool.yes') : t('factsBool.no')}
              />
            )}
            {f.terrace !== undefined && (
              <Row
                label={t('factsField.terrace')}
                value={f.terrace ? t('factsBool.yes') : t('factsBool.no')}
              />
            )}
          </dl>
          {amenities.length > 0 && (
            <>
              <p className="mt-4 text-xs font-medium text-helper">
                {t('factsField.amenities')}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {amenities.map((a) => (
                  <li
                    key={a}
                    className="inline-flex items-center rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs text-ink-muted dark:bg-surface-dark dark:text-ink-inverse-muted"
                  >
                    {a}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {presence.property && (
        <div className={sectionClass}>
          <p className={headingClass}>{t('factsSectionProperty')}</p>
          <dl className={rowsClass}>
            {propertyType && (
              <Row
                label={t('factsField.propertyType')}
                value={propertyType}
              />
            )}
            {lotSizeSqm != null && (
              <Row label={t('factsField.lotSize')} value={fmtArea(lotSizeSqm)} />
            )}
            {yearBuilt != null && (
              <Row label={t('factsField.yearBuilt')} value={String(yearBuilt)} />
            )}
            {f.stories != null && (
              <Row label={t('factsField.stories')} value={String(f.stories)} />
            )}
            {f.basement !== undefined && (
              <Row
                label={t('factsField.basement')}
                value={f.basement ? t('factsBool.yes') : t('factsBool.no')}
              />
            )}
            {f.petPolicy && (
              <Row
                label={t('factsField.petPolicy')}
                value={t(`featuresEnum.petPolicy.${f.petPolicy}`)}
              />
            )}
            {f.lastRenovationYear != null && (
              <Row
                label={t('factsField.lastRenovationYear')}
                value={String(f.lastRenovationYear)}
              />
            )}
          </dl>
        </div>
      )}

      {presence.construction && (
        <div className={sectionClass}>
          <p className={headingClass}>{t('factsSectionConstruction')}</p>
          <dl className={rowsClass}>
            {f.exteriorMaterial && (
              <Row
                label={t('factsField.exteriorMaterial')}
                value={f.exteriorMaterial}
              />
            )}
            {f.roofType && <Row label={t('factsField.roofType')} value={f.roofType} />}
          </dl>
        </div>
      )}

      {presence.utilities && (
        <div className={sectionClass}>
          <p className={headingClass}>{t('factsSectionUtilities')}</p>
          <dl className={rowsClass}>
            {f.water && (
              <Row
                label={t('factsField.water')}
                value={t(`featuresEnum.water.${f.water}`)}
              />
            )}
            {f.sewer && (
              <Row
                label={t('factsField.sewer')}
                value={t(`featuresEnum.sewer.${f.sewer}`)}
              />
            )}
            {f.solar !== undefined && (
              <Row
                label={t('factsField.solar')}
                value={f.solar ? t('factsBool.yes') : t('factsBool.no')}
              />
            )}
          </dl>
        </div>
      )}

      {presence.community && (
        <div className={sectionClass}>
          <p className={headingClass}>{t('factsSectionCommunity')}</p>
          <dl className={rowsClass}>
            {f.hoaFeeCents != null && (
              <Row
                label={t('factsField.communityFee')}
                value={`${fmtMoney(f.hoaFeeCents)}${
                  f.hoaFeePeriod
                    ? ` / ${t(`featuresEnum.hoaFeePeriod.${f.hoaFeePeriod}`)}`
                    : ''
                }`}
              />
            )}
            {f.gated !== undefined && (
              <Row
                label={t('factsField.gated')}
                value={f.gated ? t('factsBool.yes') : t('factsBool.no')}
              />
            )}
            {f.securitySystem !== undefined && (
              <Row
                label={t('factsField.securitySystem')}
                value={f.securitySystem ? t('factsBool.yes') : t('factsBool.no')}
              />
            )}
          </dl>
          {f.communityAmenities && f.communityAmenities.length > 0 && (
            <>
              <p className="mt-4 text-xs font-medium text-helper">
                {t('factsField.communityAmenities')}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {f.communityAmenities.map((a) => (
                  <li
                    key={a}
                    className="inline-flex items-center rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs text-ink-muted dark:bg-surface-dark dark:text-ink-inverse-muted"
                  >
                    {a}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {presence.location && (
        <div className={sectionClass}>
          <p className={headingClass}>{t('factsSectionLocation')}</p>
          <dl className={rowsClass}>
            {neighborhood && (
              <Row label={t('factsField.neighborhood')} value={neighborhood} />
            )}
            {(city || stateRegion) && (
              <Row
                label={t('factsField.cityRegion')}
                value={[city, stateRegion].filter(Boolean).join(', ')}
              />
            )}
            {f.schoolDistrict && (
              <Row
                label={t('factsField.schoolDistrict')}
                value={f.schoolDistrict}
              />
            )}
            {f.distanceToBeachMeters != null && (
              <Row
                label={t('factsField.distanceToBeach')}
                value={fmtMeters(f.distanceToBeachMeters)}
              />
            )}
            {f.publicTransitNearby !== undefined && (
              <Row
                label={t('factsField.publicTransit')}
                value={f.publicTransitNearby ? t('factsBool.yes') : t('factsBool.no')}
              />
            )}
          </dl>
        </div>
      )}

      {presence.financial && (
        <div className={sectionClass}>
          <p className={headingClass}>{t('factsSectionFinancial')}</p>
          <dl className={rowsClass}>
            {f.propertyTaxAnnualCents != null && (
              <Row
                label={t('factsField.propertyTaxAnnual')}
                value={fmtMoney(f.propertyTaxAnnualCents)}
              />
            )}
            {f.listingTerms && f.listingTerms.length > 0 && (
              <Row
                label={t('factsField.listingTerms')}
                value={f.listingTerms
                  .map((term) => t(`featuresEnum.listingTerm.${term}`))
                  .join(', ')}
              />
            )}
          </dl>
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5 last:border-b-0 sm:border-b-0">
      <dt className="text-xs uppercase tracking-wide text-helper">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

// Re-export for convenience so consumers can import the type from one place.
export type { PropertyFeatures };
