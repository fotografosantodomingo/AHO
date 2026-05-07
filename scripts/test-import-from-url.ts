/**
 * One-shot smoke test for `lib/listings/import-from-url.ts`. Hits a
 * known URL (the PO's own AHO listing — zero-risk, real data) and
 * dumps the extracted facts so we can eyeball the prompt's accuracy.
 *
 * Usage:
 *   set -a && source .env.local && set +a && pnpm tsx scripts/test-import-from-url.ts
 */
import { importFromUrl } from '../src/lib/listings/import-from-url';

const TARGETS = [
  // The PO's own AHO listing — Polish, simple facts, photos backfilled.
  'https://advertisehomes.online/pl/properties/wwww-siemianowice-pl-cQF9BN',
  // Pick whichever is convenient when run; the rest is here as
  // documentation of the URLs we expect to handle.
  // 'https://www.otodom.pl/pl/oferta/...',
  // 'https://www.idealista.com/inmueble/...',
];

async function main(): Promise<void> {
  for (const url of TARGETS) {
    console.log(`\n========== ${url} ==========`);
    const start = Date.now();
    try {
      const facts = await importFromUrl({ url });
      const ms = Date.now() - start;
      console.log(`(${ms}ms)`);
      console.log(JSON.stringify(facts, null, 2));
    } catch (e) {
      console.error(`✗ ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
