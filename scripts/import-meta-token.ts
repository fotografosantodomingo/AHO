/**
 * Manual Meta token import — bypasses the OAuth dialog entirely.
 *
 * Used when the OAuth Configuration flow on advertisehomes.online is
 * blocked (Meta Login for Business setup gremlins, App Review still
 * pending, dev-account weirdness, whatever). The PO generates a
 * short-lived user access token via Graph API Explorer
 * (https://developers.facebook.com/tools/explorer), pastes it here,
 * and the script does what the OAuth callback would have done:
 *
 *   1. Exchange short-lived → long-lived (~60d) user token.
 *   2. Fetch /me to get the FB user id + display name.
 *   3. Fetch /me/accounts for the user's managed Pages + their Page
 *      tokens + linked IG Business accounts.
 *   4. Encrypted-upsert into ad_platform_tokens for the AHO user_id
 *      passed in env.
 *
 * The end result is identical to a successful OAuth callback —
 * /dashboard/social will render "Connected as <name>" + the Pages list,
 * and downstream publish endpoints can use the stored Page tokens.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   DEV_META_AHO_USER_ID=<aho-supabase-user-uuid> \
 *   DEV_META_USER_TOKEN='<short-lived-token-from-explorer>' \
 *   pnpm tsx scripts/import-meta-token.ts
 *
 * Env required:
 *   - META_APP_ID + META_APP_SECRET — for the long-lived exchange
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — for upsert RPC
 *   - AHO_TOKEN_ENCRYPTION_KEY — for token encryption-at-rest
 *   - DEV_META_AHO_USER_ID — which AHO user this token belongs to
 *   - DEV_META_USER_TOKEN — the token pasted from Graph API Explorer
 */
import { createClient } from '@supabase/supabase-js';

const META_GRAPH = 'https://graph.facebook.com/v21.0';

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = process.env.AHO_TOKEN_ENCRYPTION_KEY;
const AHO_USER_ID = process.env.DEV_META_AHO_USER_ID;
const USER_TOKEN = process.env.DEV_META_USER_TOKEN;

if (!APP_ID || !APP_SECRET || !SUPABASE_URL || !SERVICE_KEY || !ENCRYPTION_KEY || !AHO_USER_ID || !USER_TOKEN) {
  console.error(
    'Missing env. Need: META_APP_ID, META_APP_SECRET, (NEXT_PUBLIC_)SUPABASE_URL, ' +
      'SUPABASE_SERVICE_ROLE_KEY, AHO_TOKEN_ENCRYPTION_KEY, DEV_META_AHO_USER_ID, ' +
      'DEV_META_USER_TOKEN.',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

interface GraphAccessTokenRes {
  access_token: string;
  token_type: string;
  expires_in?: number;
}
interface GraphMeRes {
  id: string;
  name: string;
}
interface GraphPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  instagram_business_account?: { id: string };
}
interface GraphPagesRes {
  data: GraphPage[];
}

async function exchangeForLongLived(shortToken: string): Promise<GraphAccessTokenRes> {
  const url = new URL(`${META_GRAPH}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', APP_ID!);
  url.searchParams.set('client_secret', APP_SECRET!);
  url.searchParams.set('fb_exchange_token', shortToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`exchangeForLongLived HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as GraphAccessTokenRes;
}

async function fetchMe(token: string): Promise<GraphMeRes> {
  const url = new URL(`${META_GRAPH}/me`);
  url.searchParams.set('fields', 'id,name');
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`fetchMe HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as GraphMeRes;
}

async function fetchPages(token: string): Promise<GraphPage[]> {
  const url = new URL(`${META_GRAPH}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token,category,instagram_business_account');
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`fetchPages HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as GraphPagesRes;
  return json.data ?? [];
}

async function upsert(args: {
  externalAccountId: string;
  displayName: string;
  accessToken: string;
  expiresAt: string | null;
  scopes: string[];
}): Promise<void> {
  const { error } = await supabase.rpc('upsert_platform_token', {
    p_user_id: AHO_USER_ID!,
    p_platform: 'meta',
    p_external_account_id: args.externalAccountId,
    p_display_name: args.displayName,
    p_access_token: args.accessToken,
    p_refresh_token: null,
    p_expires_at: args.expiresAt,
    p_scopes: args.scopes,
    p_user_agent: 'scripts/import-meta-token.ts',
    p_ip_address: '127.0.0.1',
    p_key: ENCRYPTION_KEY!,
  });
  if (error) throw new Error(`upsert_platform_token: ${error.message}`);
}

async function main(): Promise<void> {
  console.log('1/4 — exchanging short-lived → long-lived user token…');
  const longLived = await exchangeForLongLived(USER_TOKEN!);
  const expiresAt = longLived.expires_in
    ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
    : null;
  console.log(`     long-lived token acquired, expires_in=${longLived.expires_in ?? '∞'}`);

  console.log('2/4 — fetching /me…');
  const me = await fetchMe(longLived.access_token);
  console.log(`     FB user: ${me.name} (id=${me.id})`);

  console.log('3/4 — fetching /me/accounts (Pages + linked IG)…');
  const pages = await fetchPages(longLived.access_token);
  console.log(`     ${pages.length} Page(s) found.`);
  for (const p of pages) {
    const igLabel = p.instagram_business_account?.id
      ? ` (IG Business: ${p.instagram_business_account.id})`
      : '';
    console.log(`     - ${p.name} (id=${p.id}, ${p.category ?? '—'})${igLabel}`);
  }

  console.log('4/4 — encrypted-upsert into ad_platform_tokens…');

  // (a) User token row.
  await upsert({
    externalAccountId: me.id,
    displayName: me.name,
    accessToken: longLived.access_token,
    expiresAt,
    scopes: [
      'public_profile',
      'email',
      'pages_show_list',
      'pages_manage_posts',
      'pages_read_engagement',
      'business_management',
    ],
  });
  console.log(`     ✓ user token (${me.id})`);

  // (b) One row per Page.
  for (const p of pages) {
    await upsert({
      externalAccountId: `page:${p.id}`,
      displayName: `${p.name}${p.category ? ` (${p.category})` : ''}`,
      accessToken: p.access_token,
      expiresAt: null,
      scopes: ['pages_manage_posts', 'pages_read_engagement'],
    });
    console.log(`     ✓ page: ${p.name}`);

    // (c) IG Business pointer if present (uses the same Page token).
    if (p.instagram_business_account?.id) {
      await upsert({
        externalAccountId: `ig:${p.instagram_business_account.id}`,
        displayName: `Instagram (${p.name})`,
        accessToken: p.access_token,
        expiresAt: null,
        scopes: ['instagram_basic', 'instagram_content_publish'],
      });
      console.log(`     ✓ ig: ${p.instagram_business_account.id}`);
    }
  }

  console.log('\nDone. Refresh /dashboard/social to see the connected state.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
