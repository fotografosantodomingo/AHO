import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getCurrentUserOrgPlan,
  isOrgOnProAutomation,
} from '@/lib/billing/plan-gating';
import { serverEnv } from '@/lib/env';
import { META_GRAPH_BASE } from '@/lib/oauth/meta';

export const runtime = 'edge';

/**
 * POST /api/social/connection-test
 *
 * Phase G of docs/SOCIAL_AUTOMATION_PLAN.md — connection-test endpoint.
 * The agent (or our future "Test connection" button next to each
 * account in ConnectMetaSection) hits this with a platform +
 * external_account_id; we decrypt the stored token and call a benign
 * Meta Graph endpoint to confirm the token still works without
 * publishing anything.
 *
 * Per the skill `social-platform-integration` step #8:
 *   "Add a connection test endpoint the agent can hit from the Settings
 *    UI to verify their token still works."
 *
 * Returns:
 *   200 { ok: true, platform, externalAccountId, displayName,
 *         expiresAt, scopes, lastChecked }
 *   200 { ok: false, errorCode, errorMessage, ... } when the token is
 *         broken/expired/revoked at the platform side (still 200 because
 *         the request itself worked — the OUTCOME is failure)
 *   4xx for caller errors (auth, plan, no_token, invalid_input)
 *
 * Auth + Pro Automation gate mirrors /api/social/post.
 */

const BodySchema = z.object({
  platform: z.enum(['meta', 'linkedin']),
  externalAccountId: z.string().min(1).max(200),
});

type CheckErrorCode =
  | 'token_invalid'
  | 'permission_denied'
  | 'rate_limited'
  | 'transient_5xx'
  | 'network_timeout'
  | 'oauth_not_implemented'
  | 'unknown';

interface MetaApiError {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
}

function categorize(
  status: number,
  body: MetaApiError,
): { code: CheckErrorCode; message: string } {
  const e = body.error ?? {};
  const msg = e.message ?? `HTTP ${status}`;
  if (e.code === 190) return { code: 'token_invalid', message: msg };
  if (e.code === 200) return { code: 'permission_denied', message: msg };
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) {
    return { code: 'rate_limited', message: msg };
  }
  if (status === 401) return { code: 'token_invalid', message: msg };
  if (status === 403) return { code: 'permission_denied', message: msg };
  if (status === 429) return { code: 'rate_limited', message: msg };
  if (status >= 500 && status < 600) return { code: 'transient_5xx', message: msg };
  return { code: 'unknown', message: msg };
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }
  const userId = userResult.user.id;

  const ctx = await getCurrentUserOrgPlan(supabase);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, errorCode: 'no_org' },
      { status: 403 },
    );
  }
  if (!(await isOrgOnProAutomation(supabase, ctx.orgId))) {
    return NextResponse.json(
      { ok: false, errorCode: 'plan_required', requiredPlan: 'pro_automation' },
      { status: 403 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'invalid_input',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  // Look up token via RLS owner-select (user reads their own rows). The
  // .eq('user_id', userId) is defense-in-depth — RLS already enforces.
  const { data: tokenRow } = await supabase
    .from('ad_platform_tokens')
    .select('id, external_account_id, display_name, scopes, expires_at, revoked_at')
    .eq('user_id', userId)
    .eq('platform', body.platform)
    .eq('external_account_id', body.externalAccountId)
    .is('revoked_at', null)
    .maybeSingle();
  if (!tokenRow) {
    return NextResponse.json(
      { ok: false, errorCode: 'no_token' },
      { status: 404 },
    );
  }

  // LinkedIn is a stub — same shape as the publish primitive.
  if (body.platform === 'linkedin') {
    return NextResponse.json({
      ok: false,
      errorCode: 'oauth_not_implemented' as CheckErrorCode,
      errorMessage:
        'LinkedIn connection-test is gated on Marketing Developer Platform partner approval.',
      platform: body.platform,
      externalAccountId: body.externalAccountId,
      displayName: tokenRow.display_name,
      scopes: tokenRow.scopes,
      expiresAt: tokenRow.expires_at,
      lastChecked: new Date().toISOString(),
    });
  }

  const env = serverEnv();
  if (!env.AHO_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json(
      { ok: false, errorCode: 'token_key_not_configured' },
      { status: 503 },
    );
  }

  // Decrypt via service-role RPC.
  const admin = createAdminClient();
  const { data: tokenPlain, error: tokenErr } = await admin.rpc(
    'get_decrypted_access_token',
    {
      p_user_id: userId,
      p_platform: body.platform,
      p_external_account_id: body.externalAccountId,
      p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
    },
  );
  if (tokenErr || !tokenPlain) {
    return NextResponse.json({
      ok: false,
      errorCode: 'token_invalid' as CheckErrorCode,
      errorMessage: tokenErr?.message ?? 'decrypt returned null',
      platform: body.platform,
      externalAccountId: body.externalAccountId,
      displayName: tokenRow.display_name,
      scopes: tokenRow.scopes,
      expiresAt: tokenRow.expires_at,
      lastChecked: new Date().toISOString(),
    });
  }

  // Pick the benign endpoint per account type. We deliberately use
  // read-only fields so this is genuinely free of side effects.
  let testUrl: string;
  const acctId = body.externalAccountId;
  if (acctId.startsWith('page:')) {
    const pageId = acctId.slice('page:'.length);
    testUrl = `${META_GRAPH_BASE}/${encodeURIComponent(pageId)}?fields=id,name,category`;
  } else if (acctId.startsWith('ig:')) {
    const igId = acctId.slice('ig:'.length);
    testUrl = `${META_GRAPH_BASE}/${encodeURIComponent(igId)}?fields=id,username`;
  } else {
    // Bare account id = user-level Meta token. /me with the token.
    testUrl = `${META_GRAPH_BASE}/me?fields=id,name`;
  }

  const url = new URL(testUrl);
  url.searchParams.set('access_token', tokenPlain as string);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    return NextResponse.json({
      ok: false,
      errorCode: 'network_timeout' as CheckErrorCode,
      errorMessage: err instanceof Error ? err.message : String(err),
      platform: body.platform,
      externalAccountId: body.externalAccountId,
      displayName: tokenRow.display_name,
      scopes: tokenRow.scopes,
      expiresAt: tokenRow.expires_at,
      lastChecked: new Date().toISOString(),
    });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return NextResponse.json({
      ok: false,
      errorCode: (res.status >= 500 ? 'transient_5xx' : 'unknown') as CheckErrorCode,
      errorMessage: `HTTP ${res.status} (no JSON body)`,
      platform: body.platform,
      externalAccountId: body.externalAccountId,
      displayName: tokenRow.display_name,
      scopes: tokenRow.scopes,
      expiresAt: tokenRow.expires_at,
      lastChecked: new Date().toISOString(),
    });
  }

  if (!res.ok) {
    const { code, message } = categorize(res.status, json as MetaApiError);
    return NextResponse.json({
      ok: false,
      errorCode: code,
      errorMessage: message,
      platform: body.platform,
      externalAccountId: body.externalAccountId,
      displayName: tokenRow.display_name,
      scopes: tokenRow.scopes,
      expiresAt: tokenRow.expires_at,
      lastChecked: new Date().toISOString(),
    });
  }

  // Success — pull the human-readable name out for nicer UI.
  const data = json as { id?: string; name?: string; username?: string };
  const platformName = data.name ?? (data.username ? `@${data.username}` : null);

  return NextResponse.json({
    ok: true,
    platform: body.platform,
    externalAccountId: body.externalAccountId,
    displayName: tokenRow.display_name,
    platformName,
    scopes: tokenRow.scopes,
    expiresAt: tokenRow.expires_at,
    lastChecked: new Date().toISOString(),
  });
}
