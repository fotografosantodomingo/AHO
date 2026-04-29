/**
 * Migration runner for AHO. Applies hand-written SQL files under
 * `src/db/migrations/` in alphabetical order, tracking applied migrations
 * in a `public.aho_migrations` table.
 *
 * Each .sql file is applied inside a transaction; if any statement fails the
 * whole file is rolled back and the migration is not marked applied. Re-runs
 * are safe — already-applied files are skipped.
 *
 * Per `docs/DECISIONS.md` "Migration tooling", we hand-write SQL rather than
 * generating from Drizzle, so we don't use drizzle-kit's journal format.
 *
 * Usage:
 *   pnpm db:migrate
 *
 * Env required:
 *   SUPABASE_POOLER_URL — full Postgres connection string with password.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const POOLER_URL = process.env.SUPABASE_POOLER_URL;
if (!POOLER_URL) {
  console.error(
    'SUPABASE_POOLER_URL is not set. Source .env.local first or set it in env.',
  );
  process.exit(1);
}

const MIGRATIONS_DIR = './src/db/migrations';

async function main() {
  const sql = postgres(POOLER_URL!, {
    max: 1,
    prepare: false,
  });

  try {
    // Track applied migrations in a small bookkeeping table.
    await sql`
      create table if not exists public.aho_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const allFiles = await readdir(MIGRATIONS_DIR);
    const sqlFiles = allFiles.filter((f) => f.endsWith('.sql')).sort();

    if (sqlFiles.length === 0) {
      console.log('No migration files found in', MIGRATIONS_DIR);
      return;
    }

    let appliedThisRun = 0;
    for (const file of sqlFiles) {
      const existing = await sql`
        select 1 from public.aho_migrations where name = ${file}
      `;
      if (existing.length > 0) {
        console.log(`✓ ${file} (already applied)`);
        continue;
      }

      console.log(`→ applying ${file}...`);
      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');

      await sql.begin(async (tx) => {
        // simple() lets us run multi-statement SQL files without splitting.
        await tx.unsafe(content).simple();
        await tx`insert into public.aho_migrations (name) values (${file})`;
      });

      console.log(`✓ ${file}`);
      appliedThisRun++;
    }

    if (appliedThisRun === 0) {
      console.log('\nNo new migrations to apply.');
    } else {
      console.log(`\nApplied ${appliedThisRun} migration(s).`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
