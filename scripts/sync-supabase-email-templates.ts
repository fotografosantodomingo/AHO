/**
 * Sync the AHO Supabase Auth email templates with the canonical
 * source-of-truth in `scripts/lib/supabase-auth-templates.ts`.
 *
 * Replaces the manual "open dashboard, paste 4 templates" loop with a
 * single command:
 *
 *     pnpm supabase:templates
 *
 * Auth: requires a Supabase Personal Access Token in
 * `SUPABASE_ACCESS_TOKEN` (env var). PAT, NOT the service-role key —
 * email templates live in project config, which only the Management API
 * can mutate, and the Management API only accepts PATs.
 *
 * To get the PAT:
 *   1. https://supabase.com/dashboard/account/tokens
 *   2. "Generate new token" → name: AHO automation
 *   3. Copy the `sbp_…` value into `.env.local` as
 *      `SUPABASE_ACCESS_TOKEN=sbp_xxx`
 *
 * Project ref: read from `NEXT_PUBLIC_SUPABASE_URL`
 * (e.g. https://lqujtquofsdsxtujvjtl.supabase.co → ref `lqujtquofsdsxtujvjtl`).
 *
 * The script is idempotent: re-running with the same templates is a
 * no-op on Supabase's side; rerun any time the templates file changes
 * to pick up edits.
 */

import { AUTH_TEMPLATES } from './lib/supabase-auth-templates';

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!PAT) {
  console.error(
    'SUPABASE_ACCESS_TOKEN is not set.\n\n' +
      'Generate a Personal Access Token at:\n' +
      '  https://supabase.com/dashboard/account/tokens\n\n' +
      'Then add to .env.local:\n' +
      '  SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx\n\n' +
      'PATs (sbp_*) are different from project keys (eyJ*). The Management\n' +
      'API requires a PAT; project keys (anon, service-role) only work\n' +
      'against PostgREST / auth / storage at the project URL.\n',
  );
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error('NEXT_PUBLIC_SUPABASE_URL is not set.');
  process.exit(1);
}

const refMatch = SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
if (!refMatch) {
  console.error(
    `Could not extract project ref from SUPABASE_URL=${SUPABASE_URL}. Expected https://{ref}.supabase.co.`,
  );
  process.exit(1);
}
const projectRef = refMatch[1];

const ENDPOINT = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

interface AuthConfigBody {
  [field: string]: string;
}

const body: AuthConfigBody = {};
for (const tpl of AUTH_TEMPLATES) {
  body[tpl.subjectField] = tpl.subject;
  body[tpl.contentField] = tpl.content;
}

async function main(): Promise<void> {
  console.log(`Syncing ${AUTH_TEMPLATES.length} email templates to project ${projectRef}…\n`);
  for (const tpl of AUTH_TEMPLATES) {
    console.log(`  • ${tpl.label.padEnd(20)} → "${tpl.subject}"`);
  }
  console.log('');

  const res = await fetch(ENDPOINT, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`HTTP ${res.status} from Management API`);
    console.error(text);
    process.exit(1);
  }

  console.log(`Done. Templates synced. Trigger any auth flow (e.g. /signup)`);
  console.log(`to verify the new emails render correctly across mail clients.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
