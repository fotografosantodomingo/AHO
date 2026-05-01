import { z } from 'zod';
import { TRANSACTION_TYPES, PRICE_PERIODS } from '@/db/schema';
import { AMENITY_KEYS } from '@/lib/listings/amenities';

/**
 * Listing form Zod schemas + inferred types. Lives in a NON-server module
 * so both the client form (`<ListingForm>`) and the server action
 * (`createListing`) can import it.
 *
 * Why this is its own file:
 *   - `src/lib/listings/actions.ts` has `'use server'`. Next.js 15 only
 *     allows async function exports from server-action files; non-function
 *     exports (Zod schemas, types, constants) get tree-shaken from the
 *     client bundle and end up `undefined` at runtime. That broke the
 *     form's `zodResolver(CreateListingSchema)` → "is not a function"
 *     TypeError on submit. Splitting the schema fixes it.
 *
 * Validation behavior that the form relies on:
 *   - `price_period` accepts an empty string (the disabled `<select>`
 *     ships `''` when the form is in Sale mode) and treats it as null.
 *     Without the preprocess, Zod rejected `''` with an enum error.
 *   - The optional number fields (bedrooms/bathrooms/area_sqm) accept
 *     NaN and treat as null. RHF's `valueAsNumber: true` on an empty
 *     `<input type="number">` produces NaN — without the preprocess,
 *     Zod rejected with "Expected number, received nan".
 */

const TransactionType = z.enum(TRANSACTION_TYPES);
const PricePeriod = z.enum(PRICE_PERIODS);

const TitleAtLeastOneLanguage = z
  .object({
    title_en: z.string().trim().max(200).optional().nullable(),
    title_es: z.string().trim().max(200).optional().nullable(),
  })
  .refine(
    (data) =>
      (data.title_en && data.title_en.length > 0) ||
      (data.title_es && data.title_es.length > 0),
    { message: 'titleRequired', path: ['title_en'] },
  );

// Preprocess helper for nullable number fields — RHF's valueAsNumber on
// an empty `<input type="number">` returns NaN. We accept NaN/empty and
// coerce to null so the optional+nullable schema branches accept them.
const nullableNumber = z.preprocess(
  (v) => (v === '' || v == null || (typeof v === 'number' && Number.isNaN(v)) ? null : v),
  z.number().optional().nullable(),
);

const ListingInputBase = z.object({
  description_en: z.string().trim().max(8000).optional().nullable(),
  description_es: z.string().trim().max(8000).optional().nullable(),
  transaction_type: TransactionType,
  property_type: z.string().min(1).max(50).default('apartment'),
  price_cents: z
    .number()
    .int()
    .positive()
    .max(9_999_999_999_999),
  currency: z.string().length(3).toUpperCase().default('USD'),
  // Empty string from the hidden <select> when transaction is Sale →
  // coerced to null. Otherwise must be one of the enum values.
  price_period: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    PricePeriod.optional().nullable(),
  ),
  bedrooms: nullableNumber.pipe(
    z.number().int().nonnegative().max(50).optional().nullable(),
  ),
  bathrooms: nullableNumber.pipe(
    z.number().nonnegative().max(50).optional().nullable(),
  ),
  area_sqm: nullableNumber.pipe(
    z.number().positive().max(100_000).optional().nullable(),
  ),
  address_line: z.string().trim().max(200).optional().nullable(),
  neighborhood: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().min(1).max(120),
  state_region: z.string().trim().max(120).optional().nullable(),
  country_code: z.string().trim().length(2).toUpperCase(),
  postal_code: z.string().trim().max(20).optional().nullable(),
  display_address: z.boolean().default(true),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // Frontend sends only valid keys; server filters to the catalog too so
  // a tampered request can't store rogue values.
  amenities: z
    .array(z.enum(AMENITY_KEYS))
    .max(AMENITY_KEYS.length)
    .optional()
    .default([]),
});

export const CreateListingSchema = ListingInputBase.and(TitleAtLeastOneLanguage);
export type CreateListingInput = z.infer<typeof CreateListingSchema>;
