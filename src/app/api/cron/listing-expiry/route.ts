import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv, publicEnv } from '@/lib/env';
import { checkCronAuth } from '@/app/api/cron/meta-insights/route';
import { sendEmail } from '@/lib/email/brevo';
import { renderListingRenewalReminderEmail } from '@/lib/email/templates/listing-renewal-reminder';
import { renderListingExpiredEmail } from '@/lib/email/templates/listing-expired';
import { renderListingUnpublishedReminderEmail } from '@/lib/email/templates/listing-unpublished-reminder';

export const runtime = 'edge';

/**
 * GET /api/cron/listing-expiry
 *
 * Daily cron — drives the lifecycle of $5 private-owner listings per
 * `docs/SELL_FUNNEL_PLAN.md` Track E. Three independent passes:
 *
 *   1. Day-55 renewal reminder — find `listing_purchases` rows whose
 *      linked property is active and whose `expires_at` is within
 *      the next 5 days, and we haven't already emailed them
 *      (`renewal_reminder_sent_at IS NULL`). Send the reminder, then
 *      stamp the column to dedupe future runs.
 *
 *   2. Day-60 expiry — find active private-purchase properties whose
 *      `expires_at` has passed. UPDATE `status='expired'`, then for
 *      each linked `listing_purchases` row that still has
 *      `expired_email_sent_at IS NULL`, send the expired email and
 *      stamp the column.
 *
 *   3. Orphan reminder — find `listing_purchases` rows where
 *      `property_id IS NULL` (paid but never published), `paid_at`
 *      is 5–60 days old, and we haven't already emailed them
 *      (`unpublished_reminder_sent_at IS NULL`). Send the
 *      "finish your listing" nudge, then stamp the column.
 *
 * Auth: shared `checkCronAuth` helper. The standalone Worker in
 * `workers/listing-expiry/` is the prod scheduler (cron `0 4 * * *`
 * UTC daily — 30 min after `audit-prune`, 2 hours after
 * `ai-daily-rollup`, so the three night-time DB jobs don't pile up).
 *
 * CLAUDE.md note: every supabase-js call destructures `{ data, error }`
 * — supabase-js does NOT throw on row-level rejections. Every email
 * send is awaited (Edge runtime cancels unawaited promises after the
 * response is returned).
 */

interface ExpirySummary {
  ok: boolean;
  processed?: {
    /** Day-55 renewal reminders sent. */
    reminded: number;
    /** Day-60 listings flipped to expired (and emailed). */
    expired: number;
    /** Orphaned purchases nudged with "finish your listing". */
    orphans: number;
  };
  /** Per-bucket error counts — non-fatal; the cron continues past
   *  individual row failures so one bad row doesn't block the whole
   *  daily pass. */
  errors?: {
    reminded: number;
    expired: number;
    orphans: number;
  };
  errorCode?: string;
  errorMessage?: string;
}

type Locale = 'en' | 'es';

/** Pick the locale for an email based on the recipient's
 *  `preferred_language` profile setting. Marketing locales (PL / PT /
 *  DE / FR / IT) fall back to EN per the existing landing-page
 *  convention; the templates only render EN + ES handwritten copy. */
function pickEmailLocale(preferred: string | null | undefined): Locale {
  return preferred === 'es' ? 'es' : 'en';
}

/** Resolve the public URL for a listing, preferring the recipient's
 *  locale. Mirrors the pattern in `src/lib/listings/seo.ts`. */
function buildListingUrl(
  siteOrigin: string,
  locale: Locale,
  slugEn: string | null,
  slugEs: string | null,
  shortId: string,
): string {
  const slug = locale === 'es' ? slugEs ?? slugEn : slugEn ?? slugEs;
  if (!slug) {
    // No slug at all — fall back to the listings root. Shouldn't
    // happen for an `active` property (publish gates require a slug)
    // but defensive.
    return `${siteOrigin}/${locale}/properties`;
  }
  const pathRoot = locale === 'es' ? 'propiedades' : 'properties';
  return `${siteOrigin}/${locale}/${pathRoot}/${slug}-${shortId}`;
}

/** Resolve the locale-specific title for the listing. */
function pickTitle(
  locale: Locale,
  titleEn: string | null,
  titleEs: string | null,
): string {
  return (
    (locale === 'es' ? titleEs : titleEn) ??
    titleEn ??
    titleEs ??
    (locale === 'es' ? 'Tu anuncio' : 'Your listing')
  );
}

/** Localized URL for the renewal-redirect endpoint. The path is
 *  NOT localized (it's an API route, not a marketing page) — but
 *  the success/cancel pages it ultimately redirects to ARE locale-
 *  aware via the existing private-listing checkout helper. */
function buildRenewUrl(siteOrigin: string, propertyId: string): string {
  return `${siteOrigin}/api/sell/private/renew/${propertyId}`;
}

/** Localized URL for the upgrade upsell — points at /pricing in the
 *  recipient's locale. Marketing locales fall back to /en/pricing. */
function buildUpgradeUrl(siteOrigin: string, locale: Locale): string {
  return locale === 'es'
    ? `${siteOrigin}/es/precios`
    : `${siteOrigin}/en/pricing`;
}

/** Localized URL for /sell/private/new — the simplified create
 *  form. Used by the orphan-reminder email. */
function buildCreateUrl(siteOrigin: string, locale: Locale): string {
  return locale === 'es'
    ? `${siteOrigin}/es/vender/privado/nuevo`
    : `${siteOrigin}/en/sell/private/new`;
}

/** Stamp the idempotency column on a purchase row after a
 *  successful email send. Errors are logged but never rethrown —
 *  the worst case is the email gets sent again tomorrow, which is
 *  preferable to a half-stamped row that says we did but didn't. */
async function stampPurchase(
  admin: ReturnType<typeof createAdminClient>,
  purchaseId: string,
  column:
    | 'renewal_reminder_sent_at'
    | 'expired_email_sent_at'
    | 'unpublished_reminder_sent_at',
): Promise<void> {
  const { error } = await admin
    .from('listing_purchases')
    .update({ [column]: new Date().toISOString() })
    .eq('id', purchaseId);
  if (error) {
    console.error('[listing-expiry] stamp failed', {
      purchaseId,
      column,
      code: error.code,
      message: error.message,
    });
  }
}

interface RenewalRow {
  id: string;
  property_id: string;
  buyer_user_id: string;
  expires_at: string;
  property: {
    id: string;
    short_id: string;
    title_en: string | null;
    title_es: string | null;
    slug_en: string | null;
    slug_es: string | null;
    expires_at: string | null;
    status: string;
    published_via: string;
  } | null;
  buyer: {
    id: string;
    email: string;
    full_name: string | null;
    preferred_language: string | null;
  } | null;
}

/** Pass 1: day-55 renewal reminder. Returns (sent, errors). */
async function runRenewalReminders(
  admin: ReturnType<typeof createAdminClient>,
  siteOrigin: string,
): Promise<{ sent: number; errors: number }> {
  const now = new Date();
  const in5Days = new Date(now.getTime() + 5 * 24 * 3600 * 1000);

  // Active private-purchase properties expiring in the next 5 days,
  // joined with the linked purchase + buyer profile. We filter on
  // `renewal_reminder_sent_at IS NULL` so each purchase is reminded
  // at most once.
  const { data, error } = await admin
    .from('listing_purchases')
    .select(
      `
        id,
        property_id,
        buyer_user_id,
        expires_at,
        property:properties!inner(
          id, short_id,
          title_en, title_es,
          slug_en, slug_es,
          expires_at, status, published_via
        ),
        buyer:profiles!buyer_user_id(
          id, email, full_name, preferred_language
        )
      `,
    )
    .is('renewal_reminder_sent_at', null)
    .not('property_id', 'is', null)
    .eq('property.status', 'active')
    .eq('property.published_via', 'private_purchase')
    .gte('property.expires_at', now.toISOString())
    .lte('property.expires_at', in5Days.toISOString());

  if (error) {
    console.error('[listing-expiry] renewal query failed', {
      code: error.code,
      message: error.message,
    });
    return { sent: 0, errors: 1 };
  }

  const rows = (data ?? []) as unknown as RenewalRow[];
  let sent = 0;
  let errors = 0;

  for (const row of rows) {
    if (!row.property || !row.buyer) continue;
    const locale = pickEmailLocale(row.buyer.preferred_language);
    const title = pickTitle(locale, row.property.title_en, row.property.title_es);
    const propertyUrl = buildListingUrl(
      siteOrigin,
      locale,
      row.property.slug_en,
      row.property.slug_es,
      row.property.short_id,
    );
    const propertyExpiresAt = row.property.expires_at ?? row.expires_at;
    const msRemaining = new Date(propertyExpiresAt).getTime() - now.getTime();
    const daysRemaining = Math.max(1, Math.ceil(msRemaining / (24 * 3600 * 1000)));

    const { subject, html } = renderListingRenewalReminderEmail({
      buyerName: row.buyer.full_name,
      propertyTitle: title,
      propertyUrl,
      daysRemaining,
      renewUrl: buildRenewUrl(siteOrigin, row.property.id),
      upgradeUrl: buildUpgradeUrl(siteOrigin, locale),
      locale,
    });

    const result = await sendEmail({
      to: row.buyer.email,
      subject,
      html,
    });
    if (!result.sent) {
      console.error('[listing-expiry] renewal send failed', {
        purchaseId: row.id,
        error: result.error,
      });
      errors += 1;
      continue;
    }
    await stampPurchase(admin, row.id, 'renewal_reminder_sent_at');
    sent += 1;
  }

  return { sent, errors };
}

interface ExpiredRow {
  id: string;
  property_id: string;
  buyer_user_id: string;
  property: {
    id: string;
    short_id: string;
    title_en: string | null;
    title_es: string | null;
    slug_en: string | null;
    slug_es: string | null;
    expires_at: string | null;
    status: string;
    published_via: string;
  } | null;
  buyer: {
    id: string;
    email: string;
    full_name: string | null;
    preferred_language: string | null;
  } | null;
}

/** Pass 2: day-60 expiry. Flips active → expired and emails. */
async function runExpiries(
  admin: ReturnType<typeof createAdminClient>,
  siteOrigin: string,
): Promise<{ sent: number; errors: number }> {
  const now = new Date();

  // First — flip the status on every active private-purchase property
  // whose expires_at has passed. One bulk UPDATE is cleaner than a
  // per-row loop; the email pass below picks up the freshly-expired
  // rows by joining on `status='expired'` AND `expired_email_sent_at
  // IS NULL`.
  const { error: updateErr, data: updated } = await admin
    .from('properties')
    .update({ status: 'expired' })
    .eq('published_via', 'private_purchase')
    .eq('status', 'active')
    .lt('expires_at', now.toISOString())
    .select('id');
  if (updateErr) {
    console.error('[listing-expiry] expiry status update failed', {
      code: updateErr.code,
      message: updateErr.message,
    });
    return { sent: 0, errors: 1 };
  }
  const expiredPropertyIds = (updated ?? []).map((r) => r.id as string);
  // No newly-expired rows AND no prior-day un-emailed rows → bail.
  // We still need to scan for purchase rows that may have failed to
  // email yesterday, so don't short-circuit on `expiredPropertyIds`
  // alone.

  // Find purchase rows tied to ANY expired private-purchase property
  // (today's batch + any leftover from past runs that failed to send)
  // where the expired email hasn't been sent yet.
  const { data, error } = await admin
    .from('listing_purchases')
    .select(
      `
        id,
        property_id,
        buyer_user_id,
        property:properties!inner(
          id, short_id,
          title_en, title_es,
          slug_en, slug_es,
          expires_at, status, published_via
        ),
        buyer:profiles!buyer_user_id(
          id, email, full_name, preferred_language
        )
      `,
    )
    .is('expired_email_sent_at', null)
    .not('property_id', 'is', null)
    .eq('property.status', 'expired')
    .eq('property.published_via', 'private_purchase');

  if (error) {
    console.error('[listing-expiry] expired query failed', {
      code: error.code,
      message: error.message,
    });
    return { sent: 0, errors: 1 };
  }

  const rows = (data ?? []) as unknown as ExpiredRow[];
  let sent = 0;
  let errors = 0;

  for (const row of rows) {
    if (!row.property || !row.buyer) continue;
    const locale = pickEmailLocale(row.buyer.preferred_language);
    const title = pickTitle(locale, row.property.title_en, row.property.title_es);
    const propertyUrl = buildListingUrl(
      siteOrigin,
      locale,
      row.property.slug_en,
      row.property.slug_es,
      row.property.short_id,
    );
    const expiredAt = row.property.expires_at ?? new Date().toISOString();

    const { subject, html } = renderListingExpiredEmail({
      buyerName: row.buyer.full_name,
      propertyTitle: title,
      propertyUrl,
      expiredAt,
      reactivateUrl: buildRenewUrl(siteOrigin, row.property.id),
      upgradeUrl: buildUpgradeUrl(siteOrigin, locale),
      locale,
    });

    const result = await sendEmail({
      to: row.buyer.email,
      subject,
      html,
    });
    if (!result.sent) {
      console.error('[listing-expiry] expired send failed', {
        purchaseId: row.id,
        error: result.error,
      });
      errors += 1;
      continue;
    }
    await stampPurchase(admin, row.id, 'expired_email_sent_at');
    sent += 1;
  }

  return { sent, errors };
}

interface OrphanRow {
  id: string;
  buyer_user_id: string;
  paid_at: string;
  expires_at: string;
  property_id: string | null;
  buyer: {
    id: string;
    email: string;
    full_name: string | null;
    preferred_language: string | null;
  } | null;
}

/** Pass 3: orphaned-purchase nudges (paid but never published). */
async function runOrphans(
  admin: ReturnType<typeof createAdminClient>,
  siteOrigin: string,
): Promise<{ sent: number; errors: number }> {
  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
  // 60-day upper bound — past that, the purchase window has expired
  // and a nudge isn't actionable anyway. Belt-and-suspenders with
  // `paid_at > now() - interval '60 days'`.
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 3600 * 1000);

  const { data, error } = await admin
    .from('listing_purchases')
    .select(
      `
        id,
        buyer_user_id,
        paid_at,
        expires_at,
        property_id,
        buyer:profiles!buyer_user_id(
          id, email, full_name, preferred_language
        )
      `,
    )
    .is('property_id', null)
    .is('unpublished_reminder_sent_at', null)
    .is('refunded_at', null)
    .lt('paid_at', fiveDaysAgo.toISOString())
    .gt('paid_at', sixtyDaysAgo.toISOString());

  if (error) {
    console.error('[listing-expiry] orphan query failed', {
      code: error.code,
      message: error.message,
    });
    return { sent: 0, errors: 1 };
  }

  const rows = (data ?? []) as unknown as OrphanRow[];
  let sent = 0;
  let errors = 0;

  for (const row of rows) {
    if (!row.buyer) continue;
    const locale = pickEmailLocale(row.buyer.preferred_language);

    const { subject, html } = renderListingUnpublishedReminderEmail({
      buyerName: row.buyer.full_name,
      expiresAt: row.expires_at,
      createUrl: buildCreateUrl(siteOrigin, locale),
      locale,
    });

    const result = await sendEmail({
      to: row.buyer.email,
      subject,
      html,
    });
    if (!result.sent) {
      console.error('[listing-expiry] orphan send failed', {
        purchaseId: row.id,
        error: result.error,
      });
      errors += 1;
      continue;
    }
    await stampPurchase(admin, row.id, 'unpublished_reminder_sent_at');
    sent += 1;
  }

  return { sent, errors };
}

async function handle(req: NextRequest): Promise<NextResponse<ExpirySummary>> {
  const env = serverEnv();
  const auth = checkCronAuth({
    authorizationHeader: req.headers.get('authorization'),
    expectedSecret: env.CRON_SECRET,
  });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, errorCode: auth.errorCode },
      { status: auth.status },
    );
  }

  const admin = createAdminClient();
  const siteOrigin = publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  // Three independent passes — one bad pass doesn't kill the others.
  const renewal = await runRenewalReminders(admin, siteOrigin);
  const expired = await runExpiries(admin, siteOrigin);
  const orphans = await runOrphans(admin, siteOrigin);

  return NextResponse.json({
    ok: true,
    processed: {
      reminded: renewal.sent,
      expired: expired.sent,
      orphans: orphans.sent,
    },
    errors: {
      reminded: renewal.errors,
      expired: expired.errors,
      orphans: orphans.errors,
    },
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
