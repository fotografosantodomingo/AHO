# Real Estate Platform — Developer Handoff Plan

**Version:** 1.0
**Date:** April 29, 2026
**Stack:** Next.js (App Router) on Cloudflare Pages + Supabase + Stripe
**Status:** Spec for v1 build

> **Note:** This is part 1 of the handoff document. Part 2 (sections 12 onward) lives in `HANDOFF_part2.md` until merged. Do not treat this file as complete until part 2 is integrated.

---

## Implementation status (live as of 2026-04-30)

This spec was written before any code shipped. Implementation is now ahead of the spec in places; see `docs/PROGRESS.md` for the per-session log and `docs/DECISIONS.md` for architectural deviations.

**Live at:** https://advertisehomes.online (Cloudflare Pages, auto-deploy on push to `main`)

| Slice | Spec ref | Status |
|---|---|---|
| Slice 1 (Free + Registered + Agent — `CRITIQUE.md` §F) | §1.7, §4–§11 | **~94%**. Code feature-complete; bounded by Resend / R2 / soft-beta agents. |
| Slice 2 (lead inbox UI, agent profiles, admin dashboard, search/filter/map, saved searches) | §F | **5/5 surfaces shipped**. Email-alert worker for saved searches waits on Resend. |
| Slice 3 polish (city landing pages, OG cards, JSON-LD, bbox map, marker clusters, design tokens) | §16 | substantial polish landed; on-going |
| v1.1 (Premium, Agency, LinkedIn) | §1.7 | not started — gated on slice-1 paying users |
| v2 (Expert, AI, mobile app) | §1.7 | not started |

**Major architectural deviations from this spec** (each logged in `DECISIONS.md`):

- Cloudflare adapter: `@cloudflare/next-on-pages` (despite npm-deprecation; chose for spec adherence to "Cloudflare Pages")
- Visual design: HashiCorp tokens (DESIGN_REFERENCE.md), Inter substituted for HashiCorp Sans
- Migration tooling: hand-written SQL + Drizzle TS schema as types-only mirror
- Stripe currently in test mode (live products archived 2026-04-29 after a process gap — promotion requires explicit DECISIONS.md entry per CLAUDE.md hard rule #9)
- Founder-rate pricing: application-gated atomic counter (not Stripe-gated)
- 38 Edge Function Routes deployed; 141/141 tests passing; Stripe webhook replay 7/7 against live URL
- Custom domain advertisehomes.online live; sitemap covers homepage / pricing / properties / city landings / agent profiles

**Read `CLAUDE.md` first for the running state**, then come back here for the canonical spec.

---

## 0. How to Read This Document

This is the source of truth for the v1 build. It is opinionated on purpose — every decision here was made to remove ambiguity for the dev. If you (the developer) disagree with something, raise it in writing before you change it; some choices have non-obvious downstream consequences.

Sections marked **[SCOPE FLAG]** are areas where the product owner has chosen a more ambitious scope than I would recommend for v1. They are buildable, but each multiplies time and risk. They are documented so the dev knows what they are signing up for.

Sections marked **[OPEN]** require a decision before that module is built.

---

## 1. Executive Summary

### 1.1 What we are building

A subscription-based real estate platform — Zillow-style for buyers/browsers, with paid tiers for agents, agencies, and enterprises. The platform's defining premium feature is a **one-click social distribution system** that publishes a new listing to multiple social networks (Facebook Page, Instagram, LinkedIn, X, TikTok) with platform-appropriate formatting, included in the Agent tier and above.

### 1.2 Target audience

- **Free browsers** — anyone shopping for property
- **Registered users** — buyers/renters who want favorites and alerts
- **Premium subscribers** — buyers/investors who need full analytics and direct contact info
- **Individual agents** — listing 1–5 properties at a time, want marketing automation
- **Agencies** — small teams with up to 25 active listings and shared lead routing
- **Expert/enterprise** — unlimited listings, AI tooling, API integrations

### 1.3 Geography & languages

- **Market: Worldwide** **[SCOPE FLAG]** — see §1.5.
- **Languages: English and Spanish at launch.** Architecture must support adding more later without refactoring routes.
- **Currency: multi-currency display** required from day one because of the worldwide scope. Default per IP geolocation, user can override and persist the choice.

### 1.4 Stack at a glance

| Layer | Tech | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router, RSC) on Cloudflare Pages | SEO-first, edge-rendered, large ecosystem |
| Auth | Supabase Auth (email/password, Google OAuth, magic link, MFA via TOTP) | Tightly integrated with Postgres RLS |
| Database | Supabase Postgres + PostGIS | Geospatial search is core; RLS for tier enforcement |
| File storage | Cloudflare R2 (originals) + Cloudflare Images (variants) | Cheap egress, built-in resizing |
| Edge logic | Cloudflare Workers | Webhooks, social fan-out, scheduled jobs |
| Async jobs | Cloudflare Queues | Social posting fan-out, retries, image processing |
| Payments | Stripe (Checkout, Billing, Customer Portal) | Industry standard; subscriptions + tax + invoicing |
| Email | Resend (transactional) + Supabase Auth emails | Simple API, good deliverability |
| Search | Postgres + PostGIS + trigram for v1; OpenSearch for v2 if needed | Avoid premature complexity |
| Analytics | PostHog (product) + Cloudflare Web Analytics (privacy-friendly traffic) | Free tiers cover early scale |
| Monitoring | Sentry (errors) + Better Stack or Cloudflare Logs (uptime/logs) | |

### 1.5 Scope honesty — read this before estimating

The product owner has chosen the most ambitious scope on three axes simultaneously:

1. **All six tiers at launch** — multiplies UX surface, billing edge cases, and admin complexity. The buyer "Premium" tier in particular is unproven and may not justify its build cost in v1. **Recommendation kept on file:** ship Free + Registered + Agent + Agency in week 1; add Premium and Expert in a fast-follow release after talking to real users. The plan below builds all six because that is the directive, but the dev should sequence Premium and Expert *last* within v1 to allow a graceful descope if the timeline slips.
2. **Worldwide market, manual listings.** Without an MLS/IDX feed, the chicken-and-egg problem (no listings = no buyers; no buyers = no agents pay) is real in every market. Plan for a *seeded launch* in a single anchor market first (suggest Dominican Republic + LATAM Spanish + US English) and let SEO + agent acquisition pull the rest. Do not block the build on global launch readiness.
3. **All five social platforms.** TikTok and X have the most restrictive and/or expensive APIs. See §10 for what each one actually costs and how long approval takes.

Realistic v1 build estimate with one strong full-stack dev: **14–18 weeks** to a private beta, **20–24 weeks** to public launch with all six tiers and all five social integrations live. Cut social integrations to FB/IG/LinkedIn and the timeline drops by ~3 weeks. Cut to four tiers and it drops by another ~2 weeks.

### 1.6 Success criteria for v1

- 99.9% uptime on auth and payment flows
- Property detail page LCP ≤ 2.5s on 4G mobile (Core Web Vitals "good")
- Stripe webhook → entitlement change applied in ≤ 5 seconds, p95
- Social post fan-out: ≥ 95% success rate per connected account, with visible failure reasons for the rest
- Agent can create a listing and publish to all connected socials in ≤ 60 seconds of total user time
- Zero RLS bypass incidents in penetration testing before launch

---

## 1.7 v1 SCOPE — LOCKED 2026-04-29

> **Read this before reading the rest of the spec.** Some sections below describe features that are not in v1. They are kept in the document because the data model, RLS, and architecture must support them — but they are **not built or shipped** in v1. See `docs/DECISIONS.md` (entry "v1 scope locked") for the rationale.

### What ships in v1

| Capability | Free | Registered | Agent (paid) |
|---|---|---|---|
| Browse listings + photos + map + price/beds/baths/sqm | ✅ | ✅ | ✅ |
| See agent name | ✅ | ✅ | ✅ |
| Save favorites + saved-search alerts | ❌ | ✅ | ✅ |
| Contact via form (relay) | redirect to register | ✅ | ✅ |
| WhatsApp `wa.me` link | ✅ | ✅ | ✅ |
| Phone/email reveal | ❌ | ❌ | (no Premium tier in v1) |
| Create listings (cap 5 active) | ❌ | ❌ | ✅ |
| One-click share to Facebook + Instagram | ❌ | ❌ | ✅ (gated on Meta app review) |
| Manual share fallback (pre-rendered post → opens platform composer) | ❌ | ❌ | ✅ (until app review approves) |
| Agent profile + listings page | ❌ | ❌ | ✅ |
| Performance analytics (basic: views, saves, contacts) | ❌ | ❌ | ✅ |
| Stripe checkout + customer portal | ❌ | ❌ | ✅ |

**Pricing (per `DECISIONS.md` "Pricing locked"):**
- Standard: **$29/month** or **$290/year** (~17% annual discount)
- Founder rate: **$19/month for life** for first 50 agents who sign up within 60 days of public launch
- Currency: USD only in v1; DOP / multi-currency display deferred to v1.1
- Trial: 7-day free trial on monthly

### What's deferred to v1.1

- **Premium buyer tier** — phone/email reveal, advanced filters, full property history, CSV/PDF export, virtual tours. (HANDOFF §6.1, §7, §8.5)
- **Agency tier** — org seats, lead routing, CRM-lite kanban, bulk CSV import, agency branding page. (HANDOFF §6.1, §19.2 in part 2)
- **LinkedIn auto-share** — review submitted in week 1 of slice 1; integration ships with v1.1 once approved. (HANDOFF_part2 §12.1, §12.3)
- **Multi-currency display** — DOP plus user-selectable currency with daily FX. v1 is USD-only. (HANDOFF §1.3)

### What's deferred to v2

- **Expert tier** — AI features, auto-blog, predictive analytics, Salesforce/HubSpot integration, API+webhooks, X auto-share, TikTok auto-share. (HANDOFF §6.1; HANDOFF_part2 §13, §14, §19.3)
- **Auto-blog generation** — high SEO risk, marginal upside. (HANDOFF_part2 §14)
- **AI description polish, AI follow-up sequences, AI pricing assistant** — all defer with Expert. (HANDOFF_part2 §13)
- **Mobile native app** — PWA for v1; native (Expo) is v2. (CRITIQUE §C — design APIs to not paint into a corner)
- **SAML SSO, advanced admin tooling, internationalization beyond EN/ES** — all v2.

### Non-negotiable from §1 still applies in v1

- Bilingual EN/ES at the URL/SEO/i18n layer (single-language listings allowed per `DECISIONS.md` "Drop the no-language-fallback rule"; UI strings are EN+ES from day 1).
- No fake data, no stock photography (per `DECISIONS.md` "Real-only data").
- RLS as the primary tier enforcement layer (per `CLAUDE.md` hard rule #2).
- Stripe webhook idempotency + signature verification (per `CLAUDE.md` hard rule #3).
- Anchor market: Santo Domingo, DR (per `DECISIONS.md` "Anchor launch market").

### Slice-1 timebox

10 weeks from start of week 1, per `docs/CRITIQUE.md` §F. Over-runs require explicit re-scoping (cut features from the slice, do not silently extend the timeline). PROGRESS.md updated every Friday end-of-day.

---

## 2. High-Level Architecture

```
                                   ┌─────────────────────────────────┐
                                   │         Browsers / Apps         │
                                   └─────────────┬───────────────────┘
                                                 │ HTTPS
                                   ┌─────────────▼───────────────────┐
                                   │    Cloudflare CDN + WAF + Bot   │
                                   └─────────────┬───────────────────┘
                                                 │
                                ┌────────────────┼────────────────────┐
                                │                │                    │
                    ┌───────────▼─────────┐  ┌───▼────────┐  ┌────────▼──────────┐
                    │ Next.js on          │  │ Workers    │  │ Cloudflare Images │
                    │ Cloudflare Pages    │  │ (API/edge) │  │ (variants/CDN)    │
                    │ (SSR + RSC + ISR)   │  │            │  │                   │
                    └───────────┬─────────┘  └───┬────────┘  └────────▲──────────┘
                                │                │                    │
                                │      ┌─────────┴─────────┐          │
                                │      │ Cloudflare Queues │          │
                                │      │ (social fan-out)  │          │
                                │      └─────────┬─────────┘          │
                                │                │                    │
                                │      ┌─────────▼──────────┐         │
                                │      │ Worker: SocialPost │         │
                                │      └─────────┬──────────┘         │
                                │                │                    │
                                │     ┌──────────┼──────────┐         │
                                │     │          │          │         │
                                │     ▼          ▼          ▼         │
                                │   Meta      LinkedIn      X        TikTok
                                │   Graph      API          API       API
                                │     ▲                                │
                                │     │                                │
              ┌─────────────────▼─────┴────────────┐         ┌─────────┴─────────┐
              │     Supabase                       │         │  Cloudflare R2     │
              │  - Postgres + PostGIS              │         │  (image originals) │
              │  - Auth (JWT)                      │         └────────────────────┘
              │  - RLS (tier enforcement)          │
              │  - Realtime (lead notifications)   │         ┌────────────────────┐
              └────────┬───────────────────────────┘         │  Stripe            │
                       │                                     │  (subs + invoices) │
                       │ Webhooks                            └─────────┬──────────┘
                       └──────────────────────────────────────────────►┘
                                          ▲
                                          │ Stripe webhooks
                                          └── Worker: StripeWebhook
```

**Key principles:**

1. **Database is the source of truth for entitlements.** The frontend never decides what a user can do — it asks the database (which checks subscription state via RLS). This prevents drift between billing and feature access.
2. **Stripe is the source of truth for billing.** All subscription state mutations originate from Stripe webhooks. The DB is a cache.
3. **Social posting is async by design.** A "Publish" click writes a job to a queue, returns immediately, and the dashboard shows progress. Synchronous social posting is brittle (rate limits, slow APIs) and ruins UX.
4. **One repo, one deploy.** Next.js handles the UI and most APIs; Workers handle webhooks and queues. Avoid splitting into microservices until you have a reason.

---

## 3. Tech Stack & Hosting Detail

### 3.1 Frontend

- **Framework:** Next.js 15+ App Router. Use Server Components for listing pages, Client Components only where interactivity is needed (filters, maps, dashboards).
- **Styling:** Tailwind CSS 4. Use the official `next-themes` package for dark/light toggle.
- **UI components:** shadcn/ui as the base; do not import a heavy component library.
- **Maps:** MapLibre GL JS with OpenStreetMap tiles for v1 (free). Switch to Mapbox or Google Maps if/when budget allows. Property markers, clustering, draw-to-search polygon.
- **Forms:** React Hook Form + Zod for validation. The same Zod schemas should be reused server-side.
- **i18n:** `next-intl` — see §11.
- **Icons:** lucide-react.

### 3.2 Backend

- **API routes:** Next.js Route Handlers for the bulk of the API (runs on Cloudflare Workers via Pages adapter).
- **Standalone Workers** (separate from Pages) for:
  - Stripe webhook ingestion
  - Social media posting queue consumer
  - Scheduled jobs (cron — sitemap regeneration, expired listing cleanup, dunning checks)
  - Image processing trigger
- **Supabase client:** Use `@supabase/ssr` for server components, `@supabase/supabase-js` for client. Never expose the service role key client-side.

### 3.3 Database

- **Postgres 15+ on Supabase**, with extensions: `postgis`, `pg_trgm` (fuzzy text search), `uuid-ossp`, `citext` (case-insensitive emails).
- **Connection pooling:** Use Supabase's Supavisor in transaction mode for serverless.
- **Migrations:** Drizzle ORM or Prisma for schema migrations and TypeScript types. Recommend **Drizzle** — better edge runtime support, less magic. Migrations live in `/supabase/migrations` and are version-controlled.

### 3.4 File storage

- **Originals → Cloudflare R2.** Path scheme: `properties/{property_id}/{uuid}.{ext}`.
- **Variants → Cloudflare Images.** Predefined variants: `thumb` (320w), `card` (640w), `hero` (1280w), `full` (1920w), `og` (1200x630 cropped, for social previews).
- **Upload flow:** Client gets a signed upload URL from a Worker → uploads directly to R2 → Worker triggered by R2 event creates Cloudflare Images variants → DB row updated with image references.

### 3.5 Email

- **Resend** for transactional (welcome, password reset where Supabase isn't enough, social-post failure alerts, dunning notices).
- Templates stored as React Email components in `/emails`, sent server-side.
- Critical: configure SPF, DKIM, DMARC for the sending domain.

### 3.6 Observability

- **Sentry** in both Next.js and every Worker.
- **PostHog** for product analytics, feature flags, and session replay.
- **Cloudflare Web Analytics** for traffic (cookieless, GDPR-friendly).
- **Cloudflare Logpush** to R2 for compliance/audit retention.

---

## 4. Database Schema

This is the canonical schema. All names use `snake_case`. All tables have `created_at`, `updated_at` (`timestamptz`, default `now()`), unless noted.

### 4.1 Core tables

```sql
-- Extends Supabase auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext unique not null,
  full_name text,
  phone text,
  avatar_url text,
  preferred_language text not null default 'en' check (preferred_language in ('en','es')),
  preferred_currency char(3) not null default 'USD',
  preferred_theme text not null default 'system' check (preferred_theme in ('light','dark','system')),
  country_code char(2),
  city text,
  marketing_opt_in boolean not null default false,
  is_admin boolean not null default false,
  admin_role text check (admin_role in ('super_admin','billing_admin','user_support','content_admin','analytics_viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  type text not null check (type in ('agent','agency','expert')), -- individual agents also have an org for billing simplicity
  logo_url text,
  website text,
  description_en text,
  description_es text,
  headquarters_country char(2),
  headquarters_city text,
  seats_total int not null default 1,
  listing_cap int, -- null = unlimited
  rank_boost numeric(3,2) not null default 0.00, -- search ranking multiplier
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','manager','agent','analyst','viewer')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (org_id, user_id)
);

create index idx_org_members_user on public.organization_members(user_id);
```

### 4.2 Subscription & billing

```sql
create table public.plans (
  id text primary key, -- e.g. 'agent_monthly', 'agency_annual'
  tier text not null check (tier in ('premium','agent','agency','expert')),
  billing_period text not null check (billing_period in ('monthly','annual')),
  stripe_product_id text not null,
  stripe_price_id text not null unique,
  display_name_en text not null,
  display_name_es text not null,
  description_en text,
  description_es text,
  amount_cents int not null,
  currency char(3) not null default 'USD',
  trial_days int not null default 0,
  listing_cap int, -- null = unlimited; mirrors org but lets us validate at plan level
  seats_included int not null default 1,
  features jsonb not null default '{}'::jsonb, -- canonical feature flags
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid references public.profiles(id), -- for individual buyer Premium
  plan_id text not null references public.plans(id),
  stripe_customer_id text not null,
  stripe_subscription_id text unique not null,
  status text not null check (status in ('trialing','active','past_due','cancelled','expired','suspended','incomplete')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (org_id is not null or user_id is not null)
);

create index idx_subs_status on public.subscriptions(status);
create index idx_subs_stripe_cust on public.subscriptions(stripe_customer_id);
create index idx_subs_org on public.subscriptions(org_id);

create table public.payments (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid references public.subscriptions(id) on delete set null,
  stripe_payment_intent_id text unique,
  stripe_invoice_id text,
  amount_cents int not null,
  currency char(3) not null,
  status text not null, -- 'succeeded', 'failed', 'refunded'
  failure_reason text,
  created_at timestamptz not null default now()
);
```

### 4.3 Properties & listings

```sql
create table public.properties (
  id uuid primary key default uuid_generate_v4(),
  short_id text unique not null, -- 6-char base62 for URLs, e.g. 'a3f9k2'
  org_id uuid not null references public.organizations(id) on delete restrict,
  created_by uuid not null references public.profiles(id),

  -- Listing intent
  transaction_type text not null check (transaction_type in ('sale','rent','short_term')),
  property_type text not null, -- 'apartment','house','condo','land','commercial','villa', etc.
  status text not null default 'draft' check (status in ('draft','active','pending','sold','rented','archived')),

  -- Localized content
  title_en text,
  title_es text,
  description_en text,
  description_es text,
  -- Slugs derived from title + city + country
  slug_en text,
  slug_es text,

  -- Numbers
  price_cents bigint not null,
  currency char(3) not null,
  price_period text check (price_period in ('total','monthly','weekly','nightly')), -- for rent/short_term
  bedrooms int,
  bathrooms numeric(3,1),
  area_sqm numeric(10,2),
  lot_size_sqm numeric(12,2),
  year_built int,

  -- Address (split for SEO + privacy controls)
  address_line text,
  neighborhood text,
  city text not null,
  state_region text,
  country_code char(2) not null,
  postal_code text,
  display_address boolean not null default true,

  -- Geo (PostGIS)
  location geography(Point, 4326) not null,

  -- Features
  amenities text[] not null default '{}',
  features jsonb not null default '{}'::jsonb,

  -- Featured / promotion
  featured_until timestamptz,

  -- SEO computed fields cached for fast SSR
  seo_title_en text,
  seo_title_es text,
  seo_description_en text,
  seo_description_es text,

  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_properties_status on public.properties(status);
create index idx_properties_org on public.properties(org_id);
create index idx_properties_location on public.properties using gist(location);
create index idx_properties_country_city on public.properties(country_code, city);
create index idx_properties_price on public.properties(price_cents) where status = 'active';
create index idx_properties_featured on public.properties(featured_until) where featured_until > now();
create index idx_properties_search_en on public.properties using gin(to_tsvector('english', coalesce(title_en,'') || ' ' || coalesce(description_en,'')));
create index idx_properties_search_es on public.properties using gin(to_tsvector('spanish', coalesce(title_es,'') || ' ' || coalesce(description_es,'')));

create table public.property_images (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  r2_key text not null,
  cf_image_id text, -- Cloudflare Images ID
  alt_text_en text,
  alt_text_es text,
  width int,
  height int,
  position int not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_images_property on public.property_images(property_id, position);
```

### 4.4 User actions (favorites, saved searches, leads)

```sql
create table public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, property_id)
);

create table public.saved_searches (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  query jsonb not null, -- filter params
  alert_frequency text not null default 'daily' check (alert_frequency in ('off','instant','daily','weekly')),
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  assigned_to uuid references public.profiles(id),
  source text not null, -- 'form','phone_click','whatsapp','email_click'
  contact_name text,
  contact_email citext,
  contact_phone text,
  message text,
  language text default 'en',
  user_id uuid references public.profiles(id), -- if logged in
  status text not null default 'new' check (status in ('new','contacted','qualified','won','lost')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leads_org_status on public.leads(org_id, status);
create index idx_leads_assigned on public.leads(assigned_to);
```

### 4.5 Social media integration

```sql
create table public.social_accounts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connected_by uuid not null references public.profiles(id),
  platform text not null check (platform in ('facebook','instagram','linkedin','twitter','tiktok')),
  -- Provider-specific identifiers
  external_account_id text not null, -- Page ID, IG Business ID, etc.
  external_account_name text not null, -- display name shown in UI
  external_account_username text,
  -- Encrypted tokens — see §10 on encryption
  access_token_encrypted bytea not null,
  refresh_token_encrypted bytea,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  is_active boolean not null default true,
  last_validated_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, platform, external_account_id)
);

create table public.social_posts (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  triggered_by uuid not null references public.profiles(id),
  status text not null default 'queued' check (status in ('queued','processing','posted','failed','cancelled')),
  scheduled_for timestamptz,
  posted_at timestamptz,
  external_post_id text, -- ID returned by platform
  external_post_url text,
  rendered_content text not null, -- the actual text that was sent
  rendered_image_keys text[], -- which images were attached
  error_message text,
  retry_count int not null default 0,
  metrics jsonb default '{}'::jsonb, -- likes, shares, etc., refreshed periodically
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_social_posts_property on public.social_posts(property_id);
create index idx_social_posts_status on public.social_posts(status);
create index idx_social_posts_scheduled on public.social_posts(scheduled_for) where status = 'queued';
```

### 4.6 Audit log

```sql
create table public.admin_actions (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid not null references public.profiles(id),
  action_type text not null,
  target_type text not null, -- 'user','org','subscription','property','listing'
  target_id text not null,
  before_state jsonb,
  after_state jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_admin_actions_actor on public.admin_actions(actor_id, created_at desc);
create index idx_admin_actions_target on public.admin_actions(target_type, target_id, created_at desc);
```

### 4.7 Row Level Security — the heart of tier enforcement

Enable RLS on every public table. Below are the patterns; the dev should write the full set during the schema migration phase.

```sql
alter table public.properties enable row level security;

-- Anyone (including anon) can read active, published properties
create policy "active properties are public"
  on public.properties for select
  using (status = 'active' and published_at is not null);

-- Org members can see all of their org's properties
create policy "org members see own org properties"
  on public.properties for select
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = properties.org_id
        and om.user_id = auth.uid()
    )
  );

-- Only org members with role agent or higher can insert listings, AND only if org is under listing cap
create policy "org agents can insert listings within cap"
  on public.properties for insert
  with check (
    exists (
      select 1 from public.organization_members om
      join public.organizations o on o.id = om.org_id
      where om.org_id = properties.org_id
        and om.user_id = auth.uid()
        and om.role in ('owner','manager','agent')
        and (
          o.listing_cap is null
          or (
            select count(*) from public.properties p2
            where p2.org_id = o.id and p2.status in ('active','pending')
          ) < o.listing_cap
        )
    )
  );

-- Sensitive fields (full address, agent contact) gated through SECURITY DEFINER functions
-- See §6 for the contact info reveal pattern
```

**Important:** RLS is the *primary* tier enforcement layer. The frontend will also check feature flags for UX, but the database refuses unauthorized data regardless.

### 4.8 Database functions worth pre-building

```sql
-- Search properties within a radius
create or replace function public.search_properties_nearby(
  lat double precision,
  lng double precision,
  radius_m int default 5000,
  min_price bigint default null,
  max_price bigint default null,
  bedrooms_min int default null
) returns setof public.properties
language sql stable as $$
  select * from public.properties
  where status = 'active'
    and ST_DWithin(location, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, radius_m)
    and (min_price is null or price_cents >= min_price)
    and (max_price is null or price_cents <= max_price)
    and (bedrooms_min is null or bedrooms >= bedrooms_min)
  order by ST_Distance(location, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography);
$$;

-- Get effective tier for a user (considers org membership + active subs)
create or replace function public.get_user_tier(uid uuid)
returns text language plpgsql stable security definer as $$
declare
  best_tier text := 'registered';
begin
  -- Premium buyer subscription
  if exists (
    select 1 from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.user_id = uid and s.status in ('trialing','active') and p.tier = 'premium'
  ) then best_tier := 'premium';
  end if;
  -- Org-based tier
  select coalesce(max(p.tier), best_tier) into best_tier
  from public.organization_members om
  join public.subscriptions s on s.org_id = om.org_id
  join public.plans p on p.id = s.plan_id
  where om.user_id = uid and s.status in ('trialing','active');
  return best_tier;
end $$;
```

---

## 5. Authentication

### 5.1 Methods supported at launch

- Email + password
- Google OAuth
- Magic link (email)
- TOTP MFA (mandatory for admin roles, optional for everyone else)

**Deferred to v2:** Apple, LinkedIn, Facebook social login; WebAuthn/passkeys; SAML SSO.

### 5.2 Registration flow

1. **Step 1:** Email + password (or Google OAuth click). Required: ToS + Privacy consent. Optional: marketing opt-in.
2. **Email verification:** Supabase sends verification link, valid 24h. User cannot list properties or upgrade until verified.
3. **Step 2 (only for paid tiers):** Role selection → Stripe Checkout. Account is created in Supabase first; org and subscription are created on Stripe webhook receipt.
4. **Welcome email** via Resend (custom template, branded — Supabase's default email is fine for verification but not for welcome).

### 5.3 Login

- Rate limit: 5 failed attempts per email per 10 minutes → temporary lockout with reset link.
- Device tracking: store `user_agent` and `ip` per session in a `user_sessions` table (Supabase doesn't expose this directly, so log on every login).
- Trusted device flag: once MFA is verified on a device, optional 30-day trust.

### 5.4 Recovery

- Forgot password → email link, valid 1h.
- MFA recovery codes: 10 codes generated when MFA is enabled, stored hashed.
- Account recovery for lost MFA + email: manual support process; no self-serve.

### 5.5 Session management

- Supabase issues JWTs. Configure 1h access token, 7d refresh token.
- Refresh token rotation enabled.
- "Sign out everywhere" button revokes all refresh tokens.

---

## 6. Authorization & Tier Enforcement

### 6.1 The matrix

| Capability | Free | Registered | Premium | Agent | Agency | Expert |
|---|---|---|---|---|---|---|
| Browse listings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View photos & basic details | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| See agent name | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| See agent phone/email | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Save favorites | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Saved-search alerts | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Contact via form | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| WhatsApp contact button | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Property history (12 months) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Full property history & analytics | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Advanced filters (cap rate, schools…) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Export market reports CSV/PDF | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| Create listings | ❌ | ❌ | ❌ | up to 5 | up to 25 | unlimited |
| One-click social share | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Featured placement credits | ❌ | ❌ | ❌ | configurable | configurable | configurable |
| CRM-lite (pipelines, tasks) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Team seats | — | — | — | 1 | 10 | configurable |
| Lead routing rules | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Bulk CSV/API import | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| AI pricing suggestions | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| AI auto follow-ups | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Auto-blog from listing | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Salesforce/HubSpot integration | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| API access + webhooks | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Priority search rank boost | ❌ | ❌ | ❌ | small | medium | large |
| SAML SSO | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (v2) |

### 6.2 Implementation pattern

Every protected resource access flows through three layers:

1. **Frontend feature flag check** (UX — hide buttons the user can't use).
2. **API route authorization** (defense — Next.js middleware or route handler checks `user_tier` against required tier).
3. **Database RLS** (final source of truth — even if the API is bypassed, DB refuses).

Example helper:

```ts
// lib/auth/tier.ts
export async function requireTier(tier: Tier, ctx: RequestContext) {
  const userTier = await getUserTier(ctx.userId);
  if (!tierAtLeast(userTier, tier)) {
    throw new ApiError(403, 'PLAN_REQUIRED', { required: tier });
  }
}
```

### 6.3 Contact info reveal

This is the single most-abused feature in real estate platforms. Treat unmasking phone/email as a privileged operation:

- Free/Registered: see a "Contact agent" button → opens form modal.
- Premium+: backend returns full contact when authorized; frontend displays inline.
- Anti-scrape: rate-limit reveals per IP and per account (e.g., 50/day). Log every reveal in `admin_actions` with `actor_id` and `target_type='listing'`.
- Bot detection: Cloudflare Turnstile on the reveal endpoint.

---

## 7. Subscription & Payments (Stripe)

### 7.1 Product structure in Stripe

Create one **Product** per tier. Each product has multiple **Prices**: monthly, annual, and (optionally) per-currency.

```
Products:
  premium_buyer
  agent_5
  agency_25
  expert_unlimited

Prices for each:
  *_monthly_usd
  *_annual_usd
  *_monthly_eur (if needed)
  *_annual_eur
```

Sync the price IDs into `public.plans` via env vars at deploy time. **Never hard-code price IDs in app code.**

### 7.2 Trial logic

- Premium buyer: 7-day trial.
- Agent: 7-day trial.
- Agency, Expert: no trial (require sales contact for Expert? **[OPEN]** — recommend yes for Expert; book demo before subscription).

### 7.3 Checkout flow

1. User on `/pricing` clicks plan → backend creates a Stripe Checkout Session with `client_reference_id = userId` and `metadata = { plan_id, intended_org_name? }`.
2. User completes payment on Stripe.
3. Stripe redirects to `/onboarding/welcome?session_id=…`.
4. Stripe sends `checkout.session.completed` webhook to our Worker.
5. Worker creates the `organizations` row (for paid tiers), `subscriptions` row, `organization_members` row (owner = user). Marks user's effective tier.
6. Welcome email + in-product tour begin.

### 7.4 Webhooks to handle

| Event | Action |
|---|---|
| `checkout.session.completed` | Create org+sub on first payment |
| `customer.subscription.created` | Idempotent backup of above |
| `customer.subscription.updated` | Update plan_id, status, period; recompute entitlements |
| `customer.subscription.deleted` | Mark cancelled; schedule downgrade at period_end |
| `invoice.paid` | Record payment row |
| `invoice.payment_failed` | Mark `past_due`, start dunning |
| `invoice.payment_action_required` | Notify user (3DS) |
| `customer.updated` | Sync billing email/address |
| `charge.refunded` | Log refund, recompute entitlements if needed |

**Idempotency:** webhook handler must be idempotent. Use `stripe_event_id` as a dedup key in a `stripe_events_processed` table.

### 7.5 Dunning policy

- Day 0: Payment fails → email user, status `past_due`, full access continues.
- Day 3: Reminder email + in-app banner.
- Day 5: Restrictions begin — listings hidden from public, contact reveal disabled, but agent can still log in and pay.
- Day 7: Final retry. If failed → status `expired`. Auto-downgrade:
  - Premium → Registered
  - Agent → Read-only (listings archived but recoverable for 90 days)
  - Agency → Same as Agent
  - Expert → Agency (preserves data, disables AI/API)
- Day 97: hard data deletion of recoverable items unless paid.

### 7.6 Plan changes

- **Upgrade:** immediate, prorated. Stripe handles via `proration_behavior='always_invoice'`.
- **Downgrade:** schedule for `current_period_end` (don't refund). On switch, enforce new caps — agent must select which N listings to keep active.
- **Cancel:** sets `cancel_at_period_end=true`; access until period end; win-back email at day +7 and +30.

### 7.7 Tax & compliance

- **Stripe Tax** enabled for automatic VAT/sales tax. Confirm with an accountant for the markets you operate in.
- Invoices generated and stored in Stripe + emailed to user. Customer Portal exposes invoice history.
- Refunds: only `billing_admin` and `super_admin` can issue. Logged in `admin_actions`.

---

## 8. Property Listings

### 8.1 Listing lifecycle

```
draft → active (published) → pending (offer accepted) → sold|rented → archived
                ↑                                                       ↓
                └─────────── unarchive (within 90 days) ────────────────┘
```

### 8.2 Creating a listing — agent UX

Single-page form, save-as-you-go to draft. Sections:

1. **Basics** — transaction type, property type, currency, price.
2. **Location** — address autocomplete (Google Places API or Nominatim fallback), map pin adjustment, privacy toggle ("show exact address" off → only neighborhood shown).
3. **Details** — beds, baths, sqm, year built, amenities multiselect.
4. **Photos** — drag-drop, reorder, set primary, edit alt text per language.
5. **Description** — rich text editor (TipTap), per language. AI assist button (Expert tier) generates EN + ES drafts from the structured fields.
6. **Visibility & SEO preview** — shows the generated slug, meta title, OG card preview.
7. **Publish** — checks listing cap, validates required fields, sets `status='active'`, `published_at=now()`. Then opens the **Social Share** dialog (§10).

### 8.3 Slug generation

```
slug_en = slugify(`${title_en} ${city} ${country_name_en}`).truncate(60)
slug_es = slugify(`${title_es} ${city} ${country_name_es}`).truncate(60)
```

URL formats:

```
/en/properties/{slug_en}-{short_id}
/es/propiedades/{slug_es}-{short_id}
```

`short_id` is a 6-character base62 string. Slugs may change (re-edits); `short_id` never does. Old slug paths 301 to current slug path.

### 8.4 Image pipeline (detailed)

1. **Upload:** Client requests signed PUT URL from `/api/uploads/property-image?propertyId=…&filename=…`. Worker validates user has write access to property, generates a UUID, returns signed R2 URL valid 5 minutes.
2. **Direct upload** to R2 (no proxy through our servers).
3. **R2 event** (or client callback `/api/uploads/property-image/complete`) triggers Worker to:
   - Read EXIF orientation, fix if needed.
   - Reject if NSFW (Cloudflare Images has a content moderation flag — enable it).
   - Create variants in Cloudflare Images.
   - Insert `property_images` row with `cf_image_id`.
4. **Alt text:** required field per image, stored per language. AI suggestion via Cloudflare Workers AI (vision model) on Expert tier.
5. **Limits:** max 30 images per listing, max 15 MB each, formats `jpg|png|webp|heic`.

### 8.5 Search

For v1, all search is Postgres + PostGIS. No external search index.

**Filter capabilities:**
- Bounding box / radius / polygon
- Price range, currency-aware (convert at query time using cached daily FX rates)
- Bedrooms, bathrooms, sqm range
- Property type, transaction type
- Amenities (intersect on `amenities[]`)
- Full-text on title + description (per-language tsvector)
- Distance from a POI (school, beach, etc.) — **deferred to v2**

**Ranking:**
1. `featured_until > now()` first
2. Then by `org.rank_boost` desc
3. Then by relevance / distance / recency (depending on query)

Cache common queries with `Cache-Control: s-maxage=60, stale-while-revalidate=300` at the Cloudflare edge.

### 8.6 Featured placements

Stored as time-bounded promotions: `featured_until` on the property row, charged via Stripe metered usage or a credit-pack add-on product.

### 8.7 Bulk import (Agency+)

- CSV upload UI with column mapping wizard.
- Server-side validation per row, partial success allowed, error report downloadable.
- API endpoint `POST /api/v1/listings/bulk` for Expert tier (Bearer token auth, rate-limited).

---

## 9. WhatsApp Contact (all tiers)

A simple but high-leverage feature, especially in markets where WhatsApp is dominant.

### 9.1 Behavior

- Every property page has a **"Chat on WhatsApp"** button if the listing org provides a WhatsApp number.
- The button is a `wa.me` link with a pre-filled message in the user's selected language:
  - EN: `Hi, I'm interested in {title} in {city} ({url}). Is it still available?`
  - ES: `Hola, me interesa {title} en {city} ({url}). ¿Sigue disponible?`
- Click is logged as a lead (`source='whatsapp'`).
- Number masking on Free/Registered: button still works (it opens WhatsApp), but the visible number is hidden — same model as phone reveal. The lead is still attributed.

### 9.2 No WhatsApp Business API in v1

Automated WhatsApp messaging requires Meta Business approval and template registration. Defer to v2. The `wa.me` link approach is free, immediate, and works.

---

## 10. The One-Click Social Share System

This is the marquee Agent-tier feature. It is also the most operationally complex part of the build. Read this section in full before starting.

### 10.1 Per-platform reality check

| Platform | API status | Auth | Practical content limit | Approval needed | Cost |
|---|---|---|---|---|---|
| Facebook Page | Graph API (mature) | OAuth, requires user with Page admin role | ~63k chars; recommend ≤ 2,200 | Yes — Meta App Review | Free API |
| Instagram (Business/Creator) | Graph API via linked FB Page | OAuth — IG account must be Business/Creator and linked to a FB Page | 2,200 char caption; image or video required; **no clickable URLs in captions** | Yes — Meta App Review | Free API |
| LinkedIn | Marketing Developer Platform | OAuth 2.0; needs partner program approval for `w_member_social` and Pages access | 3,000 char post | Yes — partner approval can take weeks; review platform docs for current state | Free API |
| X (Twitter) | API v2 — paid tiers | OAuth 2.0 | 280 chars (free), 25,000 chars on premium accounts | App approval required | Paid — verify current pricing in Stripe-style billing on the X developer portal before committing scope |
| TikTok | Content Posting API | OAuth 2.0; **video-only**, no plain-image or text-only posts | Caption ~2,200 chars; requires a video file | Yes — Content Posting API requires app review and audit | Free API but heavy approval |

**[SCOPE FLAG]** TikTok requires a video for every post. For a real estate listing with only photos, the system would need to *generate* a slideshow video on the fly. This is doable (FFmpeg in a Worker via Container) but it is meaningfully more work than the other four. Before starting TikTok integration, confirm with the product owner whether it's worth the engineering cost; many agents post to TikTok manually with their own captions and walk-through videos and would not benefit from auto-fan-out anyway.

**X paid API:** the X developer pricing page should be checked for current tier costs at the time of build — these have changed several times. Plan to either pay the platform cost or have agents bring their own X dev keys (BYO-key flow) for v1.

### 10.2 OAuth & token storage

For each platform, the agent connects once via OAuth in the **Settings → Social Connections** page. The flow per platform:

1. Agent clicks "Connect Facebook" → backend builds OAuth URL with our `client_id`, `redirect_uri`, scopes, and a CSRF state token.
2. Agent authorizes on platform → callback to `/api/social/{platform}/callback?code=…&state=…`.
3. Backend exchanges code for access token, stores encrypted in `social_accounts`.
4. For Facebook: also fetch list of Pages the user manages, ask agent to pick which Page to publish to, store the *Page* token (not user token) — Page tokens are long-lived.
5. For Instagram: discover the IG Business account linked to the chosen FB Page.
6. Validate token by calling a benign endpoint (e.g., `/me`).

**Token encryption:** Use a Cloudflare Worker secret as the master key; encrypt with AES-GCM 256-bit. Never store raw tokens. Decrypt only at the moment of API use, in a Worker. Rotate the master key with a re-encryption migration job at least annually.

**Token refresh:** Daily cron job re-validates and refreshes tokens nearing expiration. Failures email the agent and mark the account `is_active=false`.

### 10.3 The "Share" UX

After publishing a property, the agent sees a modal:

```
Share to your social channels
─────────────────────────────────
[✓] Facebook — My Realty Page
    ┌─ Preview ────────────────┐
    │ 🏡 New listing! Beauti…  │  [Edit]
    └──────────────────────────┘

[✓] Instagram — @myrealty
    ┌─ Preview ────────────────┐
    │ 🏡 ¡Nueva propiedad!…    │  [Edit]
    └──────────────────────────┘

[ ] LinkedIn — (not connected)  [Connect]
[✓] X — @myrealty
[ ] TikTok — (skip — no video)

When?
( ) Now
( ) Schedule for [date/time picker]

[Cancel]    [Publish now]
```

- Per-platform preview shows the rendered text (auto-generated from the listing) plus the primary image.
- Edit button lets the agent tweak the caption before sending — but discourage this (agents who must edit each one defeats the purpose).
- Language: posts go out in the agent's primary language, OR both (configurable per platform; for some platforms, two posts in different languages may be the right call).

### 10.4 Content templates — the real spec

Per platform, the system renders text from a template. Templates live in `social_templates` (a future table) but ship with sensible defaults:

#### Facebook (long form, link in body)

```
🏡 {emoji_for_type} New {transaction_label} — {city}, {country}

{price_formatted} · {bedrooms} bd · {bathrooms} ba · {area_formatted}

{description_first_300_chars}…

✨ Highlights:
{top_5_amenities_as_bullets}

📍 {neighborhood_or_city}

👉 See full details and contact info: {url}

#realestate #{city_hashtag} #{country_hashtag} #{transaction_hashtag}
```

#### Instagram (caption + carousel of 3–10 images, NO clickable URL)

```
🏡 New {transaction_label} in {city}!
{price_formatted} · {bedrooms}bd/{bathrooms}ba · {area_formatted}

{description_first_200_chars}…

✨ {top_3_amenities_comma}

📍 {neighborhood_or_city}, {country}

👉 Link in bio for full details
{hashtags_15_to_20}
```

Reminder: IG strips clickable URLs from captions. Agent's IG bio must contain a Linktree-style page (or your platform's `/agent/{slug}` profile page works — link to it).

#### LinkedIn (professional, longer)

```
{transaction_label_capitalized} | {city}, {country}

{price_formatted}
{bedrooms} bedrooms · {bathrooms} bathrooms · {area_formatted}

{description_first_500_chars}…

This {property_type} sits in {neighborhood_or_city} and offers {top_3_features_as_sentence}.

For professional inquiries and a full information pack: {url}

#RealEstate #{country_hashtag_camelcase} #PropertyInvestment
```

#### X (≤ 270 chars to leave room for link card)

```
🏡 {transaction_label} · {city}
{price_formatted} · {bedrooms}bd · {area_formatted}
{url}
```

#### TikTok (if shipped — video required)

Caption similar to Instagram. Generated video = 15-second slideshow of property images with Ken Burns pan-zoom + license-cleared background music + price/location text overlay.

### 10.5 The fan-out worker

```
[POST /api/social/publish]
        │
        ▼
   create N rows in social_posts (status='queued')
        │
        ▼
   enqueue N messages in Cloudflare Queue (one per platform)
        │
        ▼
   [Worker: SocialPostConsumer]
        │
        ├─ load social_post + social_account
        ├─ decrypt access token
        ├─ render content from template + listing
        ├─ for IG/TikTok: also prepare media
        ├─ POST to platform API
        ├─ on success: update social_post status, save external_post_id/url
        ├─ on retryable failure: re-enqueue with backoff (max 3)
        └─ on permanent failure: status='failed', notify agent
```

### 10.6 Status dashboard

Every property has a "Distribution" tab showing all `social_posts`:

| Platform | Account | Posted | Status | Link |
|---|---|---|---|---|
| Facebook | My Realty | 2026-04-29 14:12 | ✅ Posted | [View](…) |
| Instagram | @myrealty | 2026-04-29 14:12 | ⏳ Processing | — |
| LinkedIn | — | — | ❌ Token expired | [Reconnect](…) |

Engagement metrics (likes, comments, reach) refreshed nightly per post for the first 14 days, then weekly.

### 10.7 Compliance

- **Disclosure:** posts can be required by some jurisdictions (e.g., agents in some US states must include license # — model this as an org-level field appended to every post).
- **Watermarks:** for Expert tier, automatically watermark the primary image with the agency logo.
- **Rate limits:** respect each platform's posting rate limits per account (e.g., Facebook ~25 posts/day per Page is a soft sanity cap to enforce, regardless of actual API limits).

### 10.8 "Auto-blog" for Expert tier

Out of scope detail in this section — the **auto-blog from new listing** feature mentioned in the original spec is a v1.5 feature on Expert tier. Brief design: on listing publish, an Expert-tier feature flag triggers a Worker that generates a 600–800 word SEO blog post via an LLM (Anthropic API), publishes to `/{lang}/blog/{slug}`, and links it from the listing page. Detailed spec deferred — note the SEO risk of mass-generated content (Google's spam policy targets this exactly).

---

## 11. Bilingual EN/ES

### 11.1 Routing strategy

Use **path-prefix routing** with `next-intl`:

```
/en/...    → English
/es/...    → Spanish
/          → Server-side detect from Accept-Language → 302 to /en or /es
```

Cookie `NEXT_LOCALE` overrides Accept-Language detection on subsequent visits.

### 11.2 Required SEO tags per page

```html
<link rel="alternate" hreflang="en" href="https://example.com/en/properties/luxury-villa-miami-florida-a3f9k2">
<link rel="alternate" hreflang="es" href="https://example.com/es/propiedades/villa-lujo-miami-florida-a3f9k2">
<link rel="alternate" hreflang="x-default" href="https://example.com/en/properties/luxury-villa-miami-florida-a3f9k2">
<link rel="canonical" href="https://example.com/en/properties/luxury-villa-miami-florida-a3f9k2">
```

### 11.3 Translation workflow

- **UI strings:** `messages/en.json`, `messages/es.json`. Reviewed by a human translator before release. Do not machine-translate UI without review.
- **Dynamic content (listings):** agents enter both languages. The form has a "Translate with AI" button that fills the other language draft; agent reviews before publish. Listings missing one language do not show on that language's site (do not fall back across languages — bad SEO and UX).
- **Country and city names:** maintain a `geo_translations` table mapping ISO codes to localized names.
- **Currency formatting:** use `Intl.NumberFormat` with the appropriate locale.
- **Date formatting:** `Intl.DateTimeFormat`.

### 11.4 Adding more languages later

The architecture supports it. Adding a language = add locale to `next-intl` config + translate UI strings + agents fill in their listings.

---

## 12. Light/Dark Theme

### 12.1

<!-- Document continues in HANDOFF_part2.md (incoming). Merge back into this file once received. -->
