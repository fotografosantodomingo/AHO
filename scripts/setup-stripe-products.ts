/**
 * Idempotent Stripe products + prices setup for AHO.
 *
 * Run with the desired Stripe key in env (`sk_test_*` or `sk_live_*`).
 * The script is idempotent — re-running does NOT duplicate products or
 * prices. Each Stripe object carries metadata identifying its AHO role,
 * and the script reuses existing rows when found.
 *
 * Usage:
 *   pnpm stripe:setup
 *
 * Prints a JSON object with all resulting product/price IDs at the end.
 * Per `docs/DECISIONS.md` "Pricing locked", these IDs are reviewed
 * before any LIVE creation. Test-mode IDs come back to the PO; LIVE-
 * mode is a separate run with a `sk_live_*` key after PO approval.
 *
 * Tier structure (3-tier Path 1 from the social-automation spec):
 *   Agent           $29 / mo   $290 / yr   listing_cap 5    (existing)
 *   Plus            $49 / mo   $490 / yr   listing_cap 15   (NEW)
 *   Pro Automation  $99 / mo   $990 / yr   listing_cap 30   (NEW)
 *   Founder rate    $19 / mo                                 (existing, archived)
 */

import Stripe from 'stripe';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.error('STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}

// LIVE-MODE GUARDRAIL — see CLAUDE.md hard rule #9.
if (STRIPE_KEY.startsWith('sk_live_')) {
  console.error(
    'Refusing to run in LIVE mode. STRIPE_SECRET_KEY starts with `sk_live_`.\n' +
      'Set a `sk_test_*` key in `.env.local` and re-run.\n' +
      'See CLAUDE.md hard rule #9 and docs/DECISIONS.md for the policy.',
  );
  process.exit(1);
}

const MODE = 'TEST';
const stripe = new Stripe(STRIPE_KEY);

const META_KEY = 'aho_role';

// Per-tier product roles. Each has its own Stripe Product so customers
// see distinct line items + Stripe Customer Portal can offer plan-
// switching between them cleanly.
const PRODUCT_ROLES = {
  agent: 'agent',
  plus: 'plus',
  pro_automation: 'pro_automation',
} as const;

const PRICE_ROLES = {
  // Agent (existing)
  agent_monthly: 'agent_monthly',
  agent_annual: 'agent_annual',
  agent_founder: 'agent_founder_monthly',
  // Plus (NEW)
  plus_monthly: 'plus_monthly',
  plus_annual: 'plus_annual',
  // Pro Automation (NEW)
  pro_automation_monthly: 'pro_automation_monthly',
  pro_automation_annual: 'pro_automation_annual',
} as const;

interface ProductSpec {
  role: string;
  name: string;
  description: string;
}

const PRODUCTS: ProductSpec[] = [
  {
    role: PRODUCT_ROLES.agent,
    name: 'AHO Agent',
    description:
      'Up to 5 active listings. Manual social share, agent profile and inbox, performance analytics, WhatsApp lead capture.',
  },
  {
    role: PRODUCT_ROLES.plus,
    name: 'AHO Plus',
    description:
      'Up to 15 active listings. Priority placement on city landings, Verified Real Estate Agent badge, multi-city listings. Includes everything in Agent.',
  },
  {
    role: PRODUCT_ROLES.pro_automation,
    name: 'AHO Pro Automation',
    description:
      'Up to 30 active listings. One-click social automation to Facebook + Instagram + LinkedIn with AI-generated captions, post history + retry, traffic tracking back to AHO. Includes everything in Plus.',
  },
];

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

async function ensureProduct(spec: ProductSpec): Promise<Stripe.Product> {
  const existing = await findProductByRole(spec.role);
  if (existing) {
    console.error(`[product ${spec.role}] reusing existing ${existing.id}`);
    // Update name/description in case copy has been edited since first run.
    if (existing.name !== spec.name || existing.description !== spec.description) {
      const updated = await stripe.products.update(existing.id, {
        name: spec.name,
        description: spec.description,
      });
      console.error(`[product ${spec.role}] copy refreshed`);
      return updated;
    }
    return existing;
  }
  const created = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    metadata: { [META_KEY]: spec.role },
  });
  console.error(`[product ${spec.role}] created ${created.id}`);
  return created;
}

interface PriceSpec {
  role: string;
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
    console.error(`[price ${spec.role}] reusing existing ${existing.id}`);
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
      ...(spec.trialPeriodDays ? { trial_period_days: spec.trialPeriodDays } : {}),
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

  // Ensure each tier's product.
  const agentProduct = await ensureProduct(PRODUCTS[0]!);
  const plusProduct = await ensureProduct(PRODUCTS[1]!);
  const proProduct = await ensureProduct(PRODUCTS[2]!);

  // Agent prices (existing).
  const agentMonthly = await ensurePrice(agentProduct.id, {
    role: PRICE_ROLES.agent_monthly,
    nickname: 'agent_monthly',
    unitAmount: 2900,
    interval: 'month',
    trialPeriodDays: 7,
  });
  const agentAnnual = await ensurePrice(agentProduct.id, {
    role: PRICE_ROLES.agent_annual,
    nickname: 'agent_annual',
    unitAmount: 29000,
    interval: 'year',
  });
  const agentFounder = await ensurePrice(agentProduct.id, {
    role: PRICE_ROLES.agent_founder,
    nickname: 'agent_founder_monthly',
    unitAmount: 1900,
    interval: 'month',
    trialPeriodDays: 7,
    archive: true,
  });

  // Plus prices (NEW).
  const plusMonthly = await ensurePrice(plusProduct.id, {
    role: PRICE_ROLES.plus_monthly,
    nickname: 'plus_monthly',
    unitAmount: 4900,
    interval: 'month',
    trialPeriodDays: 7,
  });
  const plusAnnual = await ensurePrice(plusProduct.id, {
    role: PRICE_ROLES.plus_annual,
    nickname: 'plus_annual',
    unitAmount: 49000,
    interval: 'year',
  });

  // Pro Automation prices (NEW).
  const proMonthly = await ensurePrice(proProduct.id, {
    role: PRICE_ROLES.pro_automation_monthly,
    nickname: 'pro_automation_monthly',
    unitAmount: 9900,
    interval: 'month',
    trialPeriodDays: 7,
  });
  const proAnnual = await ensurePrice(proProduct.id, {
    role: PRICE_ROLES.pro_automation_annual,
    nickname: 'pro_automation_annual',
    unitAmount: 99000,
    interval: 'year',
  });

  const result = {
    mode: MODE,
    products: {
      agent: agentProduct.id,
      plus: plusProduct.id,
      pro_automation: proProduct.id,
    },
    prices: {
      agent_monthly: agentMonthly.id,
      agent_annual: agentAnnual.id,
      agent_founder_monthly: agentFounder.id,
      plus_monthly: plusMonthly.id,
      plus_annual: plusAnnual.id,
      pro_automation_monthly: proMonthly.id,
      pro_automation_annual: proAnnual.id,
    },
    envSnippet: [
      `STRIPE_AGENT_PRODUCT_ID=${agentProduct.id}`,
      `STRIPE_AGENT_MONTHLY_PRICE_ID=${agentMonthly.id}`,
      `STRIPE_AGENT_ANNUAL_PRICE_ID=${agentAnnual.id}`,
      `STRIPE_AGENT_FOUNDER_PRICE_ID=${agentFounder.id}`,
      `STRIPE_PLUS_PRODUCT_ID=${plusProduct.id}`,
      `STRIPE_PLUS_MONTHLY_PRICE_ID=${plusMonthly.id}`,
      `STRIPE_PLUS_ANNUAL_PRICE_ID=${plusAnnual.id}`,
      `STRIPE_PRO_AUTOMATION_PRODUCT_ID=${proProduct.id}`,
      `STRIPE_PRO_AUTOMATION_MONTHLY_PRICE_ID=${proMonthly.id}`,
      `STRIPE_PRO_AUTOMATION_ANNUAL_PRICE_ID=${proAnnual.id}`,
    ].join('\n'),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
