import 'server-only';
import { publicEnv } from '@/lib/env';

/**
 * IndexNow protocol client.
 *
 * IndexNow is the modern way to tell search engines "here is a new/changed
 * URL — please re-crawl now." Supported natively by Bing + Yandex + Seznam
 * + Naver. Google says "we evaluate it" but doesn't formally support;
 * however Cloudflare's IndexNow integration auto-translates pings into
 * Google's now-deprecated /ping endpoint so the signal lands there too.
 *
 * Spec: https://www.indexnow.org/documentation
 *
 * Endpoint: https://api.indexnow.org/IndexNow accepts a JSON body
 *   {
 *     "host": "advertisehomes.online",
 *     "key": "<32-char hex>",
 *     "keyLocation": "https://advertisehomes.online/<32-char>.txt",
 *     "urlList": ["https://advertisehomes.online/...", ...]
 *   }
 *
 * Verification: the key file at /<32-char>.txt must contain ONLY the same
 * 32-char key (no whitespace, no newline). Served by the matching Next
 * route at src/app/[key].txt/route.ts.
 *
 * Errors are SWALLOWED — we never want a sitemap signal to block a real
 * user action (publish, edit). Logged for ops visibility.
 */

const INDEXNOW_KEY = 'fe23afa28920273afd39958484c4f0e8';
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';

export const INDEXNOW_KEY_FILE_PATH = `/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_KEY_VALUE = INDEXNOW_KEY;

/**
 * Submit one or more URLs to IndexNow. Best-effort: failures log but
 * don't throw. Returns true on 200/202, false otherwise.
 *
 * Bulk submission: up to 10,000 URLs per request per spec. We don't
 * batch internally — callers should keep their lists reasonable
 * (typically 1-5 URLs per publish event).
 */
export async function pingIndexNow(urls: string[]): Promise<boolean> {
  if (urls.length === 0) return true;

  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  let host: string;
  try {
    host = new URL(site).host;
  } catch {
    console.warn('[indexnow] invalid NEXT_PUBLIC_SITE_URL, skipping');
    return false;
  }

  const body = {
    host,
    key: INDEXNOW_KEY,
    keyLocation: `${site}${INDEXNOW_KEY_FILE_PATH}`,
    urlList: urls,
  };

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 200 || res.status === 202) return true;
    // IndexNow returns specific non-2xx codes for various conditions
    // (429 rate-limited, 422 unprocessable for malformed URLs, 403
    // for key mismatch). All recoverable — log and move on.
    console.warn(
      `[indexnow] ping returned HTTP ${res.status}; ${urls.length} URL(s) not accepted`,
    );
    return false;
  } catch (err) {
    console.warn('[indexnow] ping threw', err);
    return false;
  }
}
