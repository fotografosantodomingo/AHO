import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  publishToFacebookPage,
  publishToInstagramBusiness,
  publishToLinkedIn,
  type PublishResult,
} from '@/lib/social/publish';

/**
 * Programmatic SEO blog distribution. Called by /api/cron/blog-publish
 * AFTER the row lands in `blog_posts(status='published')`. Iterates
 * the admin user's connected social tokens and publishes a short
 * link-card post per channel (Facebook Page + LinkedIn). Returns
 * one DistributionEntry per attempt — stamped into
 * `blog_posts.distribution` JSONB so the success email + future
 * /admin UI can show what landed where.
 *
 * Why FB + LinkedIn (and not IG):
 *   - Facebook Page: `publishToFacebookPage` posts to `/feed` with a
 *     link, FB auto-renders the article preview card. No image needed.
 *   - LinkedIn: `publishToLinkedIn` posts text + content URL, LinkedIn
 *     renders the article card. No image needed.
 *   - Instagram REQUIRES a hero image (IG API rejects image-less posts).
 *     Blog v1 doesn't ship hero images; IG distribution lands when the
 *     image-generation pass ships.
 *
 * Token decrypt: uses the same `get_decrypted_access_token` RPC the
 * /api/social/post route uses. Admin token encryption key comes from
 * `AHO_TOKEN_ENCRYPTION_KEY` env (server-only).
 *
 * Caller behavior on failure: distribute() NEVER throws. Failures
 * fold into `DistributionEntry.status='failed'` so the cron route's
 * happy path (the blog post is already published) doesn't get
 * rolled back when a social channel hiccups.
 */

export type DistributionChannel = 'facebook' | 'linkedin' | 'instagram';

export interface DistributionEntry {
  channel: DistributionChannel;
  status: 'queued' | 'posted' | 'failed' | 'skipped';
  /** External platform post id (e.g. fb post id, linkedin urn).
   *  Present on `status='posted'`. */
  external_id?: string;
  /** Public URL to the live external post. Present on `status='posted'`. */
  external_url?: string;
  /** Categorized error code from publish.ts when status='failed'. */
  error_code?: string;
  /** Human-readable error message. */
  error?: string;
  /** Reason for skip when status='skipped' (e.g. 'no_token'). */
  skip_reason?: string;
  /** ISO timestamp the attempt finished. */
  at: string;
}

interface AdPlatformTokenRow {
  id: string;
  user_id: string;
  platform: 'meta' | 'linkedin';
  external_account_id: string;
  display_name: string | null;
}

interface DistributeArgs {
  admin: SupabaseClient;
  /** The post that just landed in `blog_posts`. */
  post: {
    title: string;
    summary: string;
    publicUrl: string;
    /** Public HTTPS URL of the hero image. Served by the per-slug
     *  opengraph-image.tsx route (Satori-rendered editorial card).
     *  Required for IG (the API rejects image-less posts) and used
     *  to enrich the FB Page post + LinkedIn thumbnail. NULL only
     *  in degenerate test paths — production cron always passes one. */
    heroImageUrl: string | null;
  };
  /** Encryption key for the token RPC — sourced from
   *  serverEnv().AHO_TOKEN_ENCRYPTION_KEY by the cron route. */
  tokenEncryptionKey: string;
  /** When false, dry-run mode: simulate the calls without hitting
   *  Meta / LinkedIn. Used by the dry-run cron flag + by tests. */
  enabled: boolean;
}

/**
 * Find the admin user whose connected tokens we distribute through.
 * Returns the first profile with `is_admin = true`. NULL when the
 * platform has no admin yet (pre-launch) — distribution is then
 * skipped gracefully.
 */
async function findAdminUserId(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('is_admin', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Build the short text accompanying the blog-post link. Same shape
 * for FB + LinkedIn (~280 chars) so the platform link-preview card
 * does the heavy lifting visually.
 *
 * Exported for unit testing.
 */
export function buildBlogShareText(args: {
  title: string;
  summary: string;
  url: string;
}): { fbMessage: string; linkedInCommentary: string } {
  const headline = args.title.trim();
  // Trim the summary so the full text fits even on platforms that
  // collapse-with-ellipsis early. ~220 chars works on FB + LinkedIn
  // without the "See more" fold appearing mid-sentence.
  const trimmedSummary =
    args.summary.length > 220 ? `${args.summary.slice(0, 217).trimEnd()}…` : args.summary;
  const fbMessage = `${headline}\n\n${trimmedSummary}`;
  const linkedInCommentary = `${headline}\n\n${trimmedSummary}\n\nFull article:`;
  return { fbMessage, linkedInCommentary };
}

export async function distributeBlogPost(args: DistributeArgs): Promise<DistributionEntry[]> {
  const now = () => new Date().toISOString();
  const out: DistributionEntry[] = [];

  if (!args.enabled) {
    out.push({ channel: 'facebook', status: 'skipped', skip_reason: 'distribution_disabled', at: now() });
    out.push({ channel: 'instagram', status: 'skipped', skip_reason: 'distribution_disabled', at: now() });
    out.push({ channel: 'linkedin', status: 'skipped', skip_reason: 'distribution_disabled', at: now() });
    return out;
  }

  const adminUserId = await findAdminUserId(args.admin);
  if (!adminUserId) {
    out.push({ channel: 'facebook', status: 'skipped', skip_reason: 'no_admin_user', at: now() });
    out.push({ channel: 'instagram', status: 'skipped', skip_reason: 'no_admin_user', at: now() });
    out.push({ channel: 'linkedin', status: 'skipped', skip_reason: 'no_admin_user', at: now() });
    return out;
  }

  const { data: tokenRows, error: tokenErr } = await args.admin
    .from('ad_platform_tokens')
    .select('id, user_id, platform, external_account_id, display_name')
    .eq('user_id', adminUserId)
    .is('revoked_at', null);

  if (tokenErr) {
    console.error('[blog-distribute] token list failed', {
      code: tokenErr.code,
      message: tokenErr.message,
    });
    out.push({ channel: 'facebook', status: 'failed', error_code: 'token_list_failed', error: tokenErr.message, at: now() });
    out.push({ channel: 'instagram', status: 'failed', error_code: 'token_list_failed', error: tokenErr.message, at: now() });
    out.push({ channel: 'linkedin', status: 'failed', error_code: 'token_list_failed', error: tokenErr.message, at: now() });
    return out;
  }

  const tokens = (tokenRows ?? []) as unknown as AdPlatformTokenRow[];

  // Pick at most ONE FB Page token + ONE LinkedIn token for v1.
  // If the admin has multiple FB Pages connected, we use the first one;
  // a future surface can let the operator pick which channel(s) to
  // include. v1 keeps it deterministic.
  const fbPageToken = tokens.find(
    (t) => t.platform === 'meta' && t.external_account_id.startsWith('page:'),
  );
  const liToken = tokens.find((t) => t.platform === 'linkedin');

  const { fbMessage, linkedInCommentary } = buildBlogShareText({
    title: args.post.title,
    summary: args.post.summary,
    url: args.post.publicUrl,
  });

  // The IG token row is identified by external_account_id starting
  // with 'ig:' (the IG Business account id). The token used is the
  // PARENT FB Page's token — same shape as /api/social/post.
  const igToken = tokens.find(
    (t) => t.platform === 'meta' && t.external_account_id.startsWith('ig:'),
  );

  // ───────── Facebook Page ─────────
  if (fbPageToken) {
    const pageId = fbPageToken.external_account_id.slice('page:'.length);
    const { data: tokenPlain, error: decErr } = await args.admin.rpc(
      'get_decrypted_access_token',
      {
        p_user_id: adminUserId,
        p_platform: 'meta',
        p_external_account_id: fbPageToken.external_account_id,
        p_key: args.tokenEncryptionKey,
      },
    );
    if (decErr || !tokenPlain) {
      out.push({
        channel: 'facebook',
        status: 'failed',
        error_code: 'token_decrypt_failed',
        error: decErr?.message ?? 'decrypt returned null',
        at: now(),
      });
    } else {
      const result: PublishResult = await publishToFacebookPage({
        pageId,
        pageToken: tokenPlain as string,
        post: {
          message: fbMessage,
          link: args.post.publicUrl,
          // When a hero image is available, FB renders a photo post
          // with caption + link beneath. Visual richness > link-only.
          ...(args.post.heroImageUrl ? { imageUrl: args.post.heroImageUrl } : {}),
        },
      });
      out.push({
        channel: 'facebook',
        status: result.ok ? 'posted' : 'failed',
        ...(result.ok && result.externalPostId ? { external_id: result.externalPostId } : {}),
        ...(result.ok && result.externalPostUrl ? { external_url: result.externalPostUrl } : {}),
        ...(!result.ok ? { error_code: result.errorCode, error: result.errorMessage } : {}),
        at: now(),
      });
    }
  } else {
    out.push({ channel: 'facebook', status: 'skipped', skip_reason: 'no_facebook_page_token', at: now() });
  }

  // ───────── Instagram Business ─────────
  // IG REQUIRES an image — when heroImageUrl is null we skip the
  // channel rather than fail. The cron always passes one in prod
  // (rendered by /blog/[slug]/opengraph-image.tsx) so this guard is
  // belt-and-braces. Uses the PARENT FB Page token (same Meta OAuth
  // grant covers both surfaces).
  if (!args.post.heroImageUrl) {
    out.push({ channel: 'instagram', status: 'skipped', skip_reason: 'no_hero_image', at: now() });
  } else if (!igToken || !fbPageToken) {
    out.push({
      channel: 'instagram',
      status: 'skipped',
      skip_reason: igToken ? 'no_parent_fb_token' : 'no_instagram_token',
      at: now(),
    });
  } else {
    const igId = igToken.external_account_id.slice('ig:'.length);
    // IG uses the FB Page token, not a separate IG token — we already
    // decrypted it above. But to keep this block self-contained
    // (post-only-IG-fail isolation), re-decrypt cleanly.
    const { data: tokenPlain, error: decErr } = await args.admin.rpc(
      'get_decrypted_access_token',
      {
        p_user_id: adminUserId,
        p_platform: 'meta',
        p_external_account_id: fbPageToken.external_account_id,
        p_key: args.tokenEncryptionKey,
      },
    );
    if (decErr || !tokenPlain) {
      out.push({
        channel: 'instagram',
        status: 'failed',
        error_code: 'token_decrypt_failed',
        error: decErr?.message ?? 'decrypt returned null',
        at: now(),
      });
    } else {
      // IG strips URLs from clickability in captions — include the
      // URL as plain text so the buyer can copy/paste even though
      // it isn't auto-linkified. "Link in bio" is the standard
      // pattern but we don't manage the bio link from here.
      const igCaption = `${fbMessage}\n\nRead: ${args.post.publicUrl}`;
      const result: PublishResult = await publishToInstagramBusiness({
        igId,
        pageToken: tokenPlain as string,
        post: {
          caption: igCaption,
          imageUrls: [args.post.heroImageUrl],
        },
      });
      out.push({
        channel: 'instagram',
        status: result.ok ? 'posted' : 'failed',
        ...(result.ok && result.externalPostId ? { external_id: result.externalPostId } : {}),
        ...(result.ok && result.externalPostUrl ? { external_url: result.externalPostUrl } : {}),
        ...(!result.ok ? { error_code: result.errorCode, error: result.errorMessage } : {}),
        at: now(),
      });
    }
  }

  // ───────── LinkedIn ─────────
  if (liToken) {
    const authorUrn = liToken.external_account_id.startsWith('urn:')
      ? liToken.external_account_id
      : `urn:li:person:${liToken.external_account_id}`;
    const { data: tokenPlain, error: decErr } = await args.admin.rpc(
      'get_decrypted_access_token',
      {
        p_user_id: adminUserId,
        p_platform: 'linkedin',
        p_external_account_id: liToken.external_account_id,
        p_key: args.tokenEncryptionKey,
      },
    );
    if (decErr || !tokenPlain) {
      out.push({
        channel: 'linkedin',
        status: 'failed',
        error_code: 'token_decrypt_failed',
        error: decErr?.message ?? 'decrypt returned null',
        at: now(),
      });
    } else {
      const dryRun = process.env.LINKEDIN_DRY_RUN === 'true';
      const result: PublishResult = await publishToLinkedIn({
        authorUrn,
        accessToken: tokenPlain as string,
        dryRun,
        post: {
          commentary: linkedInCommentary,
          contentUrl: args.post.publicUrl,
          contentTitle: args.post.title,
          contentDescription: args.post.summary,
          ...(args.post.heroImageUrl
            ? { contentThumbnailUrl: args.post.heroImageUrl }
            : {}),
        },
      });
      out.push({
        channel: 'linkedin',
        status: result.ok ? 'posted' : 'failed',
        ...(result.ok && result.externalPostId ? { external_id: result.externalPostId } : {}),
        ...(result.ok && result.externalPostUrl ? { external_url: result.externalPostUrl } : {}),
        ...(!result.ok ? { error_code: result.errorCode, error: result.errorMessage } : {}),
        at: now(),
      });
    }
  } else {
    out.push({ channel: 'linkedin', status: 'skipped', skip_reason: 'no_linkedin_token', at: now() });
  }

  return out;
}

/**
 * Format the distribution log for inline rendering in the operator
 * success email. Returns a multi-line HTML snippet suitable for
 * embedding in the email template body.
 */
export function renderDistributionSummary(entries: ReadonlyArray<DistributionEntry>): string {
  if (entries.length === 0) {
    return '<p style="font-size: 13px; color: #6b6356;">No distribution attempts.</p>';
  }
  const lines = entries.map((e) => {
    const label = e.channel.charAt(0).toUpperCase() + e.channel.slice(1);
    if (e.status === 'posted') {
      const link = e.external_url ? ` — <a href="${e.external_url}">post</a>` : '';
      return `<li><strong>${label}</strong>: ✓ posted${link}</li>`;
    }
    if (e.status === 'failed') {
      return `<li><strong>${label}</strong>: ✗ failed (${e.error_code ?? 'unknown'}${e.error ? ` — ${e.error}` : ''})</li>`;
    }
    if (e.status === 'skipped') {
      return `<li><strong>${label}</strong>: — skipped (${e.skip_reason ?? 'no_reason'})</li>`;
    }
    return `<li><strong>${label}</strong>: ${e.status}</li>`;
  });
  return `<ul style="line-height: 1.7; margin: 0; padding-left: 1.25rem;">${lines.join('')}</ul>`;
}
