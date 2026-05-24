import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { LeadCreateSchema } from '@/lib/leads/schemas';
import { sendEmail } from '@/lib/email/brevo';
import { renderLeadNotificationEmail } from '@/lib/email/templates/lead-notification';
import { formatPrice } from '@/lib/listings/seo';
import { publicEnv } from '@/lib/env';
import { recordPropertyEvent } from '@/lib/listings/events';
import { ANON_COOKIE_NAME } from '@/lib/listings/recent-views';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyTurnstileToken } from '@/lib/auth/turnstile-verify';
import { checkRateLimit, LEAD_FORM_RATE_LIMIT } from '@/lib/rate-limit/kv';
import {
  applyRoutingRules,
  type RoutingRule,
} from '@/lib/leads/routing';
import type {
  LeadRoutingAction,
  LeadRoutingConditions,
} from '@/db/schema';

export const runtime = 'edge';

/**
 * POST /api/leads
 *
 * Creates a lead row for a property. Anonymous buyers can submit (the
 * detail page form posts here). Per `docs/HANDOFF.md` §17.3, lead writes
 * never go through user-context RLS — anonymous writes need a permissive
 * policy that opens spam vectors. Routing through this endpoint with the
 * service role lets us layer rate limiting, Turnstile, content filtering
 * before the DB sees the row.
 *
 * Email notification to the agent fires after the row is committed. If
 * BREVO_API_KEY isn't set the wrapper logs and no-ops — the lead is still
 * created and visible in the dashboard inbox.
 *
 * Anti-abuse layers (in order):
 *   1. Honeypot — schema rejects non-empty `website` field (commit cbe6ec6).
 *   2. Cloudflare Turnstile — server-side siteverify on the captcha token
 *      issued by the widget on the contact form. Same shared Turnstile
 *      site key + secret as Supabase Auth's captcha (PO 2026-05-06).
 *      Required for `source='form'` when TURNSTILE_SECRET_KEY is set;
 *      skipped silently in local dev when unset. Tracking-style sources
 *      (whatsapp_click, phone_click, email_click) are NOT spammable form
 *      submissions and bypass the captcha — they're outbound-click
 *      analytics events.
 *   3. KV-backed per-IP rate limit — 10 form submits per hour per client
 *      IP (`cf-connecting-ip`). Implemented in `src/lib/rate-limit/kv.ts`;
 *      degrades open in environments without the KV binding (tests,
 *      local). Same source-gating as Turnstile: only `form` is limited.
 *      Tracking-click sources don't bottleneck the dialer pattern of a
 *      legitimate buyer pinging multiple listings.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = LeadCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Captcha + rate-limit gate — only on the spammable form source.
  // Tracking clicks (whatsapp/phone/email) skip; they post no user
  // content, just record a click event.
  if (data.source === 'form') {
    const remoteIp =
      req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      null;

    // Rate limit before Turnstile verify — saves a siteverify call when
    // the IP is already past its quota.
    const rl = await checkRateLimit(remoteIp ?? 'unknown', LEAD_FORM_RATE_LIMIT);
    if (!rl.allowed && !('skipped' in rl)) {
      return NextResponse.json(
        { error: 'rate_limited' },
        {
          status: 429,
          headers: { 'retry-after': String(rl.retryAfterSeconds) },
        },
      );
    }

    const verify = await verifyTurnstileToken(data.captcha_token, remoteIp);
    if ('valid' in verify && !verify.valid) {
      return NextResponse.json(
        { error: 'captcha_failed', code: verify.error },
        { status: 400 },
      );
    }
    // verify.skipped (TURNSTILE_SECRET_KEY unset, dev/preview) → fall
    // through; honeypot still gates spam-bot submissions.
  }

  const supabase = createAdminClient();

  // Verify the property exists and is publicly visible. Service-role
  // bypasses RLS so we filter explicitly.
  const { data: property, error: propErr } = await supabase
    .from('properties')
    .select(
      'id, short_id, org_id, created_by, status, published_at, title_en, title_es, slug_en, slug_es, city, country_code, price_cents, currency, property_type',
    )
    .eq('id', data.property_id)
    .maybeSingle();

  if (propErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!property || property.status !== 'active' || !property.published_at) {
    // Treat as 404 rather than leak status — anyone could probe property IDs.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Apply per-org routing rules. Solo agents with no rules see no
  // change — `applyRoutingRules` returns the fallback (the property's
  // primary agent, i.e. legacy attribution). Failures here are
  // soft-handled; we never want a routing-config bug to drop a lead.
  const routing = await routeLead({
    supabase,
    orgId: property.org_id,
    fallbackUserId: property.created_by,
    lead: {
      city: property.city ?? null,
      countryCode: property.country_code ?? null,
      language: data.language ?? null,
      propertyType: property.property_type ?? null,
    },
  });

  const { error: insertErr } = await supabase.from('leads').insert({
    property_id: property.id,
    org_id: property.org_id,
    assigned_to: routing.assignTo,
    source: data.source,
    contact_name: data.contact_name ?? null,
    contact_email: data.contact_email ?? null,
    contact_phone: data.contact_phone ?? null,
    message: data.message ?? null,
    language: data.language ?? 'en',
  });

  if (insertErr) {
    console.error('[POST /api/leads] insert failed', insertErr);
    return NextResponse.json(
      { error: 'insert_failed' },
      { status: 500 },
    );
  }

  // Analytics event — `lead_form_submit`. Fan into property_events so
  // the agent dashboard's "leads in last 7 days" widget has data.
  // Identity-resolution: signed-in user_id from session, anon_id from
  // cookie if set. Both can be null for fresh-cookie-less anon submits.
  try {
    const userClient = await createServerSupabaseClient();
    const { data: userResult } = await userClient.auth.getUser();
    const userId = userResult.user?.id ?? null;
    const anonymousId = req.cookies.get(ANON_COOKIE_NAME)?.value ?? null;
    await recordPropertyEvent({
      supabase,
      propertyId: property.id,
      orgId: property.org_id,
      eventType: 'lead_form_submit',
      userId,
      anonymousId,
      source: data.source ?? null,
      metadata: {
        has_message: !!data.message,
        has_phone: !!data.contact_phone,
        language: data.language ?? 'en',
      },
    });
  } catch (e) {
    console.warn('[leads] analytics event record failed', e);
  }

  // Fire-and-await the notification email. Failures are logged but don't
  // affect the API contract — the lead exists in the DB regardless.
  // Notify the routed assignee (falls back to property.created_by when
  // no rule matched, preserving legacy behavior for solo agents).
  try {
    await notifyAgent({
      property,
      lead: data,
      notifyUserId: routing.assignTo,
    });
  } catch (e) {
    console.error('[leads] notify agent failed', e);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

/**
 * Load active routing rules for the org, run them through the engine,
 * and persist the round-robin cursor when one was advanced. All
 * failures are soft — a routing-config bug must never drop a lead, so
 * any error here logs + returns the legacy fallback.
 */
async function routeLead(args: {
  supabase: ReturnType<typeof createAdminClient>;
  orgId: string;
  fallbackUserId: string;
  lead: {
    city: string | null;
    countryCode: string | null;
    language: string | null;
    propertyType: string | null;
  };
}): Promise<{ assignTo: string; ruleId: string | null }> {
  const { supabase, orgId, fallbackUserId, lead } = args;
  try {
    const { data: ruleRows, error: rulesErr } = await supabase
      .from('lead_routing_rules')
      .select('id, priority, created_at, is_active, conditions, action')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });
    if (rulesErr) {
      console.warn('[leads] routing rules lookup failed', rulesErr);
      return { assignTo: fallbackUserId, ruleId: null };
    }
    if (!ruleRows || ruleRows.length === 0) {
      return { assignTo: fallbackUserId, ruleId: null };
    }

    const { data: stateRow } = await supabase
      .from('lead_routing_state')
      .select('last_round_robin_index')
      .eq('org_id', orgId)
      .maybeSingle();
    const cursor = stateRow?.last_round_robin_index ?? 0;

    const rules: RoutingRule[] = ruleRows
      .map((r) => {
        // Defensive: rows are JSONB; the action/conditions could in
        // theory be wrong-shape if a manual SQL edit slipped past the
        // CHECK constraint. Validate structurally and skip on miss.
        const conditions = r.conditions as LeadRoutingConditions | null;
        const action = r.action as LeadRoutingAction | null;
        if (!action || (action.type !== 'assign' && action.type !== 'round_robin')) {
          return null;
        }
        if (
          action.type === 'assign' &&
          typeof action.assign_to_user_id !== 'string'
        ) {
          return null;
        }
        if (
          action.type === 'round_robin' &&
          !Array.isArray(action.round_robin_user_ids)
        ) {
          return null;
        }
        return {
          id: r.id as string,
          priority: r.priority as number,
          createdAt: r.created_at as string,
          isActive: r.is_active as boolean,
          conditions: (conditions ?? {}) as LeadRoutingConditions,
          action,
        } satisfies RoutingRule;
      })
      .filter((r): r is RoutingRule => r !== null);

    const decision = applyRoutingRules(rules, lead, fallbackUserId, cursor);

    if (decision.newRoundRobinIndex !== null) {
      // Upsert the cursor. Conflict target is the PK (org_id).
      const { error: upsertErr } = await supabase
        .from('lead_routing_state')
        .upsert(
          {
            org_id: orgId,
            last_round_robin_index: decision.newRoundRobinIndex,
          },
          { onConflict: 'org_id' },
        );
      if (upsertErr) {
        // Cursor write failed — the lead still gets the right
        // assignment for THIS round, but the next call will see the
        // stale cursor. Acceptable; log it.
        console.warn('[leads] routing cursor upsert failed', upsertErr);
      }
    }

    return { assignTo: decision.assignTo, ruleId: decision.ruleId };
  } catch (e) {
    console.warn('[leads] routing engine threw; falling back', e);
    return { assignTo: fallbackUserId, ruleId: null };
  }
}

interface NotifyArgs {
  property: {
    id: string;
    short_id: string;
    org_id: string;
    created_by: string;
    title_en: string | null;
    title_es: string | null;
    slug_en: string | null;
    slug_es: string | null;
    city: string;
    country_code: string;
    price_cents: number;
    currency: string;
  };
  lead: {
    source: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    message?: string;
    language?: string;
  };
  /** The routed assignee — used as the notification recipient. Falls
   *  back to property.created_by upstream when no rule matched, so
   *  this is always a valid profile id. */
  notifyUserId: string;
}

async function notifyAgent({
  property,
  lead,
  notifyUserId,
}: NotifyArgs): Promise<void> {
  const supabase = createAdminClient();
  const { data: agent, error } = await supabase
    .from('profiles')
    .select('email, full_name, preferred_language')
    .eq('id', notifyUserId)
    .single();
  if (error || !agent?.email) {
    console.warn('[leads] no agent email; skipping notification', {
      property_id: property.id,
      notify_user_id: notifyUserId,
    });
    return;
  }

  // Buyer locale = the language they submitted in. Fall back to agent's
  // preferred language for the email itself (the agent reads it, not the buyer).
  const agentLocale: 'en' | 'es' =
    agent.preferred_language === 'es' ? 'es' : 'en';

  const title =
    (agentLocale === 'es' ? property.title_es : property.title_en) ??
    property.title_en ??
    property.title_es ??
    '—';
  const slug =
    (agentLocale === 'es' ? property.slug_es : property.slug_en) ??
    property.slug_en ??
    property.slug_es;

  const pub = publicEnv();
  const propertyUrl = slug
    ? `${pub.NEXT_PUBLIC_SITE_URL}/${agentLocale}/${
        agentLocale === 'es' ? 'propiedades' : 'properties'
      }/${slug}-${property.short_id}`
    : `${pub.NEXT_PUBLIC_SITE_URL}/${agentLocale}`;
  const inboxUrl = `${pub.NEXT_PUBLIC_SITE_URL}/${agentLocale}/${
    agentLocale === 'es' ? 'panel/contactos' : 'dashboard/leads'
  }`;

  const { subject, html } = renderLeadNotificationEmail({
    agentName: agent.full_name,
    propertyTitle: title,
    propertyCity: property.city,
    propertyPriceFormatted: formatPrice(
      Number(property.price_cents),
      property.currency,
      agentLocale,
    ),
    propertyUrl,
    inboxUrl,
    source: lead.source,
    contactName: lead.contact_name ?? null,
    contactEmail: lead.contact_email ?? null,
    contactPhone: lead.contact_phone ?? null,
    message: lead.message ?? null,
    receivedAt: new Date().toISOString(),
    locale: agentLocale,
  });

  await sendEmail({
    to: agent.email,
    subject,
    html,
    // Reply-to the lead's email so the agent can respond directly.
    ...(lead.contact_email ? { replyTo: lead.contact_email } : {}),
  });
}
