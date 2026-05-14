import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getCurrentUserOrgPlan,
  isOrgOnProAutomation,
} from '@/lib/billing/plan-gating';
import { serverEnv, publicEnv } from '@/lib/env';
import { localePath } from '@/i18n/routing';
import { LOCALES, type Locale, narrowContentLocale } from '@/i18n/config';
import { getCountryName } from '@/lib/i18n/countries';
import { formatPrice } from '@/lib/listings/format';
import {
  generateDrafts,
  type DrafterPlatform,
} from '@/lib/social/ai-drafter';

export const runtime = 'edge';

/**
 * POST /api/social/ai-draft
 *
 * Phase J of docs/SOCIAL_AUTOMATION_PLAN.md — AI caption drafter for the
 * pre-share editor. The agent clicks "Generate draft" before clicking
 * "Share now"; this route returns one suggested caption per requested
 * platform. Agent reviews + edits before publishing. AI never publishes.
 *
 * Auth + Pro Automation gate (same as /api/social/post — frontend never
 * decides per CLAUDE.md hard rule #4).
 *
 * Failure modes are SILENT to the user — on any Anthropic error the
 * response carries an empty `drafts` for affected platforms; the UI
 * then falls back to the deterministic template (Phase C formatter)
 * so the agent's flow is never blocked.
 *
 * Costs: ~$0.002/call on Claude Haiku (3 platforms, ~700 input cached
 * + ~500 output). At 32 calls/agent/month = $0.07/agent/month —
 * comfortable inside $99 MRR.
 */

const BodySchema = z.object({
  propertyId: z.string().uuid(),
  locale: z.enum(LOCALES).default('en'),
  platforms: z
    .array(z.enum(['facebook', 'instagram', 'linkedin']))
    .min(1)
    .max(3),
});

export async function POST(req: NextRequest) {
  // Auth + Pro Automation gate (mirrors /api/social/post)
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }

  const ctx = await getCurrentUserOrgPlan(supabase);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, errorCode: 'no_org' },
      { status: 403 },
    );
  }
  if (!(await isOrgOnProAutomation(supabase, ctx.orgId))) {
    return NextResponse.json(
      { ok: false, errorCode: 'plan_required', requiredPlan: 'pro_automation' },
      { status: 403 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'invalid_input',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  // Fetch property via user-context (RLS enforces org ownership)
  const { data: property, error: propErr } = await supabase
    .from('properties')
    .select(
      'id, org_id, title_en, title_es, slug_en, slug_es, short_id, city, country_code, price_cents, currency, bedrooms, bathrooms, area_sqm, status, published_at',
    )
    .eq('id', body.propertyId)
    .maybeSingle();
  if (propErr || !property) {
    return NextResponse.json(
      { ok: false, errorCode: 'property_not_found' },
      { status: 404 },
    );
  }
  if (property.status !== 'active' || !property.published_at) {
    return NextResponse.json(
      { ok: false, errorCode: 'property_not_published' },
      { status: 400 },
    );
  }
  if (property.org_id !== ctx.orgId) {
    return NextResponse.json(
      { ok: false, errorCode: 'cross_org' },
      { status: 403 },
    );
  }

  // Locale narrowing (same rule as /api/social/post)
  const wantEs = body.locale === 'es' && property.slug_es && property.title_es;
  const contentLocale: Locale = wantEs ? 'es' : 'en';
  const slug = wantEs ? property.slug_es : property.slug_en ?? property.slug_es;
  const title = wantEs
    ? property.title_es ?? property.title_en
    : property.title_en ?? property.title_es;
  if (!slug || !title) {
    return NextResponse.json(
      { ok: false, errorCode: 'listing_missing_translation' },
      { status: 400 },
    );
  }
  const propertyStem = localePath(contentLocale, '/properties/[slug]').replace(
    '/[slug]',
    '',
  );
  const url = `${publicEnv().NEXT_PUBLIC_SITE_URL}${propertyStem}/${slug}-${property.short_id}`;

  const priceFormatted = formatPrice(
    Number(property.price_cents),
    property.currency,
    narrowContentLocale(contentLocale),
  );

  const env = serverEnv();
  const result = await generateDrafts(
    {
      title,
      city: property.city,
      countryDisplay: getCountryName(property.country_code, contentLocale),
      priceCents: Number(property.price_cents),
      currency: property.currency,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms != null ? Number(property.bathrooms) : null,
      areaSqm: property.area_sqm != null ? Number(property.area_sqm) : null,
      url,
      locale: contentLocale,
      priceFormatted,
    },
    body.platforms as DrafterPlatform[],
    env.ANTHROPIC_API_KEY,
  );

  // Always 200 — failure is signaled via empty drafts + errorCode in
  // the body. Lets the UI render a graceful fallback without HTTP-status
  // gymnastics on the client side.
  return NextResponse.json({
    ok: result.anySuccess,
    drafts: result.drafts,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.errorCode ? { aiErrorCode: result.errorCode } : {}),
    ...(result.errorMessage ? { aiErrorMessage: result.errorMessage } : {}),
  });
}
