import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * MFA enforcement gate for admin accounts.
 *
 * Per the security model: any user whose `profiles.is_admin = true` must
 * have at least one VERIFIED TOTP factor enrolled before they can access
 * the admin tree (or, by extension, any authenticated dashboard surface).
 * Non-admin users are unaffected — MFA stays opt-in for them.
 *
 * The check is intentionally cheap and runs at layout time so it covers
 * every path into the app: password sign-in, magic link, OAuth callback,
 * etc. Layout returns the redirect URL when enrollment is required, or
 * `null` to allow the page through.
 *
 * Why we don't enforce in middleware: middleware doesn't have a clean
 * RSC-tier signal of "what kind of route is this". Admin enforcement
 * fits naturally in the admin layout (which already has the auth gate
 * + admin gate), and the dashboard layout enforces it for admins
 * passing through the agent UI.
 */

export interface AdminMfaState {
  isAdmin: boolean;
  hasVerifiedFactor: boolean;
  /** True when the caller must redirect the user to the setup interstitial. */
  enrollmentRequired: boolean;
}

/**
 * Compute the admin MFA state for the currently signed-in user.
 *
 * @param supabase A user-context Supabase client (the one returned by
 *   `createServerSupabaseClient()` — NOT the admin client). MFA factors
 *   are user-scoped and the listFactors() call must run as the user.
 * @param userId The auth user id (from `supabase.auth.getUser()`).
 */
export async function getAdminMfaState(
  supabase: SupabaseClient,
  userId: string,
): Promise<AdminMfaState> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle();

  const isAdmin = profile?.is_admin === true;
  if (!isAdmin) {
    return { isAdmin: false, hasVerifiedFactor: false, enrollmentRequired: false };
  }

  // listFactors returns both 'all' and 'totp' arrays; we care about
  // verified TOTP factors specifically. Any verified factor counts as
  // "MFA enrolled" for the gate.
  const { data: factorData, error: factorErr } = await supabase.auth.mfa.listFactors();
  if (factorErr) {
    // Fail-closed for admins on listFactors error: we'd rather over-
    // redirect to the enrollment page than wave a possibly-unprotected
    // admin into the admin panel.
    console.error('admin-mfa: listFactors failed', factorErr);
    return { isAdmin: true, hasVerifiedFactor: false, enrollmentRequired: true };
  }

  const verified = (factorData?.all ?? []).filter((f) => f.status === 'verified');
  const hasVerifiedFactor = verified.length > 0;
  return {
    isAdmin: true,
    hasVerifiedFactor,
    enrollmentRequired: !hasVerifiedFactor,
  };
}

/**
 * Locale-aware path to the MFA setup interstitial. The admin layout
 * imports this so the redirect target stays in lockstep with the
 * page route below.
 *
 * The interstitial deliberately lives OUTSIDE the /dashboard tree
 * (`/setup-mfa` rather than `/dashboard/security/setup-mfa`) so it
 * doesn't inherit the dashboard layout's MFA gate — which would
 * redirect-loop the page back to itself when an admin without a
 * factor opens it. The path is shared across all locales (no
 * localized segment) — this is an admin/security surface, not
 * user-facing copy.
 */
export function adminMfaSetupPath(locale: string): string {
  return `/${locale}/setup-mfa`;
}
