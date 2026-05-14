import 'server-only';
import { serverEnv } from '@/lib/env';

/**
 * Account-less unsubscribe links — every campaign email carries a
 * `?email=&sig=` URL pointing at /api/email/unsubscribe. The sig is
 * HMAC-SHA256(email, AHO_TOKEN_ENCRYPTION_KEY), so anyone with the
 * link can unsubscribe without logging in, but no one can forge a
 * link to unsubscribe someone else.
 *
 * Key reuse note: we use AHO_TOKEN_ENCRYPTION_KEY (already in env;
 * also signs the OAuth state cookie) instead of a dedicated email
 * secret. Different surfaces, but acceptable for v1 — keeps PO
 * env-var management lighter. Rotate the env key ⇒ every previous
 * unsubscribe link breaks (an unsubscribed user would need to click
 * a fresh link); same trade-off applies for the OAuth state cookie.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://advertisehomes.online';

export function buildUnsubscribeUrl(email: string): string {
  const sig = signEmailSync(email);
  const u = new URL('/api/email/unsubscribe', SITE_URL);
  u.searchParams.set('email', email);
  u.searchParams.set('sig', sig);
  return u.toString();
}

/**
 * Async (Web Crypto) HMAC verify used by the route handler.
 * Constant-time compare via XOR mismatch accumulator.
 */
export async function verifyEmailSignature({
  email,
  signature,
}: {
  email: string;
  signature: string;
}): Promise<boolean> {
  const expected = await signEmail(email);
  return constantTimeEqual(signature.toLowerCase(), expected.toLowerCase());
}

async function signEmail(email: string): Promise<string> {
  const secret = getSecret();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(email.toLowerCase().trim()),
  );
  return bufferToHex(sig);
}

/**
 * Sync version used by buildUnsubscribeUrl. Falls back to a
 * deterministic-but-non-Web-Crypto path because this module is
 * called from non-async code paths (email-template builders run
 * inside transactional handlers that synchronously assemble HTML).
 * Uses an inline HMAC-SHA256 implementation that matches the async
 * Web Crypto output byte-for-byte.
 */
function signEmailSync(email: string): string {
  const secret = getSecret();
  const key = new TextEncoder().encode(secret);
  const msg = new TextEncoder().encode(email.toLowerCase().trim());
  const digest = hmacSha256Sync(key, msg);
  return bufferToHex(digest.buffer as ArrayBuffer);
}

function getSecret(): string {
  const { AHO_TOKEN_ENCRYPTION_KEY } = serverEnv();
  if (!AHO_TOKEN_ENCRYPTION_KEY) {
    throw new Error('AHO_TOKEN_ENCRYPTION_KEY not set; cannot sign unsubscribe links');
  }
  return AHO_TOKEN_ENCRYPTION_KEY;
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Pure JS HMAC-SHA256 — small inline implementation. Used only by the
 * sync template-builder path; the route handler uses Web Crypto.
 */
function hmacSha256Sync(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) {
    k = sha256(k);
  }
  if (k.length < blockSize) {
    const padded = new Uint8Array(blockSize);
    padded.set(k);
    k = padded;
  }
  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = k[i]! ^ 0x5c;
    iKeyPad[i] = k[i]! ^ 0x36;
  }
  const inner = sha256(concat(iKeyPad, message));
  return sha256(concat(oKeyPad, inner));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// --- Minimal SHA-256 (RFC 6234). Used only by the sync path. -------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(msg: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const l = msg.length;
  const bitLen = l * 8;
  const padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  for (let i = 0; i < padded.length; i += 64) {
    const w = new Uint32Array(64);
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15]!, 7) ^ rotr(w[j - 15]!, 18) ^ (w[j - 15]! >>> 3);
      const s1 = rotr(w[j - 2]!, 17) ^ rotr(w[j - 2]!, 19) ^ (w[j - 2]! >>> 10);
      w[j] = (w[j - 16]! + s0 + w[j - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [H[0]!, H[1]!, H[2]!, H[3]!, H[4]!, H[5]!, H[6]!, H[7]!];
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j]! + w[j]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0; H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0; H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0; H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0; H[7] = (H[7]! + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]!, false);
  return out;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}
