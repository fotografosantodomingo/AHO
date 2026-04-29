/**
 * RLS test harness for AHO.
 *
 * This module creates a stable set of fixture users (one per tier of interest),
 * provides a `clientFor(tier)` factory that returns a Supabase client
 * authenticated as that fixture user, and exposes an `admin()` service-role
 * client for setting up cross-tier preconditions.
 *
 * **Run against a dedicated test Supabase project, never against staging or
 * production.** The harness writes to `auth.users` and `public.profiles` and
 * leaves fixture rows behind on purpose (idempotent across runs).
 *
 * Required env (loaded via direnv from `.env.local`):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * See `docs/HANDOFF.md` §4.7 + the `rls-policy` skill for authoring rules and
 * `CLAUDE.md` hard rule #2 (every RLS policy ships with a paired test).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    'RLS tests require NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ' +
      'and SUPABASE_SERVICE_ROLE_KEY in env. Source .env.local via direnv ' +
      '(or export them) before running `pnpm test:rls`.',
  );
}

// Defensive guard — refuse to run against URLs that look like staging or prod.
// Adjust the deny-list as our environments evolve.
const DENY_HOSTS = ['staging.advertisehomes.online', 'www.advertisehomes.online'];
if (DENY_HOSTS.some((h) => SUPABASE_URL.includes(h))) {
  throw new Error(
    `Refusing to run RLS tests against ${SUPABASE_URL}. ` +
      'Use a dedicated test Supabase project.',
  );
}

// ----------------------------------------------------------------
// Fixture users
// ----------------------------------------------------------------

export type FixtureTier =
  | 'anon'
  | 'registered_a'
  | 'registered_b'
  | 'agent_a_owner' // owns "AHO Test Org A"
  | 'agent_a_agent' // member with role 'agent' in Org A
  | 'agent_b_owner' // owns "AHO Test Org B"
  | 'admin'; // platform admin (is_admin = true, admin_role = 'super_admin')

interface FixtureCreds {
  email: string;
  password: string;
}

const FIXTURE_PASSWORD = 'fixture-pw-Aa1-not-for-prod';

const FIXTURE_USERS: Record<Exclude<FixtureTier, 'anon'>, FixtureCreds> = {
  registered_a: { email: 'fixture-registered-a@aho.test', password: FIXTURE_PASSWORD },
  registered_b: { email: 'fixture-registered-b@aho.test', password: FIXTURE_PASSWORD },
  agent_a_owner: { email: 'fixture-agent-a-owner@aho.test', password: FIXTURE_PASSWORD },
  agent_a_agent: { email: 'fixture-agent-a-agent@aho.test', password: FIXTURE_PASSWORD },
  agent_b_owner: { email: 'fixture-agent-b-owner@aho.test', password: FIXTURE_PASSWORD },
  admin: { email: 'fixture-admin@aho.test', password: FIXTURE_PASSWORD },
};

// ----------------------------------------------------------------
// Clients
// ----------------------------------------------------------------

/** Service-role client. Bypasses RLS; use only in test setup. */
export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Cache of authenticated clients per tier. Supabase Auth rate-limits
// `signInWithPassword`, so we sign in once per fixture user per test run
// and reuse the resulting client across all tests.
const clientCache = new Map<FixtureTier, SupabaseClient>();

/**
 * Returns a Supabase client authenticated as the given fixture tier.
 * `'anon'` returns an unauthenticated client (anon key only).
 *
 * Clients are cached after the first sign-in. Tests that need a fresh
 * session should sign out first via `c.auth.signOut()` and then call
 * `clientFor` again.
 */
export async function clientFor(tier: FixtureTier): Promise<SupabaseClient> {
  if (tier === 'anon') {
    // Anon clients are cheap; cache them too for consistency.
    const cached = clientCache.get('anon');
    if (cached) return cached;
    const c = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    clientCache.set('anon', c);
    return c;
  }
  const cached = clientCache.get(tier);
  if (cached) return cached;
  const creds = FIXTURE_USERS[tier];
  const c = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword(creds);
  if (error) {
    throw new Error(
      `Could not sign in fixture user ${creds.email}: ${error.message}. ` +
        `Did you call ensureFixtures() in beforeAll?`,
    );
  }
  clientCache.set(tier, c);
  return c;
}

/** Returns the auth UUID of a fixture user (after fixtures exist). */
export async function fixtureUserId(
  tier: Exclude<FixtureTier, 'anon'>,
): Promise<string> {
  const a = admin();
  const { data, error } = await a
    .from('profiles')
    .select('id')
    .eq('email', FIXTURE_USERS[tier].email)
    .single();
  if (error || !data) {
    throw new Error(`Fixture user ${tier} not found: ${error?.message ?? 'no row'}`);
  }
  return data.id;
}

// ----------------------------------------------------------------
// Fixture setup — idempotent
// ----------------------------------------------------------------

export interface FixtureContext {
  orgAId: string;
  orgBId: string;
  // Billing fixtures (created by ensureFixtures after 0003_billing.sql is applied).
  planId: string;
  orgASubscriptionId: string;
  orgAPaymentId: string;
  orgAFounderGrantId: string;
  // Property fixtures (created after 0004_properties.sql is applied).
  orgAActiveListingId: string;
  orgADraftListingId: string;
  orgAActiveListingImageId: string;
  orgADraftListingImageId: string;
}

let cachedContext: FixtureContext | null = null;

/**
 * Idempotent setup. Creates fixture users, two fixture organizations
 * ("AHO Test Org A", "AHO Test Org B"), and the org_members rows that wire
 * users into them.
 *
 * Call from `beforeAll` in every RLS test file. The first call does the work;
 * subsequent calls return the cached context.
 */
export async function ensureFixtures(): Promise<FixtureContext> {
  if (cachedContext) return cachedContext;

  const a = admin();

  // 1. Create users (idempotent — listUsers + skip if present).
  const existing = await a.auth.admin.listUsers();
  if (existing.error) throw existing.error;
  const presentEmails = new Set(existing.data.users.map((u) => u.email));

  for (const [, creds] of Object.entries(FIXTURE_USERS)) {
    if (presentEmails.has(creds.email)) continue;
    const created = await a.auth.admin.createUser({
      email: creds.email,
      password: creds.password,
      email_confirm: true,
    });
    if (created.error) {
      throw new Error(
        `Failed to create fixture user ${creds.email}: ${created.error.message}`,
      );
    }
  }

  // 2. Promote the admin fixture (service-role bypasses the protect trigger).
  const { error: adminUpdateErr } = await a
    .from('profiles')
    .update({ is_admin: true, admin_role: 'super_admin' })
    .eq('email', FIXTURE_USERS.admin.email);
  if (adminUpdateErr) throw adminUpdateErr;

  // 3. Create two fixture orgs (idempotent by slug).
  const orgA = await ensureOrg(a, {
    slug: 'aho-test-org-a',
    name: 'AHO Test Org A',
    type: 'agent',
    listingCap: 5,
  });
  const orgB = await ensureOrg(a, {
    slug: 'aho-test-org-b',
    name: 'AHO Test Org B',
    type: 'agent',
    listingCap: 5,
  });

  // 4. Wire org_members.
  const ownerA = await profileIdByEmail(a, FIXTURE_USERS.agent_a_owner.email);
  const agentA = await profileIdByEmail(a, FIXTURE_USERS.agent_a_agent.email);
  const ownerB = await profileIdByEmail(a, FIXTURE_USERS.agent_b_owner.email);

  await ensureMember(a, orgA, ownerA, 'owner');
  await ensureMember(a, orgA, agentA, 'agent');
  await ensureMember(a, orgB, ownerB, 'owner');

  // 5. Plan + subscription + payment + founder grant for billing RLS tests.
  const planId = await ensurePlan(a);
  const subId = await ensureSubscription(a, orgA, planId);
  const payId = await ensurePayment(a, subId);
  const ownerAId = await profileIdByEmail(a, FIXTURE_USERS.agent_a_owner.email);
  const grantId = await ensureFounderGrant(a, subId, ownerAId);

  // 6. Property fixtures (one active+published, one draft) on org A.
  const activeListingId = await ensureProperty(a, {
    orgId: orgA,
    createdBy: ownerA,
    shortId: 'fixaa1',
    titleEn: 'AHO Fixture — Active Listing',
    slugEn: 'aho-fixture-active-listing-santo-domingo',
    status: 'active',
    publishedAt: new Date().toISOString(),
  });
  const draftListingId = await ensureProperty(a, {
    orgId: orgA,
    createdBy: ownerA,
    shortId: 'fixad1',
    titleEn: 'AHO Fixture — Draft Listing',
    slugEn: null, // drafts allow null slug
    status: 'draft',
    publishedAt: null,
  });
  const activeImageId = await ensurePropertyImage(a, activeListingId, {
    r2Key: 'fixture/active/hero.webp',
    altTextEn: 'Fixture active listing photo',
    isPrimary: true,
  });
  const draftImageId = await ensurePropertyImage(a, draftListingId, {
    r2Key: 'fixture/draft/hero.webp',
    altTextEn: 'Fixture draft listing photo',
    isPrimary: true,
  });

  cachedContext = {
    orgAId: orgA,
    orgBId: orgB,
    planId,
    orgASubscriptionId: subId,
    orgAPaymentId: payId,
    orgAFounderGrantId: grantId,
    orgAActiveListingId: activeListingId,
    orgADraftListingId: draftListingId,
    orgAActiveListingImageId: activeImageId,
    orgADraftListingImageId: draftImageId,
  };
  return cachedContext;
}

interface PropertyFixtureSpec {
  orgId: string;
  createdBy: string;
  shortId: string;
  titleEn: string;
  slugEn: string | null;
  status: 'draft' | 'active' | 'pending' | 'sold' | 'rented' | 'archived';
  publishedAt: string | null;
}

/**
 * Insert a fixture property idempotently. Uses EWKT format for the geography
 * column since Supabase JS goes through PostgREST and PostGIS auto-casts
 * `'SRID=4326;POINT(lng lat)'` text to `geography`.
 */
async function ensureProperty(
  a: SupabaseClient,
  spec: PropertyFixtureSpec,
): Promise<string> {
  const existing = await a
    .from('properties')
    .select('id')
    .eq('short_id', spec.shortId)
    .maybeSingle();
  if (existing.data) return existing.data.id as string;

  const created = await a
    .from('properties')
    .insert({
      org_id: spec.orgId,
      created_by: spec.createdBy,
      short_id: spec.shortId,
      transaction_type: 'sale',
      property_type: 'apartment',
      status: spec.status,
      title_en: spec.titleEn,
      slug_en: spec.slugEn,
      price_cents: 20_000_000,
      currency: 'USD',
      bedrooms: 2,
      bathrooms: 1.5,
      area_sqm: 80,
      city: 'Santo Domingo',
      country_code: 'DO',
      // EWKT — PostGIS casts to geography(Point, 4326) automatically.
      location: 'SRID=4326;POINT(-69.92 18.47)',
      published_at: spec.publishedAt,
    })
    .select('id')
    .single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

interface PropertyImageFixtureSpec {
  r2Key: string;
  altTextEn: string;
  isPrimary: boolean;
}

async function ensurePropertyImage(
  a: SupabaseClient,
  propertyId: string,
  spec: PropertyImageFixtureSpec,
): Promise<string> {
  const existing = await a
    .from('property_images')
    .select('id')
    .eq('property_id', propertyId)
    .eq('r2_key', spec.r2Key)
    .maybeSingle();
  if (existing.data) return existing.data.id as string;

  const created = await a
    .from('property_images')
    .insert({
      property_id: propertyId,
      r2_key: spec.r2Key,
      alt_text_en: spec.altTextEn,
      is_primary: spec.isPrimary,
      width: 1280,
      height: 853,
      position: 0,
      upload_status: 'confirmed', // fixtures simulate the post-confirm state
    })
    .select('id')
    .single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

/**
 * Cleanup helper for tests that create extra properties beyond the fixtures
 * (e.g., listing-cap overflow tests). Removes any property whose `short_id`
 * starts with `fixtest` — fixtures use `fixaa*` / `fixad*` prefixes so they
 * are preserved.
 */
export async function cleanupTestProperties(): Promise<void> {
  const a = admin();
  await a.from('properties').delete().like('short_id', 'fixtest%');
}

const FIXTURE_PLAN_ID = 'aho_agent_monthly_test';
const FIXTURE_STRIPE_PRICE = 'price_test_aho_agent_monthly';
const FIXTURE_STRIPE_PRODUCT = 'prod_test_aho_agent';
const FIXTURE_STRIPE_CUSTOMER = 'cus_test_aho_org_a';
const FIXTURE_STRIPE_SUB = 'sub_test_aho_org_a';

async function ensurePlan(a: SupabaseClient): Promise<string> {
  const existing = await a.from('plans').select('id').eq('id', FIXTURE_PLAN_ID).maybeSingle();
  if (existing.data) return existing.data.id as string;
  const { error } = await a.from('plans').insert({
    id: FIXTURE_PLAN_ID,
    tier: 'agent',
    billing_period: 'monthly',
    stripe_product_id: FIXTURE_STRIPE_PRODUCT,
    stripe_price_id: FIXTURE_STRIPE_PRICE,
    display_name_en: 'AHO Agent (test fixture)',
    display_name_es: 'AHO Agente (fixture)',
    amount_cents: 2900,
    currency: 'USD',
    trial_days: 7,
    listing_cap: 5,
    seats_included: 1,
    is_active: true,
    is_visible: true,
    sort_order: 1,
  });
  if (error) throw error;
  return FIXTURE_PLAN_ID;
}

async function ensureSubscription(
  a: SupabaseClient,
  orgId: string,
  planId: string,
): Promise<string> {
  const existing = await a
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', FIXTURE_STRIPE_SUB)
    .maybeSingle();
  if (existing.data) return existing.data.id as string;
  const now = new Date();
  const oneMonthOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const created = await a
    .from('subscriptions')
    .insert({
      org_id: orgId,
      plan_id: planId,
      stripe_customer_id: FIXTURE_STRIPE_CUSTOMER,
      stripe_subscription_id: FIXTURE_STRIPE_SUB,
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: oneMonthOut.toISOString(),
    })
    .select('id')
    .single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

async function ensurePayment(
  a: SupabaseClient,
  subscriptionId: string,
): Promise<string> {
  const existing = await a
    .from('payments')
    .select('id')
    .eq('subscription_id', subscriptionId)
    .maybeSingle();
  if (existing.data) return existing.data.id as string;
  const created = await a
    .from('payments')
    .insert({
      subscription_id: subscriptionId,
      stripe_payment_intent_id: 'pi_test_aho_org_a_first_invoice',
      stripe_invoice_id: 'in_test_aho_org_a_first_invoice',
      amount_cents: 2900,
      currency: 'USD',
      status: 'succeeded',
    })
    .select('id')
    .single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

async function ensureFounderGrant(
  a: SupabaseClient,
  subscriptionId: string,
  userId: string,
): Promise<string> {
  const existing = await a
    .from('founder_rate_grants')
    .select('id')
    .eq('subscription_id', subscriptionId)
    .maybeSingle();
  if (existing.data) return existing.data.id as string;
  const created = await a
    .from('founder_rate_grants')
    .insert({
      subscription_id: subscriptionId,
      user_id: userId,
      original_price_id: 'price_test_aho_agent_founder_monthly',
    })
    .select('id')
    .single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

interface OrgSpec {
  slug: string;
  name: string;
  type: 'agent' | 'agency' | 'expert';
  listingCap: number | null;
}

async function ensureOrg(a: SupabaseClient, spec: OrgSpec): Promise<string> {
  const existing = await a
    .from('organizations')
    .select('id')
    .eq('slug', spec.slug)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id as string;

  const created = await a
    .from('organizations')
    .insert({
      slug: spec.slug,
      name: spec.name,
      type: spec.type,
      listing_cap: spec.listingCap,
    })
    .select('id')
    .single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

async function ensureMember(
  a: SupabaseClient,
  orgId: string,
  userId: string,
  role: 'owner' | 'manager' | 'agent' | 'analyst' | 'viewer',
): Promise<void> {
  const existing = await a
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  const { error } = await a
    .from('organization_members')
    .insert({ org_id: orgId, user_id: userId, role, joined_at: new Date().toISOString() });
  if (error) throw error;
}

async function profileIdByEmail(a: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await a
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();
  if (error || !data) {
    throw new Error(`Profile not found for ${email}: ${error?.message ?? 'no row'}`);
  }
  return data.id as string;
}
