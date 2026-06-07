/**
 * SEED LISTINGS — Tier-3 indexed seed inventory for the cold-start period.
 * See docs/SEO_COLD_START_PLAN.md §7 + docs/SEED_LOG.md. PO authorized
 * 2026-06-07 (reversal of the original no-fake-data rule — see DECISIONS).
 *
 * EVERYTHING this creates is tagged `data_origin='seed'` so it is trivially
 * removable later (scripts/remove-seed.ts → DELETE WHERE data_origin='seed'),
 * which cascades through orgs/profiles/properties. Slugs look REAL (so the
 * pages index), NOT `aho-fixture-`/`aho-test-org-` (those are filtered out of
 * public surfaces — the opposite of what we want here).
 *
 * Content is generated PER LISTING via Claude (distinct text — templated/spun
 * listings get flagged by Google's scaled-content policy). Photos: NONE
 * (text-only seed, PO decision) — the listing card renders its placeholder.
 *
 * Idempotent per city: skips a city that already has seed listings, so you can
 * run a small `--limit 1 --apply` test then re-run for the rest.
 *
 * Run:
 *   set -a && source .env.local && set +a
 *   pnpm tsx scripts/seed-listings.ts                 # dry-run (plan only)
 *   pnpm tsx scripts/seed-listings.ts --apply --limit 1
 *   pnpm tsx scripts/seed-listings.ts --apply         # full ~100
 */
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const CITY_LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const PER_CITY = 5;
const MODEL = 'claude-sonnet-4-6';

const POOLER = process.env.SUPABASE_POOLER_URL;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
if (!POOLER || !SB_URL || !SB_SERVICE || !ANTHROPIC) {
  console.error('Missing env (SUPABASE_POOLER_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY).');
  process.exit(1);
}
const admin = createClient(SB_URL, SB_SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

// Famous secondary markets (not capitals, so not in the graph) — real coords.
const SECONDARY = [
  { iso2: 'ES', name: 'Barcelona', slug: 'barcelona', currency: 'EUR', lat: 41.3874, lng: 2.1686 },
  { iso2: 'PT', name: 'Porto', slug: 'porto', currency: 'EUR', lat: 41.1579, lng: -8.6291 },
  { iso2: 'AE', name: 'Dubai', slug: 'dubai', currency: 'AED', lat: 25.2048, lng: 55.2708 },
  { iso2: 'MX', name: 'Cancún', slug: 'cancun', currency: 'MXN', lat: 21.1619, lng: -86.8515 },
  { iso2: 'IT', name: 'Milan', slug: 'milan', currency: 'EUR', lat: 45.4642, lng: 9.19 },
];

// Three seed agencies + which regions they cover.
const AGENCIES = [
  { key: 'atlas', slug: 'atlas-prime-realty', name: 'Atlas Prime Realty', hqCountry: 'ES', hqCity: 'Madrid',
    descEn: 'Boutique brokerage focused on residential and investment property across Western Europe and the Mediterranean.',
    descEs: 'Agencia boutique especializada en vivienda e inversión inmobiliaria en Europa Occidental y el Mediterráneo.',
    regions: ['ES', 'PT', 'IT', 'FR', 'DE', 'GR'] },
  { key: 'costa', slug: 'costa-co-properties', name: 'Costa & Co. Properties', hqCountry: 'MX', hqCity: 'Mexico City',
    descEn: 'Latin American property specialists helping local and international buyers across the region.',
    descEs: 'Especialistas en inmuebles de América Latina, ayudando a compradores locales e internacionales en toda la región.',
    regions: ['MX', 'CO', 'CR', 'PA', 'BR'] },
  { key: 'meridian', slug: 'meridian-global-homes', name: 'Meridian Global Homes', hqCountry: 'US', hqCity: 'Washington',
    descEn: 'Cross-border real estate advisory for relocation, investment, and lifestyle buyers worldwide.',
    descEs: 'Asesoría inmobiliaria transfronteriza para mudanzas, inversión y compradores de estilo de vida en todo el mundo.',
    regions: ['US', 'CA', 'AE', 'TH'] },
];

// Two seed agents per agency.
const AGENTS = [
  { email: 'elena.marquez@aho-seed.test', name: 'Elena Márquez', agency: 'atlas', country: 'ES', city: 'Madrid',
    bio: 'Madrid-based adviser specialising in city-centre apartments and Mediterranean second homes for international buyers.',
    specialties: ['Luxury', 'Investment', 'Relocation'], languages: ['es', 'en', 'fr'] },
  { email: 'tomas.silva@aho-seed.test', name: 'Tomás Silva', agency: 'atlas', country: 'PT', city: 'Lisbon',
    bio: 'Portugal and Italy specialist with a focus on golden-visa-eligible property and historic-centre renovations.',
    specialties: ['Golden Visa', 'Renovation', 'Investment'], languages: ['pt', 'en', 'it'] },
  { email: 'sofia.reyes@aho-seed.test', name: 'Sofía Reyes', agency: 'costa', country: 'MX', city: 'Mexico City',
    bio: 'Mexico and Central America adviser helping expats and investors find homes from city condos to coastal villas.',
    specialties: ['Beachfront', 'Investment', 'Expat Relocation'], languages: ['es', 'en'] },
  { email: 'andres.gomez@aho-seed.test', name: 'Andrés Gómez', agency: 'costa', country: 'CO', city: 'Bogotá',
    bio: 'Colombian-market specialist covering Bogotá, Medellín and the Caribbean coast for local and remote buyers.',
    specialties: ['Investment', 'New Developments', 'Rentals'], languages: ['es', 'en'] },
  { email: 'james.carter@aho-seed.test', name: 'James Carter', agency: 'meridian', country: 'US', city: 'Washington',
    bio: 'Cross-border adviser for North American buyers purchasing abroad and international buyers entering the US market.',
    specialties: ['Cross-border', 'Investment', 'Luxury'], languages: ['en', 'es'] },
  { email: 'noor.haddad@aho-seed.test', name: 'Noor Haddad', agency: 'meridian', country: 'AE', city: 'Dubai',
    bio: 'Dubai and Southeast Asia specialist focused on high-yield investment property and lifestyle relocations.',
    specialties: ['Investment', 'Off-plan', 'Lifestyle'], languages: ['en', 'ar'] },
];

function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
}

async function generateForCity(city: { name: string; iso2: string; currency: string }): Promise<any[]> {
  const prompt = `You are populating a real-estate marketplace with realistic example listings for ${city.name} (country code ${city.iso2}).
Generate ${PER_CITY} DISTINCT, realistic property listings. Each must be genuinely different (type, size, price tier, neighborhood, tone) — NOT templated.
Use market-realistic prices for ${city.name} in the local currency ${city.currency} (integer, major units, no separators).
Return ONLY a JSON array, no prose, no markdown fences. Each element:
{
  "property_type": one of "apartment","house","villa","penthouse","townhouse","studio",
  "transaction_type": "sale" or "rent",
  "bedrooms": integer 0-6,
  "bathrooms": number (e.g. 1, 1.5, 2),
  "area_sqm": integer 30-600,
  "price": integer in ${city.currency} major units (monthly amount if rent),
  "year_built": integer 1950-2024,
  "neighborhood": real, well-known neighborhood/district name in ${city.name},
  "amenities": array of 3-6 short strings,
  "title_en": compelling EN listing title (<=70 chars, includes the city),
  "title_es": Spanish translation of the title (<=70 chars),
  "description_en": 120-170 word EN description, specific and distinct, no fake street address,
  "description_es": faithful Spanish version of the description
}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as any;
  let text = (body.content?.[0]?.text ?? '').trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error('expected JSON array');
  return arr;
}

async function ensureAgency(a: typeof AGENCIES[number]): Promise<string> {
  const existing = await admin.from('organizations').select('id').eq('slug', a.slug).maybeSingle();
  if (existing.data) return existing.data.id as string;
  const { data, error } = await admin.from('organizations').insert({
    slug: a.slug, public_slug: a.slug, name: a.name, type: 'agency',
    description_en: a.descEn, description_es: a.descEs,
    headquarters_country: a.hqCountry, headquarters_city: a.hqCity,
    listing_cap: null, data_origin: 'seed',
  }).select('id').single();
  if (error) throw new Error(`agency ${a.slug}: ${error.message}`);
  return data.id as string;
}

async function ensureAgent(ag: typeof AGENTS[number], orgId: string): Promise<string> {
  // Find or create the auth user (trigger auto-creates the profile row).
  const list = await admin.auth.admin.listUsers();
  let user = list.data.users.find((u) => u.email === ag.email);
  if (!user) {
    const created = await admin.auth.admin.createUser({ email: ag.email, email_confirm: true, password: `seed-${Math.abs(hash(ag.email))}-Aa1` });
    if (created.error) throw new Error(`auth ${ag.email}: ${created.error.message}`);
    user = created.data.user;
  }
  const uid = user!.id;
  const { error: upErr } = await admin.from('profiles').update({
    full_name: ag.name, bio: ag.bio, specialties: ag.specialties, languages_spoken: ag.languages,
    country_code: ag.country, city: ag.city, data_origin: 'seed',
  }).eq('id', uid);
  if (upErr) throw new Error(`profile ${ag.email}: ${upErr.message}`);
  // Org membership (idempotent).
  const mem = await admin.from('organization_members').select('user_id').eq('org_id', orgId).eq('user_id', uid).maybeSingle();
  if (!mem.data) {
    const { error } = await admin.from('organization_members').insert({ org_id: orgId, user_id: uid, role: 'agent', joined_at: new Date().toISOString() });
    if (error) throw new Error(`member ${ag.email}: ${error.message}`);
  }
  return uid;
}

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

async function main() {
  const sql = postgres(POOLER!, { max: 1, prepare: false });
  let inserted = 0;
  try {
    const flagship = ['ES', 'PT', 'MX', 'US', 'CO', 'IT', 'FR', 'DE', 'CR', 'PA', 'AE', 'GR', 'TH', 'BR', 'CA'];
    const caps = await sql`
      select c.country_iso2 as iso2, c.slug, c.names->>'en' as name, co.currency_code as currency,
             st_y(c.centroid::geometry) lat, st_x(c.centroid::geometry) lng
      from geo_cities c join geo_countries co on co.iso2 = c.country_iso2
      where c.admin_region = 'Capital' and c.country_iso2 = any(${flagship})`;
    const cities = [...caps.map((r: any) => ({ iso2: r.iso2, name: r.name, slug: r.slug, currency: r.currency, lat: r.lat, lng: r.lng })), ...SECONDARY]
      .filter((c) => c.currency && c.lat != null).slice(0, CITY_LIMIT);

    console.error(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${cities.length} cities, target ~${cities.length * PER_CITY} listings`);

    if (!APPLY) {
      console.error('Cities:', cities.map((c) => `${c.name}(${c.iso2})`).join(', '));
      console.error('\nRe-run with --apply to generate + insert. Nothing written.');
      await sql.end();
      return;
    }

    // Seed orgs + agents.
    const orgIds: Record<string, string> = {};
    for (const a of AGENCIES) orgIds[a.key] = await ensureAgency(a);
    const agentIds: Record<string, string> = {};
    for (const ag of AGENTS) agentIds[ag.email] = await ensureAgent(ag, orgIds[ag.agency]!);
    console.error(`seed orgs: ${Object.keys(orgIds).length}, seed agents: ${Object.keys(agentIds).length}`);

    for (const city of cities) {
      // Idempotency: skip a city that already has seed listings.
      const existing = await sql`select count(*)::int as n from properties where data_origin='seed' and city=${city.name}`;
      const existingN = existing[0]?.n ?? 0;
      if (existingN > 0) { console.error(`  ${city.name}: already seeded (${existingN}) — skip`); continue; }

      const agency = AGENCIES.find((a) => a.regions.includes(city.iso2)) ?? AGENCIES[2]!;
      const agent = AGENTS.find((ag) => ag.agency === agency.key)!;
      const orgId = orgIds[agency.key]!;
      const createdBy = agentIds[agent.email]!;

      let listings: any[];
      try { listings = await generateForCity(city); }
      catch (e) { console.error(`  ${city.name}: generation failed — ${(e as Error).message}`); continue; }

      for (const l of listings) {
        const jLat = city.lat + (Math.random() - 0.5) * 0.04;
        const jLng = city.lng + (Math.random() - 0.5) * 0.04;
        const titleEn = String(l.title_en ?? '').slice(0, 160);
        const titleEs = String(l.title_es ?? '').slice(0, 160);
        if (!titleEn || !titleEs) continue;
        const row = {
          org_id: orgId, created_by: createdBy,
          transaction_type: l.transaction_type === 'rent' ? 'rent' : 'sale',
          property_type: String(l.property_type ?? 'apartment'),
          status: 'active',
          title_en: titleEn, title_es: titleEs,
          description_en: String(l.description_en ?? ''), description_es: String(l.description_es ?? ''),
          slug_en: slugify(titleEn), slug_es: slugify(titleEs),
          price_cents: Math.max(0, Math.round(Number(l.price ?? 0) * 100)),
          currency: city.currency,
          price_period: l.transaction_type === 'rent' ? 'monthly' : 'total',
          bedrooms: Number.isFinite(+l.bedrooms) ? +l.bedrooms : null,
          bathrooms: Number.isFinite(+l.bathrooms) ? +l.bathrooms : null,
          area_sqm: Number.isFinite(+l.area_sqm) ? +l.area_sqm : null,
          year_built: Number.isFinite(+l.year_built) ? +l.year_built : null,
          neighborhood: l.neighborhood ? String(l.neighborhood) : null,
          city: city.name, country_code: city.iso2, display_address: false,
          location: `SRID=4326;POINT(${jLng} ${jLat})`,
          amenities: Array.isArray(l.amenities) ? l.amenities.map(String).slice(0, 8) : [],
          published_at: new Date().toISOString(),
          data_origin: 'seed',
        };
        const { error } = await admin.from('properties').insert(row);
        if (error) { console.error(`    insert fail (${city.name}): ${error.message}`); continue; }
        inserted++;
      }
      console.error(`  ${city.name}: +${listings.length} (running total ${inserted})`);
    }
    console.error(`\nDONE — inserted ${inserted} seed listings.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error('SEED FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
