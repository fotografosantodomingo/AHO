'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  parseFeatures,
  type PropertyFeatures,
  type ParkingType,
  type HeatingFuel,
  type CoolingType,
  type WaterSource,
  type SewerType,
  type HoaFeePeriod,
  type PetPolicy,
} from '@/lib/listings/features';

export interface EditListingInitial {
  id: string;
  status: string;
  titleEn: string | null;
  titleEs: string | null;
  descriptionEn: string | null;
  descriptionEs: string | null;
  priceCents: number;
  currency: string;
  pricePeriod: 'total' | 'monthly' | 'weekly' | 'nightly' | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  lotSizeSqm: number | null;
  yearBuilt: number | null;
  addressLine: string | null;
  neighborhood: string | null;
  postalCode: string | null;
  displayAddress: boolean;
  amenities: string[];
  features: unknown;
}

interface Props {
  initial: EditListingInitial;
}

const PARKING_OPTIONS: ParkingType[] = ['garage', 'carport', 'street', 'lot', 'none'];
const HEATING_OPTIONS: HeatingFuel[] = ['electric', 'gas', 'oil', 'solar', 'wood', 'none'];
const COOLING_OPTIONS: CoolingType[] = ['central', 'split', 'window', 'evaporative', 'none'];
const WATER_OPTIONS: WaterSource[] = ['public', 'well', 'cistern', 'truck'];
const SEWER_OPTIONS: SewerType[] = ['public', 'septic', 'none'];
const HOA_PERIOD_OPTIONS: HoaFeePeriod[] = ['monthly', 'annual'];
const PET_POLICY_OPTIONS: PetPolicy[] = ['allowed', 'restricted', 'none'];

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';
const labelClass = 'block text-sm font-medium';

/**
 * Editable form for an existing listing. Posts to PATCH /api/listings/:id.
 *
 * Worldwide-shaped:
 *   - Currency is a free-form 3-letter code (USD/EUR/DOP/MXN/...) — no
 *     country-derived defaulting.
 *   - Areas in m² (no sqft conversion in v1).
 *   - HOA-equivalent labelled "community fee" with monthly/annual period.
 *
 * What we deliberately don't expose here:
 *   - city / country_code: would require slug regeneration; route accepts
 *     them but UI is locked.
 *   - transaction_type / property_type: SEO-impactful; locked at publish.
 *   - status: use the dedicated mark-sold / archive / publish buttons.
 *   - location / lat/lng: separate flow (deferred to v1.1 map editor).
 */
export function EditListingForm({ initial }: Props) {
  const t = useTranslations('editListing');
  const tFeat = useTranslations('property');
  const router = useRouter();

  const initialFeatures = parseFeatures(initial.features);

  // Core
  const [titleEn, setTitleEn] = useState(initial.titleEn ?? '');
  const [titleEs, setTitleEs] = useState(initial.titleEs ?? '');
  const [descEn, setDescEn] = useState(initial.descriptionEn ?? '');
  const [descEs, setDescEs] = useState(initial.descriptionEs ?? '');
  const [priceWhole, setPriceWhole] = useState(String(initial.priceCents / 100));
  const [currency, setCurrency] = useState(initial.currency);
  const [pricePeriod, setPricePeriod] = useState<string>(initial.pricePeriod ?? '');

  // Numbers
  const [bedrooms, setBedrooms] = useState(initial.bedrooms != null ? String(initial.bedrooms) : '');
  const [bathrooms, setBathrooms] = useState(initial.bathrooms != null ? String(initial.bathrooms) : '');
  const [areaSqm, setAreaSqm] = useState(initial.areaSqm != null ? String(initial.areaSqm) : '');
  const [lotSizeSqm, setLotSizeSqm] = useState(initial.lotSizeSqm != null ? String(initial.lotSizeSqm) : '');
  const [yearBuilt, setYearBuilt] = useState(initial.yearBuilt != null ? String(initial.yearBuilt) : '');

  // Location
  const [addressLine, setAddressLine] = useState(initial.addressLine ?? '');
  const [neighborhood, setNeighborhood] = useState(initial.neighborhood ?? '');
  const [postalCode, setPostalCode] = useState(initial.postalCode ?? '');
  const [displayAddress, setDisplayAddress] = useState(initial.displayAddress);

  // Amenities (chips)
  const [amenities, setAmenities] = useState<string[]>(initial.amenities ?? []);
  const [amenityDraft, setAmenityDraft] = useState('');

  // Features — typed
  const [features, setFeatures] = useState<PropertyFeatures>(initialFeatures);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  function setFeat<K extends keyof PropertyFeatures>(
    k: K,
    v: PropertyFeatures[K] | undefined,
  ) {
    setFeatures((prev) => {
      const next = { ...prev };
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
        delete next[k];
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (next as any)[k] = v;
      }
      return next;
    });
  }

  function nullify(value: string): string | null {
    const t = value.trim();
    return t.length === 0 ? null : t;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const priceCents = Math.round(parseFloat(priceWhole) * 100);
      if (!Number.isFinite(priceCents) || priceCents < 0) {
        setError(t('priceInvalid'));
        return;
      }

      const payload: Record<string, unknown> = {
        title_en: nullify(titleEn),
        title_es: nullify(titleEs),
        description_en: nullify(descEn),
        description_es: nullify(descEs),
        price_cents: priceCents,
        currency: currency.trim().toUpperCase(),
        price_period: pricePeriod || null,
        bedrooms: bedrooms.trim() === '' ? null : Number(bedrooms),
        bathrooms: bathrooms.trim() === '' ? null : Number(bathrooms),
        area_sqm: areaSqm.trim() === '' ? null : Number(areaSqm),
        lot_size_sqm: lotSizeSqm.trim() === '' ? null : Number(lotSizeSqm),
        year_built: yearBuilt.trim() === '' ? null : Number(yearBuilt),
        address_line: nullify(addressLine),
        neighborhood: nullify(neighborhood),
        postal_code: nullify(postalCode),
        display_address: displayAddress,
        amenities: amenities,
        features,
      };

      const res = await fetch(`/api/listings/${initial.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        errorCode?: string;
      };
      if (data.ok) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
        router.refresh();
      } else {
        setError(t(data.errorCode === 'forbidden' ? 'forbidden' : 'genericError'));
      }
    } catch {
      setError(t('genericError'));
    } finally {
      setPending(false);
    }
  }

  function addAmenity() {
    const v = amenityDraft.trim();
    if (v.length === 0 || v.length > 60) return;
    if (amenities.includes(v)) return;
    setAmenities([...amenities, v]);
    setAmenityDraft('');
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <Section title={t('sectionCore')}>
        <Field>
          <label htmlFor="el-title-en" className={labelClass}>
            {t('titleEn')}
          </label>
          <input
            id="el-title-en"
            type="text"
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            maxLength={120}
            className={inputClass}
          />
        </Field>
        <Field>
          <label htmlFor="el-title-es" className={labelClass}>
            {t('titleEs')}
          </label>
          <input
            id="el-title-es"
            type="text"
            value={titleEs}
            onChange={(e) => setTitleEs(e.target.value)}
            maxLength={120}
            className={inputClass}
          />
        </Field>
        <Field>
          <label htmlFor="el-desc-en" className={labelClass}>
            {t('descriptionEn')}
          </label>
          <textarea
            id="el-desc-en"
            value={descEn}
            onChange={(e) => setDescEn(e.target.value)}
            rows={6}
            maxLength={20000}
            className={inputClass}
          />
        </Field>
        <Field>
          <label htmlFor="el-desc-es" className={labelClass}>
            {t('descriptionEs')}
          </label>
          <textarea
            id="el-desc-es"
            value={descEs}
            onChange={(e) => setDescEs(e.target.value)}
            rows={6}
            maxLength={20000}
            className={inputClass}
          />
        </Field>
      </Section>

      <Section title={t('sectionPricing')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field>
            <label htmlFor="el-price" className={labelClass}>
              {t('price')}
            </label>
            <input
              id="el-price"
              type="number"
              step="0.01"
              min="0"
              value={priceWhole}
              onChange={(e) => setPriceWhole(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field>
            <label htmlFor="el-currency" className={labelClass}>
              {t('currency')}
            </label>
            <input
              id="el-currency"
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              minLength={3}
              className={inputClass}
              required
            />
          </Field>
          <Field>
            <label htmlFor="el-period" className={labelClass}>
              {t('pricePeriod')}
            </label>
            <select
              id="el-period"
              value={pricePeriod}
              onChange={(e) => setPricePeriod(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('pricePeriodNone')}</option>
              <option value="total">{t('periodTotal')}</option>
              <option value="monthly">{t('periodMonthly')}</option>
              <option value="weekly">{t('periodWeekly')}</option>
              <option value="nightly">{t('periodNightly')}</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title={t('sectionDimensions')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <NumberField id="el-bd" label={t('bedrooms')} value={bedrooms} onChange={setBedrooms} step="1" min="0" max="99" />
          <NumberField id="el-ba" label={t('bathrooms')} value={bathrooms} onChange={setBathrooms} step="0.5" min="0" max="99" />
          <NumberField id="el-ar" label={t('areaSqm')} value={areaSqm} onChange={setAreaSqm} step="0.01" min="0" />
          <NumberField id="el-lot" label={t('lotSqm')} value={lotSizeSqm} onChange={setLotSizeSqm} step="0.01" min="0" />
          <NumberField id="el-yb" label={t('yearBuilt')} value={yearBuilt} onChange={setYearBuilt} step="1" min="1500" max="2100" />
        </div>
      </Section>

      <Section title={t('sectionLocation')}>
        <Field>
          <label htmlFor="el-addr" className={labelClass}>
            {t('addressLine')}
          </label>
          <input
            id="el-addr"
            type="text"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            maxLength={200}
            className={inputClass}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <label htmlFor="el-nh" className={labelClass}>
              {t('neighborhood')}
            </label>
            <input
              id="el-nh"
              type="text"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              maxLength={120}
              className={inputClass}
            />
          </Field>
          <Field>
            <label htmlFor="el-pc" className={labelClass}>
              {t('postalCode')}
            </label>
            <input
              id="el-pc"
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              maxLength={20}
              className={inputClass}
            />
          </Field>
        </div>
        <Field>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={displayAddress}
              onChange={(e) => setDisplayAddress(e.target.checked)}
            />
            <span>{t('displayAddress')}</span>
          </label>
        </Field>
      </Section>

      <Section title={t('sectionAmenities')}>
        <Field>
          <span className={labelClass}>{t('amenitiesLabel')}</span>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {amenities.map((a) => (
              <li
                key={a}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs dark:bg-surface-dark"
              >
                <span>{a}</span>
                <button
                  type="button"
                  onClick={() => setAmenities(amenities.filter((x) => x !== a))}
                  className="text-helper hover:text-ink dark:hover:text-ink-inverse"
                  aria-label={`Remove ${a}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={amenityDraft}
              onChange={(e) => setAmenityDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addAmenity();
                }
              }}
              maxLength={60}
              placeholder={t('amenitiesPlaceholder')}
              className={inputClass}
            />
            <button
              type="button"
              onClick={addAmenity}
              className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              {t('amenitiesAdd')}
            </button>
          </div>
        </Field>
      </Section>

      <Section title={t('sectionFacts')}>
        <p className="text-xs text-helper">{t('factsExplainer')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberField
            id="el-pk"
            label={tFeat('factsField.parkingSpaces')}
            value={features.parkingSpaces != null ? String(features.parkingSpaces) : ''}
            onChange={(v) => setFeat('parkingSpaces', v.trim() === '' ? undefined : Number(v))}
            step="1"
            min="0"
          />
          <SelectField
            id="el-pkt"
            label={tFeat('factsField.parkingType')}
            value={features.parkingType ?? ''}
            options={PARKING_OPTIONS}
            translateOption={(o) => tFeat(`featuresEnum.parkingType.${o}`)}
            onChange={(v) => setFeat('parkingType', (v || undefined) as ParkingType | undefined)}
          />
          <SelectField
            id="el-ht"
            label={tFeat('factsField.heating')}
            value={features.heatingFuel ?? ''}
            options={HEATING_OPTIONS}
            translateOption={(o) => tFeat(`featuresEnum.heatingFuel.${o}`)}
            onChange={(v) => setFeat('heatingFuel', (v || undefined) as HeatingFuel | undefined)}
          />
          <SelectField
            id="el-cl"
            label={tFeat('factsField.cooling')}
            value={features.cooling ?? ''}
            options={COOLING_OPTIONS}
            translateOption={(o) => tFeat(`featuresEnum.cooling.${o}`)}
            onChange={(v) => setFeat('cooling', (v || undefined) as CoolingType | undefined)}
          />
          <SelectField
            id="el-wt"
            label={tFeat('factsField.water')}
            value={features.water ?? ''}
            options={WATER_OPTIONS}
            translateOption={(o) => tFeat(`featuresEnum.water.${o}`)}
            onChange={(v) => setFeat('water', (v || undefined) as WaterSource | undefined)}
          />
          <SelectField
            id="el-sw"
            label={tFeat('factsField.sewer')}
            value={features.sewer ?? ''}
            options={SEWER_OPTIONS}
            translateOption={(o) => tFeat(`featuresEnum.sewer.${o}`)}
            onChange={(v) => setFeat('sewer', (v || undefined) as SewerType | undefined)}
          />
          <SelectField
            id="el-pp"
            label={tFeat('factsField.petPolicy')}
            value={features.petPolicy ?? ''}
            options={PET_POLICY_OPTIONS}
            translateOption={(o) => tFeat(`featuresEnum.petPolicy.${o}`)}
            onChange={(v) => setFeat('petPolicy', (v || undefined) as PetPolicy | undefined)}
          />
          <NumberField
            id="el-st"
            label={tFeat('factsField.stories')}
            value={features.stories != null ? String(features.stories) : ''}
            onChange={(v) => setFeat('stories', v.trim() === '' ? undefined : Number(v))}
            step="1"
            min="0"
          />
          <NumberField
            id="el-lr"
            label={tFeat('factsField.lastRenovationYear')}
            value={features.lastRenovationYear != null ? String(features.lastRenovationYear) : ''}
            onChange={(v) =>
              setFeat('lastRenovationYear', v.trim() === '' ? undefined : Number(v))
            }
            step="1"
            min="1500"
            max="2100"
          />
          <NumberField
            id="el-hf"
            label={tFeat('factsField.communityFee')}
            value={features.hoaFeeCents != null ? String(features.hoaFeeCents / 100) : ''}
            onChange={(v) =>
              setFeat(
                'hoaFeeCents',
                v.trim() === '' ? undefined : Math.round(parseFloat(v) * 100),
              )
            }
            step="0.01"
            min="0"
          />
          <SelectField
            id="el-hp"
            label={tFeat('factsField.communityFeePeriod')}
            value={features.hoaFeePeriod ?? ''}
            options={HOA_PERIOD_OPTIONS}
            translateOption={(o) => tFeat(`featuresEnum.hoaFeePeriod.${o}`)}
            onChange={(v) => setFeat('hoaFeePeriod', (v || undefined) as HoaFeePeriod | undefined)}
          />
          <NumberField
            id="el-tax"
            label={tFeat('factsField.propertyTaxAnnual')}
            value={
              features.propertyTaxAnnualCents != null
                ? String(features.propertyTaxAnnualCents / 100)
                : ''
            }
            onChange={(v) =>
              setFeat(
                'propertyTaxAnnualCents',
                v.trim() === '' ? undefined : Math.round(parseFloat(v) * 100),
              )
            }
            step="0.01"
            min="0"
          />
        </div>
        <ToggleRow
          label={tFeat('factsField.gated')}
          value={features.gated}
          onChange={(b) => setFeat('gated', b)}
        />
        <ToggleRow
          label={tFeat('factsField.securitySystem')}
          value={features.securitySystem}
          onChange={(b) => setFeat('securitySystem', b)}
        />
        <ToggleRow
          label={tFeat('factsField.solar')}
          value={features.solar}
          onChange={(b) => setFeat('solar', b)}
        />
        <ToggleRow
          label={tFeat('factsField.publicTransit')}
          value={features.publicTransitNearby}
          onChange={(b) => setFeat('publicTransitNearby', b)}
        />
        <ToggleRow
          label={tFeat('factsField.furnished')}
          value={features.furnished}
          onChange={(b) => setFeat('furnished', b)}
        />
        <ToggleRow
          label={tFeat('factsField.balcony')}
          value={features.balcony}
          onChange={(b) => setFeat('balcony', b)}
        />
        <ToggleRow
          label={tFeat('factsField.terrace')}
          value={features.terrace}
          onChange={(b) => setFeat('terrace', b)}
        />
      </Section>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? t('saving') : t('save')}
        </button>
        {savedFlash && (
          <span className="text-sm text-emerald-700 dark:text-emerald-400">
            ✓ {t('saved')}
          </span>
        )}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep">
      <legend className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
        {title}
      </legend>
      <div className="space-y-3 pt-1">{children}</div>
    </fieldset>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function NumberField({
  id,
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <Field>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        min={min}
        max={max}
        className={inputClass}
      />
    </Field>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  translateOption,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  translateOption: (o: string) => string;
  onChange: (v: string) => void;
}) {
  return (
    <Field>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {translateOption(o)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
}) {
  // Tri-state: undefined (unset, not surfaced) → true → false → undefined.
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2">
      <span className="text-sm">{label}</span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange(value === true ? undefined : true)}
          className={`inline-flex h-7 items-center rounded-md border px-2 text-xs ${
            value === true
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400'
              : 'border-border-strong text-helper'
          }`}
        >
          ✓
        </button>
        <button
          type="button"
          onClick={() => onChange(value === false ? undefined : false)}
          className={`inline-flex h-7 items-center rounded-md border px-2 text-xs ${
            value === false
              ? 'border-danger bg-danger/10 text-danger'
              : 'border-border-strong text-helper'
          }`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
