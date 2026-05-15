/**
 * One-off importer for the 2026-05-14 bulk-agent CSV.
 *
 * Splits by country into separate email_audiences. The audience
 * description carries a HARD-CODED legal-status flag — green / amber /
 * red — so the admin UI shows which buckets are safe to send to and
 * which would expose AHO to legal liability + sender-domain reputation
 * risk if a campaign were fired against them.
 *
 * Run once. Idempotent (uses upsert on email_audience_contacts
 * unique (audience_id, email)).
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const POOLER_URL = process.env.SUPABASE_POOLER_URL;
if (!POOLER_URL) {
  console.error('SUPABASE_POOLER_URL not set');
  process.exit(1);
}

const CSV_PATH = 'docs/agent-imports/2026-05-14-bulk-import.csv';
const INFO_ADMIN_ID = '493e656d-58f3-416f-b6d7-20ba755c089d'; // info@advertisehomes.online

// Country → ISO 3166-1 alpha-2 + legal-status flag
type LegalStatus = 'green' | 'amber' | 'red';
const COUNTRY_META: Record<string, { iso: string; status: LegalStatus; reason: string }> = {
  USA: { iso: 'US', status: 'green', reason: 'CAN-SPAM opt-out — legal with proper unsubscribe + headers' },
  Australia: { iso: 'AU', status: 'green', reason: 'Spam Act §16 inferred-consent for emails on business profiles' },
  UK: { iso: 'GB', status: 'amber', reason: 'PECR — OK to corporate emails (.co.uk agencies), borderline for sole traders' },
  Canada: { iso: 'CA', status: 'red', reason: 'CASL — cold marketing ILLEGAL, fines up to CA$10M per violation' },
  'New Zealand': { iso: 'NZ', status: 'red', reason: 'UEM Act 2007 — cold marketing requires prior opt-in' },
  Ireland: { iso: 'IE', status: 'red', reason: 'EU GDPR — opt-in required for marketing emails' },
  'South Africa': { iso: 'ZA', status: 'red', reason: 'POPIA — opt-in required for direct marketing' },
  Barbados: { iso: 'BB', status: 'red', reason: 'Data Protection Act 2019 — opt-in required' },
  Jamaica: { iso: 'JM', status: 'red', reason: 'Data Protection Act 2020 — opt-in required' },
};

const STATUS_PREFIX: Record<LegalStatus, string> = {
  green: '✅ SAFE TO SEND',
  amber: '⚠️ SEND WITH CARE',
  red: '🚫 DO NOT SEND',
};

function parseCsvLine(line: string): string[] {
  // Simple CSV: no quoted fields with embedded commas in this file.
  // (Verified by inspection — names with parentheses don't contain commas.)
  return line.split(',');
}

const csv = readFileSync(CSV_PATH, 'utf-8');
const lines = csv.split(/\r?\n/).slice(1).filter((l) => l.trim());
const byCountry = new Map<string, Array<{ name: string; email: string }>>();
const skipped: string[] = [];

for (const line of lines) {
  const cells = parseCsvLine(line);
  if (cells.length !== 3) {
    skipped.push(line);
    continue;
  }
  const [name, country, email] = cells;
  if (!name || !country || !email) {
    skipped.push(line);
    continue;
  }
  const cleanEmail = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    skipped.push(line);
    continue;
  }
  if (!COUNTRY_META[country.trim()]) {
    console.warn(`unknown country: "${country.trim()}" — skipping ${name}`);
    skipped.push(line);
    continue;
  }
  if (!byCountry.has(country.trim())) byCountry.set(country.trim(), []);
  byCountry.get(country.trim())!.push({ name: name.trim(), email: cleanEmail });
}

if (skipped.length > 0) {
  console.warn(`Skipped ${skipped.length} malformed rows:`);
  for (const s of skipped) console.warn(' -', s);
}

const sql = postgres(POOLER_URL!, { max: 1, prepare: false });

try {
  console.log(`\nImporting ${[...byCountry.values()].reduce((s, a) => s + a.length, 0)} contacts across ${byCountry.size} audiences\n`);

  for (const [country, agents] of byCountry) {
    const meta = COUNTRY_META[country]!;
    const audienceName = `Agents — ${country} (${STATUS_PREFIX[meta.status]})`;
    const description = `Bulk import 2026-05-14. ${meta.reason}. ${agents.length} contacts.`;

    // Deduplicate emails within this country bucket before insert.
    const seen = new Set<string>();
    const dedupedAgents = agents.filter((a) => {
      if (seen.has(a.email)) return false;
      seen.add(a.email);
      return true;
    });

    // Insert audience
    const [audience] = await sql`
      insert into public.email_audiences (name, description, created_by, contact_count)
      values (${audienceName}, ${description}, ${INFO_ADMIN_ID}, ${dedupedAgents.length})
      returning id
    `;
    const audienceId = (audience as { id: string }).id;

    // Bulk-insert contacts. Chunk at 500 to stay well below any param-count limits.
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < dedupedAgents.length; i += CHUNK) {
      const slice = dedupedAgents.slice(i, i + CHUNK).map((a) => ({
        audience_id: audienceId,
        email: a.email,
        full_name: a.name,
        country_code: meta.iso,
      }));
      const result = await sql`
        insert into public.email_audience_contacts ${sql(slice, 'audience_id', 'email', 'full_name', 'country_code')}
        on conflict (audience_id, email) do nothing
        returning id
      `;
      inserted += result.length;
    }

    // Reconcile audience.contact_count with actual inserts (in case of intra-batch dups).
    await sql`update public.email_audiences set contact_count = ${inserted} where id = ${audienceId}`;

    console.log(`${STATUS_PREFIX[meta.status]}  ${country.padEnd(15)} ${String(inserted).padStart(3)} contacts → audience ${audienceId.slice(0, 8)}…`);
  }

  console.log('\n✓ All audiences created.\n');

  // Final summary by status.
  const summary = await sql`
    select
      case
        when name like '%🚫%' then 'red'
        when name like '%⚠️%' then 'amber'
        when name like '%✅%' then 'green'
        else 'unknown'
      end as status,
      sum(contact_count)::int as total
    from public.email_audiences
    where name like 'Agents —%' and created_at > now() - interval '5 minutes'
    group by 1 order by 1
  `;
  console.log('Summary by legal status:');
  for (const row of summary as Array<{ status: string; total: number }>) {
    console.log(`  ${row.status}: ${row.total} contacts`);
  }
} finally {
  await sql.end();
}
