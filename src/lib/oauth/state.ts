import 'server-only';

/**
 * Signed-cookie CSRF state for OAuth flows. The state value is a
 * random UUID; the cookie carries `{state}.{hmac}` where the HMAC is
 * keyed on a server-side secret. Callback verifies HMAC + state match
 * before exchanging the code.
 *
 * Why not just trust a plain state cookie: a plain cookie is set by
 * the browser without origin restrictions in some flows, and an
 * attacker could plant a state value via a sub-domain. Signing pins
 * the state to a value WE generated.
 *
 * Edge runtime — uses Web Crypto subtle. Same primitive as the
 * Stripe webhook signature path.
 */

const STATE_COOKIE_NAME = 'aho_oauth_state';
/** 10-minute TTL on the cookie — long enough for a careful user to
 *  read FB's prompt + click Authorize, short enough that abandoned
 *  flows don't leave dangling cookies. */
const STATE_TTL_MS = 10 * 60 * 1000;

interface SignedState {
  state: string;
  /** Where to bounce the user after the callback succeeds (the dashboard
   *  social tab in the active locale). Stored in the same payload so the
   *  callback doesn't have to look it up. */
  returnTo: string;
  expiresAt: number;
}

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i] as number);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * Generate a fresh CSRF state and the signed-cookie value carrying it.
 * Returns both — caller renders the state into the OAuth URL and sets
 * the cookie on the response.
 */
export async function buildState(args: {
  secret: string;
  returnTo: string;
}): Promise<{ state: string; cookieValue: string; cookieMaxAgeSeconds: number }> {
  const state = crypto.randomUUID();
  const expiresAt = Date.now() + STATE_TTL_MS;
  const payload: SignedState = { state, returnTo: args.returnTo, expiresAt };
  const payloadJson = JSON.stringify(payload);
  const key = await hmacKey(args.secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadJson));
  const cookieValue = `${toBase64Url(enc.encode(payloadJson).buffer as ArrayBuffer)}.${toBase64Url(sig)}`;
  return {
    state,
    cookieValue,
    cookieMaxAgeSeconds: Math.floor(STATE_TTL_MS / 1000),
  };
}

/**
 * Verify the cookie + match the state. Returns the parsed payload on
 * success, or null on any failure mode (tampered cookie, expired,
 * state mismatch).
 */
export async function verifyState(args: {
  secret: string;
  cookieValue: string;
  state: string;
}): Promise<SignedState | null> {
  const parts = args.cookieValue.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(parts[0]);
    sigBytes = fromBase64Url(parts[1]);
  } catch {
    return null;
  }

  const key = await hmacKey(args.secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes as BufferSource,
    payloadBytes as BufferSource,
  );
  if (!ok) return null;

  let payload: SignedState;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as SignedState;
  } catch {
    return null;
  }
  if (payload.expiresAt < Date.now()) return null;
  if (payload.state !== args.state) return null;
  return payload;
}

export const STATE_COOKIE = STATE_COOKIE_NAME;
