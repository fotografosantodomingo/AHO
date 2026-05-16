/**
 * Unit tests for `src/lib/social/publish.ts` — Phase D of
 * docs/SOCIAL_AUTOMATION_PLAN.md.
 *
 * We mock `global.fetch` so no real Meta calls happen. Each test sets
 * up exactly the response sequence the primitive expects, then asserts
 * on (a) the returned PublishResult shape and (b) the request payload
 * sent to the platform.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isRetryable,
  publishToFacebookPage,
  publishToInstagramBusiness,
  publishToLinkedIn,
  type PublishErrorCode,
} from '@/lib/social/publish';
import type {
  FacebookPost,
  InstagramPost,
  LinkedInPost,
} from '@/lib/social/post-formatter';

const FB_POST_TEXT: FacebookPost = {
  message: 'A nice listing',
  link: 'https://advertisehomes.online/en/properties/test-cQF9BN?utm_source=facebook',
};

const FB_POST_PHOTO: FacebookPost = {
  ...FB_POST_TEXT,
  imageUrl: 'https://imagedelivery.net/abc/img-1/og',
};

const IG_POST: InstagramPost = {
  caption: 'A nice IG caption',
  imageUrls: ['https://imagedelivery.net/abc/img-1/igsquare'],
};

function igPostWithImages(n: number): InstagramPost {
  return {
    caption: `Carousel caption with ${n} photos`,
    imageUrls: Array.from({ length: n }, (_, i) => `https://imagedelivery.net/abc/img-${i + 1}/igsquare`),
  };
}

const LI_POST: LinkedInPost = {
  commentary: 'A nice LI post',
  contentUrl: 'https://advertisehomes.online/en/properties/test-cQF9BN?utm_source=linkedin',
  contentTitle: 'Test listing',
  contentDescription: 'Santo Domingo · $225,000',
};

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Build a Response-shaped object that publish.ts can json() and read status from. */
function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ============================================================
// isRetryable
// ============================================================

describe('publish · isRetryable', () => {
  it('returns true for transient codes', () => {
    const retryable: PublishErrorCode[] = [
      'rate_limited',
      'container_not_ready',
      'network_timeout',
      'transient_5xx',
      'unknown',
    ];
    for (const c of retryable) expect(isRetryable(c)).toBe(true);
  });

  it('returns false for permanent codes', () => {
    const permanent: PublishErrorCode[] = [
      'token_invalid',
      'permission_denied',
      'image_required',
      'image_too_large',
      'image_url_unreachable',
      'oauth_not_implemented',
      'invalid_input',
    ];
    for (const c of permanent) expect(isRetryable(c)).toBe(false);
  });

  it('returns false for undefined (no error)', () => {
    expect(isRetryable(undefined)).toBe(false);
  });
});

// ============================================================
// publishToFacebookPage
// ============================================================

describe('publish · publishToFacebookPage', () => {
  it('happy path /feed (no image) — returns externalPostId from `id`', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, { id: 'PAGE_123_456' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToFacebookPage({
      pageId: 'PAGE_123',
      pageToken: 'tok-fb-page',
      post: FB_POST_TEXT,
    });

    expect(result).toEqual({
      ok: true,
      externalPostId: 'PAGE_123_456',
      externalPostUrl: 'https://www.facebook.com/PAGE_123_456',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/PAGE_123/feed');
    const body = init?.body as URLSearchParams;
    expect(body.get('message')).toBe(FB_POST_TEXT.message);
    expect(body.get('link')).toBe(FB_POST_TEXT.link);
    expect(body.get('access_token')).toBe('tok-fb-page');
  });

  it('happy path /photos (with image) — uses post_id from response', async () => {
    const fetchMock = vi.fn(async () =>
      mockResponse(200, { id: 'PHOTO_ID', post_id: 'PAGE_123_999' }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToFacebookPage({
      pageId: 'PAGE_123',
      pageToken: 'tok-fb-page',
      post: FB_POST_PHOTO,
    });

    expect(result.ok).toBe(true);
    expect(result.externalPostId).toBe('PAGE_123_999');
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/PAGE_123/photos');
    const body = init?.body as URLSearchParams;
    expect(body.get('url')).toBe(FB_POST_PHOTO.imageUrl);
    expect(body.get('caption')).toBe(FB_POST_PHOTO.message);
    expect(body.get('link')).toBe(FB_POST_PHOTO.link);
  });

  it('FB error code 190 → token_invalid (permanent)', async () => {
    global.fetch = vi.fn(async () =>
      mockResponse(400, {
        error: { code: 190, message: 'Invalid OAuth access token', type: 'OAuthException' },
      }),
    ) as unknown as typeof fetch;

    const result = await publishToFacebookPage({
      pageId: 'PAGE_123',
      pageToken: 'bad-token',
      post: FB_POST_TEXT,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('token_invalid');
    expect(isRetryable(result.errorCode)).toBe(false);
    expect(result.errorMessage).toContain('Invalid OAuth');
  });

  it('FB error code 200 → permission_denied', async () => {
    global.fetch = vi.fn(async () =>
      mockResponse(403, {
        error: { code: 200, message: '(#200) Permissions error' },
      }),
    ) as unknown as typeof fetch;

    const result = await publishToFacebookPage({
      pageId: 'PAGE_123',
      pageToken: 'tok',
      post: FB_POST_TEXT,
    });

    expect(result.errorCode).toBe('permission_denied');
  });

  it('FB error code 4 → rate_limited (retryable)', async () => {
    global.fetch = vi.fn(async () =>
      mockResponse(400, {
        error: { code: 4, message: 'Application request limit reached' },
      }),
    ) as unknown as typeof fetch;

    const result = await publishToFacebookPage({
      pageId: 'PAGE_123',
      pageToken: 'tok',
      post: FB_POST_TEXT,
    });

    expect(result.errorCode).toBe('rate_limited');
    expect(isRetryable(result.errorCode)).toBe(true);
  });

  it('HTTP 503 fallback → transient_5xx (retryable)', async () => {
    global.fetch = vi.fn(async () => mockResponse(503, {})) as unknown as typeof fetch;

    const result = await publishToFacebookPage({
      pageId: 'PAGE_123',
      pageToken: 'tok',
      post: FB_POST_TEXT,
    });

    expect(result.errorCode).toBe('transient_5xx');
    expect(isRetryable(result.errorCode)).toBe(true);
  });

  it('HTTP 401 with no error body → token_invalid', async () => {
    global.fetch = vi.fn(async () => mockResponse(401, {})) as unknown as typeof fetch;

    const result = await publishToFacebookPage({
      pageId: 'PAGE_123',
      pageToken: 'tok',
      post: FB_POST_TEXT,
    });

    expect(result.errorCode).toBe('token_invalid');
  });

  it('fetch throws → network_timeout (retryable)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('AbortError: signal aborted');
    }) as unknown as typeof fetch;

    const result = await publishToFacebookPage({
      pageId: 'PAGE_123',
      pageToken: 'tok',
      post: FB_POST_TEXT,
    });

    expect(result.errorCode).toBe('network_timeout');
    expect(isRetryable(result.errorCode)).toBe(true);
    expect(result.errorMessage).toContain('AbortError');
  });

  it('rejects empty pageId / pageToken without calling fetch', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const r1 = await publishToFacebookPage({ pageId: '', pageToken: 'x', post: FB_POST_TEXT });
    const r2 = await publishToFacebookPage({ pageId: 'PAGE_123', pageToken: '', post: FB_POST_TEXT });

    expect(r1.errorCode).toBe('invalid_input');
    expect(r2.errorCode).toBe('invalid_input');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('2xx with no id in body → unknown', async () => {
    global.fetch = vi.fn(async () => mockResponse(200, { something: 'else' })) as unknown as typeof fetch;

    const result = await publishToFacebookPage({
      pageId: 'PAGE_123',
      pageToken: 'tok',
      post: FB_POST_TEXT,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('unknown');
  });
});

// ============================================================
// publishToInstagramBusiness
// ============================================================

describe('publish · publishToInstagramBusiness', () => {
  it('happy path — 2-step flow returns mediaId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { id: 'CONTAINER_42' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'MEDIA_99' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok-page',
      post: IG_POST,
    });

    expect(result.ok).toBe(true);
    expect(result.externalPostId).toBe('MEDIA_99');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url1, init1] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url1).toContain('/IG_BIZ_1/media');
    expect((init1?.body as URLSearchParams).get('image_url')).toBe(IG_POST.imageUrls[0]);
    expect((init1?.body as URLSearchParams).get('caption')).toBe(IG_POST.caption);

    const [url2, init2] = fetchMock.mock.calls[1]! as unknown as [string, RequestInit];
    expect(url2).toContain('/IG_BIZ_1/media_publish');
    expect((init2?.body as URLSearchParams).get('creation_id')).toBe('CONTAINER_42');
  });

  it('step 1 fails token_invalid → step 2 not called', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(400, { error: { code: 190, message: 'Token expired' } }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: IG_POST,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('token_invalid');
    expect(result.errorMessage).toContain('IG /media:');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('step 2 fails container_not_ready → retryable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { id: 'CONTAINER_42' }))
      .mockResolvedValueOnce(
        mockResponse(400, { error: { code: 9007, message: 'Media not yet available' } }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: IG_POST,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('container_not_ready');
    expect(isRetryable(result.errorCode)).toBe(true);
  });

  it('image too large (code 100 + 2207050) → image_too_large (permanent)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse(400, {
        error: {
          code: 100,
          error_subcode: 2207050,
          message: 'Image size exceeded',
        },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: IG_POST,
    });

    expect(result.errorCode).toBe('image_too_large');
    expect(isRetryable(result.errorCode)).toBe(false);
  });

  it('image url unreachable (code 100 + 2207026) → image_url_unreachable', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse(400, {
        error: {
          code: 100,
          error_subcode: 2207026,
          message: 'Cannot fetch image',
        },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: IG_POST,
    });

    expect(result.errorCode).toBe('image_url_unreachable');
  });

  it('rejects empty igId / pageToken without calling fetch', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await publishToInstagramBusiness({ igId: '', pageToken: 'x', post: IG_POST });
    expect(r.errorCode).toBe('invalid_input');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns image_required if imageUrls is empty', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: { caption: 'no image', imageUrls: [] } satisfies InstagramPost,
    });
    expect(r.errorCode).toBe('image_required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('network error mid-step-1 → network_timeout', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: IG_POST,
    });

    expect(result.errorCode).toBe('network_timeout');
    expect(result.errorMessage).toContain('socket hang up');
  });
});

// ============================================================
// publishToInstagramBusiness — Phase K carousel branch (>1 image)
// ============================================================

describe('publish · publishToInstagramBusiness (carousel)', () => {
  it('happy 2-image carousel — 4 fetches (2 child + parent + publish)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { id: 'CHILD_1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'CHILD_2' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'PARENT_42' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'MEDIA_99' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: igPostWithImages(2),
    });

    expect(result.ok).toBe(true);
    expect(result.externalPostId).toBe('MEDIA_99');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Child 1 — is_carousel_item=true, caption NOT sent on children
    const [, init1] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const body1 = init1.body as URLSearchParams;
    expect(body1.get('image_url')).toBe('https://imagedelivery.net/abc/img-1/igsquare');
    expect(body1.get('is_carousel_item')).toBe('true');
    expect(body1.get('caption')).toBeNull();

    // Parent — media_type=CAROUSEL + children comma-list + caption
    const [, init3] = fetchMock.mock.calls[2]! as unknown as [string, RequestInit];
    const body3 = init3.body as URLSearchParams;
    expect(body3.get('media_type')).toBe('CAROUSEL');
    expect(body3.get('children')).toBe('CHILD_1,CHILD_2');
    expect(body3.get('caption')).toBe('Carousel caption with 2 photos');

    // Publish — creation_id=parent
    const [, init4] = fetchMock.mock.calls[3]! as unknown as [string, RequestInit];
    expect((init4.body as URLSearchParams).get('creation_id')).toBe('PARENT_42');
  });

  it('happy 5-image carousel — 7 fetches', async () => {
    const fetchMock = vi.fn();
    for (let i = 1; i <= 5; i++) {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { id: `CHILD_${i}` }));
    }
    fetchMock.mockResolvedValueOnce(mockResponse(200, { id: 'PARENT_X' }));
    fetchMock.mockResolvedValueOnce(mockResponse(200, { id: 'MEDIA_X' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: igPostWithImages(5),
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    const [, parentInit] = fetchMock.mock.calls[5]! as unknown as [string, RequestInit];
    expect((parentInit.body as URLSearchParams).get('children')).toBe(
      'CHILD_1,CHILD_2,CHILD_3,CHILD_4,CHILD_5',
    );
  });

  it('child fail at index 2 of 5 → 3 fetches, message contains "child 3/5"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { id: 'CHILD_1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'CHILD_2' }))
      .mockResolvedValueOnce(
        mockResponse(400, {
          error: { code: 190, message: 'Token expired mid-batch' },
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: igPostWithImages(5),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('token_invalid');
    expect(result.errorMessage).toContain('child 3/5');
    expect(fetchMock).toHaveBeenCalledTimes(3); // stopped at the failure
  });

  it('parent fail (step 2) → no publish call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { id: 'CHILD_1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'CHILD_2' }))
      .mockResolvedValueOnce(
        mockResponse(400, {
          error: {
            code: 100,
            error_subcode: 2207026,
            message: 'Image fetch failed for one of the children',
          },
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: igPostWithImages(2),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('image_url_unreachable');
    expect(result.errorMessage).toContain('carousel parent');
    expect(fetchMock).toHaveBeenCalledTimes(3); // no publish
  });

  it('publish fail with container_not_ready → retryable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { id: 'CHILD_1' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'CHILD_2' }))
      .mockResolvedValueOnce(mockResponse(200, { id: 'PARENT_55' }))
      .mockResolvedValueOnce(
        mockResponse(400, {
          error: { code: 9007, message: 'Media not yet available' },
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: igPostWithImages(2),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('container_not_ready');
    expect(result.errorMessage).toContain('carousel');
    expect(isRetryable(result.errorCode)).toBe(true);
  });

  it('children created sequentially (one fetch in flight at a time)', async () => {
    // We assert sequentiality by recording the order calls START vs end:
    // each child's response is delayed; if they ran in parallel we'd see
    // the second fetch START before the first END. Sequential design
    // guarantees one-at-a-time.
    const callOrder: string[] = [];
    const fetchMock = vi.fn(
      async (_url: string | URL, init?: RequestInit): Promise<Response> => {
        const body = init?.body as URLSearchParams | undefined;
        const isChild = body?.get('is_carousel_item') === 'true';
        const tag = isChild ? `child:${body?.get('image_url')}` : 'other';
        callOrder.push(`start:${tag}`);
        await new Promise((r) => setTimeout(r, 5));
        callOrder.push(`end:${tag}`);
        return mockResponse(200, { id: `RESULT_${callOrder.length}` });
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: igPostWithImages(3),
    });

    // First three operations must be children, each starting after the
    // previous ended (sequential).
    expect(callOrder.slice(0, 6)).toEqual([
      'start:child:https://imagedelivery.net/abc/img-1/igsquare',
      'end:child:https://imagedelivery.net/abc/img-1/igsquare',
      'start:child:https://imagedelivery.net/abc/img-2/igsquare',
      'end:child:https://imagedelivery.net/abc/img-2/igsquare',
      'start:child:https://imagedelivery.net/abc/img-3/igsquare',
      'end:child:https://imagedelivery.net/abc/img-3/igsquare',
    ]);
  });
});

// ============================================================
// publishToLinkedIn — real /rest/posts (DECISIONS.md 2026-05-15)
// ============================================================

describe('publish · publishToLinkedIn', () => {
  it('returns invalid_input when authorUrn is empty', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: '',
      accessToken: 'tok',
      post: LI_POST,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_input');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input when commentary is blank', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: 'urn:li:person:abc',
      accessToken: 'tok',
      post: { ...LI_POST, commentary: '   ' },
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_input');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dryRun returns ok with synthetic urn without calling LinkedIn', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: 'urn:li:person:abc',
      accessToken: 'tok',
      post: LI_POST,
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.externalPostId).toMatch(/^urn:li:share:dryrun-/);
    expect(result.externalPostUrl).toContain('linkedin.com/feed/update/');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('success: 201 with x-restli-id header → ok with externalPostId+Url', async () => {
    const headers = new Headers();
    headers.set('x-restli-id', 'urn:li:share:7193245678901234567');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 201, headers }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: 'urn:li:person:abc',
      accessToken: 'tok',
      post: LI_POST,
    });

    expect(result.ok).toBe(true);
    expect(result.externalPostId).toBe('urn:li:share:7193245678901234567');
    expect(result.externalPostUrl).toBe(
      'https://www.linkedin.com/feed/update/urn:li:share:7193245678901234567/',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    expect((init.headers as Record<string, string>)['linkedin-version']).toMatch(
      /^\d{6}$/,
    );
    expect((init.headers as Record<string, string>)['x-restli-protocol-version']).toBe(
      '2.0.0',
    );
    const body = JSON.parse(init.body as string);
    expect(body.author).toBe('urn:li:person:abc');
    expect(body.lifecycleState).toBe('PUBLISHED');
    expect(body.content.article.source).toBe(LI_POST.contentUrl);
  });

  it('401 → token_invalid (permanent)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('expired', { status: 401 })) as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: 'urn:li:person:abc',
      accessToken: 'tok',
      post: LI_POST,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('token_invalid');
    expect(isRetryable(result.errorCode)).toBe(false);
  });

  it('403 → permission_denied (permanent)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('no scope', { status: 403 })) as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: 'urn:li:person:abc',
      accessToken: 'tok',
      post: LI_POST,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('permission_denied');
  });

  it('429 → rate_limited (retryable)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('throttled', { status: 429 })) as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: 'urn:li:person:abc',
      accessToken: 'tok',
      post: LI_POST,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('rate_limited');
    expect(isRetryable(result.errorCode)).toBe(true);
  });

  it('500 → transient_5xx (retryable)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: 'urn:li:person:abc',
      accessToken: 'tok',
      post: LI_POST,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('transient_5xx');
    expect(isRetryable(result.errorCode)).toBe(true);
  });

  it('network error → network_timeout (retryable)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: 'urn:li:person:abc',
      accessToken: 'tok',
      post: LI_POST,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('network_timeout');
    expect(isRetryable(result.errorCode)).toBe(true);
  });
});
