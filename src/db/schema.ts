/**
 * Drizzle schema — runtime types source for AHO.
 *
 * Migrations are hand-written SQL under `src/db/migrations/` (per `docs/DECISIONS.md`
 * "Migration tooling"). This file is kept in sync with the migrations manually
 * and is the source of truth for typed queries from Workers and Server Actions.
 *
 * Conventions:
 *   - `snake_case` table and column names.
 *   - Every table has `created_at` and `updated_at` `timestamptz` defaulting to `now()`.
 *   - Money is stored as `bigint` cents.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// citext (case-insensitive text) is enabled in 0001_init.sql via the citext extension.
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

// ----------------------------------------------------------------
// profiles — extends auth.users (Supabase Auth)
// ----------------------------------------------------------------

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: citext('email').notNull().unique(),
  fullName: text('full_name'),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  preferredLanguage: text('preferred_language').notNull().default('en'),
  preferredCurrency: char('preferred_currency', { length: 3 }).notNull().default('USD'),
  preferredTheme: text('preferred_theme').notNull().default('system'),
  countryCode: char('country_code', { length: 2 }),
  city: text('city'),
  marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
  isAdmin: boolean('is_admin').notNull().default(false),
  adminRole: text('admin_role'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

// ----------------------------------------------------------------
// organizations
// ----------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  type: text('type').notNull(), // 'agent' | 'agency' | 'expert'
  logoUrl: text('logo_url'),
  website: text('website'),
  descriptionEn: text('description_en'),
  descriptionEs: text('description_es'),
  headquartersCountry: char('headquarters_country', { length: 2 }),
  headquartersCity: text('headquarters_city'),
  seatsTotal: integer('seats_total').notNull().default(1),
  listingCap: integer('listing_cap'), // null = unlimited (Expert)
  rankBoost: numeric('rank_boost', { precision: 3, scale: 2 }).notNull().default('0.00'),
  // Entitlement denormalization — maintained by trigger from subscriptions.
  // Read these for authz instead of joining through subscriptions on every check.
  // See `0007_denormalizations_and_latlng.sql`.
  currentSubscriptionId: uuid('current_subscription_id'),
  currentPlanId: text('current_plan_id'),
  currentStatus: text('current_status'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

// ----------------------------------------------------------------
// organization_members
// ----------------------------------------------------------------

export const organizationMembers = pgTable(
  'organization_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'owner' | 'manager' | 'agent' | 'analyst' | 'viewer'
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
    idxUser: index('idx_org_members_user').on(t.userId),
  }),
);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;

// ----------------------------------------------------------------
// Tier / role union types — keep in sync with the SQL CHECK constraints
// in 0002_identity.sql and the docs/HANDOFF.md §6.1 capability matrix.
// ----------------------------------------------------------------

export const ORG_TYPES = ['agent', 'agency', 'expert'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ORG_ROLES = ['owner', 'manager', 'agent', 'analyst', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ADMIN_ROLES = [
  'super_admin',
  'billing_admin',
  'user_support',
  'content_admin',
  'analytics_viewer',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const BUYER_TIERS = ['free', 'registered'] as const;
// 'premium' is added in v1.1 when the Premium buyer tier ships.
export type BuyerTier = (typeof BUYER_TIERS)[number];

// ----------------------------------------------------------------
// Billing — plans, subscriptions, payments, stripe_events_processed,
// founder_rate_grants. See `0003_billing.sql`.
// ----------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  tier: text('tier').notNull(), // 'premium' | 'agent' | 'agency' | 'expert'
  billingPeriod: text('billing_period').notNull(), // 'monthly' | 'annual'
  stripeProductId: text('stripe_product_id').notNull(),
  stripePriceId: text('stripe_price_id').notNull().unique(),
  displayNameEn: text('display_name_en').notNull(),
  displayNameEs: text('display_name_es').notNull(),
  descriptionEn: text('description_en'),
  descriptionEs: text('description_es'),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  trialDays: integer('trial_days').notNull().default(0),
  listingCap: integer('listing_cap'),
  seatsIncluded: integer('seats_included').notNull().default(1),
  features: jsonb('features').notNull().default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  isVisible: boolean('is_visible').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').references(() => profiles.id),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  status: text('status').notNull(),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  trialEnd: timestamp('trial_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
    onDelete: 'set null',
  }),
  stripePaymentIntentId: text('stripe_payment_intent_id').unique(),
  stripeInvoiceId: text('stripe_invoice_id'),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  status: text('status').notNull(),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export const stripeEventsProcessed = pgTable('stripe_events_processed', {
  stripeEventId: text('stripe_event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  payloadSummary: jsonb('payload_summary'),
});

export const founderRateGrants = pgTable('founder_rate_grants', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .unique()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  originalPriceId: text('original_price_id').notNull(),
});

export type FounderRateGrant = typeof founderRateGrants.$inferSelect;

// Subscription-status union — keep in sync with the SQL CHECK constraint
// in 0008_subscription_status_fix.sql. Includes Stripe's full status set
// plus our derived ones (suspended, expired). NB Stripe spelling: `canceled`.
export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
  'suspended',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Statuses that represent "the org has access right now" — used by authz.
 * Note: `canceled` is in here because it stays in-period until current_period_end.
 */
export const ACTIVE_STATUSES: ReadonlyArray<SubscriptionStatus> = [
  'active',
  'trialing',
  'past_due',
  'canceled',
] as const;

export const PAYMENT_STATUSES = [
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
  'pending',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const BILLING_PERIODS = ['monthly', 'annual'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

// ----------------------------------------------------------------
// Properties + property_images. See `0004_properties.sql`.
// ----------------------------------------------------------------

// PostGIS geography(Point, 4326) — Drizzle has no native support; use customType.
// Values are written as `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`
// SQL fragments via Drizzle's `sql` helper at insert/update time. Reads come
// back as the raw EWKB hex string; the SSR layer parses them via PostGIS
// helpers (e.g., `ST_X` / `ST_Y` columns added to the SELECT).
const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(Point, 4326)';
  },
});

// citext array — for `amenities text[]` we use Drizzle's array helper, but
// PostgreSQL itself uses `text[]` not `citext[]`. Just use plain text array.

export const properties = pgTable('properties', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  shortId: text('short_id')
    .notNull()
    .unique()
    .default(sql`public.gen_short_id()`),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => profiles.id),

  // Listing intent
  transactionType: text('transaction_type').notNull(), // 'sale' | 'rent' | 'short_term'
  propertyType: text('property_type').notNull(),
  status: text('status').notNull().default('draft'), // see PROPERTY_STATUSES

  // Localized content
  titleEn: text('title_en'),
  titleEs: text('title_es'),
  descriptionEn: text('description_en'),
  descriptionEs: text('description_es'),
  slugEn: text('slug_en'),
  slugEs: text('slug_es'),

  // Numbers
  priceCents: bigint('price_cents', { mode: 'bigint' }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  pricePeriod: text('price_period'), // 'total' | 'monthly' | 'weekly' | 'nightly'
  bedrooms: integer('bedrooms'),
  bathrooms: numeric('bathrooms', { precision: 3, scale: 1 }),
  areaSqm: numeric('area_sqm', { precision: 10, scale: 2 }),
  lotSizeSqm: numeric('lot_size_sqm', { precision: 12, scale: 2 }),
  yearBuilt: integer('year_built'),

  // Address
  addressLine: text('address_line'),
  neighborhood: text('neighborhood'),
  city: text('city').notNull(),
  stateRegion: text('state_region'),
  countryCode: char('country_code', { length: 2 }).notNull(),
  postalCode: text('postal_code'),
  displayAddress: boolean('display_address').notNull().default(true),

  // Geo
  location: geographyPoint('location').notNull(),

  // Features
  amenities: text('amenities')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  features: jsonb('features').notNull().default(sql`'{}'::jsonb`),

  // Featured / promotion
  featuredUntil: timestamp('featured_until', { withTimezone: true }),

  // SEO
  seoTitleEn: text('seo_title_en'),
  seoTitleEs: text('seo_title_es'),
  seoDescriptionEn: text('seo_description_en'),
  seoDescriptionEs: text('seo_description_es'),

  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  // Denormalized — maintained by triggers; do not write directly.
  imageCount: integer('image_count').notNull().default(0),
  latitude: numeric('latitude'),
  longitude: numeric('longitude'),
});

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;

export const propertyImages = pgTable(
  'property_images',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    r2Key: text('r2_key').notNull(),
    cfImageId: text('cf_image_id'),
    altTextEn: text('alt_text_en'),
    altTextEs: text('alt_text_es'),
    width: integer('width'),
    height: integer('height'),
    position: integer('position').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),
    uploadStatus: text('upload_status').notNull().default('pending'), // 'pending' | 'confirmed'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxProperty: index('idx_images_property').on(t.propertyId, t.position),
  }),
);

export const PROPERTY_IMAGE_UPLOAD_STATUSES = ['pending', 'confirmed'] as const;
export type PropertyImageUploadStatus = (typeof PROPERTY_IMAGE_UPLOAD_STATUSES)[number];

export type PropertyImage = typeof propertyImages.$inferSelect;
export type NewPropertyImage = typeof propertyImages.$inferInsert;

// Status / type unions — keep in sync with the SQL CHECK constraints in 0004.

export const PROPERTY_STATUSES = [
  'draft',
  'active',
  'pending',
  'sold',
  'rented',
  'archived',
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const TRANSACTION_TYPES = ['sale', 'rent', 'short_term'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PRICE_PERIODS = ['total', 'monthly', 'weekly', 'nightly'] as const;
export type PricePeriod = (typeof PRICE_PERIODS)[number];

// ----------------------------------------------------------------
// Leads. See `0009_leads.sql`.
// ----------------------------------------------------------------

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  assignedTo: uuid('assigned_to').references(() => profiles.id),
  source: text('source').notNull(), // 'form' | 'phone_click' | 'whatsapp_click' | 'email_click'
  contactName: text('contact_name'),
  contactEmail: citext('contact_email'),
  contactPhone: text('contact_phone'),
  message: text('message'),
  language: text('language').default('en'),
  userId: uuid('user_id').references(() => profiles.id),
  status: text('status').notNull().default('new'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

export const LEAD_SOURCES = [
  'form',
  'phone_click',
  'whatsapp_click',
  'email_click',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

// Saved searches. See `0010_saved_searches.sql`. Buyer-side: any signed-in
// user can save a filter set + opt into email alerts when matching listings
// are published. Email-alert worker is OUT of scope until Resend wiring
// lands; the data layer + dashboard view ship first.
export const savedSearches = pgTable('saved_searches', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  name: text('name'),
  filters: jsonb('filters').notNull(),
  locale: text('locale').notNull().default('en'),
  notifyEmail: boolean('notify_email').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SavedSearch = typeof savedSearches.$inferSelect;
export type NewSavedSearch = typeof savedSearches.$inferInsert;
