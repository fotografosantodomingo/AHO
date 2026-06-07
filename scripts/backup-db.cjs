/**
 * Logical database backup → backup/database/
 *
 * Why this exists: no pg_dump / supabase CLI on this machine, and only the
 * pooler connection string is available. This streams every row of every
 * public-schema table to JSON-lines (one file per table) plus a manifest.
 *
 * Restore model: schema DDL lives in src/db/migrations/ (version-controlled);
 * this captures the DATA. migrations + these .jsonl files = full restore.
 *
 * Output (backup/database/ is gitignored — files contain production PII):
 *   <table>.jsonl      one JSON object per row
 *   _manifest.json     { generated_at, host(sanitized), schema, tables:{name:count} }
 *
 * Run: set -a && source .env.local && set +a && node scripts/backup-db.cjs
 */
const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

const raw = process.env.SUPABASE_POOLER_URL;
if (!raw) {
  console.error('SUPABASE_POOLER_URL not set — source .env.local first');
  process.exit(1);
}
// Cursor streaming needs a real session; the transaction pooler (6543) can't
// hold a portal across fetches. Supabase exposes the session pooler on 5432
// at the same host.
const url = raw.replace(':6543/', ':5432/');
const sanitizedHost = url.replace(/^[^@]*@/, '<creds>@');

const OUT = path.join('backup', 'database');
fs.mkdirSync(OUT, { recursive: true });

const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 20 });

(async () => {
  const tables = await sql`
    select tablename from pg_tables
    where schemaname = 'public'
    order by tablename
  `;
  const manifest = {
    generated_at: new Date().toISOString(),
    host: sanitizedHost,
    schema: 'public',
    table_count: tables.length,
    tables: {},
  };
  let grandTotal = 0;
  for (const { tablename } of tables) {
    const file = path.join(OUT, `${tablename}.jsonl`);
    const ws = fs.createWriteStream(file);
    let count = 0;
    // Stream in 500-row chunks so large log tables don't blow up memory.
    await sql`select * from ${sql(tablename)}`.cursor(500, (rows) => {
      for (const row of rows) {
        ws.write(`${JSON.stringify(row)}\n`);
        count++;
      }
    });
    await new Promise((res) => ws.end(res));
    manifest.tables[tablename] = count;
    grandTotal += count;
    console.error(`  ${tablename.padEnd(40)} ${count}`);
  }
  fs.writeFileSync(
    path.join(OUT, '_manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.error(`\nDONE: ${tables.length} tables, ${grandTotal} rows → ${OUT}/`);
  await sql.end();
})().catch((e) => {
  console.error('BACKUP FAILED:', e.message || e);
  process.exit(1);
});
