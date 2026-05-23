import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/brevo';
import { checkRateLimit, type RateLimitConfig } from '@/lib/rate-limit/kv';
import { ALL_COUNTRY_CODES, getCountryName } from '@/lib/i18n/countries';
import type { Locale } from '@/i18n/config';
import { renderFoundingAgentWelcomeEmail } from '@/lib/email/templates/founding-agent-welcome';
import { renderFoundingAgentAdminAlertEmail } from '@/lib/email/templates/founding-agent-admin-alert';

export const runtime = 'edge';

/**
 * POST /api/founding-agent
 *
 * Public form submission for the Founding 50 program. Anonymous
 * write — all anti-abuse + dedup happens here BEFORE the service-role
 * insert. Same defense-in-depth pattern as /api/leads:
 *
 *   1. Honeypot — `website` field must be empty
 *   2. Zod schema validation (length bounds, email regex, country code
 *      whitelist, URL prefix)
 *   3. Per-IP KV rate limit (3 applications per IP per 24h — this is a
 *      ONE-TIME ASK form, not a repeat-submission form)
 *   4. Email-dedup query — if the same email has an existing 'applied'
 *      row in the last 30 days, return ok+already_applied without
 *      inserting (idempotent UX for the "did my submit work?" reload)
 *   5. service-role INSERT
 *   6. dual sendEmail — welcome to applicant + alert to operator
 *
 * Returns:
 *   200 ok { applicationId }     — fresh submission accepted
 *   200 ok { duplicate: true }   — same email applied recently; no-op
 *   400 invalid_request          — schema rejected
 *   429 rate_limited             — per-IP cap hit
 *   500 internal_error           — DB / email failure (only the DB
 *                                  failure rolls back; email failures
 *                                  log + proceed since the row is
 *                                  durable + the admin view shows it)
 *
 * Why service-role insert (not anon RLS): the RLS on
 * founding_agent_applications denies INSERT to authenticated + anon
 * by design. The public form writes via this route which (a) is rate-
 * limited, (b) validates, (c) dedups, (d) fires the side-effect
 * emails. Direct PostgREST insert would skip all four.
 */

const FoundingAgentRateLimit: RateLimitConfig = {
  namespace: 'founding-agent-apply',
  windowSeconds: 60 * 60 * 24, // 24h
  max: 3,
};

const ApplicationSchema = z
  .object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(180),
    whatsapp: z
      .string()
      .trim()
      .min(6)
      .max(40)
      .optional()
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    city: z.string().trim().min(2).max(80),
    country_code: z
      .string()
      .trim()
      .toUpperCase()
      .refine((cc) => (ALL_COUNTRY_CODES as readonly string[]).includes(cc), {
        message: 'unknown country code',
      }),
    portfolio_url: z
      .string()
      .trim()
      .max(500)
      .regex(/^https?:\/\//i, 'must start with http:// or https://')
      .optional()
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    message: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    locale: z.enum(['en', 'es', 'pl', 'pt', 'de', 'fr', 'it']).default('en'),
    utm_source: z.string().trim().max(80).optional().nullable(),
    utm_campaign: z.string().trim().max(80).optional().nullable(),

    // Honeypot — bots fill this; humans never see it.
    website: z.string().max(0).optional().default(''),
  })
  .strict();

const ADMIN_EMAIL = 'info@advertisehomes.online';
const PROGRAM_CAP = 50;
const DEDUP_WINDOW_DAYS = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ─── Step 1: parse body ──────────────────────────────────────────
  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const parsed = ApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // ─── Step 2: rate limit per IP ───────────────────────────────────
  const remoteIp =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';

  const rl = await checkRateLimit(remoteIp, FoundingAgentRateLimit);
  if (!rl.allowed && !('skipped' in rl)) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { 'retry-after': String(rl.retryAfterSeconds) },
      },
    );
  }

  const supabase = createAdminClient();

  // ─── Step 3: idempotency — same-email-recently dedup ─────────────
  const dedupSince = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const { data: existing, error: dedupErr } = await supabase
    .from('founding_agent_applications')
    .select('id, status, applied_at')
    .eq('email', data.email)
    .gte('applied_at', dedupSince.toISOString())
    .order('applied_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dedupErr) {
    console.error('[founding-agent] dedup query failed', {
      code: dedupErr.code,
      message: dedupErr.message,
    });
    // Soft-fail dedup — proceed with insert; worst case we get a
    // duplicate row the operator merges manually.
  }
  if (existing) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      applicationId: existing.id,
    });
  }

  // ─── Step 4: hash the IP for the row ─────────────────────────────
  const submissionIpHash = remoteIp === 'unknown' ? null : await sha256Hex(remoteIp);

  // ─── Step 5: insert ──────────────────────────────────────────────
  const { data: inserted, error: insertErr } = await supabase
    .from('founding_agent_applications')
    .insert({
      full_name: data.full_name,
      email: data.email,
      whatsapp: data.whatsapp,
      city: data.city,
      country_code: data.country_code,
      portfolio_url: data.portfolio_url,
      message: data.message,
      submission_ip_hash: submissionIpHash,
      utm_source: data.utm_source ?? null,
      utm_campaign: data.utm_campaign ?? null,
    })
    .select('id, applied_at')
    .single();

  if (insertErr || !inserted) {
    console.error('[founding-agent] insert failed', {
      code: insertErr?.code,
      message: insertErr?.message,
      details: insertErr?.details,
      hint: insertErr?.hint,
    });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  // ─── Step 6: total count for the operator alert ──────────────────
  const { count: totalCount } = await supabase
    .from('founding_agent_applications')
    .select('id', { count: 'exact', head: true });
  const applicationCountTotal = totalCount ?? 1;

  // ─── Step 7: fire emails — best-effort, don't fail the request ───
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://advertisehomes.online';
  const localeForUrl: Locale = data.locale;
  const programUrl = `${siteUrl}/${localeForUrl}/founding-agent`;
  const adminUrl = `${siteUrl}/${localeForUrl}/admin/founding-agents?id=${inserted.id}`;

  // Applicant welcome — EN or ES only for v1; non-supported locales
  // fall back to EN to keep the founder voice consistent.
  const applicantLocale: 'en' | 'es' =
    data.locale === 'es' ? 'es' : 'en';
  const applicantEmail = renderFoundingAgentWelcomeEmail({
    fullName: data.full_name,
    locale: applicantLocale,
    city: data.city,
    whatsappDisplay: data.whatsapp,
    programUrl,
  });
  const applicantSend = await sendEmail({
    to: data.email,
    subject: applicantEmail.subject,
    html: applicantEmail.html,
    text: applicantEmail.text,
  });
  if (!applicantSend.sent) {
    console.error('[founding-agent] applicant email failed', applicantSend.error);
  }

  // Operator alert — always EN, always to info@advertisehomes.online.
  const adminEmail = renderFoundingAgentAdminAlertEmail({
    fullName: data.full_name,
    email: data.email,
    whatsapp: data.whatsapp,
    city: data.city,
    countryCode: data.country_code,
    countryDisplay: getCountryName(data.country_code, 'en'),
    portfolioUrl: data.portfolio_url,
    message: data.message,
    applicationId: inserted.id,
    appliedAt: inserted.applied_at,
    adminUrl,
    utmSource: data.utm_source ?? null,
    utmCampaign: data.utm_campaign ?? null,
    applicationCountTotal,
    applicationCap: PROGRAM_CAP,
  });
  const adminSend = await sendEmail({
    to: ADMIN_EMAIL,
    subject: adminEmail.subject,
    html: adminEmail.html,
    text: adminEmail.text,
  });
  if (!adminSend.sent) {
    console.error('[founding-agent] admin alert email failed', adminSend.error);
  }

  return NextResponse.json({
    ok: true,
    applicationId: inserted.id,
  });
}

/** SHA-256 hex of input — same primitive as /api/audit/start uses
 *  for IP hashing. Edge-runtime compatible. */
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
