import 'server-only';

/**
 * LinkedIn OAuth 2.0 (3-legged) flow helpers.
 *
 * Per https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow:
 *   1. Redirect user to /oauth/v2/authorization with our Client ID +
 *      redirect_uri + a CSRF state token + the requested scopes.
 *   2. User authorizes on LinkedIn — sees the consent screen with the
 *      app name + scope list.
 *   3. LinkedIn redirects to our callback with `?code=…&state=…`.
 *   4. We exchange `code` for an access_token (~60 days expiry, plus
 *      optional refresh_token if the app is approved for refresh) +
 *      an OIDC `id_token` carrying the user's profile claims.
 *   5. We fetch /v2/userinfo (OpenID Connect endpoint) to get the
 *      member URN suffix (`sub`) + display name + email. The full
 *      author URN for posting is `urn:li:person:{sub}`.
 *
 * Scopes (per `Share on LinkedIn` + `Sign In with LinkedIn using
 * OpenID Connect` products):
 *   - openid + profile + email — OIDC sign-in claims
 *   - w_member_social — publish to the member's own feed
 *
 * Personal-profile only. Company-page posting (w_organization_social)
 * requires Marketing Developer Platform approval and stays v1.1.
 * See DECISIONS.md 2026-05-15.
 */

export const LINKEDIN_OAUTH_BASE = 'https://www.linkedin.com/oauth/v2';
export const LINKEDIN_API_BASE = 'https://api.linkedin.com';

/** Sign-in / identity scopes. Always requested (gated by Sign-In product). */
export const LINKEDIN_IDENTITY_SCOPES = ['openid', 'profile', 'email'] as const;

/** Posting scope. Requested only when env LINKEDIN_PUBLISH_ENABLED='true'
 *  AND the dev app's Share-on-LinkedIn product is Verified. Asking for an
 *  unapproved scope fails the WHOLE flow ("Scope X is not authorized") —
 *  no partial grant. */
export const LINKEDIN_PUBLISH_SCOPES = ['w_member_social'] as const;

/** Full set when both products are approved. Kept for type/runtime checks. */
export const LINKEDIN_SCOPES = [
  ...LINKEDIN_IDENTITY_SCOPES,
  ...LINKEDIN_PUBLISH_SCOPES,
] as const;

/** Pick the scope set to request based on the publish-enabled flag. */
export function chooseScopes(publishEnabled: boolean): readonly string[] {
  return publishEnabled
    ? [...LINKEDIN_IDENTITY_SCOPES, ...LINKEDIN_PUBLISH_SCOPES]
    : [...LINKEDIN_IDENTITY_SCOPES];
}

/**
 * Build the OAuth dialog URL for the start route. The state token is
 * the CSRF guard — the callback verifies it matches the cookie.
 */
export function buildAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  /** Scope list to request. Pass via chooseScopes(publishEnabled). */
  scopes: readonly string[];
}): string {
  const url = new URL(`${LINKEDIN_OAUTH_BASE}/authorization`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('state', args.state);
  url.searchParams.set('scope', args.scopes.join(' '));
  return url.toString();
}

interface ExchangeCodeResponse {
  access_token: string;
  /** Seconds until access_token expiry. LinkedIn issues ~60-day tokens. */
  expires_in: number;
  /** Present only when the app is approved for refresh tokens (most
   *  apps aren't by default — we don't depend on it). */
  refresh_token?: string;
  refresh_token_expires_in?: number;
  /** OIDC id_token carrying the user's profile claims. JWT — we don't
   *  bother decoding it; we hit /v2/userinfo for canonical claims. */
  id_token?: string;
  scope: string;
}

/**
 * Exchange the auth code for an access token. POST to /oauth/v2/accessToken
 * with form-encoded body (LinkedIn requires application/x-www-form-urlencoded
 * for this endpoint, NOT JSON).
 */
export async function exchangeCode(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<ExchangeCodeResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
  });

  const res = await fetch(`${LINKEDIN_OAUTH_BASE}/accessToken`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LinkedIn exchangeCode ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as ExchangeCodeResponse;
}

export interface LinkedInUserInfo {
  /** Member id — the URN suffix. Full URN is `urn:li:person:{sub}`. */
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
  locale?: string;
}

/**
 * Fetch the OIDC userinfo claims for the access token. This is the
 * canonical way to get the member URN suffix needed for posting (the
 * id_token from exchangeCode also carries it but as a JWT — userinfo
 * is simpler and authoritative).
 */
export async function fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
  const res = await fetch(`${LINKEDIN_API_BASE}/v2/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LinkedIn userinfo ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as LinkedInUserInfo;
}

/** Build the author URN expected by the Posts API from a userinfo `sub`. */
export function buildAuthorUrn(sub: string): string {
  return `urn:li:person:${sub}`;
}
