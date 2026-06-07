/**
 * SEED: one agent + one listing per country (100 countries).
 * Extends the Tier-3 seed inventory — see docs/SEED_LOG.md + DECISIONS.
 * Everything tagged data_origin='seed' (removable via scripts/remove-seed.ts).
 *
 * For each of the 100 most-populous countries (excluding DR, where real agents
 * operate): creates ONE solo agent (own agency so it has a public profile page)
 * with a country-appropriate name/bio, and ONE distinct bilingual listing in
 * that country's capital. Content generated per-country by Claude (not
 * templated). Text-only (no photos — PO policy).
 *
 * Idempotent per country: skips a country whose seed agent org already exists.
 *
 * Run:
 *   set -a && source .env.local && set +a
 *   pnpm tsx scripts/seed-agents-per-country.ts                # dry-run
 *   pnpm tsx scripts/seed-agents-per-country.ts --apply --limit 1
 *   pnpm tsx scripts/seed-agents-per-country.ts --apply        # full 100
 */
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const li = process.argv.indexOf('--limit');
const LIMIT = li >= 0 ? Number(process.argv[li + 1]) : 100;
const BATCH = 5;
const MODEL = 'claude-sonnet-4-6';

const POOLER = process.env.SUPABASE_POOLER_URL;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
if (!POOLER || !SB_URL || !SB_SERVICE || !ANTHROPIC) { console.error('Missing env.'); process.exit(1); }
const admin = createClient(SB_URL, SB_SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

interface Country { iso2: string; currency: string; country: string; city: string; lat: number; lng: number; }

function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

async function generateBatch(batch: Country[]): Promise<Record<string, any>> {
  const list = batch.map((c) => `- ${c.iso2}: capital ${c.city}, ${c.country}, currency ${c.currency}`).join('\n');
  const prompt = `For EACH country below, invent ONE realistic local real-estate agent and ONE property listing they represent in that country's capital city.
Countries:
${list}

Return ONLY a JSON array (no prose/markdown). One element per country:
{
  "iso2": "<the code>",
  "agent": { "name": "realistic full name appropriate to the country", "bio": "1-2 sentence professional bio", "specialties": ["..",".."], "languages": ["..",".."] },
  "listing": {
    "property_type": one of "apartment","house","villa","penthouse","townhouse","studio",
    "transaction_type": "sale" or "rent",
    "bedrooms": int 0-6, "bathrooms": number, "area_sqm": int 30-500,
    "price": int in that country's currency major units (monthly if rent),
    "year_built": int 1960-2024,
    "neighborhood": real district in the capital,
    "amenities": [3-5 short strings],
    "title_en": "<=70 chars, includes the city", "title_es": "Spanish title <=70 chars",
    "description_en": "110-150 words, specific, distinct", "description_es": "Spanish version"
  }
}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as any;
  let text = (body.content?.[0]?.text ?? '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const arr = JSON.parse(text);
  const byIso: Record<string, any> = {};
  for (const el of arr) if (el?.iso2) byIso[String(el.iso2).toUpperCase()] = el;
  return byIso;
}

async function existingEmails(): Promise<Set<string>> {
  const set = new Set<string>();
  for (let page = 1; page <= 40; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email) set.add(u.email);
    if (data.users.length < 1000) break;
  }
  return set;
}

async function main() {
  const sql = postgres(POOLER!, { max: 1, prepare: false });
  let made = 0;
  try {
    const rows = await sql`
      select co.iso2, co.currency_code as currency, co.names->>'en' as country,
             c.names->>'en' as city, st_y(c.centroid::geometry) lat, st_x(c.centroid::geometry) lng
      from geo_countries co
      join geo_cities c on c.country_iso2 = co.iso2 and c.admin_region = 'Capital'
      where co.iso2 <> 'DO' and co.currency_code is not null and c.centroid is not null
      order by co.population desc nulls last
      limit ${LIMIT}`;
    const countries: Country[] = rows.map((r: any) => ({ iso2: r.iso2, currency: r.currency, country: r.country, city: r.city, lat: r.lat, lng: r.lng }));
    console.error(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${countries.length} countries (1 agent + 1 listing each)`);
    if (!APPLY) {
      console.error(countries.map((c) => `${c.iso2}:${c.city}`).join(', '));
      console.error('\nRe-run with --apply.');
      await sql.end();
      return;
    }

    const seenEmails = await existingEmails();

    for (let i = 0; i < countries.length; i += BATCH) {
      const batch = countries[i] ? countries.slice(i, i + BATCH) : [];
      // Skip countries already seeded (org slug seed-agent-<iso2>).
      const todo: Country[] = [];
      for (const c of batch) {
        const ex = await admin.from('organizations').select('id').eq('slug', `seed-agent-${c.iso2.toLowerCase()}`).maybeSingle();
        if (ex.data) { console.error(`  ${c.iso2}: exists — skip`); continue; }
        todo.push(c);
      }
      if (!todo.length) continue;

      let gen: Record<string, any>;
      try { gen = await generateBatch(todo); }
      catch (e) { console.error(`  batch ${i}: gen failed — ${(e as Error).message}`); continue; }

      for (const c of todo) {
        const g = gen[c.iso2];
        if (!g?.agent?.name || !g?.listing?.title_en) { console.error(`  ${c.iso2}: missing data — skip`); continue; }

        // 1. Org (solo agency).
        const orgSlug = `seed-agent-${c.iso2.toLowerCase()}`;
        const pubSlug = `${slugify(g.agent.name)}-${c.iso2.toLowerCase()}`;
        const orgIns = await admin.from('organizations').insert({
          slug: orgSlug, public_slug: pubSlug, name: g.agent.name, type: 'agent',
          headquarters_country: c.iso2, headquarters_city: c.city, listing_cap: null, data_origin: 'seed',
        }).select('id').single();
        if (orgIns.error) { console.error(`  ${c.iso2}: org — ${orgIns.error.message}`); continue; }
        const orgId = orgIns.data.id as string;

        // 2. Agent (auth user → profile).
        const email = `agent-${c.iso2.toLowerCase()}@aho-seed.test`;
        let uid: string;
        if (seenEmails.has(email)) {
          const list = await admin.auth.admin.listUsers();
          uid = list.data.users.find((u) => u.email === email)!.id;
        } else {
          const cu = await admin.auth.admin.createUser({ email, email_confirm: true, password: `seed-${Math.abs(hash(email))}-Aa1` });
          if (cu.error) { console.error(`  ${c.iso2}: auth — ${cu.error.message}`); continue; }
          uid = cu.data.user.id;
          seenEmails.add(email);
        }
        await admin.from('profiles').update({
          full_name: g.agent.name, bio: String(g.agent.bio ?? ''),
          specialties: Array.isArray(g.agent.specialties) ? g.agent.specialties.map(String).slice(0, 6) : [],
          languages_spoken: Array.isArray(g.agent.languages) ? g.agent.languages.map(String).slice(0, 6) : [],
          country_code: c.iso2, city: c.city, data_origin: 'seed',
        }).eq('id', uid);
        const mem = await admin.from('organization_members').select('user_id').eq('org_id', orgId).eq('user_id', uid).maybeSingle();
        if (!mem.data) await admin.from('organization_members').insert({ org_id: orgId, user_id: uid, role: 'owner', joined_at: new Date().toISOString() });

        // 3. Listing.
        const l = g.listing;
        const jLat = c.lat + (Math.random() - 0.5) * 0.04;
        const jLng = c.lng + (Math.random() - 0.5) * 0.04;
        const { error: lErr } = await admin.from('properties').insert({
          org_id: orgId, created_by: uid,
          transaction_type: l.transaction_type === 'rent' ? 'rent' : 'sale',
          property_type: String(l.property_type ?? 'apartment'), status: 'active',
          title_en: String(l.title_en).slice(0, 160), title_es: String(l.title_es ?? l.title_en).slice(0, 160),
          description_en: String(l.description_en ?? ''), description_es: String(l.description_es ?? ''),
          slug_en: slugify(String(l.title_en)), slug_es: slugify(String(l.title_es ?? l.title_en)),
          price_cents: Math.max(0, Math.round(Number(l.price ?? 0) * 100)), currency: c.currency,
          price_period: l.transaction_type === 'rent' ? 'monthly' : 'total',
          bedrooms: Number.isFinite(+l.bedrooms) ? +l.bedrooms : null,
          bathrooms: Number.isFinite(+l.bathrooms) ? +l.bathrooms : null,
          area_sqm: Number.isFinite(+l.area_sqm) ? +l.area_sqm : null,
          year_built: Number.isFinite(+l.year_built) ? +l.year_built : null,
          neighborhood: l.neighborhood ? String(l.neighborhood) : null,
          city: c.city, country_code: c.iso2, display_address: false,
          location: `SRID=4326;POINT(${jLng} ${jLat})`,
          amenities: Array.isArray(l.amenities) ? l.amenities.map(String).slice(0, 8) : [],
          published_at: new Date().toISOString(), data_origin: 'seed',
        });
        if (lErr) { console.error(`  ${c.iso2}: listing — ${lErr.message}`); continue; }
        made++;
        console.error(`  ${c.iso2} ${c.country}: agent + listing (total ${made})`);
      }
    }
    console.error(`\nDONE — ${made} agents + listings across countries.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
