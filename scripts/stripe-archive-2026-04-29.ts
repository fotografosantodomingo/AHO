/**
 * One-off LIVE-mode archive of the AHO Stripe objects created in error
 * on 2026-04-29 before CLAUDE.md hard rule #9 was in place.
 *
 * Targets (per docs/DECISIONS.md "Live mode objects archived in error"):
 *   product: prod_UQNAhtN4rTQm3Y
 *   prices:  price_1TRWQTHkr4MqMDqIi73Swonq (agent_monthly)
 *            price_1TRWQTHkr4MqMDqICouAeiPe (agent_annual)
 *            price_1TRWQUHkr4MqMDqIf2Y9P6jc (agent_founder_monthly)
 *
 * What this script does:
 *   1. Audit each target — print current `active` state.
 *   2. Set each price `active=false`.
 *   3. Set the product `active=false`.
 *
 * Stripe does not allow deleting prices that have been used; archive is the
 * only durable disposal. Re-running this script is idempotent — already-
 * archived objects are noted and skipped.
 *
 * Requires `STRIPE_SECRET_KEY` to be a `sk_live_*` key. The script refuses
 * other modes — this is intentionally narrow.
 *
 * **This script does NOT run as part of `pnpm` lifecycle.** Invoke directly:
 *
 *   set -a && source .env.local && set +a && tsx scripts/stripe-archive-2026-04-29.ts
 *
 * After successful archival, this file should be retained in the repo
 * (history) but never re-run. Delete or rename if needed for clarity.
 */

import Stripe from 'stripe';

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}
if (!KEY.startsWith('sk_live_')) {
  console.error(
    'This is a LIVE-only cleanup script. STRIPE_SECRET_KEY must start with `sk_live_`.\n' +
      'If you are running this against test mode by accident, swap keys and re-evaluate.',
  );
  process.exit(1);
}

const TARGETS = {
  product: 'prod_UQNAhtN4rTQm3Y',
  prices: [
    'price_1TRWQTHkr4MqMDqIi73Swonq',
    'price_1TRWQTHkr4MqMDqICouAeiPe',
    'price_1TRWQUHkr4MqMDqIf2Y9P6jc',
  ],
} as const;

const stripe = new Stripe(KEY);

async function main() {
  console.log('=== AUDIT (LIVE mode) ===');
  for (const priceId of TARGETS.prices) {
    const p = await stripe.prices.retrieve(priceId);
    console.log(
      `  price ${priceId}: active=${p.active}, product=${p.product}, role=${p.metadata.aho_role ?? '(none)'}, amount=${p.unit_amount}`,
    );
  }
  const prod = await stripe.products.retrieve(TARGETS.product);
  console.log(
    `  product ${TARGETS.product}: active=${prod.active}, name="${prod.name}", role=${prod.metadata.aho_role ?? '(none)'}`,
  );

  console.log('\n=== ARCHIVE PRICES ===');
  for (const priceId of TARGETS.prices) {
    const cur = await stripe.prices.retrieve(priceId);
    if (!cur.active) {
      console.log(`  price ${priceId}: already archived, skipping`);
      continue;
    }
    const updated = await stripe.prices.update(priceId, { active: false });
    console.log(`  price ${priceId}: active=${updated.active} (was true)`);
  }

  console.log('\n=== ARCHIVE PRODUCT ===');
  const curProd = await stripe.products.retrieve(TARGETS.product);
  if (!curProd.active) {
    console.log(`  product ${TARGETS.product}: already archived, skipping`);
  } else {
    const archivedProd = await stripe.products.update(TARGETS.product, { active: false });
    console.log(`  product ${TARGETS.product}: active=${archivedProd.active} (was true)`);
  }

  console.log('\n=== POST-ARCHIVE VERIFY ===');
  for (const priceId of TARGETS.prices) {
    const p = await stripe.prices.retrieve(priceId);
    console.log(`  price ${priceId}: active=${p.active}`);
  }
  const verifyProd = await stripe.products.retrieve(TARGETS.product);
  console.log(`  product ${TARGETS.product}: active=${verifyProd.active}`);

  console.log('\nArchive complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
