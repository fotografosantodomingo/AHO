/**
 * Idempotent Stripe products + prices setup for AHO.
 *
 * Run with the desired Stripe key in env (`sk_test_*` or `sk_live_*`).
 * The script is idempotent — re-running it does not duplicate products or prices,
 * because each Stripe object carries metadata identifying its AHO role.
 *
 * Usage:
 *   pnpm stripe:setup
 *
 * Prints a JSON object with the resulting product/price IDs at the end.
 * Per `docs/DECISIONS.md` "Pricing locked", these IDs are reviewed before any
 * LIVE creation. Test-mode IDs come back to the PO; LIVE-mode is a separate
 * run with a `sk_live_*` key after PO approval.
 */

import Stripe from 'stripe';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.error(
    'STRIPE_SECRET_KEY is not set. Make sure direnv is active (`direnv reload`) ' +
      'and the key is in `.env.local`.',
  );
  process.exit(1);
}

// ============================================================
// LIVE-MODE GUARDRAIL
//
// This script refuses to run with a `sk_live_*` key. Live products + prices
// are real billable infrastructure. Creating them by accident pollutes the
// production Stripe account, blocks test-mode iteration, and risks real
// charges if the website is ever publicly reachable.
//
// Per CLAUDE.md hard rule #9: "Any operation that creates billable resources
// or live-mode payment infrastructure requires explicit confirmation in chat
// before execution. The presence of a live API key is not implicit consent."
//
// Do NOT remove this guard without a `docs/DECISIONS.md` entry approving the
// specific live-mode setup operation, with rollback plan, on a date.
// ============================================================
if (STRIPE_KEY.startsWith('sk_live_')) {
  console.error(
    'Refusing to run in LIVE mode. STRIPE_SECRET_KEY starts with `sk_live_`.\n' +
      'Set a `sk_test_*` key in `.env.local` and re-run.\n' +
      'See CLAUDE.md hard rule #9 and docs/DECISIONS.md for the policy.',
  );
  process.exit(1);
}

const MODE = 'TEST';
// API version is pinned by the Stripe SDK we depend on (see package.json).
const stripe = new Stripe(STRIPE_KEY);

// AHO role identifiers stored as metadata on each Stripe object.
const META_KEY = 'aho_role';
const PRODUCT_ROLE = 'agent';
const PRICE_ROLES = {
  monthly: 'agent_monthly',
  annual: 'agent_annual',
  founder: 'agent_founder_monthly',
} as const;

async function findProductByRole(role: string): Promise<Stripe.Product | null> {
  for await (const product of stripe.products.list({ limit: 100, active: true })) {
    if (product.metadata[META_KEY] === role) return product;
  }
  return null;
}

async function findPriceByRole(
  productId: string,
  role: string,
): Promise<Stripe.Price | null> {
  for await (const price of stripe.prices.list({
    product: productId,
    limit: 100,
  })) {
    if (price.metadata[META_KEY] === role) return price;
  }
  return null;
}

async function ensureProduct(): Promise<Stripe.Product> {
  const existing = await findProductByRole(PRODUCT_ROLE);
  if (existing) {
    console.error(`[product] reusing existing product ${existing.id}`);
    return existing;
  }
  const created = await stripe.products.create({
    name: 'AHO Agent',
    description:
      'Up to 5 active listings. Includes one-click social share to Facebook and Instagram, agent profile and inbox, performance analytics, WhatsApp lead capture.',
    metadata: { [META_KEY]: PRODUCT_ROLE },
  });
  console.error(`[product] created ${created.id}`);
  return created;
}

interface PriceSpec {
  role: (typeof PRICE_ROLES)[keyof typeof PRICE_ROLES];
  nickname: string;
  unitAmount: number;
  interval: 'month' | 'year';
  trialPeriodDays?: number;
  /** Archive the price so it never appears on /pricing — application-gated. */
  archive?: boolean;
}

async function ensurePrice(
  productId: string,
  spec: PriceSpec,
): Promise<Stripe.Price> {
  const existing = await findPriceByRole(productId, spec.role);
  if (existing) {
    console.error(`[price ${spec.role}] reusing existing price ${existing.id}`);
    if (spec.archive && existing.active) {
      const updated = await stripe.prices.update(existing.id, { active: false });
      console.error(`[price ${spec.role}] archived (was active)`);
      return updated;
    }
    return existing;
  }
  const created = await stripe.prices.create({
    product: productId,
    nickname: spec.nickname,
    unit_amount: spec.unitAmount,
    currency: 'usd',
    recurring: {
      interval: spec.interval,
      ...(spec.trialPeriodDays
        ? { trial_period_days: spec.trialPeriodDays }
        : {}),
    },
    metadata: { [META_KEY]: spec.role },
  });
  console.error(`[price ${spec.role}] created ${created.id}`);
  if (spec.archive) {
    const updated = await stripe.prices.update(created.id, { active: false });
    console.error(`[price ${spec.role}] archived`);
    return updated;
  }
  return created;
}

async function main() {
  console.error(`Running in ${MODE} mode against Stripe.`);
  const product = await ensureProduct();

  const monthly = await ensurePrice(product.id, {
    role: PRICE_ROLES.monthly,
    nickname: 'agent_monthly',
    unitAmount: 2900, // $29.00
    interval: 'month',
    trialPeriodDays: 7,
  });

  const annual = await ensurePrice(product.id, {
    role: PRICE_ROLES.annual,
    nickname: 'agent_annual',
    unitAmount: 29000, // $290.00
    interval: 'year',
    // No trial on annual — per DECISIONS.md "Stripe trial period on Price".
  });

  const founder = await ensurePrice(product.id, {
    role: PRICE_ROLES.founder,
    nickname: 'agent_founder_monthly',
    unitAmount: 1900, // $19.00 — first 50 agents, application-gated
    interval: 'month',
    trialPeriodDays: 7,
    archive: true, // never on /pricing; only assignable via application logic
  });

  // Machine-readable result for env-var population.
  const result = {
    mode: MODE,
    productId: product.id,
    prices: {
      monthly: { id: monthly.id, role: monthly.metadata[META_KEY] },
      annual: { id: annual.id, role: annual.metadata[META_KEY] },
      founder: {
        id: founder.id,
        role: founder.metadata[META_KEY],
        archived: !founder.active,
      },
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
