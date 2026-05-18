import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv, publicEnv } from '@/lib/env';
import { checkCronAuth } from '@/app/api/cron/meta-insights/route';
import {
  renderAiWeeklyDigestEmail,
  type DigestTopConversation,
} from '@/lib/email/templates/ai-weekly-digest';
import { sendEmail } from '@/lib/email/brevo';

export const runtime = 'edge';

/**
 * GET /api/cron/ai-weekly-digest
 *
 * Phase 4 of `docs/AI_CONVERSION_PLAN.md`. Fired by
 * `workers/ai-weekly-digest/` every Monday at 09:00 UTC. For each org
 * with ≥1 conversation in the past 7 days, sends a digest to the org
 * owner (lowest `organization_members.joined_at`).
 *
 * Empty orgs get nothing — the "zero conversations → guilt-trip email"
 * footgun is closed by checking `sum(conversations) > 0` before
 * building the digest. See R5 in `docs/AI_CONVERSION_PLAN.md`.
 *
 * Auth: bearer token via `checkCronAuth` against `CRON_SECRET`.
 *
 * Manual back-fill: pass `?dryRun=1` to compute + return the per-org
 * digest payloads WITHOUT sending. Useful when debugging template
 * regressions before pushing.
 */

interface DigestSummary {
  ok: boolean;
  orgsConsidered?: number;
  emailsSent?: number;
  emailsSkippedZero?: number;
  emailsFailed?: number;
  dryRun?: boolean;
  payloads?: Array<{
    orgId: string;
    to: string;
    subject: string;
  }>;
  errorCode?: string;
  errorMessage?: string;
}

// Locale → AI-inbox path. Mirrors the localized PATHNAMES entry for
// '/dashboard/ai-inbox' in `src/i18n/config.ts`. Duplicated here as a
// pure map because the cron route can't reach into the next-intl
// runtime helpers (no request context).
const INBOX_PATH_BY_LOCALE: Record<'en' | 'es', string> = {
  en: '/dashboard/ai-inbox',
  es: '/panel/bandeja-ia',
};

/** Map a profile's `preferred_language` to one of the digest's
 *  supported locales. Marketing-only languages (pl/pt/de/fr/it) fall
 *  back to English — the digest template only ships EN + ES copy. */
function resolveDigestLocale(
  preferredLanguage: string | null | undefined,
): 'en' | 'es' {
  return preferredLanguage === 'es' ? 'es' : 'en';
}

async function handle(req: NextRequest): Promise<NextResponse<DigestSummary>> {
  const env = serverEnv();
  const pub = publicEnv();
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

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';

  const admin = createAdminClient();

  // Window = last 7 days, ending at "now". The rollup runs at 02:00
  // UTC; this cron runs at 09:00 UTC so yesterday's rollup is fresh.
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoIso = weekAgo.toISOString().slice(0, 10);

  // Pull the per-org agg from `ai_daily_stats`. The `agent_id IS NULL`
  // rows hold the org-level totals (see migration 0072 comment).
  const { data: statsRows, error: statsErr } = await admin
    .from('ai_daily_stats')
    .select(
      'org_id, conversations, leads_captured, viewings_booked, agent_id, day',
    )
    .gte('day', weekAgoIso)
    .is('agent_id', null);
  if (statsErr) {
    console.error('[ai-weekly-digest] stats fetch error', {
      code: statsErr.code,
      message: statsErr.message,
    });
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'stats_fetch_failed',
        errorMessage: statsErr.message,
      },
      { status: 500 },
    );
  }

  // Aggregate the per-day rows into per-org totals.
  interface OrgTotals {
    conversations: number;
    leadsCaptured: number;
    viewingsBooked: number;
  }
  const perOrg = new Map<string, OrgTotals>();
  for (const row of statsRows ?? []) {
    const totals = perOrg.get(row.org_id) ?? {
      conversations: 0,
      leadsCaptured: 0,
      viewingsBooked: 0,
    };
    totals.conversations += row.conversations ?? 0;
    totals.leadsCaptured += row.leads_captured ?? 0;
    totals.viewingsBooked += row.viewings_booked ?? 0;
    perOrg.set(row.org_id, totals);
  }

  const orgsConsidered = perOrg.size;
  let emailsSent = 0;
  let emailsSkippedZero = 0;
  let emailsFailed = 0;
  const payloads: NonNullable<DigestSummary['payloads']> = [];

  // Filter out the test-fixture orgs (R11 — RLS fixture orgs share the
  // prod Supabase project). The fixture slug pattern is `aho-test-org-*`.
  const candidateOrgIds = Array.from(perOrg.keys());
  if (candidateOrgIds.length === 0) {
    return NextResponse.json({
      ok: true,
      orgsConsidered: 0,
      emailsSent: 0,
      emailsSkippedZero: 0,
      emailsFailed: 0,
    });
  }

  const { data: orgs, error: orgsErr } = await admin
    .from('organizations')
    .select('id, name, slug, headquarters_country')
    .in('id', candidateOrgIds)
    .not('slug', 'like', 'aho-test-org-%');
  if (orgsErr) {
    console.error('[ai-weekly-digest] orgs fetch error', {
      code: orgsErr.code,
      message: orgsErr.message,
    });
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'orgs_fetch_failed',
        errorMessage: orgsErr.message,
      },
      { status: 500 },
    );
  }

  for (const org of orgs ?? []) {
    const totals = perOrg.get(org.id);
    if (!totals) continue;

    // Defense in depth on the test-fixture filter — even though the
    // SQL filter above already excluded them, the in-loop check makes
    // a future column-shape change less likely to leak fixture orgs
    // into a real send.
    if (org.slug && org.slug.startsWith('aho-test-org-')) continue;

    if (totals.conversations === 0) {
      // Zero-activity orgs get nothing. The plan's R5 rule.
      emailsSkippedZero++;
      continue;
    }

    // Owner = lowest `joined_at` member of this org. NULL joined_at
    // sorts last in PG so it can't outrank a real joined-at date.
    const { data: ownerRow, error: ownerErr } = await admin
      .from('organization_members')
      .select('user_id, joined_at')
      .eq('org_id', org.id)
      .order('joined_at', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (ownerErr || !ownerRow) {
      if (ownerErr) {
        console.error('[ai-weekly-digest] owner lookup error', {
          orgId: org.id,
          code: ownerErr.code,
          message: ownerErr.message,
        });
      }
      emailsFailed++;
      continue;
    }

    const { data: ownerProfile, error: profileErr } = await admin
      .from('profiles')
      .select('email, full_name, preferred_language')
      .eq('id', ownerRow.user_id)
      .maybeSingle();
    if (profileErr || !ownerProfile?.email) {
      if (profileErr) {
        console.error('[ai-weekly-digest] owner profile error', {
          orgId: org.id,
          code: profileErr.code,
          message: profileErr.message,
        });
      }
      emailsFailed++;
      continue;
    }

    // Top 3 conversations of the week — join through to the first
    // user-role message + the listing title (if any). One query per
    // org keeps the round-trip count manageable; orgs with zero
    // conversations are already filtered out above.
    const topConversations: DigestTopConversation[] = [];
    const { data: convs } = await admin
      .from('ai_conversations')
      .select(
        'id, first_message_at, property_id, properties:property_id(title_en, title_es)',
      )
      .eq('org_id', org.id)
      .gte('first_message_at', weekAgo.toISOString())
      .order('first_message_at', { ascending: false })
      .limit(3);

    for (const conv of convs ?? []) {
      const { data: firstUserMsg } = await admin
        .from('ai_conversation_messages')
        .select('body')
        .eq('conversation_id', conv.id)
        .eq('role', 'user')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!firstUserMsg?.body) continue;
      // `properties` is a typed-as-object join when `?single` joining;
      // supabase-js returns the joined row inline. Cast loosely; the
      // template handles null.
      const property = (conv as unknown as { properties?: { title_en?: string | null; title_es?: string | null } | null }).properties ?? null;
      const locale = resolveDigestLocale(ownerProfile.preferred_language);
      const listingTitle =
        (locale === 'es' ? property?.title_es : property?.title_en) ??
        property?.title_en ??
        property?.title_es ??
        null;
      topConversations.push({
        buyerOpeningMessage: firstUserMsg.body,
        listingTitle,
      });
    }

    const locale = resolveDigestLocale(ownerProfile.preferred_language);
    const inboxUrl = `${pub.NEXT_PUBLIC_SITE_URL}/${locale}${INBOX_PATH_BY_LOCALE[locale]}`;

    const { subject, html, text } = renderAiWeeklyDigestEmail({
      agentName: ownerProfile.full_name ?? null,
      conversations: totals.conversations,
      leadsCaptured: totals.leadsCaptured,
      viewingsBooked: totals.viewingsBooked,
      topConversations,
      inboxUrl,
      locale,
    });

    if (dryRun) {
      payloads.push({ orgId: org.id, to: ownerProfile.email, subject });
      continue;
    }

    const result = await sendEmail({
      to: ownerProfile.email,
      subject,
      html,
      text,
    });
    if (result.sent) {
      emailsSent++;
    } else {
      emailsFailed++;
      console.error('[ai-weekly-digest] send failed', {
        orgId: org.id,
        to: ownerProfile.email,
        error: result.error,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    orgsConsidered,
    emailsSent,
    emailsSkippedZero,
    emailsFailed,
    ...(dryRun ? { dryRun: true, payloads } : {}),
  });
}

export async function GET(req: NextRequest): Promise<NextResponse<DigestSummary>> {
  return handle(req);
}
