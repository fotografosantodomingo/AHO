# Sell-funnel plan — Identity-selection + $5 private-owner listing

> **PO accepted 2026-05-18:** "$5 per listing for private owners, Identity-selection page before pricing." Authored as the shared brief for the 4 parallel agents building this in one push. Manager: parent Claude session.

---

## 1. The wedge

Today `/pricing` is the only "Sell" landing surface — which means 80% of visitors (FSBO homeowners, vacation-rental landlords, casual sellers) see a $29-$99/mo subscription on first click. They bounce. The few who don't are mismatched anyway: a one-time seller doesn't need automation for 1000 listings.

This plan adds the missing intermediate layer:

```
Sell →  IDENTITY SELECTION  →  one of:
            ↘ Homeowner / Landlord:  $5 one-time, 60-day listing
            ↘ Professional Agent:    $29–$99/mo subscription
```

Both flows lead to a live AHO listing with AI-generated captions in 7 languages and social-publish to at least one channel. The private path is the **first non-subscription revenue path** on AHO and the only path that doesn't depend on PO-side agent recruitment.

---

## 2. What we're building (4 parallel tracks)

### Track A — Foundation (manager)
- Migration `0074_private_owner_listings.sql`:
  - `profiles.accountType` enum: `private_owner | agent | agency`
  - `properties.expires_at` timestamptz (null for agent listings; set for private)
  - `properties.published_via` text: `agent_subscription | private_purchase`
  - `listing_purchases` table — `(id, property_id, buyer_user_id, stripe_session_id unique, amount_cents, currency, paid_at, expires_at, refunded_at)`
  - RLS + REVOKE patterns mirror migrations 0066/0067
- Stripe product setup in `scripts/setup-stripe-products.ts` — add `aho_private_listing_one_time` ($5 USD) alongside existing subscription products
- PATHNAMES entries for `/sell` + `/sell/private` + `/sell/private/new` + `/sell/private/success` + `/sell/private/cancel` (7 locales each)
- Header nav: change `Sell` link from `/pricing` to `/sell`
- AHO Platform KB update: add private-owner tier (id=`'private_owner'`, status='live', priceMonthlyUsd=null, oneTimeUsd=5)
- AHO Assistant: add `'sell'` + `'private-listing'` to `AhoAssistantSurface` + bias prompts

### Track B — Agent 1: `/sell` identity-selection page
- `src/app/[locale]/sell/page.tsx` — RSC, edge runtime, force-static
- Sections: Hero · Identity cards · How-it-works (split per role) · Trust strip · Comparison table · FAQ · Repeat-CTA · Footer
- New components: `<TrustStrip>`, `<TierComparison>`, `<FaqAccordion>`
- i18n: `sell.*` namespace in `messages/{en,es}.json` full translation; PL/PT/DE/FR/IT fall back to EN
- JSON-LD: `WebPage` + `Service` + `FAQPage` + `BreadcrumbList` via `buildGraph`
- Hreflang via `buildLandingAlternates({ pathKey: '/sell', ... })`

### Track C — Agent 2: `/sell/private` landing + simplified create form
- `src/app/[locale]/sell/private/page.tsx` — RSC, force-static. The product landing page (post-card-click).
- Sections: Hero ("$5 to publish your property worldwide") · 5-step process · what's included · what's NOT included (with upgrade path to Agent tier) · FAQ slice · CTA ([Pay $5 →] → `/api/sell/private/checkout-session`)
- `src/app/[locale]/sell/private/new/page.tsx` — auth-gated; redirects to `/signin` if not signed in; gated on a paid+unconsumed `listing_purchases` row for the current user (lookup via `paid_at` not null AND a property hasn't been linked yet); shows a simplified ListingForm
- New component: `<SimplifiedListingForm>` — same Zod shape as `CreateListingSchema` but UI hides agent-only fields (lead routing notes, branded profile fields, multi-channel social config); auto-sets `published_via='private_purchase'` + `expires_at = listing_purchases.expires_at`
- i18n: `sellPrivate.*` namespace

### Track D — Agent 3: Stripe $5 one-time flow
- `src/app/api/sell/private/checkout-session/route.ts` — POST endpoint; creates Stripe Checkout Session in `mode='payment'` (not `subscription`); price = the new `aho_private_listing_one_time` product; success_url → `/sell/private/success?session_id={CHECKOUT_SESSION_ID}`; cancel_url → `/sell/private/cancel`
- Extension to `src/app/api/webhooks/stripe/route.ts` — handle `checkout.session.completed` for `mode='payment'`; INSERT `listing_purchases` row with `paid_at = now()`, `expires_at = now() + 60 days`, dedupe via `stripe_session_id` unique constraint
- `src/app/[locale]/sell/private/success/page.tsx` — confirms payment, links to `/sell/private/new`
- `src/app/[locale]/sell/private/cancel/page.tsx` — soft re-pitch + back-to-`/sell/private`
- Tests for the webhook handler: dedup on retry, idempotent insert

### Track E — Agent 4: Expiry cron + renewal emails
- Migration is in Track A; this track only builds the surfaces around the schema.
- `src/app/api/cron/listing-expiry/route.ts` — runs daily, finds private-owner listings where `expires_at < now()` and status='active'; flips status to `expired`; emits a renewal nudge for any expiring in the next 5 days
- `workers/listing-expiry/` — thin Cloudflare Worker proxy, cron `0 4 * * *` (04:00 UTC daily, after audit-prune at 03:30)
- Brevo templates:
  - `src/lib/email/templates/listing-renewal-reminder.ts` — sent at day 55; subject "Your AHO listing expires in 5 days — renew for $5" + a button to renew
  - `src/lib/email/templates/listing-expired.ts` — sent at day 60; subject "Your AHO listing has expired" + renewal CTA + agent-tier upsell
- `/api/sell/private/renew/[propertyId]/route.ts` — re-uses the same Stripe Checkout Session helper, links the new purchase to the existing property

---

## 3. What stays UNCHANGED (no v2 dashboard split today)

The dashboard does NOT fork into 3 separate experiences. v1: same shell, the existing `navItems[]` array filters by `profiles.accountType`:

| accountType | Visible nav items |
|---|---|
| `private_owner` | My listing · Profile · Billing portal (one-time receipts) |
| `agent` | Properties · Analytics · Social · Leads · AI Inbox · Reviews · Saved searches · Profile |
| `agency` | Same as agent + a future supervisor tab (deferred to v2) |

Three-dashboard split is a v2 task triggered by ≥10 paying private-owner listings AND ≥1 agency customer.

---

## 4. URL inventory (added in this plan)

| EN | ES | Purpose |
|---|---|---|
| `/en/sell` | `/es/vender` | Identity selection (Track B) |
| `/en/sell/private` | `/es/vender/privado` | Private $5 landing (Track C) |
| `/en/sell/private/new` | `/es/vender/privado/nuevo` | Simplified create form (Track C) |
| `/en/sell/private/success` | `/es/vender/privado/exito` | Post-payment redirect (Track D) |
| `/en/sell/private/cancel` | `/es/vender/privado/cancelar` | Cancel redirect (Track D) |

All 5 paths added to `PATHNAMES` with hand-translated EN+ES + EN fallback for PL/PT/DE/FR/IT (matches existing landing-page convention).

---

## 5. Data model (Track A)

```
profiles
─────────
  id
  email
+ accountType  text not null default 'private_owner'
                check (accountType in ('private_owner', 'agent', 'agency'))


properties
──────────
  id, org_id (NULL for private-owner — or a synthetic org per user; see below)
+ expires_at      timestamptz   -- NULL for agent listings; 60 days from paid_at for private
+ published_via   text not null default 'agent_subscription'
                  check (published_via in ('agent_subscription', 'private_purchase'))
  status — existing values + a new 'expired'


listing_purchases  (NEW)
─────────────────
  id                 uuid pk
  property_id        uuid references properties(id) on delete set null
  buyer_user_id      uuid references profiles(id) on delete restrict
  stripe_session_id  text unique not null
  stripe_event_id    text   -- the checkout.session.completed event id, for dedup
  amount_cents       int    not null
  currency           char(3) not null
  paid_at            timestamptz not null
  expires_at         timestamptz not null
  refunded_at        timestamptz
  created_at         timestamptz not null default now()
```

### Org model for private owners

Open question: do private owners get a real `organizations` row (with `accountType='private_owner'` mirrored on the org) or a synthetic NULL?

**Decision:** every private-owner user gets their own `organizations` row at first $5 purchase (or at signup if we add a sign-up-first flow later). Org slug = `private-{userId-short}`. This:
- Keeps `properties.org_id` NOT NULL (existing schema invariant)
- Lets all RLS policies continue to work without special-casing private-owner listings
- Costs one extra INSERT at first purchase
- The org is invisible in `/agents/[slug]` (filtered by `accountType='private_owner'`)

---

## 6. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | $5 listings undercut the agent tier; agents leave or never sign up | Different audiences. Private = "list 1 property, DIY". Agent = "automate 100 properties + branded profile + AI inbox". The agent tier wins on automation; the $5 path can't access multi-channel publish OR AI inbox. |
| R2 | Abandoned private listings clog the marketplace | 60-day TTL + auto-expiry cron. No infinite-listing problem. |
| R3 | $5 listings are unprofitable after Stripe fee + infra | Math: $5 − $0.45 Stripe − $0.40 infra = $4.15 net. At 1000/mo = $4.1k MRR-equivalent. At 10k = $41k. Sustainable. |
| R4 | Refund disputes eat into $4.15 margin | 7-day no-questions refund policy in the FAQ; soft attribute via `listing_purchases.refunded_at`. Stripe handles the dispute machinery. |
| R5 | VAT / sales-tax handling complicates a $5 charge in EU markets | Stripe Tax already enabled on the AHO Stripe account for subscriptions; one-time prices inherit the same config. VAT shows inclusive at checkout. |
| R6 | Private-owner sees the AI chat widget on their listing and gets charged for inference at scale | Per the spec, $5 tier does NOT include the per-listing AI chat widget (the `<AiChatWidget>` is only mounted when `properties.published_via='agent_subscription'`). Private listings show the contact form only. |
| R7 | The "private listing" namespace conflicts with the agent slug namespace | Both publish to `/properties/{slug}-{shortId}`. Same URL space. The slug must be unique anyway via the existing `properties.short_id` constraint. No collision. |
| R8 | Private owner forgets to publish after paying $5 (orphaned `listing_purchases`) | The renewal cron at day 55 catches this: if a purchase has `paid_at` but no linked property, the renewal email pivots to "Finish your listing — you've paid but haven't published yet." |

---

## 7. Agent briefs (what each track owner must read)

All 4 agents must read:
- This plan (`docs/SELL_FUNNEL_PLAN.md`)
- `CLAUDE.md` (especially the hard rules + the local-dev quirks section)
- The relevant per-track section in §2 above

Track-specific reading:
- **Agent 1** (`/sell`): `src/app/[locale]/for-agents/page.tsx` for the landing-page pattern; `src/components/marketing/landing-page.tsx` for the existing chrome
- **Agent 2** (`/sell/private` + create form): `src/components/listings/listing-form.tsx` for the existing form; subset its fields
- **Agent 3** (Stripe): `src/app/api/billing/checkout-session/route.ts` (or wherever the existing subscription Checkout helper lives) + `src/app/api/webhooks/stripe/route.ts`
- **Agent 4** (expiry cron): `workers/audit-prune/` as the worker template; `src/app/api/cron/audit-prune/route.ts` as the route template; `src/lib/email/templates/lead-notification.ts` as the email template pattern

---

## 8. Phasing decision

PO-accepted defaults: ship Track A → unblocks B/C/D/E running in parallel. No further sign-off needed unless an agent surfaces a structural question.
