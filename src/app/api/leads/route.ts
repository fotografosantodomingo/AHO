import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { LeadCreateSchema } from '@/lib/leads/schemas';
import { sendEmail } from '@/lib/email/resend';
import { renderLeadNotificationEmail } from '@/lib/email/templates/lead-notification';
import { formatPrice } from '@/lib/listings/seo';
import { publicEnv } from '@/lib/env';

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
 * RESEND_API_KEY isn't set the wrapper logs and no-ops — the lead is still
 * created and visible in the dashboard inbox.
 *
 * Anti-abuse — TODO before public launch:
 *   - Cloudflare Turnstile site-verification on the request
 *   - KV-backed per-IP rate limit (10/hour, per HANDOFF §21.4)
 *   - Honeypot field check
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

  const supabase = createAdminClient();

  // Verify the property exists and is publicly visible. Service-role
  // bypasses RLS so we filter explicitly.
  const { data: property, error: propErr } = await supabase
    .from('properties')
    .select(
      'id, short_id, org_id, created_by, status, published_at, title_en, title_es, slug_en, slug_es, city, country_code, price_cents, currency',
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

  const { error: insertErr } = await supabase.from('leads').insert({
    property_id: property.id,
    org_id: property.org_id,
    source: data.source,
    contact_name: data.contact_name ?? null,
    contact_email: data.contact_email ?? null,
    contact_phone: data.contact_phone ?? null,
    message: data.message ?? null,
    language: data.language ?? 'en',
  });

  if (insertErr) {
    return NextResponse.json(
      { error: 'insert_failed', details: insertErr.message },
      { status: 500 },
    );
  }

  // Fire-and-await the notification email. Failures are logged but don't
  // affect the API contract — the lead exists in the DB regardless.
  try {
    await notifyAgent({
      property,
      lead: data,
    });
  } catch (e) {
    console.error('[leads] notify agent failed', e);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
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
}

async function notifyAgent({ property, lead }: NotifyArgs): Promise<void> {
  const supabase = createAdminClient();
  const { data: agent, error } = await supabase
    .from('profiles')
    .select('email, full_name, preferred_language')
    .eq('id', property.created_by)
    .single();
  if (error || !agent?.email) {
    console.warn('[leads] no agent email; skipping notification', {
      property_id: property.id,
      created_by: property.created_by,
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
