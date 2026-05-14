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
  imageUrl: 'https://imagedelivery.net/abc/img-1/igsquare',
};

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
    expect((init1?.body as URLSearchParams).get('image_url')).toBe(IG_POST.imageUrl);
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

  it('returns image_required if the post somehow lacks imageUrl', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await publishToInstagramBusiness({
      igId: 'IG_BIZ_1',
      pageToken: 'tok',
      post: { caption: 'no image', imageUrl: '' } as InstagramPost,
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
// publishToLinkedIn (stub)
// ============================================================

describe('publish · publishToLinkedIn (stub)', () => {
  it('always returns oauth_not_implemented (permanent until partner approval lands)', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishToLinkedIn({
      authorUrn: 'urn:li:person:fixture',
      accessToken: 'tok',
      post: LI_POST,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('oauth_not_implemented');
    expect(isRetryable(result.errorCode)).toBe(false);
    expect(result.errorMessage).toContain('LinkedIn');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
