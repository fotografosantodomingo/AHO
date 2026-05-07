import 'server-only';

/**
 * Meta (Facebook + Instagram Business) OAuth flow helpers.
 *
 * Flow per https://developers.facebook.com/docs/facebook-login/guides/access-tokens:
 *   1. Redirect user to dialog/oauth with our App ID + redirect_uri +
 *      requested scopes + a CSRF state token.
 *   2. User authorizes on Facebook.
 *   3. FB redirects to our callback with `?code=…&state=…`.
 *   4. We exchange `code` for a short-lived user access token (~1h).
 *   5. We exchange the short-lived token for a long-lived (~60d) token.
 *   6. We fetch the user's id + name + their managed Pages with their
 *      respective Page tokens, and store everything encrypted.
 *
 * Scopes we ask for (matches the Day 4 Meta App Review submission):
 *   - public_profile + email — base login (auto-granted, no review needed)
 *   - pages_show_list — list the user's FB Pages so they can pick one
 *   - pages_manage_posts — publish on behalf of a Page
 *   - pages_read_engagement — read post stats for our analytics dashboard
 *   - instagram_basic — list the IG Business accounts linked to a Page
 *   - instagram_content_publish — publish to IG Business
 *   - business_management — required when posts target Business-Managed
 *     pages (most agency / agent setups)
 */

export const META_GRAPH_VERSION = 'v21.0';
export const META_OAUTH_DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export const META_SCOPES = [
  'public_profile',
  'email',
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
] as const;

/**
 * Build the OAuth dialog URL for the start route. The state token is
 * the CSRF guard — the callback verifies it matches the cookie.
 */
export function buildAuthUrl(args: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(META_OAUTH_DIALOG);
  url.searchParams.set('client_id', args.appId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('state', args.state);
  url.searchParams.set('scope', META_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

interface ExchangeCodeResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

/** Step 4: short-lived user token from the auth code. */
export async function exchangeCode(args: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<ExchangeCodeResponse> {
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('client_id', args.appId);
  url.searchParams.set('client_secret', args.appSecret);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('code', args.code);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`exchangeCode HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as ExchangeCodeResponse;
}

/** Step 5: long-lived (~60d) user token from the short-lived one. */
export async function exchangeForLongLived(args: {
  appId: string;
  appSecret: string;
  shortToken: string;
}): Promise<ExchangeCodeResponse> {
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', args.appId);
  url.searchParams.set('client_secret', args.appSecret);
  url.searchParams.set('fb_exchange_token', args.shortToken);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`exchangeForLongLived HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as ExchangeCodeResponse;
}

interface MetaUserMe {
  id: string;
  name: string;
  email?: string;
}

/** Read the FB user's id + display name with the long-lived token. */
export async function fetchMe(token: string): Promise<MetaUserMe> {
  const url = new URL(`${META_GRAPH_BASE}/me`);
  url.searchParams.set('fields', 'id,name,email');
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`fetchMe HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as MetaUserMe;
}

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  /** Linked Instagram Business account, if any. */
  instagram_business_account?: { id: string };
}

interface PagesListResponse {
  data: MetaPage[];
}

/**
 * List the user's managed FB Pages with their Page tokens. Returns
 * `instagram_business_account` when the page has a linked IG Business
 * profile (this is what we publish to for IG).
 */
export async function fetchPages(userToken: string): Promise<MetaPage[]> {
  const url = new URL(`${META_GRAPH_BASE}/me/accounts`);
  url.searchParams.set(
    'fields',
    'id,name,access_token,category,instagram_business_account',
  );
  url.searchParams.set('access_token', userToken);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`fetchPages HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as PagesListResponse;
  return json.data ?? [];
}
