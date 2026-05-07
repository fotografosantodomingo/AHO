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
} from '@/lib/ai/copywriter';
import { LOCALES } from '@/i18n/config';

export const runtime = 'edge';

/**
 * POST /api/ai/copywriter
 *
 * Generates social-media caption variants for a property listing.
 * Day-3 of the execution plan (Option C — pivot to AI Copywriter MVP
 * while Meta App Review is debugged separately).
 *
 * Auth: signed-in user. Plan: Pro Automation only — this is the
 * marquee feature of the $99/mo tier.
 *
 * Two input modes:
 *   1. `propertyId`: server fetches the property's facts from DB and
 *      formats them for the engine. Use this from the dashboard
 *      properties pages.
 *   2. `facts`: caller supplies the facts directly. Use this from the
 *      gated-signup hook on /for-agents (anon visitor pastes a URL,
 *      we scrape, send facts here even before they have an account).
 *      For v1 we still require auth + Pro Automation; the
 *      "free preview" lane wires up later.
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

const RequestSchema = z.object({
  facts: FactsSchema,
  locale: z.enum(LOCALES),
  platform: z.enum(COPYWRITER_PLATFORMS),
  count: z.number().int().min(1).max(6).default(3),
});

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

  // Plan gate: Pro Automation only. Other tiers see the upgrade CTA
  // on /dashboard/social and can't reach this endpoint.
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

  try {
    const result = await generateCaptions({
      facts: parsed.data.facts,
      locale: parsed.data.locale,
      platform: parsed.data.platform,
      count: parsed.data.count,
    });
    return NextResponse.json(
      {
        captions: result.captions,
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
