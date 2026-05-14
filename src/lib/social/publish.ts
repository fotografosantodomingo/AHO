import 'server-only';

import { META_GRAPH_BASE } from '@/lib/oauth/meta';
import type {
  FacebookPost,
  InstagramPost,
  LinkedInPost,
} from '@/lib/social/post-formatter';

/**
 * Publish primitives — the actual platform API calls that turn a
 * formatted post into a live external object on Facebook / Instagram /
 * LinkedIn.
 *
 * Phase D of docs/SOCIAL_AUTOMATION_PLAN.md. Each primitive:
 *   - Takes a decrypted token + a typed post payload
 *   - Calls exactly one platform API surface
 *   - Returns a uniform PublishResult: ok=true with external id/url, or
 *     ok=false with a categorized errorCode + raw errorMessage
 *
 * Error taxonomy (see PublishErrorCode below): "retryable" errors are
 * the ones a "Retry failed" button should re-attempt — rate limits,
 * 5xx, network timeouts, transient container-not-ready. "Permanent"
 * errors require user action — re-connect token, fix image, etc.
 * The route handler in Phase E surfaces both cleanly in the UI.
 *
 * Pure I/O — no DB writes, no token decryption, no event logging here.
 * The caller (Phase E route) owns the orchestration.
 */

// ============================================================
// Error taxonomy
// ============================================================

export type PublishErrorCode =
  | 'token_invalid' //  401 / OAuth token bad → "Reconnect" UX (permanent)
  | 'permission_denied' //  403 / missing scope → reconnect with more scopes (permanent)
  | 'rate_limited' //  429 or platform-specific code → backoff + retry (retryable)
  | 'image_required' //  Pre-flight: input missing imageUrl on a platform that needs one (permanent)
  | 'image_too_large' //  Platform rejected the image — size / dimensions (permanent)
  | 'image_url_unreachable' //  Platform couldn't fetch our imageUrl (permanent — fix the URL)
  | 'container_not_ready' //  IG /media succeeded but /media_publish too soon (retryable)
  | 'network_timeout' //  fetch() threw (retryable)
  | 'transient_5xx' //  platform returned 5xx (retryable)
  | 'oauth_not_implemented' //  stub for platforms whose OAuth isn't wired yet (LinkedIn) (permanent)
  | 'invalid_input' //  caller-side bug (e.g. empty pageId) (permanent)
  | 'unknown'; //  unmapped; treated as retryable so retries can succeed if it was transient

const RETRYABLE_CODES: ReadonlySet<PublishErrorCode> = new Set([
  'rate_limited',
  'container_not_ready',
  'network_timeout',
  'transient_5xx',
  'unknown',
]);

export function isRetryable(code: PublishErrorCode | undefined): boolean {
  return code != null && RETRYABLE_CODES.has(code);
}

/**
 * 3-letter abbreviations for support-reference codes. Used to build the
 * `AHO-SP-{CODE}-{LAST8}` reference an agent can copy and email to support.
 * Stable wire format — adding a new PublishErrorCode requires adding an
 * entry here (typescript exhaustiveness check via Record<PublishErrorCode>).
 */
export const ERROR_CODE_SHORT: Record<PublishErrorCode, string> = {
  token_invalid: 'TOK',
  permission_denied: 'PRM',
  rate_limited: 'RTL',
  image_required: 'IMR',
  image_too_large: 'IMG',
  image_url_unreachable: 'IMU',
  container_not_ready: 'CNR',
  network_timeout: 'NET',
  transient_5xx: 'T5X',
  oauth_not_implemented: 'OAN',
  invalid_input: 'INP',
  unknown: 'UNK',
};

/**
 * Build the short error reference an agent copies and emails to support.
 * Format: `AHO-SP-{CODE}-{LAST8}` — total 19 chars, phone-readable in chunks.
 * The LAST8 (last 8 chars of the attempt UUID) gives support enough to grep
 * `select * from social_post_attempts where id::text like '%<last8>'`.
 */
export function buildSupportRef(
  errorCode: PublishErrorCode | undefined,
  attemptId: string,
): string {
  const short = errorCode ? (ERROR_CODE_SHORT[errorCode] ?? 'UNK') : 'UNK';
  const last8 = attemptId.replace(/-/g, '').slice(-8);
  return `AHO-SP-${short}-${last8}`;
}

export interface PublishResult {
  ok: boolean;
  /** Platform's stable post id. FB: `{page_id}_{post_id}`. IG: media id. LinkedIn: share URN. */
  externalPostId?: string;
  /** Direct URL to the post when the platform exposes one. */
  externalPostUrl?: string;
  errorCode?: PublishErrorCode;
  /** Raw message from the platform (or fetch error). Surfaced in UI. */
  errorMessage?: string;
}

// ============================================================
// Meta error categorization
// ============================================================

interface MetaApiError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/** Map a Meta Graph API error response to our internal taxonomy. */
function categorizeMetaError(
  status: number,
  body: MetaApiError,
): { code: PublishErrorCode; message: string } {
  const e = body.error ?? {};
  const msg = e.message ?? `HTTP ${status}`;
  const fbCode = e.code;
  const fbSub = e.error_subcode;

  // FB documented error codes — https://developers.facebook.com/docs/graph-api/guides/error-handling
  if (fbCode === 190) return { code: 'token_invalid', message: msg };
  if (fbCode === 200) return { code: 'permission_denied', message: msg };
  if (fbCode === 4 || fbCode === 17 || fbCode === 32 || fbCode === 613) {
    return { code: 'rate_limited', message: msg };
  }
  // IG photo container errors fall under code 100 + a 2207xxx subcode.
  if (fbCode === 100 && fbSub != null && fbSub >= 2207000 && fbSub < 2208000) {
    // Common: 2207003 fetched-image-too-large; 2207026 fetch-failed; 2207057 invalid-image-url.
    if (fbSub === 2207026 || fbSub === 2207020) {
      return { code: 'image_url_unreachable', message: msg };
    }
    return { code: 'image_too_large', message: msg };
  }
  // IG specific: "Media ID not yet available" — container not finished processing.
  if (fbCode === 9007 || /not yet available/i.test(msg)) {
    return { code: 'container_not_ready', message: msg };
  }
  // HTTP-level fallback.
  if (status === 401) return { code: 'token_invalid', message: msg };
  if (status === 403) return { code: 'permission_denied', message: msg };
  if (status === 429) return { code: 'rate_limited', message: msg };
  if (status >= 500 && status < 600) return { code: 'transient_5xx', message: msg };
  return { code: 'unknown', message: msg };
}

function networkFailure(err: unknown): PublishResult {
  const message = err instanceof Error ? err.message : String(err);
  // AbortError → genuine timeout. Other fetch failures → still network.
  return {
    ok: false,
    errorCode: 'network_timeout',
    errorMessage: message,
  };
}

// ============================================================
// Facebook Page publish
// ============================================================

/**
 * Publish to a Facebook Page.
 *
 * - When `post.imageUrl` is present we use `/{page-id}/photos` with
 *   `url` + `caption` + `link` so FB attaches the photo AND renders the
 *   listing URL preview card under the caption.
 * - Otherwise we use `/{page-id}/feed` with `message` + `link` — FB
 *   renders the link as an article card.
 */
export async function publishToFacebookPage(args: {
  pageId: string;
  pageToken: string;
  post: FacebookPost;
}): Promise<PublishResult> {
  if (!args.pageId || !args.pageToken) {
    return { ok: false, errorCode: 'invalid_input', errorMessage: 'pageId and pageToken are required' };
  }

  const hasPhoto = !!args.post.imageUrl;
  const endpoint = hasPhoto
    ? `${META_GRAPH_BASE}/${encodeURIComponent(args.pageId)}/photos`
    : `${META_GRAPH_BASE}/${encodeURIComponent(args.pageId)}/feed`;

  const body = new URLSearchParams();
  body.set('access_token', args.pageToken);
  if (hasPhoto) {
    body.set('url', args.post.imageUrl!);
    body.set('caption', args.post.message);
    body.set('link', args.post.link);
  } else {
    body.set('message', args.post.message);
    body.set('link', args.post.link);
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      body,
    });
  } catch (err) {
    return networkFailure(err);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      errorCode: res.status >= 500 ? 'transient_5xx' : 'unknown',
      errorMessage: `HTTP ${res.status} (no JSON body)`,
    };
  }

  if (!res.ok) {
    const { code, message } = categorizeMetaError(res.status, json as MetaApiError);
    return { ok: false, errorCode: code, errorMessage: message };
  }

  // Success body shape:
  //   /photos: { id: '...', post_id: '{page_id}_{post_id}' }
  //   /feed:   { id: '{page_id}_{post_id}' }
  const data = json as { id?: string; post_id?: string };
  const externalPostId = data.post_id ?? data.id;
  if (!externalPostId) {
    return {
      ok: false,
      errorCode: 'unknown',
      errorMessage: 'FB returned 2xx but no id in body',
    };
  }
  return {
    ok: true,
    externalPostId,
    externalPostUrl: `https://www.facebook.com/${externalPostId}`,
  };
}

// ============================================================
// Instagram Business publish (2-step)
// ============================================================

/**
 * Publish to an Instagram Business account. Branches on photo count:
 *   - 1 photo  → 2-step single-image publish (existing flow)
 *   - 2-10 photos → 3-step carousel publish (Phase K)
 *
 * Step 2 / step 3 can fail with `container_not_ready` if media is still
 * being processed (large images, slow CDN). Caller (Phase E) treats
 * this as a retryable error and the retry rebuilds containers from
 * scratch — Meta auto-expires orphaned children in ~24h.
 */
export async function publishToInstagramBusiness(args: {
  igId: string;
  pageToken: string;
  post: InstagramPost;
}): Promise<PublishResult> {
  if (!args.igId || !args.pageToken) {
    return { ok: false, errorCode: 'invalid_input', errorMessage: 'igId and pageToken are required' };
  }
  const validImages = (args.post.imageUrls ?? []).filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  if (validImages.length === 0) {
    return {
      ok: false,
      errorCode: 'image_required',
      errorMessage: 'Instagram requires at least one imageUrl',
    };
  }
  if (validImages.length === 1) {
    return publishIgSingle(args.igId, args.pageToken, args.post.caption, validImages[0]!);
  }
  return publishIgCarousel(args.igId, args.pageToken, args.post.caption, validImages);
}

/**
 * Single-image IG publish — 2-step (container + publish). Existing
 * Phase D flow preserved verbatim; carousel branches off above.
 */
async function publishIgSingle(
  igId: string,
  pageToken: string,
  caption: string,
  imageUrl: string,
): Promise<PublishResult> {
  // Step 1 — create the media container.
  const containerBody = new URLSearchParams();
  containerBody.set('image_url', imageUrl);
  containerBody.set('caption', caption);
  containerBody.set('access_token', pageToken);

  let containerRes: Response;
  try {
    containerRes = await fetch(
      `${META_GRAPH_BASE}/${encodeURIComponent(igId)}/media`,
      { method: 'POST', body: containerBody },
    );
  } catch (err) {
    return networkFailure(err);
  }

  let containerJson: unknown;
  try {
    containerJson = await containerRes.json();
  } catch {
    return {
      ok: false,
      errorCode: containerRes.status >= 500 ? 'transient_5xx' : 'unknown',
      errorMessage: `IG /media HTTP ${containerRes.status} (no JSON body)`,
    };
  }

  if (!containerRes.ok) {
    const { code, message } = categorizeMetaError(containerRes.status, containerJson as MetaApiError);
    return { ok: false, errorCode: code, errorMessage: `IG /media: ${message}` };
  }

  const containerId = (containerJson as { id?: string }).id;
  if (!containerId) {
    return {
      ok: false,
      errorCode: 'unknown',
      errorMessage: 'IG /media returned 2xx but no id',
    };
  }

  return publishIgContainer(igId, pageToken, containerId, 'single');
}

/**
 * Carousel IG publish — 3-step (N children + parent + publish). Each
 * child container is created with `is_carousel_item=true`; the parent
 * is `media_type=CAROUSEL` with a comma-separated `children` field;
 * the publish step is identical to single. Children are created
 * SEQUENTIALLY (Meta rate-limits aggressive parallel POSTs to /media
 * for the same IG account; sequential adds ~200ms/photo but avoids
 * spurious rate_limited errors mid-batch).
 */
async function publishIgCarousel(
  igId: string,
  pageToken: string,
  caption: string,
  imageUrls: string[],
): Promise<PublishResult> {
  const childIds: string[] = [];

  // Step 1 — create N child containers, sequential.
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i]!;
    const childBody = new URLSearchParams();
    childBody.set('image_url', url);
    childBody.set('is_carousel_item', 'true');
    childBody.set('access_token', pageToken);
    // Caption deliberately omitted from children — Meta attaches it to
    // the parent only. Sending it here just adds noise.

    let res: Response;
    try {
      res = await fetch(
        `${META_GRAPH_BASE}/${encodeURIComponent(igId)}/media`,
        { method: 'POST', body: childBody },
      );
    } catch (err) {
      const fail = networkFailure(err);
      return {
        ...fail,
        errorMessage: `IG /media (child ${i + 1}/${imageUrls.length}): ${fail.errorMessage}`,
      };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return {
        ok: false,
        errorCode: res.status >= 500 ? 'transient_5xx' : 'unknown',
        errorMessage: `IG /media (child ${i + 1}/${imageUrls.length}) HTTP ${res.status} (no JSON body)`,
      };
    }
    if (!res.ok) {
      const { code, message } = categorizeMetaError(res.status, json as MetaApiError);
      return {
        ok: false,
        errorCode: code,
        errorMessage: `IG /media (child ${i + 1}/${imageUrls.length}): ${message}`,
      };
    }
    const id = (json as { id?: string }).id;
    if (!id) {
      return {
        ok: false,
        errorCode: 'unknown',
        errorMessage: `IG /media (child ${i + 1}/${imageUrls.length}) returned 2xx but no id`,
      };
    }
    childIds.push(id);
  }

  // Step 2 — create the parent CAROUSEL container.
  const parentBody = new URLSearchParams();
  parentBody.set('media_type', 'CAROUSEL');
  parentBody.set('children', childIds.join(','));
  parentBody.set('caption', caption);
  parentBody.set('access_token', pageToken);

  let parentRes: Response;
  try {
    parentRes = await fetch(
      `${META_GRAPH_BASE}/${encodeURIComponent(igId)}/media`,
      { method: 'POST', body: parentBody },
    );
  } catch (err) {
    const fail = networkFailure(err);
    return {
      ...fail,
      errorMessage: `IG /media (carousel parent): ${fail.errorMessage}`,
    };
  }
  let parentJson: unknown;
  try {
    parentJson = await parentRes.json();
  } catch {
    return {
      ok: false,
      errorCode: parentRes.status >= 500 ? 'transient_5xx' : 'unknown',
      errorMessage: `IG /media (carousel parent) HTTP ${parentRes.status} (no JSON body)`,
    };
  }
  if (!parentRes.ok) {
    const { code, message } = categorizeMetaError(parentRes.status, parentJson as MetaApiError);
    return {
      ok: false,
      errorCode: code,
      errorMessage: `IG /media (carousel parent): ${message}`,
    };
  }
  const parentId = (parentJson as { id?: string }).id;
  if (!parentId) {
    return {
      ok: false,
      errorCode: 'unknown',
      errorMessage: 'IG /media (carousel parent) returned 2xx but no id',
    };
  }

  // Step 3 — publish.
  return publishIgContainer(igId, pageToken, parentId, 'carousel');
}

/** Shared step-3 publish call — used by both single and carousel paths. */
async function publishIgContainer(
  igId: string,
  pageToken: string,
  creationId: string,
  shape: 'single' | 'carousel',
): Promise<PublishResult> {
  const publishBody = new URLSearchParams();
  publishBody.set('creation_id', creationId);
  publishBody.set('access_token', pageToken);

  let publishRes: Response;
  try {
    publishRes = await fetch(
      `${META_GRAPH_BASE}/${encodeURIComponent(igId)}/media_publish`,
      { method: 'POST', body: publishBody },
    );
  } catch (err) {
    return networkFailure(err);
  }

  let publishJson: unknown;
  try {
    publishJson = await publishRes.json();
  } catch {
    return {
      ok: false,
      errorCode: publishRes.status >= 500 ? 'transient_5xx' : 'unknown',
      errorMessage: `IG /media_publish HTTP ${publishRes.status} (no JSON body)`,
    };
  }

  if (!publishRes.ok) {
    const { code, message } = categorizeMetaError(publishRes.status, publishJson as MetaApiError);
    return {
      ok: false,
      errorCode: code,
      errorMessage: `IG /media_publish (${shape}): ${message}`,
    };
  }

  const mediaId = (publishJson as { id?: string }).id;
  if (!mediaId) {
    return {
      ok: false,
      errorCode: 'unknown',
      errorMessage: 'IG /media_publish returned 2xx but no id',
    };
  }
  return {
    ok: true,
    externalPostId: mediaId,
    // IG doesn't return a permalink in the publish response. Caller
    // can fetch one via GET /{media-id}?fields=permalink if needed.
  };
}

// ============================================================
// LinkedIn publish — stub until OAuth + partner approval
// ============================================================

/**
 * Publish to LinkedIn — STUB.
 *
 * Per docs/SOCIAL_AUTOMATION_PLAN.md Phase D + Phase H: the LinkedIn
 * Marketing Developer Platform partner approval has NOT been granted.
 * Even with this code wired, real publishing requires:
 *   1. LinkedIn OAuth scaffold (start + callback) — not built yet
 *   2. Partner approval for `w_member_social` / `w_organization_social`
 *
 * Until both land, this returns `oauth_not_implemented` and the route
 * handler marks the attempt `skipped` so it doesn't pollute the
 * failure metric.
 *
 * The signature is stable so Phase E can route to it without branching
 * on platform — when LinkedIn is real, just swap the body.
 */
export async function publishToLinkedIn(_args: {
  /** Member URN ('urn:li:person:{id}') or org URN ('urn:li:organization:{id}'). */
  authorUrn: string;
  /** OAuth 2.0 access token. */
  accessToken: string;
  post: LinkedInPost;
}): Promise<PublishResult> {
  return {
    ok: false,
    errorCode: 'oauth_not_implemented',
    errorMessage:
      'LinkedIn publish is gated on Marketing Developer Platform partner approval ' +
      '(docs/SOCIAL_AUTOMATION_PLAN.md Phase D + Phase H). Wire OAuth + flip this ' +
      'stub once approved.',
  };
}
