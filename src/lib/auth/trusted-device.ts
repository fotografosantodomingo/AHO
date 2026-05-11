/**
 * Trusted-device cookie + OTP helpers for the post-Turnstile sign-in
 * flow. See migrations 0046 (auth_trusted_devices) and 0047
 * (auth_login_challenges) for the table contracts. The cookie value is
 * a base64url-encoded 32-byte random token; only sha256(token) is
 * persisted, so neither the route layer nor the DB ever sees a value
 * that could be reused without the live cookie.
 */

export const TRUSTED_DEVICE_COOKIE = 'aho-trusted-device';
/** PO directive 2026-05-10 — Google-style "remember this device" window. */
export const TRUSTED_DEVICE_TTL_DAYS = 90;
export const TRUSTED_DEVICE_TTL_SECONDS = TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60;
/** OTP code length used for both the email body and the input UI. */
export const OTP_CODE_LENGTH = 6;
/** OTP validity window. PO directive 2026-05-10. */
export const OTP_TTL_MINUTES = 15;
/** Cap on wrong-code attempts per challenge before forcing a restart. */
export const OTP_MAX_ATTEMPTS = 5;
/** Cap on resend requests per challenge (initial send not counted). */
export const OTP_MAX_RESENDS = 3;

/**
 * 32 bytes of crypto-random data, base64url-encoded → 43 chars. Edge
 * runtime exposes the WebCrypto API as `crypto.getRandomValues`.
 */
export function generateDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * 6-digit numeric code, zero-padded. We could use a wider alphabet but
 * humans copy-paste digits with fewer "is that an O or a 0?" mistakes.
 */
export function generateOtpCode(): string {
  // Crypto-random integer in [0, 1_000_000). One call to getRandomValues
  // gives 4 bytes → 32 bits → modulo 1e6 introduces negligible bias for
  // a 6-digit code (max bias < 1e-3 across the whole space).
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String((buf[0] ?? 0) % 1_000_000).padStart(OTP_CODE_LENGTH, '0');
}

/**
 * SHA-256 of the input string; returns the bytea-literal string form
 * (`\xHEX...`) that PostgREST expects for `bytea` columns.
 *
 * Why not Uint8Array: supabase-js ships values through `JSON.stringify`,
 * which serializes a Uint8Array as `{"0":N,"1":N,...}` rather than the
 * bytea hex format. The column then stores the JSON-stringified object
 * (incorrect), and round-trip comparisons fail. Using the bytea literal
 * keeps both writes and reads going through plain strings, and PostgREST
 * returns bytea reads in the same `\xHEX` form, so equality comparisons
 * are direct string compares.
 */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return `\\x${hex}`;
}

/**
 * Cookie attributes for the trusted-device cookie. HttpOnly so JS
 * can't exfiltrate it; SameSite=Lax so it survives normal navigations
 * but blocks third-party use; Secure so it's HTTPS-only.
 *
 * Returned as a NextResponse.cookies.set() options object — no
 * "Secure" property when the request is over plain http (local dev).
 */
export function trustedDeviceCookieOptions(opts: {
  /** Whether the request was secure (https). When false, omit Secure
   *  so the cookie still sets in local-dev preview. Production is
   *  always https behind Cloudflare. */
  secure: boolean;
}): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure,
    path: '/',
    maxAge: TRUSTED_DEVICE_TTL_SECONDS,
  };
}

/**
 * Best-effort short label for a User-Agent string, e.g.:
 *   - "Chrome on macOS"
 *   - "Safari on iPhone"
 *   - "Firefox on Windows"
 *   - falls back to the raw UA truncated to 60 chars
 *
 * Not for security; purely cosmetic for the future devices list and
 * the verification email body.
 */
export function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  // Order matters — Edge's UA contains "Chrome", iOS Chrome contains
  // "Safari", etc. Match the more-specific names first.
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';

  let os = 'Unknown OS';
  if (/iPhone|iPad|iPod/.test(ua)) os = /iPad/.test(ua) ? 'iPad' : 'iPhone';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} on ${os}`;
}

/**
 * Pull the client IP from the standard Cloudflare/forwarded headers.
 * Falls back to null when neither is set (local dev curls without
 * a proxy header).
 */
export function getClientIp(headers: Headers): string | null {
  return (
    headers.get('cf-connecting-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  );
}

/**
 * Pull the country code from Cloudflare's enrichment header. Returns
 * the raw 2-letter ISO code (uppercase) or null.
 */
export function getClientCountry(headers: Headers): string | null {
  const c = headers.get('cf-ipcountry');
  if (!c || c === 'XX' || c === 'T1') return null; // T1 = Tor exit
  return c.toUpperCase();
}

/**
 * URL-safe base64 encoder for crypto-random tokens (no padding, +/ → -_).
 * Edge runtime has `btoa` but it operates on Latin-1 strings, so we go
 * via String.fromCharCode on the bytes directly.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
