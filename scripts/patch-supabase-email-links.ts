/**
 * Patch Supabase Auth email templates to use token-hash links instead of
 * PKCE links.
 *
 * Background: by default, when Supabase sends a confirmation / recovery /
 * magic-link / invite / email-change email, the `{{ .ConfirmationURL }}`
 * variable resolves to a PKCE-flow URL like `…/auth/callback?code=xxx`.
 * The PKCE flow stores a `code_verifier` in a browser cookie when the
 * user *initiates* the auth request; the same browser must click the
 * email link for `exchangeCodeForSession` to succeed. Cross-browser /
 * cross-device clicks (e.g., user starts on desktop, clicks the email
 * link from their phone) fail with `pkce_browser_mismatch`. This is
 * a major UX trap for password reset and magic links specifically —
 * users routinely have email open on a different device.
 *
 * This script replaces every `{{ .ConfirmationURL }}` placeholder with
 * a token-hash URL like:
 *   {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=<TYPE>&next=<PATH>
 *
 * The token-hash is verified server-side (not via cookie), so the link
 * works from ANY browser. Our `/auth/callback` route already supports
 * both flows (`?code=` and `?token_hash=&type=`), no app changes needed.
 *
 * Run via:
 *   set -a && source .env.local && set +a && pnpm tsx scripts/patch-supabase-email-links.ts
 *
 * Idempotent: runs multiple times produce the same end state. If the
 * placeholder isn't found in a template, that template is skipped.
 *
 * History: PO 2026-05-06 hit `pkce_browser_mismatch` clicking a recovery
 * link → traced to PKCE flow → switched all 5 templates to token-hash.
 */

const PROJECT_REF = 'lqujtquofsdsxtujvjtl';

const TYPES: Record<
  string,
  { type: string; next: string }
> = {
  // Map: template field name → token-hash type + sensible default landing path
  confirmation: { type: 'signup', next: '/en/dashboard' },
  recovery: { type: 'recovery', next: '/en/reset-password' },
  magic_link: { type: 'magiclink', next: '/en/dashboard' },
  invite: { type: 'invite', next: '/en/dashboard' },
  email_change: { type: 'email_change', next: '/en/dashboard' },
};

async function main(): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error('SUPABASE_ACCESS_TOKEN must be set (source .env.local).');
    process.exit(1);
  }

  const cur = (await (
    await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
  ).json()) as Record<string, string | undefined>;

  const patch: Record<string, string> = {};
  for (const [name, { type, next }] of Object.entries(TYPES)) {
    const key = `mailer_templates_${name}_content`;
    const html = cur[key];
    if (!html) {
      console.log(`SKIP ${key}: empty`);
      continue;
    }
    const newUrl = `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=${type}&next=${encodeURIComponent(next)}`;
    const updated = html.replaceAll('{{ .ConfirmationURL }}', newUrl);
    if (updated === html) {
      console.log(`SKIP ${key}: no placeholder (already patched?)`);
      continue;
    }
    patch[key] = updated;
    console.log(`UPDATE ${key} → type=${type} next=${next}`);
  }

  if (Object.keys(patch).length === 0) {
    console.log('Nothing to patch.');
    return;
  }

  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(patch),
    },
  );
  console.log('PATCH HTTP:', r.status);
  if (r.status >= 400) {
    console.log(await r.text());
    process.exit(1);
  }
  console.log('Templates updated successfully.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
