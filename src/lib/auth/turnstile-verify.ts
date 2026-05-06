import 'server-only';

/**
 * Cloudflare Turnstile server-side verification.
 *
 * Used by `/api/leads` to validate the captcha token issued by the
 * Turnstile widget on the contact form. Same widget + same secret as
 * Supabase Auth's captcha — the secret is shared (PO directive
 * 2026-05-06; pulled from `security_captcha_secret` in the Supabase
 * auth config and stored as `TURNSTILE_SECRET_KEY` in our env).
 *
 * Verification contract:
 *   - POST to https://challenges.cloudflare.com/turnstile/v0/siteverify
 *   - body: { secret, response, remoteip? }
 *   - response.success === true → token is valid (single-use; redeem only once)
 *   - response.success === false → reject with the error_codes returned
 *
 * Behavior:
 *   - When TURNSTILE_SECRET_KEY is unset, returns `{ skipped: true }` —
 *     local dev / preview environments without the secret don't break.
 *   - On network failure (siteverify unreachable), returns
 *     `{ valid: false, error: 'siteverify_unreachable' }` — fail closed,
 *     not open. Keeps spam from sneaking through during a Cloudflare blip.
 *
 * Edge-safe: pure fetch + JSON parse. No Node.js builtins.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileVerifyResult =
  | { skipped: true }
  | { valid: true }
  | { valid: false; error: string };

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
}

/**
 * Verify a Turnstile token by calling Cloudflare's siteverify endpoint.
 *
 * Returns the typed result; never throws.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Local dev / preview without the secret. Caller decides whether to
    // hard-fail or pass-through; our default in /api/leads is to skip in
    // dev (so the form works) and require in prod (gated by the route's
    // own NODE_ENV check).
    return { skipped: true };
  }
  if (!token || token.length === 0) {
    return { valid: false, error: 'missing_token' };
  }

  const formData = new URLSearchParams();
  formData.append('secret', secret);
  formData.append('response', token);
  if (remoteIp) formData.append('remoteip', remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: formData,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    });
    const data = (await res.json().catch(() => ({}))) as SiteverifyResponse;
    if (data.success) return { valid: true };
    const code = data['error-codes']?.[0] ?? `http_${res.status}`;
    return { valid: false, error: code };
  } catch {
    // Fail closed: if siteverify is unreachable, reject. Spam getting
    // through during a CF blip is worse than legit users hitting an
    // error and retrying.
    return { valid: false, error: 'siteverify_unreachable' };
  }
}
