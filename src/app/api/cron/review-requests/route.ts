import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv, publicEnv } from '@/lib/env';
import { sendEmail } from '@/lib/email/brevo';
import { renderReviewVerificationEmail } from '@/lib/email/templates/review-verification';
import { generateVerificationToken, REVIEW_TOKEN_TTL_MS } from '@/lib/reviews/token';
import { narrowContentLocale, type Locale } from '@/i18n/config';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET / POST /api/cron/review-requests
 *
 * Daily cron — closes the loop on the post-sale review-request flow.
 *
 * Why this exists. The reviews flow itself (anyone can submit, email
 * token verifies, admin moderates → published) shipped in 0016. What
 * was missing is the *trigger* to actually nudge buyers toward writing
 * one. Without it, agents have to remember to ask each buyer; in
 * practice that meant ~zero reviews ever, which kills the cold-start
 * supply problem (an agent profile with zero reviews looks suspect to
 * the next buyer browsing it). This cron walks recently-sold listings
 * and emails the buyer the standard review-verification template,
 * pointing them at the agent's profile to write the review.
 *
 * Eligibility window. The hot SELECT picks listings where:
 *
 *   - status = 'sold' AND sold_date IS NOT NULL
 *   - sold_date >= now() - 90 days (don't email people about a sale
 *     they made three months ago — too late, churn risk, looks
 *     desperate)
 *   - sold_date <= now() - 14 days (give the deal-and-move-in dust a
 *     fortnight to settle before asking; emailing on close-day reads
 *     as transactional and gets ignored)
 *   - review_request_sent_at IS NULL (idempotent — once we've sent for
 *     a sale, we never re-send. Re-sends require admin SQL.)
 *
 * Schema. `properties.review_request_sent_at` + `review_request_recipient_email`
 * (migration 0041). Single timestamp column was chosen over a separate
 * `review_requests` table because v1 has at most one buyer per closing
 * (no multi-buyer support in the schema). Migration 0041 has the full
 * rationale.
 *
 * Buyer-email resolution. We don't capture the buyer's email at
 * close-time directly — `properties` has no `buyer_email` column. The
 * canonical source is the `leads` table: the buyer almost always
 * contacted the agent through a lead form on the listing detail page.
 * For each eligible sold listing we pick the most recent lead row
 * with a non-null `contact_email`. If no such lead exists (the agent
 * captured the buyer offline, or this listing never had a digital
 * lead), we SKIP that listing — we do NOT fabricate a recipient.
 * The listing's `review_request_sent_at` stays NULL so the agent (or
 * a future admin tool) can later supply the buyer's email manually.
 *
 * Token. We mint a `lib/reviews/token.ts` token and pass it on the
 * verifyUrl as `?req=<token>`. The agent profile page can use it
 * later (post-MVP) for click attribution / pre-filling the review
 * form. We deliberately do NOT pre-insert a `reviews` row — that
 * would violate CLAUDE.md hard rule #8 (no fake/seeded data) and
 * would diverge from the existing "user submits → row created" flow.
 *
 * Auth. Bearer-secret guard via `CRON_SECRET` env (shared with the
 * other crons — LinkedIn, Meta, photo-import retry). Both GET and
 * POST accept the same gate so an external scheduler can use either
 * verb. Missing env → 503; missing/wrong header → 401.
 *
 * Schedule. Once daily at `0 8 * * *` (08:00 UTC = 04:00 Santo
 * Domingo / 09:00 Madrid). Early-morning-local across launch markets
 * means the email lands in the recipient's morning inbox, well after
 * the previous day's settlement and before the workday starts.
 * Configure in the same external scheduler (GitHub Actions cron OR
 * Cloudflare Worker w/ cron triggers) that already drives the other
 * `/api/cron/*` routes.
 *
 * Service-role client. Reads + the writeback to
 * `review_request_sent_at` go through the admin client because the
 * cron is a system actor (no user context) and needs to scan across
 * orgs. RLS on `properties` doesn't expose other orgs' rows to user
 * context, so service-role is the right tool here.
 */

const ELIGIBILITY_MIN_DAYS = 14;
const ELIGIBILITY_MAX_DAYS = 90;

/**
 * Max work per invocation. Sized so the worst-case run (50 listings ×
 * one Brevo HTTP send per row, ~1s each) fits inside Cloudflare Pages'
 * Edge wall-time budget (~30s) with comfortable headroom.
 */
const BATCH_SIZE = 50;

/**
 * Eligible sold-listing row as the cron sees it. Kept narrow on
 * purpose so the unit test can drive the planner with plain literals.
 */
export interface EligibleListing {
  id: string;
  short_id: string;
  org_id: string;
  status: string;
  sold_date: string;
  review_request_sent_at: string | null;
  // For URL building (route-locale aware) + audit:
  title_en: string | null;
  title_es: string | null;
  city: string | null;
}

/**
 * Pure eligibility filter — given a batch of candidate rows + a
 * frozen `now`, return the subset the cron should email about.
 *
 * The SELECT itself filters by status + sold_date + review_request_sent_at,
 * but we re-apply here so:
 *   (a) the unit test can pin the decision matrix without spinning up
 *       Postgres, and
 *   (b) we're defensive against a row that shifts in/out of the
 *       window between SELECT and email-send.
 */
export function filterEligibleListings(args: {
  rows: ReadonlyArray<EligibleListing>;
  now: Date;
  minDays?: number;
  maxDays?: number;
}): EligibleListing[] {
  const minDays = args.minDays ?? ELIGIBILITY_MIN_DAYS;
  const maxDays = args.maxDays ?? ELIGIBILITY_MAX_DAYS;
  const nowMs = args.now.getTime();
  const oldestEligibleMs = nowMs - maxDays * 24 * 60 * 60 * 1000;
  const youngestEligibleMs = nowMs - minDays * 24 * 60 * 60 * 1000;

  return args.rows.filter((row) => {
    if (row.status !== 'sold') return false;
    if (row.review_request_sent_at !== null) return false;
    const soldMs = Date.parse(row.sold_date);
    if (!Number.isFinite(soldMs)) return false;
    // `>=` and `<=` for the inclusive window the spec calls out
    // ("closed >= 14 days ago AND <= 90 days ago").
    if (soldMs < oldestEligibleMs) return false;
    if (soldMs > youngestEligibleMs) return false;
    return true;
  });
}

interface CronSummary {
  ok: true;
  considered: number;
  emailed: number;
  skippedNoBuyerEmail: number;
  skippedAlreadySent: number;
  skippedOutOfWindow: number;
  emailFailures: number;
}

/**
 * Bearer-token guard. Returns null on success, a NextResponse on
 * failure. Same shape as the photo-import-retry cron's gate so all
 * `/api/cron/*` routes share one auth posture.
 */
function authorize(req: NextRequest): NextResponse | null {
  const expected = serverEnv().CRON_SECRET;
  if (!expected) {
    // Misconfiguration — fail closed. 401 (not 500) so the scheduler
    // logs an unauthorized + notice in monitoring rather than
    // retrying a 500.
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match || match[1] !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

/**
 * Look up the most-recent lead with a usable email for this listing.
 * The "most recent" tiebreaker keeps the cron predictable when an
 * agent re-engaged with the same buyer multiple times: the latest
 * captured email is the one we have most reason to trust.
 *
 * Returns null when no lead with a contact_email exists for the
 * listing — caller must skip (no fabricated recipients).
 */
async function findBuyerLead(
  supabase: ReturnType<typeof createAdminClient>,
  propertyId: string,
): Promise<{ email: string; name: string | null; language: string } | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('contact_email, contact_name, language')
    .eq('property_id', propertyId)
    .not('contact_email', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    contact_email: string | null;
    contact_name: string | null;
    language: string | null;
  };
  if (!row.contact_email) return null;
  return {
    email: row.contact_email,
    name: row.contact_name,
    language: row.language ?? 'en',
  };
}

/**
 * Look up the agent's display name for the email greeting. Falls
 * back through profile.full_name → org.name → "your AHO agent" so we
 * never render an empty placeholder in the email subject.
 */
async function findAgentDisplayName(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<string> {
  const { data: orgRow, error: orgErr } = await supabase
    .from('organizations')
    .select('name, slug')
    .eq('id', orgId)
    .maybeSingle();
  if (orgErr || !orgRow) return 'your AHO agent';
  const org = orgRow as { name: string | null };

  const { data: ownerRow } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  const ownerId = (ownerRow as { user_id?: string } | null)?.user_id;
  if (ownerId) {
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', ownerId)
      .maybeSingle();
    const fullName = (profileRow as { full_name?: string | null } | null)?.full_name;
    if (fullName && fullName.trim().length > 0) return fullName;
  }
  return org.name ?? 'your AHO agent';
}

/**
 * Look up the org slug for the email's verifyUrl.
 */
async function findAgentOrgSlug(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('public_slug, slug')
    .eq('id', orgId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { public_slug: string | null; slug: string };
  return row.public_slug ?? row.slug;
}

/**
 * Build the URL the buyer lands on when they click "Write a review"
 * in the email. Points at the agent's public profile (which already
 * embeds the write-review form via `components/reviews/reviews-section.tsx`)
 * with a `req` query param carrying the cron-issued token for future
 * click-attribution. The `property` query param pre-identifies the
 * listing so the form can pre-fill `property_id`.
 */
function buildVerifyUrl(args: {
  siteUrl: string;
  locale: 'en' | 'es';
  agentSlug: string;
  propertyShortId: string;
  token: string;
}): string {
  // ES uses /agentes; EN uses /agents. Mirrors the i18n pathnames map.
  const segment = args.locale === 'es' ? 'agentes' : 'agents';
  const u = new URL(
    `${args.siteUrl.replace(/\/$/, '')}/${args.locale}/${segment}/${args.agentSlug}`,
  );
  u.searchParams.set('req', args.token);
  u.searchParams.set('property', args.propertyShortId);
  return u.toString();
}

async function runSweep(): Promise<CronSummary> {
  const pub = publicEnv();
  const supabase = createAdminClient();

  const summary: CronSummary = {
    ok: true,
    considered: 0,
    emailed: 0,
    skippedNoBuyerEmail: 0,
    skippedAlreadySent: 0,
    skippedOutOfWindow: 0,
    emailFailures: 0,
  };

  const now = new Date();
  const oldest = new Date(now.getTime() - ELIGIBILITY_MAX_DAYS * 24 * 60 * 60 * 1000);
  const youngest = new Date(now.getTime() - ELIGIBILITY_MIN_DAYS * 24 * 60 * 60 * 1000);

  // The partial index `idx_properties_review_request_pending` (migration
  // 0041) covers exactly this filter — keeps the scan O(eligible) even
  // after years of accumulated sold inventory.
  const { data: rowsRaw, error: selErr } = await supabase
    .from('properties')
    .select(
      'id, short_id, org_id, status, sold_date, review_request_sent_at, title_en, title_es, city',
    )
    .eq('status', 'sold')
    .is('review_request_sent_at', null)
    .gte('sold_date', oldest.toISOString())
    .lte('sold_date', youngest.toISOString())
    .order('sold_date', { ascending: true })
    .limit(BATCH_SIZE);
  if (selErr) {
    console.warn(`[cron/review-requests] select failed: ${selErr.message}`);
    throw new Error('select_failed');
  }

  const rows = (rowsRaw ?? []) as EligibleListing[];
  // Re-filter locally — the SELECT is also covered by the planner so a
  // race that flips a row out of the window between SELECT and send
  // doesn't double-email. Defense-in-depth, cheap.
  const eligible = filterEligibleListings({ rows, now });
  summary.considered = rows.length;
  summary.skippedOutOfWindow = rows.length - eligible.length;

  for (const listing of eligible) {
    // Belt-and-suspenders re-check (concurrent flip via admin tool).
    if (listing.review_request_sent_at !== null) {
      summary.skippedAlreadySent += 1;
      continue;
    }

    const buyer = await findBuyerLead(supabase, listing.id);
    if (!buyer) {
      // No captured digital lead with an email for this sale. Per the
      // constraint set, do NOT fabricate a recipient — skip and leave
      // `review_request_sent_at` NULL so the row is still eligible if
      // an agent later attaches a lead manually.
      summary.skippedNoBuyerEmail += 1;
      continue;
    }

    const agentName = await findAgentDisplayName(supabase, listing.org_id);
    const agentSlug = await findAgentOrgSlug(supabase, listing.org_id);
    if (!agentSlug) {
      // Org row was deleted between the property SELECT and now (very
      // unlikely — `properties.org_id` has on delete restrict — but
      // defensive). Don't email; don't stamp; let the next run try
      // again once data integrity is restored.
      console.warn(
        `[cron/review-requests] agent slug not found for org ${listing.org_id}; skipping`,
      );
      summary.emailFailures += 1;
      continue;
    }

    const { token } = generateVerificationToken();
    const buyerLocale: Locale =
      buyer.language === 'es' ? 'es' : 'en';
    const verifyUrl = buildVerifyUrl({
      siteUrl: pub.NEXT_PUBLIC_SITE_URL,
      locale: buyerLocale,
      agentSlug,
      propertyShortId: listing.short_id,
      token,
    });

    const email = renderReviewVerificationEmail({
      reviewerName: buyer.name ?? (buyerLocale === 'es' ? 'Hola' : 'there'),
      agentName,
      locale: narrowContentLocale(buyerLocale),
      verifyUrl,
      expiresInHours: Math.floor(REVIEW_TOKEN_TTL_MS / (60 * 60 * 1000)),
    });

    const sent = await sendEmail({
      to: buyer.email,
      subject: email.subject,
      html: email.html,
    });

    if (!sent.sent) {
      // Email send failure does NOT stamp `review_request_sent_at` —
      // the row stays eligible so the next run retries. Brevo's
      // transient-failure rate is low, and double-email is worse than
      // double-attempt.
      summary.emailFailures += 1;
      console.warn(
        `[cron/review-requests] brevo send failed for property=${listing.id}; will retry next run`,
        { error: sent.error },
      );
      continue;
    }

    // Stamp the audit columns. Only after a successful send so retries
    // are cleanly idempotent. The row falls out of the partial index
    // immediately — no risk of being re-picked in the same batch.
    const { error: stampErr } = await supabase
      .from('properties')
      .update({
        review_request_sent_at: new Date().toISOString(),
        review_request_recipient_email: buyer.email,
      })
      .eq('id', listing.id)
      .is('review_request_sent_at', null); // optimistic concurrency guard

    if (stampErr) {
      // The email DID go out; the stamp failed. We log + count toward
      // failures so monitoring catches the divergence. Worst-case
      // outcome is a duplicate email next run (the row stays
      // eligible). Acceptable — losing the audit row is worse than a
      // single duplicate.
      console.warn(
        `[cron/review-requests] stamp failed for property=${listing.id} after send: ${stampErr.message}`,
      );
      summary.emailFailures += 1;
      continue;
    }

    summary.emailed += 1;
  }

  return summary;
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = authorize(req);
  if (denied) return denied;
  try {
    const summary = await runSweep();
    return NextResponse.json(summary, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Some schedulers (notably GitHub Actions running curl without -X POST)
// default to GET; accept both with the same auth gate to remove the
// footgun. Mirrors the photo-import-retry cron.
export async function GET(req: NextRequest): Promise<Response> {
  return POST(req);
}
