import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * POST /api/oauth/meta/deauthorize
 *
 * Webhook Meta calls when a user removes our app from their Facebook
 * settings (Settings → Apps and Websites → AHO → Remove). Body is a
 * `signed_request` form field — `<sig>.<base64url-payload>` — where:
 *   - sig is HMAC-SHA256(payload, app_secret)
 *   - payload contains `{ user_id, algorithm, issued_at }`
 *
 * We verify the signature, then soft-revoke every ad_platform_tokens
 * row keyed on that FB user id. Page tokens + linked IG Business rows
 * are revoked too because they're scoped via the same user grant.
 *
 * Per Meta's spec we MUST respond with a Confirmation Code URL the
 * user can visit to verify the deauthorization. We render a tiny page
 * at `/oauth/meta/deauthorized?id=<token>` and return its URL here.
 *
 * Do NOT require auth: this endpoint is hit by Meta's servers, not by
 * the user. CSRF doesn't apply because the signature is the auth.
 */
export async function POST(req: NextRequest) {
  const env = serverEnv();
  if (!env.META_APP_SECRET) {
    return NextResponse.json({ error: 'meta_not_configured' }, { status: 503 });
  }

  let signedRequest: string | null = null;
  try {
    const form = await req.formData();
    const v = form.get('signed_request');
    if (typeof v === 'string') signedRequest = v;
  } catch {
    /* fall through */
  }
  if (!signedRequest) {
    return NextResponse.json({ error: 'missing_signed_request' }, { status: 400 });
  }

  const verified = await verifySignedRequest(signedRequest, env.META_APP_SECRET);
  if (!verified) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  // Soft-revoke every meta token row tied to this FB user id (covers
  // the user-token row keyed on `me.id`, every `page:*` row, every
  // `ig:*` row — all of them were inserted under our internal user_id,
  // not the FB id; we look them up via the user-token row's external_id).
  const admin = createAdminClient();
  // Find the AHO user(s) connected via this FB id, then revoke all
  // their meta tokens. There should be exactly one — we're keyed on
  // (user_id, platform, external_account_id) so the FB id maps to one
  // AHO account.
  const { data: rows } = await admin
    .from('ad_platform_tokens')
    .select('user_id')
    .eq('platform', 'meta')
    .eq('external_account_id', verified.user_id);

  for (const row of rows ?? []) {
    await admin
      .from('ad_platform_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', row.user_id as string)
      .eq('platform', 'meta');
  }

  // Confirmation Code URL. Meta will display this to the user as
  // "Visit this URL to confirm removal." The page just shows a status
  // message — there's no interactive step.
  const code = `meta-deauth-${crypto.randomUUID()}`;
  // (We don't persist the code; the URL is informational.)
  return NextResponse.json({
    url: `https://advertisehomes.online/oauth/meta/deauthorized?id=${code}`,
    confirmation_code: code,
  });
}

interface SignedPayload {
  user_id: string;
  algorithm: string;
  issued_at: number;
}

async function verifySignedRequest(
  signedRequest: string,
  appSecret: string,
): Promise<SignedPayload | null> {
  const parts = signedRequest.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedSig, encodedPayload] = parts;

  const sigBytes = base64UrlDecode(encodedSig);
  const payloadBytes = base64UrlDecode(encodedPayload);
  if (!sigBytes || !payloadBytes) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes as BufferSource,
    new TextEncoder().encode(encodedPayload),
  );
  if (!ok) return null;

  let parsed: SignedPayload;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as SignedPayload;
  } catch {
    return null;
  }
  if (parsed.algorithm !== 'HMAC-SHA256') return null;
  if (!parsed.user_id) return null;
  return parsed;
}

function base64UrlDecode(input: string): Uint8Array | null {
  try {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  } catch {
    return null;
  }
}
