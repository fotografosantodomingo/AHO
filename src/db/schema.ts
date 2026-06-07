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
  date,
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
  // Extended agent-profile fields (migration 0012). All optional with
  // sensible defaults so existing rows aren't disturbed.
  bio: text('bio'),
  whatsappPhone: text('whatsapp_phone'),
  websiteUrl: text('website_url'),
  facebookUrl: text('facebook_url'),
  instagramUrl: text('instagram_url'),
  linkedinUrl: text('linkedin_url'),
  specialties: text('specialties').array().notNull().default(sql`'{}'::text[]`),
  languagesSpoken: text('languages_spoken').array().notNull().default(sql`'{}'::text[]`),
  // Stats cache (migration 0013). Recomputed by trigger when any
  // sold-state changes; safe to read directly without re-running the
  // aggregate. AVG ignores nulls — confidential closings excluded.
  statsTotalSales: integer('stats_total_sales').notNull().default(0),
  statsSales12mo: integer('stats_sales_12mo').notNull().default(0),
  statsPriceMinCents: bigint('stats_price_min_cents', { mode: 'number' }),
  statsPriceMaxCents: bigint('stats_price_max_cents', { mode: 'number' }),
  statsAvgPriceCents: bigint('stats_avg_price_cents', { mode: 'number' }),
  statsRecomputedAt: timestamp('stats_recomputed_at', { withTimezone: true }),
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
  // SEO-friendly `<name>-<city>-<country>` slug, derived from the
  // owner's profile fields after they complete the form. Recomputed
  // on every profile save by `PUT /api/me/profile`. NULL until the
  // profile has full_name + city + country_code; the public route
  // falls back to `slug` for those orgs. See migration 0034.
  publicSlug: text('public_slug'),
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

  // Geo — nullable as of migration 0011 (listings without exact lat/lng
  // are legitimate; they just don't show on the map).
  location: geographyPoint('location'),

  // Sold-side fields (migration 0013). Required only when status flips
  // to 'sold' or 'rented' — the require_sold_date_on_close trigger
  // backfills sold_date if omitted; price stays optional (confidential
  // closings).
  soldDate: timestamp('sold_date', { withTimezone: true }),
  soldPriceCents: bigint('sold_price_cents', { mode: 'number' }),
  representedSide: text('represented_side'), // 'buyer' | 'seller' | 'both'
  closingNotes: text('closing_notes'),

  // v1.1 multi-agent forward-compat (migration 0013). When NULL, the
  // listing's primary agent for stats purposes is `created_by`. v1.1
  // multi-agent orgs set this explicitly. DO NOT remove without
  // updating the recompute_agent_stats trigger.
  primaryAgentId: uuid('primary_agent_id').references(() => profiles.id),

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

  // Review-request log (migration 0041). Stamped by the daily cron at
  // /api/cron/review-requests when the post-sale review-request email
  // is dispatched. NULL = eligible for the cron; non-NULL = already
  // requested (idempotent skip). The recipient email is captured at
  // send-time from the matching lead row for audit.
  reviewRequestSentAt: timestamp('review_request_sent_at', { withTimezone: true }),
  reviewRequestRecipientEmail: citext('review_request_recipient_email'),
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

// ----------------------------------------------------------------
// photo_import_failures (migration 0037) — dead-letter rows for the
// server-side photo-import flow. Mirror of the SQL table; see the
// migration file for the full rationale + RLS recap. One row per
// (property_id, source_url); attempts bumps on each retry.
// ----------------------------------------------------------------

export const photoImportFailures = pgTable(
  'photo_import_failures',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    sourceUrl: text('source_url').notNull(),
    errorCode: text('error_code').notNull(),
    attempts: integer('attempts').notNull().default(1),
    firstFailedAt: timestamp('first_failed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxUnresolved: index('idx_photo_import_failures_unresolved').on(t.propertyId),
  }),
);

export type PhotoImportFailure = typeof photoImportFailures.$inferSelect;
export type NewPhotoImportFailure = typeof photoImportFailures.$inferInsert;

// Status / type unions — keep in sync with the SQL CHECK constraints in 0004.

// Status enum — keep in sync with the CHECK constraint in
// 0004_properties.sql (extended in 0013_sold_stats_status.sql with
// 'coming_soon').
export const PROPERTY_STATUSES = [
  'draft',
  'active',
  'pending',
  'sold',
  'rented',
  'archived',
  'coming_soon',
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
// are published. Email-alert worker is OUT of scope until the Brevo
// transactional sender is wired into a scheduled cron; the data layer +
// dashboard view ship first.
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

// ----------------------------------------------------------------
// property_favorites (migration 0024) — buyer-side saved properties.
// One row per (user, property). RLS: user reads/writes own only;
// admin can read/delete any. No UPDATE policies.
// ----------------------------------------------------------------

export const propertyFavorites = pgTable('property_favorites', {
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PropertyFavorite = typeof propertyFavorites.$inferSelect;
export type NewPropertyFavorite = typeof propertyFavorites.$inferInsert;

// ----------------------------------------------------------------
// property_recent_views (migration 0025) — track which properties a
// visitor (anon or authed) has looked at. Server-mediated writes only
// (no INSERT/UPDATE policies); user-context SELECT for own rows + admin.
// ----------------------------------------------------------------

export const propertyRecentViews = pgTable('property_recent_views', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'cascade' }),
  anonymousId: uuid('anonymous_id'),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  viewedAt: timestamp('viewed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  locale: text('locale').notNull(),
  sourcePath: text('source_path'),
});

export type PropertyRecentView = typeof propertyRecentViews.$inferSelect;
export type NewPropertyRecentView = typeof propertyRecentViews.$inferInsert;

// ----------------------------------------------------------------
// property_events (migration 0027) — append-only engagement event
// log. Powers agent dashboard analytics + promoted-listings ROI.
// Server-mediated writes only (no INSERT policy); SELECT gated to
// own-org members + admins.
// ----------------------------------------------------------------

export const PROPERTY_EVENT_TYPES = [
  'property_view',
  'image_gallery_open',
  'whatsapp_click',
  'phone_click',
  'email_click',
  'lead_form_submit',
  'favorite_add',
  'favorite_remove',
  'share_click',
] as const;
export type PropertyEventType = (typeof PROPERTY_EVENT_TYPES)[number];

export const propertyEvents = pgTable('property_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
  anonymousId: uuid('anonymous_id'),
  eventType: text('event_type').notNull(),
  source: text('source'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PropertyEvent = typeof propertyEvents.$inferSelect;
export type NewPropertyEvent = typeof propertyEvents.$inferInsert;

// ----------------------------------------------------------------
// audit_log (migration 0013) — append-only ledger of significant
// state-changing actions. Admin reads everything; users read their
// own rows (by actor_id). No UPDATE/DELETE policies — append-only.
// Inserts are gated by RLS to actor_id = auth.uid(); service-role
// bypasses as always.
// ----------------------------------------------------------------

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  // e.g. 'listing.marked_sold', 'listing.archived', 'admin.user.promoted'
  kind: text('kind').notNull(),
  actorId: uuid('actor_id').references(() => profiles.id),
  // Loose-typed FK — we record what was acted on, not which table it lived in
  targetId: uuid('target_id'),
  // Free-form snapshot of action specifics (prior status, sold price, etc.)
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;

// ----------------------------------------------------------------
// Reviews + review_reports (migration 0016).
// Agent-targeted reviews with email-token verification and admin
// moderation. See 0016_reviews.sql for the workflow + RLS details.
// ----------------------------------------------------------------

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    reviewerUserId: uuid('reviewer_user_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    reviewerEmail: citext('reviewer_email'),
    reviewerName: text('reviewer_name'),
    propertyId: uuid('property_id').references(() => properties.id, {
      onDelete: 'set null',
    }),
    rating: integer('rating').notNull(),
    body: text('body').notNull(),
    locale: text('locale').notNull().default('en'),
    status: text('status').notNull().default('pending_verification'),
    verificationToken: text('verification_token'),
    verificationTokenExpiresAt: timestamp('verification_token_expires_at', {
      withTimezone: true,
    }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    agentReply: text('agent_reply'),
    agentRepliedAt: timestamp('agent_replied_at', { withTimezone: true }),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    moderatedBy: uuid('moderated_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    moderationNotes: text('moderation_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxAgentPublished: index('idx_reviews_agent_published').on(t.agentId, t.createdAt),
  }),
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;

export const REVIEW_STATUSES = [
  'pending_verification',
  'pending_moderation',
  'published',
  'rejected',
  'hidden',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_LOCALES = ['en', 'es'] as const;
export type ReviewLocale = (typeof REVIEW_LOCALES)[number];

export const reviewReports = pgTable(
  'review_reports',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    reporterUserId: uuid('reporter_user_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    reporterEmail: citext('reporter_email'),
    reason: text('reason').notNull(),
    notes: text('notes'),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    idxReview: index('idx_review_reports_review').on(t.reviewId),
  }),
);

export type ReviewReport = typeof reviewReports.$inferSelect;
export type NewReviewReport = typeof reviewReports.$inferInsert;

export const REVIEW_REPORT_REASONS = [
  'spam',
  'fake',
  'defamatory',
  'inappropriate',
  'duplicate',
  'other',
] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

export const REVIEW_REPORT_STATUSES = ['open', 'reviewed', 'dismissed'] as const;
export type ReviewReportStatus = (typeof REVIEW_REPORT_STATUSES)[number];

// ----------------------------------------------------------------
// currency_rate_snapshot (migration 0017) — single-base snapshot of
// FX rates for the worldwide price-tile converter. base_currency is
// the PK; rates jsonb maps quote → rate-relative-to-base. v1 stores
// only the USD base (OXR free-tier limitation).
// ----------------------------------------------------------------

export const currencyRateSnapshot = pgTable('currency_rate_snapshot', {
  baseCurrency: char('base_currency', { length: 3 }).primaryKey(),
  rates: jsonb('rates').notNull(),
  source: text('source').notNull().default('openexchangerates'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CurrencyRateSnapshot = typeof currencyRateSnapshot.$inferSelect;

// ----------------------------------------------------------------
// agent_faqs (migration 0032). Per-org FAQ entries surfaced on the
// public agent profile page; emits FAQPage JSON-LD for rich-snippet
// eligibility. Bilingual; both languages independently optional.
// ----------------------------------------------------------------

export const agentFaqs = pgTable(
  'agent_faqs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    questionEn: text('question_en'),
    questionEs: text('question_es'),
    answerEn: text('answer_en'),
    answerEs: text('answer_es'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxOrgSort: index('idx_agent_faqs_org_sort').on(t.orgId, t.sortOrder),
  }),
);

export type AgentFaq = typeof agentFaqs.$inferSelect;
export type NewAgentFaq = typeof agentFaqs.$inferInsert;

// ----------------------------------------------------------------
// listing_post_metrics (migration 0037) — Sprint 3 performance
// dashboard. Per-listing × per-platform × per-post snapshots of
// reach / impressions / clicks / leads / CPL. Populated by service-
// role writers (Meta Insights cron, FB Lead Ads webhook, future
// LinkedIn cron); read by the agent dashboard via RLS. No user-
// context INSERT/UPDATE/DELETE policies — append-only from the
// agent's POV.
// ----------------------------------------------------------------

export const LISTING_POST_PLATFORMS = [
  'facebook',
  'instagram',
  'linkedin',
  'tiktok',
  'pinterest',
] as const;
export type ListingPostPlatform = (typeof LISTING_POST_PLATFORMS)[number];

export const listingPostMetrics = pgTable(
  'listing_post_metrics',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    postExternalId: text('post_external_id').notNull(),
    reach: integer('reach').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    leads: integer('leads').notNull().default(0),
    /** Cost per lead in integer cents. NULL = organic / no spend. */
    cplCents: bigint('cpl_cents', { mode: 'number' }),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxListingPlatformPosted: index(
      'idx_listing_post_metrics_listing_platform_posted',
    ).on(t.listingId, t.platform, t.postedAt),
    idxListingCaptured: index('idx_listing_post_metrics_listing_captured').on(
      t.listingId,
      t.capturedAt,
    ),
  }),
);

export type ListingPostMetric = typeof listingPostMetrics.$inferSelect;
export type NewListingPostMetric = typeof listingPostMetrics.$inferInsert;

// ----------------------------------------------------------------
// lead_routing_rules + lead_routing_state (migration 0040).
// Per-org declarative rules for inbound-lead routing. Evaluated at
// /api/leads creation time by `src/lib/leads/routing.ts` (pure fn).
// The cursor in `lead_routing_state` powers round-robin without
// requiring an aggregate scan over `leads` per insert. See migration
// header for the "why cursor over count-based" rationale.
// ----------------------------------------------------------------

export const LEAD_ROUTING_ACTION_TYPES = ['assign', 'round_robin'] as const;
export type LeadRoutingActionType = (typeof LEAD_ROUTING_ACTION_TYPES)[number];

/**
 * Routing-rule conditions. All fields optional and AND together; only
 * present fields are evaluated. Empty `{}` matches every lead — useful
 * as an org-wide default with low priority.
 */
export interface LeadRoutingConditions {
  city?: string;
  country_code?: string;
  language?: string;
  property_type?: string;
}

/**
 * Routing-rule action. Discriminated by `type`. v1 ships two variants:
 *   - `assign` → static assignment to one user
 *   - `round_robin` → cycle across N users via the org's cursor
 */
export type LeadRoutingAction =
  | { type: 'assign'; assign_to_user_id: string }
  | { type: 'round_robin'; round_robin_user_ids: string[] };

export const leadRoutingRules = pgTable(
  'lead_routing_rules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    priority: integer('priority').notNull().default(0),
    name: text('name').notNull(),
    conditions: jsonb('conditions').notNull().default(sql`'{}'::jsonb`),
    action: jsonb('action').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxOrgPriorityActive: index(
      'idx_lead_routing_rules_org_priority_active',
    ).on(t.orgId, t.priority, t.createdAt),
  }),
);

export type LeadRoutingRule = typeof leadRoutingRules.$inferSelect;
export type NewLeadRoutingRule = typeof leadRoutingRules.$inferInsert;

export const leadRoutingState = pgTable('lead_routing_state', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  lastRoundRobinIndex: integer('last_round_robin_index').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LeadRoutingStateRow = typeof leadRoutingState.$inferSelect;
export type NewLeadRoutingStateRow = typeof leadRoutingState.$inferInsert;

// ----------------------------------------------------------------
// SEO knowledge graph. See `0082_seo_knowledge_graph.sql` +
// docs/SEO_COLD_START_PLAN.md. Real-data cold-start engine: geo entities
// (country → city → neighborhood) drive interlinked, indexable pages.
// `geographyPoint` is reused from the properties block above; polygons get
// their own customType for neighborhood boundaries.
// ----------------------------------------------------------------

const geographyPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(Polygon, 4326)';
  },
});

// Provenance + license registry. Every market_metrics row references one;
// pages render its attribution_text (data-integrity hard rule, plan §6).
export const dataSources = pgTable('data_sources', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  url: text('url'),
  license: text('license').notNull(),
  attributionText: text('attribution_text').notNull(),
  accessedAt: timestamp('accessed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DataSource = typeof dataSources.$inferSelect;
export type NewDataSource = typeof dataSources.$inferInsert;

// Countries — PK is uppercase ISO-3166-1 alpha-2. `names` is locale→name jsonb.
export const geoCountries = pgTable(
  'geo_countries',
  {
    iso2: char('iso2', { length: 2 }).primaryKey(),
    iso3: char('iso3', { length: 3 }),
    names: jsonb('names').notNull().default(sql`'{}'::jsonb`),
    region: text('region'),
    subregion: text('subregion'),
    currencyCode: char('currency_code', { length: 3 }),
    capital: text('capital'),
    centroid: geographyPoint('centroid'),
    population: bigint('population', { mode: 'number' }),
    flagEmoji: text('flag_emoji'),
    sourceId: uuid('source_id').references(() => dataSources.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxRegion: index('idx_geo_countries_region').on(t.region),
  }),
);

export type GeoCountry = typeof geoCountries.$inferSelect;
export type NewGeoCountry = typeof geoCountries.$inferInsert;

// Cities — unique(country_iso2, slug) maps 1:1 to /properties-in/{country}/{city}.
export const geoCities = pgTable(
  'geo_cities',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    countryIso2: char('country_iso2', { length: 2 })
      .notNull()
      .references(() => geoCountries.iso2, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    names: jsonb('names').notNull().default(sql`'{}'::jsonb`),
    adminRegion: text('admin_region'),
    centroid: geographyPoint('centroid'),
    population: bigint('population', { mode: 'number' }),
    geonamesId: bigint('geonames_id', { mode: 'number' }).unique(),
    sourceId: uuid('source_id').references(() => dataSources.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxCountry: index('idx_geo_cities_country').on(t.countryIso2),
    idxPopulation: index('idx_geo_cities_population').on(t.population),
  }),
);

export type GeoCity = typeof geoCities.$inferSelect;
export type NewGeoCity = typeof geoCities.$inferInsert;

// Neighborhoods — within a city; optional PostGIS boundary polygon.
export const geoNeighborhoods = pgTable(
  'geo_neighborhoods',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cityId: uuid('city_id')
      .notNull()
      .references(() => geoCities.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    names: jsonb('names').notNull().default(sql`'{}'::jsonb`),
    centroid: geographyPoint('centroid'),
    boundary: geographyPolygon('boundary'),
    sourceId: uuid('source_id').references(() => dataSources.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxCity: index('idx_geo_neighborhoods_city').on(t.cityId),
  }),
);

export type GeoNeighborhood = typeof geoNeighborhoods.$inferSelect;
export type NewGeoNeighborhood = typeof geoNeighborhoods.$inferInsert;

// Provenanced numeric facts. `sourceId` is NOT NULL (data-integrity hard rule).
// `entityId` is iso2 for countries, uuid-as-text for cities/neighborhoods.
export const marketMetrics = pgTable(
  'market_metrics',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    metric: text('metric').notNull(),
    value: numeric('value').notNull(),
    unit: text('unit'),
    asOfDate: date('as_of_date').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => dataSources.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxEntity: index('idx_market_metrics_entity').on(t.entityType, t.entityId),
    idxMetric: index('idx_market_metrics_metric').on(t.metric, t.asOfDate),
  }),
);

export type MarketMetric = typeof marketMetrics.$inferSelect;
export type NewMarketMetric = typeof marketMetrics.$inferInsert;

// Generated/edited SEO prose pages. Only status='published' is publicly
// readable (indexable). unique(locale, slug).
export const contentGuides = pgTable(
  'content_guides',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    scope: text('scope').notNull(),
    entityId: text('entity_id'),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    bodyHtml: text('body_html'),
    status: text('status').notNull().default('draft'),
    sourceIds: uuid('source_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxScope: index('idx_content_guides_scope').on(t.scope, t.entityId),
  }),
);

export type ContentGuide = typeof contentGuides.$inferSelect;
export type NewContentGuide = typeof contentGuides.$inferInsert;

