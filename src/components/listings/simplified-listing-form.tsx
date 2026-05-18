'use client';

import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  CreateListingSchema,
  type CreateListingInput,
} from '@/lib/listings/listing-schema';
import { getAllCountries, getCountryName } from '@/lib/i18n/countries';
import type { Locale } from '@/i18n/config';
import { uploadOneFile } from '@/lib/listings/client-upload';
import { buildPhotoAlt, type TransactionType } from '@/lib/listings/photo-seo';

/**
 * Simplified listing form for the $5 private-owner flow.
 *
 * A trimmed subset of `<ListingForm>` (src/components/listings/listing-form.tsx).
 * Differences:
 *
 *   - 25 photos max instead of 30.
 *   - One social-channel pick (Facebook OR Instagram) instead of the
 *     agents' multi-select.
 *   - No lead-routing/agent CRM fields, no multi-channel toggle, no
 *     auto-renewal toggle, no featured/sticky placement.
 *   - One submit path ("Publish"). Private owners skip the draft step
 *     — they paid, they want it live. The server endpoint sets
 *     `status='active'` directly.
 *   - Submits to `/api/sell/private/listings` with `purchaseId` so the
 *     endpoint can validate ownership of the paid-but-unconsumed
 *     `listing_purchases` row, create the per-user org if missing, and
 *     INSERT the property with `published_via='private_purchase'` +
 *     `expires_at` carried over from the purchase row.
 *
 * No localStorage draft restore (the $5 paid flow is short and the
 * gate page requires a live `listing_purchases` row anyway — a stale
 * draft from a previous purchase would just confuse the UX).
 */

const MAX_STAGED_IMAGES = 25;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

interface StagedFile {
  clientId: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'confirmed' | 'error';
  errorCode?: string;
}

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

const labelClass = 'block text-sm font-medium';

const PROPERTY_TYPES = [
  'apartment',
  'house',
  'condo',
  'villa',
  'land',
  'commercial',
] as const;

const CURRENCIES = ['USD', 'DOP', 'EUR'] as const;

const SOCIAL_CHANNELS = ['facebook', 'instagram'] as const;
type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

export interface SimplifiedListingFormProps {
  /** The paid `listing_purchases.id` for this buyer — supplied by the
   *  server gate page after it verified the row is paid + unconsumed. */
  purchaseId: string;
  /** Locale-prefixed properties detail base (e.g. `/en/properties`)
   *  for the post-create redirect. */
  successRedirectBase: string;
}

export function SimplifiedListingForm({
  purchaseId,
  successRedirectBase,
}: SimplifiedListingFormProps) {
  const t = useTranslations('listingForm');
  const tSell = useTranslations('sellPrivate');
  const tUploader = useTranslations('imageUploader');
  const locale = useLocale();
  const router = useRouter();

  const [serverError, setServerError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'creating' | 'uploading'>('idle');
  const [socialChannel, setSocialChannel] = useState<SocialChannel>('facebook');

  const countryOptions = useMemo(
    () => getAllCountries(locale as Locale),
    [locale],
  );

  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const remaining = MAX_STAGED_IMAGES - stagedFiles.length;
    const accepted: StagedFile[] = [];
    for (const f of arr) {
      if (accepted.length >= remaining) break;
      if (!ACCEPTED_TYPES.includes(f.type)) continue;
      if (f.size > MAX_FILE_BYTES) continue;
      accepted.push({
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        status: 'pending',
      });
    }
    if (accepted.length === 0) return;
    setStagedFiles((prev) => [...prev, ...accepted]);
  }

  function removeStaged(clientId: string) {
    setStagedFiles((prev) => {
      const target = prev.find((s) => s.clientId === clientId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.clientId !== clientId);
    });
  }

  const [transactionType, setTransactionType] = useState<
    'sale' | 'rent' | 'short_term'
  >('sale');
  const isRental = transactionType === 'rent' || transactionType === 'short_term';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateListingInput>({
    resolver: zodResolver(CreateListingSchema),
    defaultValues: {
      transaction_type: 'sale',
      property_type: 'apartment',
      currency: 'USD',
      display_address: true,
    },
  });

  async function submit(values: CreateListingInput) {
    setServerError(null);
    const priceCents = Math.round(Number(values.price_cents) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      setServerError('priceRequired');
      return;
    }
    const enriched: CreateListingInput = {
      ...values,
      price_cents: priceCents,
      price_period: isRental ? values.price_period ?? null : null,
      amenities: [],
    };

    // Step 1: create the active listing on the private endpoint.
    setPhase('creating');
    let propertyId: string;
    let propertySlug: string | null = null;
    let propertyShortId: string | null = null;
    try {
      const res = await fetch('/api/sell/private/listings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseId,
          socialChannel,
          listing: enriched,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        slug?: string;
        shortId?: string;
        errorCode?: string;
      };
      if (!res.ok || !body.ok || !body.id) {
        setPhase('idle');
        setServerError(body.errorCode ?? `http_${res.status}`);
        return;
      }
      propertyId = body.id;
      propertySlug = body.slug ?? null;
      propertyShortId = body.shortId ?? null;
    } catch (e) {
      setPhase('idle');
      setServerError(e instanceof Error ? e.message : 'network_error');
      return;
    }

    // Step 2: upload staged photos sequentially. The detail page is
    // already addressable at the slug-shortId URL; partial-upload
    // failures still surface the listing, just with fewer photos.
    if (stagedFiles.length > 0) {
      setPhase('uploading');
      const titleForEn = (enriched.title_en || enriched.title_es || 'listing').trim();
      const titleForEs = (enriched.title_es || enriched.title_en || 'listing').trim();
      const countryDisplayEn = getCountryName(enriched.country_code, 'en');
      const countryDisplayEs = getCountryName(enriched.country_code, 'es');
      const totalAfterBatch = stagedFiles.length;
      for (let i = 0; i < stagedFiles.length; i++) {
        const sf = stagedFiles[i]!;
        const positionIndex = i + 1;
        const altTextEn = buildPhotoAlt({
          title: titleForEn,
          transactionType: enriched.transaction_type as TransactionType,
          propertyType: enriched.property_type,
          city: enriched.city,
          countryDisplay: countryDisplayEn,
          position: positionIndex,
          total: totalAfterBatch,
          locale: 'en',
        });
        const altTextEs = buildPhotoAlt({
          title: titleForEs,
          transactionType: enriched.transaction_type as TransactionType,
          propertyType: enriched.property_type,
          city: enriched.city,
          countryDisplay: countryDisplayEs,
          position: positionIndex,
          total: totalAfterBatch,
          locale: 'es',
        });
        await uploadOneFile({
          propertyId,
          file: sf.file,
          altTextEn,
          altTextEs,
          onStatus: (status, errorCode) => {
            setStagedFiles((prev) =>
              prev.map((s) =>
                s.clientId === sf.clientId ? { ...s, status, errorCode } : s,
              ),
            );
          },
        });
      }
    }

    // Success — redirect to the public listing page.
    setPhase('idle');
    const tail = propertySlug && propertyShortId
      ? `${propertySlug}-${propertyShortId}`
      : propertyId;
    router.push(`${successRedirectBase}/${tail}`);
    router.refresh();
  }

  const onSubmit = handleSubmit((values) => submit(values));
  const busy = isSubmitting || phase !== 'idle';
  const totalSlots = stagedFiles.filter((s) => s.status !== 'error').length;

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <Section heading={t('sectionBasics')}>
        <Field>
          <label htmlFor="transaction_type" className={labelClass}>
            {t('transactionType')}
          </label>
          <select
            id="transaction_type"
            {...register('transaction_type', {
              onChange: (e) =>
                setTransactionType(e.target.value as 'sale' | 'rent' | 'short_term'),
            })}
            className={inputClass}
          >
            <option value="sale">{locale === 'es' ? 'Venta' : 'Sale'}</option>
            <option value="rent">{locale === 'es' ? 'Alquiler' : 'Rent'}</option>
            <option value="short_term">
              {locale === 'es' ? 'Alquiler temporal' : 'Short-term rental'}
            </option>
          </select>
        </Field>

        <Field>
          <label htmlFor="property_type" className={labelClass}>
            {t('propertyType')}
          </label>
          <select id="property_type" {...register('property_type')} className={inputClass}>
            {PROPERTY_TYPES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>

        <Field>
          <label htmlFor="title_en" className={labelClass}>
            {t('titleEn')}
          </label>
          <input id="title_en" type="text" {...register('title_en')} className={inputClass} />
        </Field>

        <Field>
          <label htmlFor="title_es" className={labelClass}>
            {t('titleEs')}
          </label>
          <input id="title_es" type="text" {...register('title_es')} className={inputClass} />
          <p className="mt-1 text-xs text-helper">{t('atLeastOneLanguage')}</p>
          {errors.title_en && (
            <p className="mt-1 text-sm text-red-600">{t('errors.titleRequired')}</p>
          )}
        </Field>

        <Field
          className={`grid gap-3 grid-cols-1 ${isRental ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
        >
          <div>
            <label htmlFor="price_cents" className={labelClass}>
              {t('price')}
            </label>
            <input
              id="price_cents"
              type="number"
              step="1"
              min="1"
              {...register('price_cents', { valueAsNumber: true })}
              className={inputClass}
            />
            {errors.price_cents && (
              <p className="mt-1 text-sm text-red-600">{t('errors.priceRequired')}</p>
            )}
          </div>
          <div>
            <label htmlFor="currency" className={labelClass}>
              {t('currency')}
            </label>
            <select id="currency" {...register('currency')} className={inputClass}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {isRental && (
            <div>
              <label htmlFor="price_period" className={labelClass}>
                {t('pricePeriod')}
              </label>
              <select
                id="price_period"
                {...register('price_period')}
                className={inputClass}
              >
                <option value="monthly">monthly</option>
                <option value="weekly">weekly</option>
                <option value="nightly">nightly</option>
              </select>
            </div>
          )}
        </Field>
      </Section>

      <Section heading={t('sectionDetails')}>
        <Field className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="bedrooms" className={labelClass}>
              {t('bedrooms')}
            </label>
            <input
              id="bedrooms"
              type="number"
              min="0"
              step="1"
              {...register('bedrooms', {
                valueAsNumber: true,
                setValueAs: (v) => (v === '' || isNaN(v) ? null : Number(v)),
              })}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="bathrooms" className={labelClass}>
              {t('bathrooms')}
            </label>
            <input
              id="bathrooms"
              type="number"
              min="0"
              step="0.5"
              {...register('bathrooms', {
                valueAsNumber: true,
                setValueAs: (v) => (v === '' || isNaN(v) ? null : Number(v)),
              })}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="area_sqm" className={labelClass}>
              {t('areaSqm')}
            </label>
            <input
              id="area_sqm"
              type="number"
              min="1"
              step="0.01"
              {...register('area_sqm', {
                valueAsNumber: true,
                setValueAs: (v) => (v === '' || isNaN(v) ? null : Number(v)),
              })}
              className={inputClass}
            />
          </div>
        </Field>
      </Section>

      <Section heading={t('sectionLocation')}>
        <Field className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="city" className={labelClass}>
              {t('city')} *
            </label>
            <input
              id="city"
              type="text"
              required
              {...register('city')}
              className={inputClass}
            />
            {errors.city && (
              <p className="mt-1 text-sm text-red-600">{t('errors.cityRequired')}</p>
            )}
          </div>
          <div>
            <label htmlFor="country_code" className={labelClass}>
              {t('countryCode')} *
            </label>
            <select
              id="country_code"
              required
              {...register('country_code')}
              className={inputClass}
              defaultValue=""
            >
              <option value="" disabled>
                {t('countryPlaceholder')}
              </option>
              {countryOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            {errors.country_code && (
              <p className="mt-1 text-sm text-red-600">{t('errors.countryRequired')}</p>
            )}
          </div>
        </Field>
      </Section>

      <Section heading={t('sectionDescription')}>
        <Field>
          <label htmlFor="description_en" className={labelClass}>
            {t('descriptionEn')}
          </label>
          <textarea
            id="description_en"
            rows={5}
            {...register('description_en')}
            className={inputClass}
          />
        </Field>
        <Field>
          <label htmlFor="description_es" className={labelClass}>
            {t('descriptionEs')}
          </label>
          <textarea
            id="description_es"
            rows={5}
            {...register('description_es')}
            className={inputClass}
          />
        </Field>
      </Section>

      {/* Single social-channel pick — the $5 tier publishes to ONE
          channel, unlike the agents' multi-select. Stored on the
          property row by the server for the social-publish step. */}
      <Section
        heading={
          locale === 'es' ? 'Canal social' : 'Social channel'
        }
      >
        <Field>
          <label htmlFor="social_channel" className={labelClass}>
            {locale === 'es'
              ? '¿Dónde quieres que aparezca?'
              : 'Where do you want this listed?'}
          </label>
          <select
            id="social_channel"
            value={socialChannel}
            onChange={(e) => setSocialChannel(e.target.value as SocialChannel)}
            className={inputClass}
          >
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
          </select>
          <p className="mt-1 text-xs text-helper">
            {locale === 'es'
              ? 'Plan de $5 publica en un canal. Para publicación multicanal, mira los planes de Agente.'
              : '$5 plan publishes to one channel. For multi-channel publishing, see Agent plans.'}
          </p>
        </Field>
      </Section>

      {/* Photo staging — same uploader chrome as the full ListingForm
          but with a 25-photo cap (vs 30 for agents). */}
      <Section heading={tUploader('heading')}>
        <Field>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
            }}
            className={`rounded-card border-2 border-dashed p-6 text-center transition ${
              totalSlots >= MAX_STAGED_IMAGES
                ? 'cursor-not-allowed border-border-strong/30 bg-surface-muted/40'
                : dragOver
                ? 'border-action bg-action/5'
                : 'border-border-strong/40 bg-surface hover:border-border-strong/60 dark:bg-surface-deep'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              multiple
              disabled={busy || totalSlots >= MAX_STAGED_IMAGES}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
              className="sr-only"
            />
            <p className="font-brand text-sm font-semibold">
              {totalSlots >= MAX_STAGED_IMAGES
                ? tUploader('atCap')
                : tUploader('dropHere')}
            </p>
            <p className="mt-1 text-xs text-helper">
              {totalSlots} <span>/ {MAX_STAGED_IMAGES}</span> ·{' '}
              {tUploader('orClickHint')}
            </p>
            {totalSlots < MAX_STAGED_IMAGES && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="mt-3 inline-flex h-9 items-center rounded-lg border border-border-strong px-4 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
              >
                {tUploader('selectFiles')}
              </button>
            )}
          </div>

          {stagedFiles.length > 0 && (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {stagedFiles.map((s) => (
                <li
                  key={s.clientId}
                  className="overflow-hidden rounded-card border border-border bg-surface shadow-whisper dark:bg-surface-deep"
                >
                  <div className="relative aspect-[4/3] bg-surface-muted dark:bg-surface-dark">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.previewUrl}
                      alt={s.file.name}
                      className="h-full w-full object-cover"
                    />
                    <span
                      className={`absolute left-2 top-2 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm ${
                        s.status === 'confirmed'
                          ? 'bg-emerald-100/90 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200'
                          : s.status === 'error'
                          ? 'bg-red-100/90 text-red-900 dark:bg-red-950/70 dark:text-red-200'
                          : 'bg-surface/90 text-ink dark:bg-surface-dark/90 dark:text-ink-inverse'
                      }`}
                    >
                      {s.status === 'pending' && tUploader('statusPending')}
                      {s.status === 'uploading' && tUploader('statusUploading')}
                      {s.status === 'confirmed' &&
                        `✓ ${tUploader('statusConfirmed')}`}
                      {s.status === 'error' && tUploader('statusError')}
                    </span>
                    {s.status === 'pending' && !busy && (
                      <button
                        type="button"
                        onClick={() => removeStaged(s.clientId)}
                        aria-label="Remove"
                        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-surface/90 text-xs text-ink shadow-whisper hover:bg-surface dark:bg-surface-dark/90 dark:text-ink-inverse"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <p className="truncate p-2 text-xs text-helper" title={s.file.name}>
                    {s.file.name}
                  </p>
                  {s.errorCode && (
                    <p className="px-2 pb-2 text-xs text-red-600">{s.errorCode}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Field>
      </Section>

      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
        >
          <p className="font-medium">
            {locale === 'es' ? 'No se pudo publicar' : "Couldn't publish"}
          </p>
          <p>
            {serverError === 'priceRequired'
              ? locale === 'es'
                ? 'El precio es obligatorio.'
                : 'Price is required.'
              : serverError === 'invalid_input'
              ? locale === 'es'
                ? 'Algunos campos no son válidos.'
                : 'Some fields are invalid.'
              : serverError === 'purchase_not_found'
              ? locale === 'es'
                ? 'Tu pago no se encontró. Vuelve a iniciar sesión y reintenta.'
                : 'Your payment record could not be found. Sign in again and retry.'
              : serverError === 'purchase_consumed'
              ? locale === 'es'
                ? 'Este pago ya fue usado para otro anuncio.'
                : 'This payment was already used for another listing.'
              : serverError === 'purchase_expired'
              ? locale === 'es'
                ? 'Este cupo de anuncio ya expiró. Compra uno nuevo.'
                : 'This listing credit has expired. Purchase a new one.'
              : serverError === 'unauthenticated'
              ? locale === 'es'
                ? 'Tu sesión expiró. Inicia sesión de nuevo.'
                : 'Your session expired. Please sign in again.'
              : serverError}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
          {phase === 'creating' || phase === 'uploading'
            ? '…'
            : tSell('form.submit')}
        </button>
      </div>
    </form>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
        {heading}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}
