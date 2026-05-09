import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  checkLockout,
  pruneAuthFailures,
  recordAuthFailure,
} from '@/lib/auth/lockout';

export const runtime = 'edge';

/**
 * POST /api/auth/signin
 *
 * Server-side wrapper around `supabase.auth.signInWithPassword` that
 * layers progressive lockout (see src/lib/auth/lockout.ts) on top of
 * the Supabase auth call. The browser form posts here instead of
 * calling the supabase client directly so we get one canonical place
 * to count failures + apply the cooldown.
 *
 * Flow:
 *   1. Validate body → email + password (+ optional Turnstile token).
 *   2. checkLockout(email) — if blocked, record one more failure
 *      (so an attacker pounding on a locked-out account doesn't
 *      reset their own clock) and return 429 with retry-after.
 *   3. supabase.auth.signInWithPassword(...). On error → record
 *      failure and propagate the Supabase error verbatim.
 *   4. On success → prune the user's failure log and return 200.
 *      Cookies set by the cookie-aware server client carry the
 *      session back to the browser automatically.
 *
 * MFA: this endpoint does NOT enforce admin MFA. The Supabase token
 * is issued at AAL1 and the layout-level enforcer in
 * `src/lib/auth/admin-mfa.ts` redirects admin users without a
 * verified factor to /dashboard/security/setup-mfa on their next
 * server-rendered page. Doing it at layout time means the rule
 * survives any path the user takes into the app (OAuth callback,
 * magic link, password sign-in).
 */

const SignInBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  captchaToken: z.string().optional(),
});

interface SignInErrorBody {
  error: string;
  message?: string;
  reason?: string;
  retryAfter?: string;
}

interface SignInSuccessBody {
  ok: true;
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = SignInBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json<SignInErrorBody>(
      { error: 'invalid_request' },
      { status: 400 },
    );
  }
  const { email, password, captchaToken } = parsed.data;

  const remoteIp =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const userAgent = req.headers.get('user-agent') ?? null;

  // Step 1 — lockout gate. Record a failure even when blocked so an
  // attacker hammering the locked account can't reset the clock by
  // their own behavior.
  const lockout = await checkLockout(email);
  if (lockout.blocked) {
    await recordAuthFailure({ email, ip: remoteIp, userAgent });
    return NextResponse.json<SignInErrorBody>(
      {
        error: 'locked_out',
        reason: lockout.reason,
        retryAfter: lockout.retryAfter?.toISOString(),
      },
      {
        status: 429,
        headers: lockout.retryAfter
          ? {
              'retry-after': String(
                Math.max(
                  1,
                  Math.ceil((lockout.retryAfter.getTime() - Date.now()) / 1000),
                ),
              ),
            }
          : {},
      },
    );
  }

  // Step 2 — let Supabase verify the credential. The cookie-aware
  // server client persists the session via Set-Cookie on the
  // response.
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });

  if (error) {
    await recordAuthFailure({ email, ip: remoteIp, userAgent });
    return NextResponse.json<SignInErrorBody>(
      { error: 'invalid_credentials', message: error.message },
      { status: 401 },
    );
  }

  // Step 3 — success. Wipe the failure history so a stale streak
  // doesn't carry forward to the user's next session.
  await pruneAuthFailures(email);
  return NextResponse.json<SignInSuccessBody>({ ok: true }, { status: 200 });
}
