'use client';

import { useState, type FormEvent } from 'react';

/**
 * Day-3 playground for the AI Copywriter (`/api/ai/copywriter`).
 * Lets the PO + soft-beta agents paste facts for any listing
 * (their AHO inventory or someone else's) and generate caption
 * variants per locale + platform. Output is one card per variant
 * with character count, hashtags, and a Copy button.
 *
 * Real listing-bound integration (where the Generate button is on
 * the dashboard's property card, pre-fills facts from the DB) is
 * the next step. This standalone form unblocks Day 3-4 testing
 * without that wiring.
 */

const PLATFORMS = [
  { id: 'fb_feed', label: 'Facebook feed' },
  { id: 'ig_feed', label: 'Instagram feed' },
  { id: 'ig_reel', label: 'Instagram Reel' },
  { id: 'linkedin', label: 'LinkedIn' },
] as const;

const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'pl', label: 'Polski' },
  { id: 'pt', label: 'Português' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'it', label: 'Italiano' },
] as const;

interface FactsPreset {
  id: string;
  label: string;
  title: string;
  transactionType: 'sale' | 'rent' | 'short_term';
  propertyType: string;
  bedrooms: string;
  bathrooms: string;
  areaSqm: string;
  city: string;
  country: string;
  priceLabel: string;
  amenities: string;
  description: string;
  positioningHint: string;
}

/**
 * Realistic example fact sets for testing the AI Copywriter across
 * different markets without inserting fake listings into the DB
 * (`aho_no_fake_data` rule). PO directive 2026-05-07: covers DR / PR /
 * USA / Madrid (existing example) so the locale-voice tuning gets
 * exercised on plausible inputs from each market.
 *
 * These are pure UI fixtures — never written to `properties`, never
 * indexable, never reachable via any URL.
 */
const PRESETS: FactsPreset[] = [
  {
    id: 'dr-puntacana-villa',
    label: '🇩🇴 Punta Cana villa (DR)',
    title: 'Beachfront villa with private pool — Cap Cana',
    transactionType: 'sale',
    propertyType: 'villa',
    bedrooms: '4',
    bathrooms: '4.5',
    areaSqm: '380',
    city: 'Punta Cana',
    country: 'Dominican Republic',
    priceLabel: '$850,000 USD',
    amenities:
      'private pool, direct beach access, ocean view, gated community, 2-car garage, outdoor terrace, BBQ area, 24/7 security',
    description:
      'Modern Caribbean villa in Cap Cana, 8 minutes from Punta Cana International Airport. Open-plan living with floor-to-ceiling glass overlooking the Atlantic. Private infinity pool flows toward the white-sand beach. Marble finishes throughout, fully equipped chef\'s kitchen, 4 ensuite bedrooms. Title insurance available. Perfect for owner-occupier or short-term rental investor (typical Cap Cana villas yield 6-9% annually).',
    positioningHint:
      'Investor + lifestyle buyer; high vacation rental yield, Title transfer in 30 days for foreigners',
  },
  {
    id: 'pr-sanjuan-condo',
    label: '🇵🇷 San Juan oceanfront condo (PR)',
    title: 'Oceanfront 2-bedroom condo — Condado',
    transactionType: 'sale',
    propertyType: 'condo',
    bedrooms: '2',
    bathrooms: '2',
    areaSqm: '110',
    city: 'San Juan',
    country: 'Puerto Rico',
    priceLabel: '$425,000 USD',
    amenities:
      'ocean view, hurricane-rated impact windows, covered parking, building gym, pool, 24/7 concierge, walking distance to Old San Juan',
    description:
      'Bright 2-bed condo on the 11th floor of a Condado oceanfront tower, fully renovated 2023. Wraparound balcony with unobstructed Atlantic views. Steps from Ashford Avenue restaurants, 10-minute walk into Old San Juan. Building amenities include rooftop pool, gym, and 24/7 doorman. Act 60 (formerly Act 22/20) tax incentive eligible for qualifying mainland buyers.',
    positioningHint:
      'Mainland US relocator on Act 60; or short-term rental investor (San Juan ADR ~$220 in season)',
  },
  {
    id: 'us-miami-apartment',
    label: '🇺🇸 Miami Beach high-rise (USA)',
    title: 'Brickell high-rise 3-bedroom — Bayfront views',
    transactionType: 'sale',
    propertyType: 'apartment',
    bedrooms: '3',
    bathrooms: '2',
    areaSqm: '145',
    city: 'Miami',
    country: 'United States',
    priceLabel: '$1,250,000 USD',
    amenities:
      'bayfront balcony, floor-to-ceiling windows, 2 covered parking spots, building gym, infinity pool, sauna, 24/7 doorman, valet, dog spa',
    description:
      'Corner 3-bed unit on the 38th floor of a Brickell tower with panoramic Biscayne Bay + downtown Miami views. Italian kitchen with Sub-Zero / Wolf appliances, Carrera marble baths, smart-home Lutron lighting. Building offers full-service amenities including spa, business center, and direct waterfront access. Walking distance to Brickell City Centre, Mary Brickell Village. HOA $1,800/mo includes everything except electricity.',
    positioningHint:
      'Latin-American relocator buying second home in US; high HNW investor; rental yield not the angle, lifestyle + visa is',
  },
  {
    id: 'es-madrid-salamanca',
    label: '🇪🇸 Madrid Salamanca apartment (ES)',
    title: 'Modern 3-bedroom apartment with rooftop terrace',
    transactionType: 'sale',
    propertyType: 'apartment',
    bedrooms: '3',
    bathrooms: '2',
    areaSqm: '95',
    city: 'Madrid',
    country: 'Spain',
    priceLabel: '€485,000',
    amenities:
      'rooftop terrace, parking, elevator, air conditioning, two balconies, fully renovated 2024',
    description:
      'Bright south-facing apartment in the Salamanca district, fully renovated 2024. Two balconies plus a private rooftop terrace with city views. Walking distance to Retiro Park and Serrano shopping.',
    positioningHint: 'Family + investor appeal; rental yield ~4.5% in this zone',
  },
  {
    id: 'pl-siemianowice-house',
    label: '🇵🇱 Siemianowice family house (PL)',
    title: 'Dom rodzinny z ogrodem — Siemianowice Śląskie',
    transactionType: 'sale',
    propertyType: 'house',
    bedrooms: '4',
    bathrooms: '2',
    areaSqm: '180',
    city: 'Siemianowice Śląskie',
    country: 'Poland',
    priceLabel: '720 000 PLN',
    amenities:
      'ogród 450 m², garaż 2-stanowiskowy, pompa ciepła, fotowoltaika, taras południowy, kominek, alarm',
    description:
      'Dom wolnostojący na osiedlu domów jednorodzinnych, 5 minut autem do A4 i 15 minut do centrum Katowic. Po remoncie z 2023, niskie koszty utrzymania dzięki pompie ciepła + 8 kW PV (rachunki ~200 zł/mc). Działka 450 m² z dojrzałym ogrodem. Idealne dla rodziny 2+2 — szkoła podstawowa 600m, przedszkole 400m, sklepy w zasięgu spaceru.',
    positioningHint:
      'Rodzina z dziećmi szkolno-przedszkolnymi; alternatywa dla mieszkania w Katowicach (mniejszy budżet, więcej przestrzeni)',
  },
];

interface Caption {
  text: string;
  characterCount: number;
  hashtags: string[];
}

interface ApiResponse {
  captions?: Caption[];
  meta?: { model: string; inputTokens: number; outputTokens: number };
  error?: string;
  details?: unknown;
}

export function CopywriterPlayground() {
  const [title, setTitle] = useState('Modern 3-bedroom apartment with rooftop terrace');
  const [transactionType, setTransactionType] =
    useState<'sale' | 'rent' | 'short_term'>('sale');
  const [propertyType, setPropertyType] = useState('apartment');
  const [bedrooms, setBedrooms] = useState('3');
  const [bathrooms, setBathrooms] = useState('2');
  const [areaSqm, setAreaSqm] = useState('95');
  const [city, setCity] = useState('Madrid');
  const [country, setCountry] = useState('Spain');
  const [priceLabel, setPriceLabel] = useState('€485,000');
  const [amenities, setAmenities] = useState('rooftop terrace, parking, elevator, air conditioning');
  const [description, setDescription] = useState(
    'Bright south-facing apartment in the Salamanca district, fully renovated 2024. Two balconies plus a private rooftop terrace with city views. Walking distance to Retiro Park and Serrano shopping.',
  );
  const [positioningHint, setPositioningHint] = useState(
    'Family + investor appeal; rental yield ~4.5% in this zone',
  );

  const [locale, setLocale] = useState<(typeof LOCALES)[number]['id']>('en');
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]['id']>('fb_feed');
  const [count, setCount] = useState('3');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Caption[] | null>(null);
  const [meta, setMeta] = useState<ApiResponse['meta'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ai/copywriter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locale,
          platform,
          count: Math.max(1, Math.min(6, Number(count) || 3)),
          facts: {
            title,
            transactionType,
            propertyType,
            bedrooms: bedrooms.trim() ? Number(bedrooms) : null,
            bathrooms: bathrooms.trim() ? Number(bathrooms) : null,
            areaSqm: areaSqm.trim() ? Number(areaSqm) : null,
            city,
            countryDisplay: country,
            priceLabel,
            amenities: amenities
              .split(',')
              .map((a) => a.trim())
              .filter((a) => a.length > 0),
            description: description.trim() || null,
            positioningHint: positioningHint.trim() || null,
          },
        }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(json.captions ?? []);
      setMeta(json.meta ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function loadPreset(presetId: string): void {
    const p = PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setTitle(p.title);
    setTransactionType(p.transactionType);
    setPropertyType(p.propertyType);
    setBedrooms(p.bedrooms);
    setBathrooms(p.bathrooms);
    setAreaSqm(p.areaSqm);
    setCity(p.city);
    setCountry(p.country);
    setPriceLabel(p.priceLabel);
    setAmenities(p.amenities);
    setDescription(p.description);
    setPositioningHint(p.positioningHint);
    // Clear results so the user knows the previous run isn't from
    // these new facts.
    setResult(null);
    setMeta(null);
    setError(null);
  }

  async function copyCaption(text: string, hashtags: string[], idx: number): Promise<void> {
    const blob = hashtags.length > 0 ? `${text}\n\n${hashtags.join(' ')}` : text;
    try {
      await navigator.clipboard.writeText(blob);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* clipboard refused; ignore */
    }
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={onSubmit}
        className="space-y-6 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep"
      >
        <header className="space-y-3">
          <div>
            <h2 className="font-brand text-xl font-semibold tracking-tight">
              Property facts
            </h2>
            <p className="mt-1 text-sm text-helper">
              Fill these in (or load an example) and pick a locale + platform. We&apos;ll generate variant captions tuned for that combo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-helper">
              Load example:
            </span>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => loadPreset(p.id)}
                className="inline-flex h-8 items-center rounded-full border border-border-strong bg-surface px-3 text-xs transition hover:bg-action/5 hover:text-action dark:bg-surface-deep dark:hover:bg-action-dark/10 dark:hover:text-action-dark"
              >
                {p.label}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              maxLength={300}
            />
          </Field>
          <Field label="Property type">
            <input
              type="text"
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              className={inputClass}
              maxLength={60}
            />
          </Field>
          <Field label="Transaction">
            <select
              value={transactionType}
              onChange={(e) =>
                setTransactionType(e.target.value as typeof transactionType)
              }
              className={inputClass}
            >
              <option value="sale">For sale</option>
              <option value="rent">For rent</option>
              <option value="short_term">Short-term rental</option>
            </select>
          </Field>
          <Field label="Price (formatted)">
            <input
              type="text"
              value={priceLabel}
              onChange={(e) => setPriceLabel(e.target.value)}
              className={inputClass}
              maxLength={60}
              placeholder="€485,000"
            />
          </Field>
          <Field label="Bedrooms">
            <input
              type="number"
              value={bedrooms}
              onChange={(e) => setBedrooms(e.target.value)}
              className={inputClass}
              min={0}
              max={20}
            />
          </Field>
          <Field label="Bathrooms">
            <input
              type="number"
              value={bathrooms}
              onChange={(e) => setBathrooms(e.target.value)}
              className={inputClass}
              min={0}
              max={20}
              step="0.5"
            />
          </Field>
          <Field label="Area (m²)">
            <input
              type="number"
              value={areaSqm}
              onChange={(e) => setAreaSqm(e.target.value)}
              className={inputClass}
              min={0}
              step="0.1"
            />
          </Field>
          <Field label="City">
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputClass}
              maxLength={120}
            />
          </Field>
          <Field label="Country">
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className={inputClass}
              maxLength={120}
            />
          </Field>
          <Field label="Amenities (comma-separated)">
            <input
              type="text"
              value={amenities}
              onChange={(e) => setAmenities(e.target.value)}
              className={inputClass}
              placeholder="parking, balcony, pool"
            />
          </Field>
        </div>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={inputClass}
            maxLength={4000}
          />
        </Field>

        <Field label="Positioning hint (optional — who's it for / what's the angle)">
          <input
            type="text"
            value={positioningHint}
            onChange={(e) => setPositioningHint(e.target.value)}
            className={inputClass}
            maxLength={400}
            placeholder="Family + investor appeal; ~4.5% rental yield"
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Locale">
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as typeof locale)}
              className={inputClass}
            >
              {LOCALES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Platform">
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as typeof platform)}
              className={inputClass}
            >
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Variants">
            <input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              min={1}
              max={6}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="btn-primary inline-flex h-11 items-center px-6 disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Generate captions'}
          </button>
          {meta && (
            <span className="text-xs text-helper">
              {meta.model} · {meta.inputTokens} in / {meta.outputTokens} out tokens
            </span>
          )}
        </div>
      </form>

      {error && (
        <p
          role="alert"
          className="rounded-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {result && result.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-brand text-xl font-semibold tracking-tight">
            {result.length} variants
          </h2>
          {result.map((c, i) => (
            <article
              key={i}
              className="space-y-3 rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-helper">
                  Variant {i + 1} · {c.characterCount} chars
                </p>
                <button
                  type="button"
                  onClick={() => copyCaption(c.text, c.hashtags, i)}
                  className="inline-flex h-8 items-center rounded-lg border border-border-strong bg-surface px-3 text-xs transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
                >
                  {copiedIdx === i ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <p className="whitespace-pre-wrap text-base leading-relaxed">{c.text}</p>
              {c.hashtags.length > 0 && (
                <p className="text-sm text-helper">{c.hashtags.join(' ')}</p>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
