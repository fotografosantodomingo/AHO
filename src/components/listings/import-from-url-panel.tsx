'use client';

import { useState, type FormEvent } from 'react';
import { ListingForm } from './listing-form';
import { AMENITY_KEYS, type AmenityKey } from '@/lib/listings/amenities';
import type { CreateListingInput } from '@/lib/listings/listing-schema';

interface ImportedFacts {
  detectedLanguage: string | null;
  titleEn: string | null;
  titleEs: string | null;
  descriptionEn: string | null;
  descriptionEs: string | null;
  transactionType: 'sale' | 'rent' | 'short_term' | null;
  propertyType: string | null;
  priceCents: number | null;
  currency: string | null;
  pricePeriod: 'total' | 'monthly' | 'weekly' | 'nightly' | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  yearBuilt: number | null;
  city: string | null;
  countryCode: string | null;
  neighborhood: string | null;
  postalCode: string | null;
  amenities: string[];
  photoUrls: string[];
  sourceUrl: string;
}

interface Props {
  successRedirectBase: string;
}

/**
 * Day-5 panel that fronts the existing `<ListingForm>` with a
 * "Paste a URL — we'll fill the form for you" lane. The agent has
 * three modes:
 *
 *   (a) URL import — paste any portal URL, click Import, watch the
 *       form populate. ~5-12 seconds via the Anthropic-backed
 *       /api/listings/import endpoint.
 *   (b) Manual — click "Skip — fill manually" and the form renders
 *       empty exactly like the previous flow.
 *   (c) After (a), the agent can still edit any field before saving.
 *
 * We render `<ListingForm>` with a different React key once facts
 * arrive, so RHF's defaultValues actually take. Without the key
 * remount, RHF caches the first defaultValues set forever.
 */
export function ImportFromUrlPanel({ successRedirectBase }: Props) {
  const [mode, setMode] = useState<'choose' | 'manual' | 'imported'>('choose');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<ImportedFacts | null>(null);

  async function onImport(e: FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/listings/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      // Defensive — on rare upstream errors (worker timeout, CF Pages
      // 502 page, etc.) the response body is HTML, not JSON. Don't
      // let JSON.parse blow up; show a generic retry message instead.
      const raw = await res.text();
      type ApiResponse =
        | { facts: ImportedFacts }
        | { error: string; message?: string };
      let json: ApiResponse | null = null;
      try {
        json = JSON.parse(raw) as ApiResponse;
      } catch {
        setError(
          `Server didn't respond with JSON (HTTP ${res.status}). Try again, or pick a different URL — some portals (Zillow, Redfin, Realtor.com) block scrapers and we'll have a fix for that in a future update.`,
        );
        return;
      }
      if (!res.ok || !json || !('facts' in json)) {
        const errCode =
          json && 'error' in json && typeof json.error === 'string' ? json.error : null;
        const errMsg =
          json && 'message' in json && typeof json.message === 'string'
            ? json.message
            : null;
        setError(translateError(errCode, errMsg, res.status));
        return;
      }
      setFacts(json.facts);
      setMode('imported');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function translateError(code: string | null, raw: string | null | undefined, status: number): string {
    if (code === 'source_blocks_scraping') {
      return `That portal blocks scrapers (we hit their bot-protection). Big US portals — Zillow, Redfin, Realtor.com — and some EU ones use Cloudflare / AWS WAF / DataDome. We'll add residential-proxy support in a future release. For now, try otodom.pl, idealista.com, immobilienscout24.de, leboncoin.fr, an agency website, or fill the form manually.`;
    }
    if (code === 'invalid_url') return 'That URL looks malformed. Make sure it starts with https:// and points to a real listing page.';
    if (code === 'internal_url') return 'That URL points to a local network address — not allowed.';
    if (code === 'fetch_failed') return 'We couldn\'t fetch that page (timeout / 404 / oversized). Make sure the URL points to a public listing.';
    if (code === 'extract_failed') return 'We fetched the page but couldn\'t parse the facts from it. The portal\'s page layout might be unusual; try a different URL or fill the form manually.';
    return raw ?? `HTTP ${status}`;
  }

  if (mode === 'manual') {
    return <ListingForm successRedirectBase={successRedirectBase} />;
  }

  if (mode === 'imported' && facts) {
    const initial = factsToFormDefaults(facts);
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-800 dark:text-emerald-300">
          <p className="font-semibold">Imported from {hostnameOf(facts.sourceUrl)}.</p>
          <p className="mt-1">
            Review the pre-filled fields below and edit anything that needs adjusting. Photos found on the source are NOT auto-uploaded — use the photo uploader below the form once the listing is saved.
          </p>
          {facts.photoUrls.length > 0 && (
            <p className="mt-1">
              Found <strong>{facts.photoUrls.length}</strong> photos on the source — copy the URLs and re-upload to AHO after saving.
            </p>
          )}
        </div>
        <ListingForm
          // Force a fresh mount when facts change so RHF re-reads
          // defaultValues. Without the key, the second import would
          // keep the first import's data on the form.
          key={facts.sourceUrl}
          successRedirectBase={successRedirectBase}
          initialValues={initial}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={onImport}
        className="space-y-4 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep"
      >
        <div>
          <h2 className="font-brand text-xl font-semibold tracking-tight">
            Import from any portal
          </h2>
          <p className="mt-1 text-sm text-helper">
            Paste a URL from otodom, idealista, Zillow, rightmove, immobilienscout24, leboncoin — or any agency website. We&apos;ll fill the form for you in ~10 seconds. You review, edit, save.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.otodom.pl/pl/oferta/..."
            className="flex-1 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
            required
            maxLength={2000}
          />
          <button
            type="submit"
            disabled={loading || url.trim().length === 0}
            className="btn-primary inline-flex h-10 items-center px-6 disabled:opacity-50"
          >
            {loading ? 'Importing…' : 'Import'}
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </p>
        )}
      </form>

      <div className="text-center">
        <button
          type="button"
          onClick={() => setMode('manual')}
          className="text-sm text-helper underline-offset-2 hover:text-ink hover:underline dark:hover:text-ink-inverse"
        >
          Skip — fill the form manually
        </button>
      </div>
    </div>
  );
}

/**
 * Convert ImportedFacts → CreateListingInput-shaped defaults RHF
 * accepts. Notes:
 *   - titleEn / titleEs / descriptionEn / descriptionEs come pre-
 *     translated from the engine (Claude does the language pivot in
 *     the same call as fact extraction). PO bug 2026-05-07: before
 *     this fix we put the source text (e.g. Polish) into both EN
 *     and ES slots, leaving the form with two identical Polish
 *     blocks — useless for AHO's bilingual front end.
 *   - Free-text `amenities` are filtered to AHO's enumerated set;
 *     anything else is dropped (the Zod schema rejects rogue keys).
 *   - currency normalized to ISO 4217 uppercase.
 */
function factsToFormDefaults(facts: ImportedFacts): Partial<CreateListingInput> {
  const filteredAmenities: AmenityKey[] = [];
  const lowered = (facts.amenities ?? []).map((a) => a.toLowerCase());
  for (const key of AMENITY_KEYS) {
    if (lowered.some((a) => a.includes(key.replace('_', ' ')) || a.includes(key))) {
      filteredAmenities.push(key);
    }
  }

  return {
    title_en: facts.titleEn ?? null,
    title_es: facts.titleEs ?? null,
    description_en: facts.descriptionEn ?? null,
    description_es: facts.descriptionEs ?? null,
    transaction_type: facts.transactionType ?? 'sale',
    property_type: (facts.propertyType ?? 'apartment').toLowerCase(),
    price_cents: facts.priceCents ?? undefined,
    currency: (facts.currency ?? 'USD').toUpperCase(),
    price_period: facts.pricePeriod ?? null,
    bedrooms: facts.bedrooms ?? null,
    bathrooms: facts.bathrooms ?? null,
    area_sqm: facts.areaSqm ?? null,
    city: facts.city ?? '',
    country_code: (facts.countryCode ?? '').toUpperCase(),
    neighborhood: facts.neighborhood ?? null,
    postal_code: facts.postalCode ?? null,
    display_address: true,
    amenities: filteredAmenities,
  };
}

function hostnameOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}
