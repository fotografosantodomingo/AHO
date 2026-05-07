/**
 * One-shot backfill for `organizations.public_slug`.
 *
 * Recomputes the SEO-friendly slug for every existing org based on its
 * owner's profile fields. Idempotent — re-running yields identical
 * slugs (collision check excludes self).
 *
 * Run after migration 0034 lands. Subsequent profile saves keep the
 * slug fresh via the route in `src/app/api/me/profile/route.ts`.
 *
 * Usage:
 *   set -a && source .env.local && set +a && pnpm tsx scripts/backfill-agent-public-slugs.ts
 *
 * Env required:
 *   - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   - SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import { resolvePublicSlugForOrg } from '../src/lib/agents/public-slug';

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY) {
  console.error(
    'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set.',
  );
  process.exit(1);
}

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main(): Promise<void> {
  // Pull every org + its owner's relevant profile fields. The
  // inner-join via organization_members surfaces only orgs that have an
  // owner (any without are presumed mid-onboarding and get skipped).
  const { data: rows, error } = await supabase
    .from('organizations')
    .select(
      'id, slug, public_slug, organization_members!inner(role, profiles!inner(full_name, city, country_code))',
    )
    .eq('organization_members.role', 'owner');

  if (error) {
    console.error('Lookup failed:', error);
    process.exit(1);
  }

  if (!rows) {
    console.log('No orgs returned.');
    return;
  }

  console.log(`Inspecting ${rows.length} org(s)...\n`);

  let updated = 0;
  let unchanged = 0;
  let cleared = 0;
  let skipped = 0;

  for (const row of rows) {
    const orgId = row.id as string;
    const slug = row.slug as string;
    const currentPublicSlug = (row.public_slug as string | null) ?? null;

    // Skip RLS test fixtures — they should never get a public slug.
    if (slug.startsWith('aho-test-org-')) {
      skipped++;
      continue;
    }

    // PostgREST returns the joined relation as either an array or a
    // single object. Normalize to the first member's profile.
    const member = Array.isArray(row.organization_members)
      ? row.organization_members[0]
      : row.organization_members;
    const profile = member?.profiles
      ? Array.isArray(member.profiles)
        ? member.profiles[0]
        : member.profiles
      : null;

    if (!profile) {
      // No profile — nothing to base the slug on. Leave NULL.
      if (currentPublicSlug !== null) {
        await supabase
          .from('organizations')
          .update({ public_slug: null })
          .eq('id', orgId);
        cleared++;
        console.log(`  cleared  ${slug} (no profile)`);
      } else {
        unchanged++;
      }
      continue;
    }

    const newSlug = await resolvePublicSlugForOrg(
      supabase,
      orgId,
      (profile.full_name as string | null) ?? null,
      (profile.city as string | null) ?? null,
      (profile.country_code as string | null) ?? null,
    );

    if (newSlug === currentPublicSlug) {
      unchanged++;
      continue;
    }

    const { error: updErr } = await supabase
      .from('organizations')
      .update({ public_slug: newSlug })
      .eq('id', orgId);
    if (updErr) {
      console.error(`  ! failed ${slug}: ${updErr.message}`);
      continue;
    }

    if (newSlug === null) {
      cleared++;
      console.log(`  cleared  ${slug} (insufficient profile data)`);
    } else {
      updated++;
      console.log(`  updated  ${slug} → ${newSlug}`);
    }
  }

  console.log(
    `\nDone. updated=${updated} unchanged=${unchanged} cleared=${cleared} skipped=${skipped}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
