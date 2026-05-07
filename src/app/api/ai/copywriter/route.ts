import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getCurrentUserOrgPlan,
  isOrgOnProAutomation,
} from '@/lib/billing/plan-gating';
import {
  COPYWRITER_PLATFORMS,
  generateCaptions,
  type PropertyFacts,
} from '@/lib/ai/copywriter';
import { LOCALES, narrowContentLocale, type Locale } from '@/i18n/config';
import { getCountryName } from '@/lib/i18n/countries';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * POST /api/ai/copywriter
 *
 * Generates social-media caption variants for a property listing.
 * Per the Content Hub Vision (docs/CONTENT_HUB_VISION.md), every
 * caption is bundled with the listing's permanent AHO URL so each
 * social post agents publish links back to advertisehomes.online.
 *
 * Auth: signed-in user. Plan: Pro Automation only.
 *
 * Two input modes:
 *   1. `propertyId`: server fetches the listing, builds facts +
 *      `https://advertisehomes.online/{locale}/properties/{slug}-{shortId}`,
 *      and threads the URL into every variant. The dashboard's
 *      "Generate social posts" button uses this mode.
 *   2. `facts`: caller supplies facts directly. Used by the
 *      standalone playground at /dashboard/copywriter for testing
 *      with fictional fact sets (no AHO URL — playground variants
 *      omit the URL line). Also the future entry point for the
 *      gated-signup hook on /for-agents (paste competitor URL →
 *      scrape → captions before signup).
 */

const FactsSchema = z.object({
  title: z.string().trim().min(1).max(300),
  transactionType: z.enum(['sale', 'rent', 'short_term']),
  propertyType: z.string().trim().min(1).max(60),
  bedrooms: z.number().int().min(0).max(20).nullable(),
  bathrooms: z.number().min(0).max(20).nullable(),
  areaSqm: z.number().min(0).max(10_000).nullable(),
  city: z.string().trim().min(1).max(120),
  countryDisplay: z.string().trim().min(1).max(120),
  priceLabel: z.string().trim().min(1).max(60),
  amenities: z.array(z.string().trim().min(1).max(80)).max(30),
  description: z.string().max(4000).nullable(),
  positioningHint: z.string().max(400).nullable().optional(),
});

const RequestSchema = z
  .object({
    facts: FactsSchema.optional(),
    propertyId: z.string().uuid().optional(),
    locale: z.enum(LOCALES),
    platform: z.enum(COPYWRITER_PLATFORMS),
    count: z.number().int().min(1).max(6).default(3),
  })
  .refine(
    (v) => Boolean(v.facts) !== Boolean(v.propertyId),
    'Provide exactly one of `facts` or `propertyId`.',
  );

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const ctx = await getCurrentUserOrgPlan(supabase);
  if (!ctx) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }
  const allowed = await isOrgOnProAutomation(supabase, ctx.orgId);
  if (!allowed) {
    return NextResponse.json(
      { error: 'plan_required', requiredTier: 'pro_automation' },
      { status: 403 },
    );
  }

  // Resolve facts + listingUrl. Two modes converge on a single shape.
  let facts: PropertyFacts;
  let listingUrl: string | null = null;

  if (parsed.data.propertyId) {
    interface ListingRow {
      id: string;
      short_id: string;
      status: string;
      title_en: string | null;
      title_es: string | null;
      slug_en: string | null;
      slug_es: string | null;
      description_en: string | null;
      description_es: string | null;
      transaction_type: string;
      property_type: string;
      price_cents: number | string;
      currency: string;
      bedrooms: number | null;
      bathrooms: number | string | null;
      area_sqm: number | string | null;
      city: string;
      country_code: string;
      amenities: string[] | null;
      org_id: string;
    }
    const { data: listingRaw, error: lookupErr } = await supabase
      .from('properties')
      .select(
        'id, short_id, status, title_en, title_es, slug_en, slug_es, ' +
          'description_en, description_es, transaction_type, property_type, ' +
          'price_cents, currency, bedrooms, bathrooms, area_sqm, ' +
          'city, country_code, amenities, org_id',
      )
      .eq('id', parsed.data.propertyId)
      .maybeSingle();
    const listing = listingRaw as unknown as ListingRow | null;
    if (lookupErr) {
      return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
    }
    if (!listing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (listing.org_id !== ctx.orgId) {
      // Cross-org access prevention — RLS would reject anyway, but
      // fail explicit and fast with a clean 403 instead of an empty
      // result set + cryptic 500.
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (listing.status !== 'active') {
      // PO directive (CONTENT_HUB_VISION.md): captions are generated
      // ONLY after the listing is published, so the URL embedded in
      // every variant is real and resolvable.
      return NextResponse.json(
        { error: 'listing_not_published', currentStatus: listing.status },
        { status: 409 },
      );
    }

    const targetLocale = parsed.data.locale;
    // The slug used in the URL is the locale-specific one (slug_en or
    // slug_es), with a fallback to whichever exists.
    const contentLocale = narrowContentLocale(targetLocale);
    const slug =
      (contentLocale === 'es' ? listing.slug_es : listing.slug_en) ??
      listing.slug_en ??
      listing.slug_es;
    if (!slug) {
      return NextResponse.json({ error: 'listing_slug_missing' }, { status: 409 });
    }
    const pathSegment = targetLocale === 'es' ? 'propiedades' : 'properties';
    const pub = publicEnv();
    listingUrl = `${pub.NEXT_PUBLIC_SITE_URL}/${targetLocale}/${pathSegment}/${slug}-${listing.short_id}`;

    // Build the facts the engine consumes. Description + title use the
    // active locale's value with content-locale fallback. Currency
    // formatting via Intl.NumberFormat — matches the price tile style
    // visitors see on the public listing page.
    const titleForLocale =
      (contentLocale === 'es' ? listing.title_es : listing.title_en) ??
      listing.title_en ??
      listing.title_es ??
      '';
    const descriptionForLocale =
      (contentLocale === 'es' ? listing.description_es : listing.description_en) ??
      listing.description_en ??
      listing.description_es ??
      null;

    const priceCents = Number(listing.price_cents);
    const priceLabel = new Intl.NumberFormat(targetLocale, {
      style: 'currency',
      currency: listing.currency || 'USD',
      maximumFractionDigits: 0,
    }).format(priceCents / 100);

    facts = {
      title: titleForLocale,
      transactionType: (listing.transaction_type as PropertyFacts['transactionType']) ?? 'sale',
      propertyType: listing.property_type ?? 'property',
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms != null ? Number(listing.bathrooms) : null,
      areaSqm: listing.area_sqm != null ? Number(listing.area_sqm) : null,
      city: listing.city,
      countryDisplay: getCountryName(listing.country_code, targetLocale as Locale),
      priceLabel,
      amenities: ((listing.amenities as string[] | null) ?? []).slice(0, 30),
      description: descriptionForLocale,
      positioningHint: null,
    };
  } else if (parsed.data.facts) {
    facts = parsed.data.facts;
  } else {
    // Schema's refine() catches this branch upstream, but TS demands
    // an exhaustive default.
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const result = await generateCaptions({
      facts,
      locale: parsed.data.locale,
      platform: parsed.data.platform,
      count: parsed.data.count,
      listingUrl,
    });
    return NextResponse.json(
      {
        captions: result.captions,
        listingUrl,
        meta: {
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      },
      { status: 200 },
    );
  } catch (e) {
    console.error('[ai/copywriter]', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: 'generation_failed', details: message },
      { status: 502 },
    );
  }
}
