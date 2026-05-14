import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getCurrentUserOrgPlan,
  isOrgOnProAutomation,
} from '@/lib/billing/plan-gating';
import { serverEnv, publicEnv } from '@/lib/env';
import { localePath } from '@/i18n/routing';
import { LOCALES, type Locale } from '@/i18n/config';
import { getCountryName } from '@/lib/i18n/countries';
import { buildImageUrl } from '@/lib/listings/image-url';
import {
  pickFacebookPost,
  pickInstagramPost,
  pickLinkedInPost,
  IG_CAROUSEL_MAX,
  type PostInput,
} from '@/lib/social/post-formatter';
import {
  publishToFacebookPage,
  publishToInstagramBusiness,
  publishToLinkedIn,
  isRetryable,
  buildSupportRef,
  type PublishResult,
  type PublishErrorCode,
} from '@/lib/social/publish';

export const runtime = 'edge';

/**
 * POST /api/social/post
 *
 * Phase E of docs/SOCIAL_AUTOMATION_PLAN.md — the real one-click
 * "Share to my socials" handler that replaces the 501 stub. Composes
 * Phase B (DB tables) + Phase C (post formatter) + Phase D (publish
 * primitives) into a single sync fan-out endpoint.
 *
 * Flow:
 *   1. Auth + Pro Automation gate (org.current_plan_id check via
 *      isOrgOnProAutomation — frontend never decides, per CLAUDE.md
 *      hard rule #4).
 *   2. Validate property: RLS enforces ownership on the SELECT;
 *      status must be 'active' and published_at must not be null.
 *   3. List active connected accounts (FB Pages via 'page:{id}',
 *      IG Business via 'ig:{id}', LinkedIn via 'urn:li:...').
 *   4. Insert one social_posts row + N social_post_attempts(queued).
 *      Service-role client because neither table has a user-context
 *      INSERT policy by design (Phase B).
 *   5. For each attempt, in parallel:
 *      a. Mark status='posting' + started_at
 *      b. Decrypt the platform token via the service-role RPC
 *      c. Call the platform's publish primitive (Phase D)
 *      d. UPDATE the attempt row with the outcome
 *   6. Return per-attempt result. UI renders the success/failure
 *      panel from this (Phase F).
 *
 * Sync fan-out chosen over Cloudflare Queue per PO directive
 * 2026-05-13. FB + IG typically settle in 1-3s; LinkedIn (when wired)
 * adds another ~1s. Request total stays under 5s for FB+IG+LI.
 */

const BodySchema = z.object({
  propertyId: z.string().uuid(),
  locale: z.enum(LOCALES).default('en'),
  /** Optional subset of platforms. Defaults to all platforms the user
   *  has connected accounts for. */
  platforms: z
    .array(z.enum(['facebook', 'instagram', 'linkedin']))
    .optional(),
  /** Phase J — agent-edited caption overrides. Per platform; when
   *  present we bypass the deterministic formatter for that platform's
   *  prose. Plumbing (UTM-tagged link, imageUrl, LinkedIn title +
   *  description) stays formatter-derived. Caps mirror the formatter's
   *  internal caps so an agent's paste can never blow past Meta's
   *  platform ceilings. */
  overrides: z
    .object({
      facebook: z
        .object({ message: z.string().min(1).max(4000) })
        .optional(),
      instagram: z
        .object({ caption: z.string().min(1).max(2000) })
        .optional(),
      linkedin: z
        .object({ commentary: z.string().min(1).max(2800) })
        .optional(),
    })
    .partial()
    .optional(),
});

type TargetPlatform = 'facebook' | 'instagram' | 'linkedin';

interface ResolvedTarget {
  externalAccountId: string;
  displayName: string | null;
  platform: TargetPlatform;
  /** Subject of the SECURITY DEFINER decrypt RPC — 'meta' or 'linkedin'. */
  tokenPlatform: 'meta' | 'linkedin';
}

interface AttemptOutcome {
  platform: TargetPlatform;
  externalAccountId: string;
  displayName: string | null;
  status: 'succeeded' | 'failed' | 'skipped';
  externalPostId?: string;
  externalPostUrl?: string;
  errorCode?: PublishErrorCode;
  errorMessage?: string;
  isRetryable: boolean;
  /** Short, copyable error reference (e.g. "AHO-SP-IMG-a3f7b2c1") the
   *  agent pastes into an email to info@advertisehomes.online. Present
   *  only on non-succeeded attempts. Built server-side so the client
   *  doesn't need the ERROR_CODE_SHORT map. */
  supportRef?: string;
}

function categorizeStatus(
  result: PublishResult,
): 'succeeded' | 'failed' | 'skipped' {
  if (result.ok) return 'succeeded';
  // 'oauth_not_implemented' (LinkedIn until partner approval) and
  // 'image_required' (preflight) are not "failures" the user can fix
  // by retrying — they're skipped so the UI doesn't show a red X.
  if (
    result.errorCode === 'oauth_not_implemented' ||
    result.errorCode === 'image_required'
  ) {
    return 'skipped';
  }
  return 'failed';
}

export async function POST(req: NextRequest) {
  // -------- 1. Auth + Pro Automation gate --------
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }
  const userId = userResult.user.id;

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

  // -------- 2. Parse + validate body --------
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

  // -------- 3. Fetch property (RLS enforces ownership) --------
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
  // Defense-in-depth: RLS already enforced this, but cross-check that
  // the property's org matches the caller's org context. Catches the
  // case where the user belongs to multiple orgs and called from the
  // wrong one.
  if (property.org_id !== ctx.orgId) {
    return NextResponse.json(
      { ok: false, errorCode: 'cross_org' },
      { status: 403 },
    );
  }

  // -------- Derive listing content locale + canonical URL --------
  // Listings can be single-language (DECISIONS.md 2026-04-29 fallback
  // rule drop). Prefer the requested locale's variant; fall back to
  // the other if the requested side is empty.
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

  // -------- Resolve images, sorted primary-first --------
  // For FB + LinkedIn we use index 0 as the hero. For IG we use the
  // whole array — 1 photo = standard publish, 2-10 = carousel.
  // Clamp to IG_CAROUSEL_MAX at the DB query (defense-in-depth + the
  // formatter re-clamps).
  const { data: imgRows } = await supabase
    .from('property_images')
    .select('cf_image_id, r2_key, is_primary, position')
    .eq('property_id', property.id)
    .eq('upload_status', 'confirmed')
    // Primary first (boolean true sorts after false ascending), then
    // ascending position. We use a two-step order to guarantee the
    // is_primary photo lands at index 0 even if its position is not
    // 0 in the DB.
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true })
    .limit(IG_CAROUSEL_MAX);
  const imageUrls = (imgRows ?? [])
    .map((r) =>
      buildImageUrl({
        cfImageId: r.cf_image_id,
        r2Key: r.r2_key,
        variant: 'public',
      }),
    )
    .filter((u): u is string => !!u);

  const postInput: PostInput = {
    title,
    city: property.city,
    countryDisplay: getCountryName(property.country_code, contentLocale),
    priceCents: Number(property.price_cents),
    currency: property.currency,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms != null ? Number(property.bathrooms) : null,
    areaSqm: property.area_sqm != null ? Number(property.area_sqm) : null,
    url,
    ...(imageUrls.length > 0 ? { imageUrls } : {}),
    locale: contentLocale,
  };

  // -------- 4. List connected accounts via RLS (user reads own rows) --------
  const { data: tokens } = await supabase
    .from('ad_platform_tokens')
    .select('id, platform, external_account_id, display_name')
    .eq('user_id', userId)
    .is('revoked_at', null);

  const targets: ResolvedTarget[] = [];
  for (const t of tokens ?? []) {
    if (t.platform === 'meta') {
      if (t.external_account_id.startsWith('page:')) {
        targets.push({
          externalAccountId: t.external_account_id,
          displayName: t.display_name,
          platform: 'facebook',
          tokenPlatform: 'meta',
        });
      } else if (t.external_account_id.startsWith('ig:')) {
        targets.push({
          externalAccountId: t.external_account_id,
          displayName: t.display_name,
          platform: 'instagram',
          tokenPlatform: 'meta',
        });
      }
      // Skip the user-level Meta token row — it's not a publish target.
    } else if (t.platform === 'linkedin') {
      targets.push({
        externalAccountId: t.external_account_id,
        displayName: t.display_name,
        platform: 'linkedin',
        tokenPlatform: 'linkedin',
      });
    }
  }

  // Optional platform filter.
  const requestedSet = body.platforms ? new Set(body.platforms) : null;
  const filteredTargets = requestedSet
    ? targets.filter((t) => requestedSet.has(t.platform))
    : targets;

  if (filteredTargets.length === 0) {
    return NextResponse.json(
      { ok: false, errorCode: 'no_connected_accounts' },
      { status: 400 },
    );
  }

  // -------- 5. Persist social_posts + queued attempts (service-role) --------
  const admin = createAdminClient();
  const requestedPlatforms = Array.from(
    new Set(filteredTargets.map((t) => t.platform)),
  );

  const { data: socialPost, error: spErr } = await admin
    .from('social_posts')
    .insert({
      property_id: property.id,
      org_id: ctx.orgId,
      user_id: userId,
      requested_platforms: requestedPlatforms,
    })
    .select('id')
    .single();
  if (spErr || !socialPost) {
    console.error('[/api/social/post] failed to insert social_posts', spErr);
    return NextResponse.json(
      { ok: false, errorCode: 'persist_failed' },
      { status: 500 },
    );
  }
  const socialPostId = socialPost.id as string;

  const attemptInserts = filteredTargets.map((t) => ({
    social_post_id: socialPostId,
    platform: t.platform,
    external_account_id: t.externalAccountId,
    status: 'queued',
  }));
  const { data: attemptRows, error: attErr } = await admin
    .from('social_post_attempts')
    .insert(attemptInserts)
    .select('id, external_account_id');
  if (attErr || !attemptRows) {
    console.error('[/api/social/post] failed to insert attempts', attErr);
    return NextResponse.json(
      { ok: false, errorCode: 'persist_failed' },
      { status: 500 },
    );
  }
  const attemptIdByAccount = new Map<string, string>(
    attemptRows.map((r) => [r.external_account_id as string, r.id as string]),
  );

  const env = serverEnv();
  if (!env.AHO_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json(
      { ok: false, errorCode: 'token_key_not_configured' },
      { status: 503 },
    );
  }
  const tokenKey = env.AHO_TOKEN_ENCRYPTION_KEY;

  // -------- 6. Fan out in parallel --------
  const settled = await Promise.allSettled(
    filteredTargets.map(async (t): Promise<{ target: ResolvedTarget; result: PublishResult }> => {
      const attemptId = attemptIdByAccount.get(t.externalAccountId);
      if (!attemptId) {
        // Defensive — should be impossible since we just inserted.
        return {
          target: t,
          result: {
            ok: false,
            errorCode: 'unknown',
            errorMessage: 'attempt row missing from id map',
          },
        };
      }
      const startedAt = new Date().toISOString();
      await admin
        .from('social_post_attempts')
        .update({ status: 'posting', started_at: startedAt })
        .eq('id', attemptId);

      const { data: tokenPlain, error: tokenErr } = await admin.rpc(
        'get_decrypted_access_token',
        {
          p_user_id: userId,
          p_platform: t.tokenPlatform,
          p_external_account_id: t.externalAccountId,
          p_key: tokenKey,
        },
      );
      if (tokenErr || !tokenPlain) {
        const finishedAt = new Date().toISOString();
        const update = {
          status: 'failed',
          error_code: 'token_invalid',
          error_message: tokenErr?.message ?? 'decrypt returned null',
          finished_at: finishedAt,
        };
        await admin.from('social_post_attempts').update(update).eq('id', attemptId);
        return {
          target: t,
          result: {
            ok: false,
            errorCode: 'token_invalid',
            errorMessage: update.error_message,
          },
        };
      }

      // Determine whether the agent's edited text is being used for
      // this platform (Phase J). Recorded in social_post_attempts.used_override
      // for telemetry + support triage.
      const platformOverride =
        t.platform === 'facebook'
          ? body.overrides?.facebook
          : t.platform === 'instagram'
            ? body.overrides?.instagram
            : t.platform === 'linkedin'
              ? body.overrides?.linkedin
              : undefined;
      const usedOverride = platformOverride != null;

      let result: PublishResult;
      try {
        if (t.platform === 'facebook') {
          const pageId = t.externalAccountId.slice('page:'.length);
          result = await publishToFacebookPage({
            pageId,
            pageToken: tokenPlain as string,
            post: pickFacebookPost(postInput, body.overrides?.facebook),
          });
        } else if (t.platform === 'instagram') {
          if (!postInput.imageUrls || postInput.imageUrls.length === 0) {
            result = {
              ok: false,
              errorCode: 'image_required',
              errorMessage: 'Listing has no confirmed images — IG publish skipped',
            };
          } else {
            const igId = t.externalAccountId.slice('ig:'.length);
            result = await publishToInstagramBusiness({
              igId,
              pageToken: tokenPlain as string,
              post: pickInstagramPost(postInput, body.overrides?.instagram),
            });
          }
        } else {
          // LinkedIn — Phase D stub returns oauth_not_implemented.
          result = await publishToLinkedIn({
            authorUrn: t.externalAccountId,
            accessToken: tokenPlain as string,
            post: pickLinkedInPost(postInput, body.overrides?.linkedin),
          });
        }
      } catch (err) {
        result = {
          ok: false,
          errorCode: 'unknown',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }

      const status = categorizeStatus(result);
      const finishedAt = new Date().toISOString();
      const update =
        status === 'succeeded'
          ? {
              status,
              external_post_id: result.externalPostId ?? null,
              external_post_url: result.externalPostUrl ?? null,
              finished_at: finishedAt,
              used_override: usedOverride,
            }
          : {
              status,
              error_code: result.errorCode ?? 'unknown',
              error_message: result.errorMessage ?? null,
              finished_at: finishedAt,
              used_override: usedOverride,
            };
      await admin.from('social_post_attempts').update(update).eq('id', attemptId);
      return { target: t, result };
    }),
  );

  const attempts: AttemptOutcome[] = settled.map((s, idx) => {
    const t = filteredTargets[idx]!;
    const attemptId = attemptIdByAccount.get(t.externalAccountId);
    if (s.status === 'rejected') {
      // Promise rejected outside the inner try/catch — shouldn't
      // happen because we catch inside, but if it does we mark
      // failed-retryable so the UI offers a retry.
      const message =
        s.reason instanceof Error ? s.reason.message : String(s.reason);
      return {
        platform: t.platform,
        externalAccountId: t.externalAccountId,
        displayName: t.displayName,
        status: 'failed',
        errorCode: 'unknown',
        errorMessage: message,
        isRetryable: true,
        ...(attemptId ? { supportRef: buildSupportRef('unknown', attemptId) } : {}),
      };
    }
    const { result } = s.value;
    const status = categorizeStatus(result);
    // Support reference only on non-succeeded outcomes — agents copy
    // it into a support email when they need help.
    const supportRef =
      status !== 'succeeded' && attemptId
        ? buildSupportRef(result.errorCode, attemptId)
        : undefined;
    return {
      platform: t.platform,
      externalAccountId: t.externalAccountId,
      displayName: t.displayName,
      status,
      ...(result.externalPostId ? { externalPostId: result.externalPostId } : {}),
      ...(result.externalPostUrl ? { externalPostUrl: result.externalPostUrl } : {}),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      isRetryable: result.errorCode ? isRetryable(result.errorCode) : false,
      ...(supportRef ? { supportRef } : {}),
    };
  });

  return NextResponse.json({
    ok: true,
    socialPostId,
    attempts,
  });
}
