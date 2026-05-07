import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * SEO-friendly agent profile slug.
 *
 * Format: `<full-name>-<city>-<lower(country-code)>`. e.g.,
 * "Juan Pérez" + "Santo Domingo" + "DO" → `juan-perez-santo-domingo-do`.
 *
 * Inputs are optional in the UI (the profile form lets agents save
 * their bio without yet picking a city). When any of the three fields
 * is missing, this returns `null` — the route then falls back to the
 * legacy `organizations.slug` for that org and Google still indexes
 * the profile, just under a less keyword-rich URL.
 *
 * Diacritics are folded via NFD + combining-mark stripping so the slug
 * is portable across systems / accent-blind to URL fragments.
 */

export function slugify(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const folded = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Common Latin extensions Unicode NFD doesn't decompose:
    .replace(/ł/g, 'l')
    .replace(/ø/g, 'o')
    .replace(/đ/g, 'd')
    .replace(/ß/g, 'ss');
  const dashed = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return dashed || null;
}

export function buildAgentSlugBase(
  fullName: string | null | undefined,
  city: string | null | undefined,
  countryCode: string | null | undefined,
): string | null {
  const namePart = slugify(fullName);
  const cityPart = slugify(city);
  const ccPart = countryCode ? countryCode.trim().toLowerCase() : null;
  if (!namePart || !cityPart || !ccPart || ccPart.length !== 2) return null;
  return `${namePart}-${cityPart}-${ccPart}`;
}

/**
 * Resolve a unique public_slug for `orgId` based on its owner's profile
 * fields. Returns null when the profile is too sparse to generate a
 * meaningful slug — caller should leave `public_slug` as NULL in that
 * case (the route handles the fallback).
 *
 * Collision algorithm: try the base form first; if another org owns it,
 * append `-2`, `-3`, ... until free. The current org is excluded from
 * the conflict check so a no-op recompute stays at the same slug.
 *
 * The query uses a service-role-or-bypassing client to scan the entire
 * public_slug column; user-context RLS would only see orgs with public
 * listings (per migration 0031) and could miss collisions against
 * pre-launch agents.
 */
export async function resolvePublicSlugForOrg(
  supabase: SupabaseClient,
  orgId: string,
  fullName: string | null,
  city: string | null,
  countryCode: string | null,
): Promise<string | null> {
  const base = buildAgentSlugBase(fullName, city, countryCode);
  if (!base) return null;

  // Find every existing public_slug starting with the base. SQL `like`
  // with the prefix gets the candidates; we filter the suffix shape in
  // JS so the comparator is forgiving across edge cases.
  const { data, error } = await supabase
    .from('organizations')
    .select('id, public_slug')
    .like('public_slug', `${base}%`);
  if (error) {
    console.error('[resolvePublicSlugForOrg] lookup failed', error);
    return null;
  }

  const taken = new Set<string>();
  for (const row of data ?? []) {
    if (row.id === orgId) continue;
    if (typeof row.public_slug === 'string') taken.add(row.public_slug);
  }

  if (!taken.has(base)) return base;
  // Try -2, -3, … until free. Cap at 1000 just to bound the loop; in
  // practice no real-world collision goes beyond -10.
  for (let n = 2; n <= 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Falling through is a no-op (caller leaves slug NULL). 1000 collisions
  // on the same name+city+country is operator-error territory.
  return null;
}
