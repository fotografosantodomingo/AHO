/**
 * REMOVE SEED DATA — the "remove the fakes later" guarantee for the Tier-3
 * seed inventory (docs/SEO_COLD_START_PLAN.md §7). Deletes everything tagged
 * `data_origin='seed'`: listings, agent profiles (via their auth users), and
 * seed agencies. This is what runs when real agents arrive and the seed
 * inventory is retired.
 *
 * Order respects FKs:
 *   1. properties        WHERE data_origin='seed'
 *   2. organization_members for seed orgs
 *   3. seed auth users (email @aho-seed.test) → cascades their profiles
 *   4. organizations     WHERE data_origin='seed'
 *
 * SEO note: for a clean Google removal, after deleting you also want the
 * retired listing URLs to return HTTP 410 + drop out of the sitemap. The
 * sitemap drop is automatic (sitemap-properties reads active listings only;
 * deleted rows vanish). 410-on-old-URLs is a follow-up if the listings were
 * indexed long enough to matter; for a short-lived seed set, 404 is fine.
 *
 * Run:
 *   set -a && source .env.local && set +a
 *   pnpm tsx scripts/remove-seed.ts            # dry-run (counts only)
 *   pnpm tsx scripts/remove-seed.ts --apply    # actually delete
 */
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_SERVICE) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const admin = createClient(SB_URL, SB_SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  // Inventory.
  const props = await admin.from('properties').select('id', { count: 'exact', head: true }).eq('data_origin', 'seed');
  const orgs = await admin.from('organizations').select('id', { count: 'exact', head: true }).eq('data_origin', 'seed');
  const profs = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('data_origin', 'seed');
  console.error(`seed inventory → properties: ${props.count ?? 0}, agencies: ${orgs.count ?? 0}, agents: ${profs.count ?? 0}`);

  if (!APPLY) {
    console.error('\nDRY-RUN — re-run with --apply to delete. Nothing removed.');
    return;
  }

  // 1. Listings.
  const delProps = await admin.from('properties').delete().eq('data_origin', 'seed');
  if (delProps.error) throw new Error(`properties: ${delProps.error.message}`);

  // Collect seed org ids + seed agent (profile) ids.
  const seedOrgs = await admin.from('organizations').select('id').eq('data_origin', 'seed');
  const seedProfiles = await admin.from('profiles').select('id, email').eq('data_origin', 'seed');
  const orgIds = (seedOrgs.data ?? []).map((o) => o.id);
  const profIds = (seedProfiles.data ?? []).map((p) => p.id);

  // 2. Memberships.
  if (orgIds.length) {
    const delMem = await admin.from('organization_members').delete().in('org_id', orgIds);
    if (delMem.error) throw new Error(`members: ${delMem.error.message}`);
  }

  // 3. Seed auth users → cascade deletes their profiles.
  for (const p of seedProfiles.data ?? []) {
    const { error } = await admin.auth.admin.deleteUser(p.id);
    if (error) console.error(`  auth delete ${p.email}: ${error.message}`);
  }

  // 4. Agencies.
  const delOrgs = await admin.from('organizations').delete().eq('data_origin', 'seed');
  if (delOrgs.error) throw new Error(`organizations: ${delOrgs.error.message}`);

  console.error(`\nREMOVED — ${props.count ?? 0} listings, ${profIds.length} agents, ${orgIds.length} agencies. Seed data cleared.`);
}

main().catch((e) => { console.error('REMOVE FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
