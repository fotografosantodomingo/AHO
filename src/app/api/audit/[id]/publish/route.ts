import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import type { ImportedFacts } from '@/lib/listings/import-from-url';
import type { DrafterResult } from '@/lib/social/ai-drafter';
import {
  publishToFacebookPage,
  publishToInstagramBusiness,
  publishToLinkedIn,
  type PublishResult,
} from '@/lib/social/publish';

export const runtime = 'edge';

/**
 * POST /api/audit/[id]/publish
 *
 * Phase 3 of docs/SUPER_PRO_STAGE_1_PLAN.md — atomic publish from the
 * preview screen. Body:
 *   { selections: [{ locale: 'en'|'es'|'pl', platform: 'facebook'|'instagram'|'linkedin' }] }
 *
 * Ownership rule:
 *   - audit must be claimed (claimed_by_user_id IS NOT NULL)
 *   - claimed_by_user_id must equal the requester
 *   - if the audit is unclaimed AND the requester is authed, the
 *     /preview server action already stamped the claim on page-load;
 *     by the time this POST runs the claim is in place
 *
 * Per cell we:
 *   1. Look up the user's appropriate token row (FB Page / IG / LinkedIn)
 *   2. Decrypt via get_decrypted_access_token RPC
 *   3. Build the platform-specific Post payload from the audit's drafts +
 *      facts (caption + photo URL + source URL for the link card)
 *   4. Call the publish primitive (already-shipped, battle-tested code)
 *   5. Append a result entry to ai_audits.published_results JSONB
 *
 * Errors:
 *   - 401 unauthenticated
 *   - 403 not-claimer (the audit isn't yours)
 *   - 404 audit not found / no token for platform
 *   - 422 missing data (no captions yet, no photos)
 *   - 200 with per-cell ok/error array (partial-success semantics)
 *
 * Why 200 with per-cell results vs 4xx on the first failure: the agent
 * checked 6 cells, IG failed because their IG isn't linked yet, FB
 * succeeded — they need to see "4 of 6 published, 2 failed (reason)"
 * and not a generic "publish failed."
 */

const BodySchema = z.object({
  selections: z
    .array(
      z.object({
        locale: z.enum(['en', 'es', 'pl']),
        platform: z.enum(['facebook', 'instagram', 'linkedin']),
      }),
    )
    .min(1)
    .max(9),
});

type Locale = 'en' | 'es' | 'pl';
type Platform = 'facebook' | 'instagram' | 'linkedin';

interface PublishedResult {
  locale: Locale;
  platform: Platform;
  ok: boolean;
  external_post_id?: string;
  external_post_url?: string;
  error_code?: string;
  error_message?: string;
  attempted_at: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: auditId } = await ctx.params;

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'invalid_input', hint: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const env = serverEnv();
  if (!env.AHO_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json(
      { ok: false, error: 'token_key_not_configured' },
      { status: 503 },
    );
  }

  // Load audit + assert ownership. Public SELECT policy lets anyone
  // read the row, so we still need an explicit owner check here.
  const admin = createAdminClient();
  const { data: audit } = await admin
    .from('ai_audits')
    .select('id, source_url, facts, drafts, claimed_by_user_id, published_results')
    .eq('id', auditId)
    .maybeSingle();
  if (!audit) {
    return NextResponse.json({ ok: false, error: 'audit_not_found' }, { status: 404 });
  }
  if (audit.claimed_by_user_id && audit.claimed_by_user_id !== userId) {
    return NextResponse.json({ ok: false, error: 'not_owner' }, { status: 403 });
  }
  // Self-heal: if the audit is unclaimed at this point, the page-load
  // claim flow didn't run (direct API hit, or user signed in between
  // page render and click). Stamp now.
  if (!audit.claimed_by_user_id) {
    await admin
      .from('ai_audits')
      .update({ claimed_by_user_id: userId, claimed_at: new Date().toISOString() })
      .eq('id', auditId);
  }

  // Capture before the closure forest below — TS's flow narrowing
  // doesn't carry the `audit !== null` check across async lambdas.
  const sourceUrl = audit.source_url as string;
  const facts = audit.facts as ImportedFacts;
  const drafts = audit.drafts as Record<Locale, DrafterResult>;
  const photoUrls = (facts.photoUrls ?? []).filter(
    (u) => typeof u === 'string' && u.startsWith('https://'),
  );
  const heroPhoto = photoUrls[0] ?? null;

  // Pre-load the user's tokens once; pick per-platform per-call.
  const { data: tokenRows } = await admin
    .from('ad_platform_tokens')
    .select('id, platform, external_account_id, display_name')
    .eq('user_id', userId)
    .is('revoked_at', null);
  const tokens = tokenRows ?? [];
  const fbPageToken = tokens.find((t) => t.platform === 'meta' && t.external_account_id.startsWith('page:'));
  const igToken = tokens.find((t) => t.platform === 'meta' && t.external_account_id.startsWith('ig:'));
  const linkedInToken = tokens.find((t) => t.platform === 'linkedin');

  async function decrypt(externalAccountId: string, platform: 'meta' | 'linkedin'): Promise<string | null> {
    const { data } = await admin.rpc('get_decrypted_access_token', {
      p_user_id: userId,
      p_platform: platform,
      p_external_account_id: externalAccountId,
      p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
    });
    return (data as string | null) ?? null;
  }

  // UTM-tagged listing URL — agents need to track which clicks came
  // from the AHO-generated posts vs other channels.
  function utmUrl(source: string): string {
    try {
      const u = new URL(sourceUrl);
      u.searchParams.set('utm_source', source);
      u.searchParams.set('utm_medium', 'social');
      u.searchParams.set('utm_campaign', 'aho_audit');
      return u.toString();
    } catch {
      return sourceUrl;
    }
  }

  // Build the per-cell publish task list and execute in parallel.
  // Each task is fully self-contained — token decrypt, payload build,
  // primitive call, result shape. Errors are categorized into the
  // returned object; never thrown.
  const tasks: Array<() => Promise<PublishedResult>> = body.selections.map(({ locale, platform }) => async () => {
    const baseResult: Pick<PublishedResult, 'locale' | 'platform' | 'attempted_at'> = {
      locale,
      platform,
      attempted_at: new Date().toISOString(),
    };
    const draftBundle = drafts[locale];
    const titleForLink =
      (locale === 'es' ? facts.titleEs : facts.titleEn) ??
      facts.titleEn ??
      facts.titleEs ??
      'Listing';
    const descForLink =
      (locale === 'es' ? facts.descriptionEs : facts.descriptionEn) ??
      facts.descriptionEn ??
      facts.descriptionEs ??
      '';

    function err(code: string, message: string): PublishedResult {
      return { ...baseResult, ok: false, error_code: code, error_message: message };
    }
    function fromPublishResult(r: PublishResult): PublishedResult {
      return {
        ...baseResult,
        ok: r.ok,
        external_post_id: r.externalPostId,
        external_post_url: r.externalPostUrl,
        error_code: r.errorCode,
        error_message: r.errorMessage,
      };
    }

    if (platform === 'facebook') {
      const message = draftBundle?.drafts?.facebook?.message;
      if (!message) return err('no_caption', 'No AI-drafted caption for this locale × platform');
      if (!fbPageToken) return err('no_token', 'Connect a Facebook Page on /dashboard/social first');
      const tokenPlain = await decrypt(fbPageToken.external_account_id, 'meta');
      if (!tokenPlain) return err('token_invalid', 'Could not decrypt the Facebook Page token');
      const pageId = fbPageToken.external_account_id.slice('page:'.length);
      const r = await publishToFacebookPage({
        pageId,
        pageToken: tokenPlain,
        post: {
          message,
          link: utmUrl('facebook'),
          imageUrl: heroPhoto ?? undefined,
        },
      });
      return fromPublishResult(r);
    }

    if (platform === 'instagram') {
      const caption = draftBundle?.drafts?.instagram?.caption;
      if (!caption) return err('no_caption', 'No AI-drafted caption for this locale × platform');
      if (!igToken) return err('no_token', 'Link an Instagram Business account to a Facebook Page first');
      if (photoUrls.length === 0) {
        return err('image_required', 'Instagram requires at least one photo from the source listing');
      }
      const tokenPlain = await decrypt(igToken.external_account_id, 'meta');
      if (!tokenPlain) return err('token_invalid', 'Could not decrypt the Instagram token');
      const igId = igToken.external_account_id.slice('ig:'.length);
      const r = await publishToInstagramBusiness({
        igId,
        pageToken: tokenPlain,
        post: { caption, imageUrls: photoUrls.slice(0, 10) },
      });
      return fromPublishResult(r);
    }

    // linkedin
    const li = draftBundle?.drafts?.linkedin;
    if (!li?.commentary) return err('no_caption', 'No AI-drafted caption for this locale × platform');
    if (!linkedInToken) return err('no_token', 'Connect your LinkedIn profile on /dashboard/social first');
    const tokenPlain = await decrypt(linkedInToken.external_account_id, 'linkedin');
    if (!tokenPlain) return err('token_invalid', 'Could not decrypt the LinkedIn token');
    const authorUrn = `urn:li:person:${linkedInToken.external_account_id}`;
    const r = await publishToLinkedIn({
      authorUrn,
      accessToken: tokenPlain,
      post: {
        commentary: li.commentary,
        contentUrl: utmUrl('linkedin'),
        contentTitle: li.contentTitle || titleForLink,
        contentDescription: li.contentDescription || descForLink.slice(0, 200),
        contentThumbnailUrl: heroPhoto ?? undefined,
      },
    });
    return fromPublishResult(r);
  });

  const results = await Promise.all(tasks.map((t) => t()));

  // Append to ai_audits.published_results. JSONB array concat — we
  // never overwrite prior attempts, so a re-publish of the same cell
  // adds a second entry. The preview UI shows the latest per cell.
  const existing = (audit.published_results as PublishedResult[] | null) ?? [];
  const merged = [...existing, ...results];
  await admin
    .from('ai_audits')
    .update({ published_results: merged })
    .eq('id', auditId);

  return NextResponse.json({ ok: true, results });
}
