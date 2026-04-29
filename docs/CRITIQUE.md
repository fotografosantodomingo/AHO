# AHO HANDOFF — Senior-Eye Critique (v1.0)

**Date:** 2026-04-29
**Author:** Engineering review, pre-build
**Inputs:** `docs/HANDOFF.md` + `docs/HANDOFF_part2.md` (full)
**Status:** Recommendation to product owner. No application code yet.

---

## A. Verdict

The spec is ambitious, well-structured, and self-aware about its biggest scope risks (§1.5). It will hold up as a build guide for the foundational two-thirds of the system. The biggest risks are business and operational, not technical: app-review timelines, the empty-platform problem, and the per-tier UX surface area at maximum scope. The technical design has real bugs and inconsistencies that will bite during implementation, but they are fixable inside §30's open-questions framework.

**My recommendation:** cut v1 scope sharply (Free + Registered + Agent only, FB + IG + WhatsApp, no Premium, no Expert, no AI, no auto-blog, defer Agency to v1.1) and treat the result as launchable, not a beta.

---

## B. Risks beyond §1.5

The spec already flags three top-level risks (six tiers at launch, worldwide scope, all five socials). Below are risks not in §1.5 that I think are equally load-bearing.

### B1. Empty-platform problem at launch + the no-fake-data principle

With worldwide scope, every market outside the anchor (DR / LATAM) shows zero listings on day 1. The no-fake-data rule (now codified in `CLAUDE.md`, `DECISIONS.md`, and project memory) means we cannot paper over this with seeded content. SEO ranking for new pages takes months; social proof for buyers requires visible inventory.

**Mitigation:** pick *one* anchor city — recommend Santo Domingo — and brand the launch as that. The homepage talks about Santo Domingo, search defaults to it, the worldwide story belongs to v1.5. This is a marketing decision, not a technical one, but it gates real adoption. The codebase stays worldwide-capable.

### B2. Social-platform app-review serial dependency on the value prop

Agent tier's flagship feature is one-click social posting. Meta and LinkedIn app reviews each take 4–8 weeks; Meta sometimes longer for posting permissions. If review is in flight at launch, agents cannot use the feature they are paying for.

**Mitigation:** submit week 1 with placeholder Privacy/ToS pages on `advertisehomes.online` (already noted in the spec's domain-side actions). Until review approves, ship a **"manual share"** path: pre-rendered text + image opens in a new tab with the platform's native composer, agent pastes and posts. Agents still get value (consistent copy, branded image), no app-review dependency for go-live. Disclose to early agents that auto-posting flips on the day approval lands.

### B3. Bilingual content burden hurts agent acquisition

§11.3 + §15.2 mandate every public listing exists in EN + ES with no fallback. For monolingual agents (most), this is meaningful friction. AI-translate-then-confirm helps, but the agent still has to review a language they may not read.

Two outcomes converge: friction-induced low publish rate, *or* low-quality auto-translated content that hurts SEO.

**Recommendation:** allow single-language listings in v1, marked with the language they are in. Listings can be translated later (the agent or a paid service). Rolling back this rule before code is written is much cheaper than after agents have published thousands of EN-only listings under a no-fallback regime.

### B4. Listing-cap race condition under RLS

§4.7 enforces the 5-listing Agent cap via `count(*)` inside an RLS `WITH CHECK` clause. Two concurrent inserts from the same agent can both pass the check (each sees 4 rows before the other commits). PostgreSQL's default isolation is READ COMMITTED, which doesn't stop this.

**Fix options, in order of preference:**
1. SERIALIZABLE isolation on the insert path — simplest, cost is low for this rate of writes.
2. `pg_advisory_xact_lock(org_id_hash)` before the count — explicit, easy to reason about.
3. Denormalized `organizations.active_listings_count` updated by trigger, with a `CHECK` constraint — fastest read path but most invasive.

Pick one and bake into the `supabase-migration` skill so every cap-style policy uses the same pattern.

### B5. OAuth token master-key compromise = total social-account compromise

§10.2 and §12.2 say tokens are encrypted with a Cloudflare Worker secret. Compromise of that one secret decrypts every social token in the database — for every org, on every platform.

**Mitigation:**
- Use Supabase Vault or `pgsodium` with a per-row data key wrapped by a master KMS key.
- Document a key-rotation procedure now (re-encrypt rows with a new master, update key version column, retire old master after grace period).
- This is also a record-keeping concern: the daily token-refresh cron should record `last_validated_at` so a key compromise can be audited via "which tokens were touched after timestamp T".

### B6. Auto-blog at scale is a domain-wide SEO risk

§14.1 is admirably honest about Google's spam policy. The mitigations (rate-limit, human edit, distinct URL pattern, disclosure) are good in principle. But: 5 published posts per day across the whole domain means a 1,000-listing platform takes 200 days to blog every listing. Either the rate limit is wrong (and the SEO risk is back) or the feature is symbolic.

**Recommendation:** defer auto-blog entirely to v1.5. The Expert-tier value can come from AI description polish + AI follow-ups — the auto-blog feature carries asymmetric domain-wide risk for marginal upside.

### B7. `get_user_tier()` (§4.8) treats orthogonal capabilities as ordered

Tier comparison is treated as an ordering (`max(p.tier)`), but a user can be a Premium buyer *and* a member of an Agency org. Premium grants buyer features (full analytics, contact reveal); Agency grants agent features (listings, leads). The function as written collapses to one tier and loses information; every RLS policy that calls it inherits the bug.

**Fix:** split into two functions, or return a JSON capability set:
- `get_user_buyer_tier(uid)` returns one of `'free' | 'registered' | 'premium'`
- `get_user_org_role(uid, org_id)` returns one of `'none' | 'viewer' | 'analyst' | 'agent' | 'manager' | 'owner'`
- Callers compose: "is this user Premium-or-above OR an org member of any tier viewing their own org's listing?"

### B8. CSP policy (§21.6) is incomplete

`connect-src` doesn't include Resend webhook origin, MapLibre tile servers, social-platform OAuth domains, or Cloudflare Analytics. `script-src` excludes PostHog. `frame-src` excludes Stripe Customer Portal redirect.

**Recommendation:** ship in `Content-Security-Policy-Report-Only` mode for two weeks, observe violations, then enforce. Building CSP defensively is the only way it survives contact with reality.

### B9. Stripe Tax registration overhead is silent

§7.7 mentions "Stripe Tax enabled" casually. Stripe Tax handles calculation and collection, but you must register for tax in each jurisdiction where you have nexus before Stripe will collect there. For worldwide scope, that's accountants, paperwork, and recurring filings per jurisdiction. For DR + EU OSS + US states, that's ~5–10 registrations within a year of revenue.

**Recommendation:** ship in Stripe Tax `automatic-no-collection` mode initially. Register only for jurisdictions where revenue justifies it (typically: home country + EU OSS once over €10k/year). Document this so it's not a surprise in month three.

### B10. Image-pipeline reconciliation gap

§3.4 + §8.4 describe upload → R2 → CF Images → DB row. What if R2 succeeds, the CF Images variant call fails, and the DB row never gets `cf_image_id`? The listing publishes with no image; nothing detects this.

**Fix:** an idempotent reconciler cron that (a) finds R2 objects with no DB row (orphan R2 → delete after 24h), and (b) finds DB rows with no `cf_image_id` (retry the variant call, surface to admin after 3 retries). Ship this with the image pipeline, not as a v1.1 patch.

### B11. Email reply threading via single inbound alias is fragile

§17.3 forwards via `lead-{id}@inbound.advertisehomes.online`. If the agent replies from a different From address than the one we forwarded to (replies from a phone with a different signature; auto-replies from a CRM), threading breaks.

**Fix:** Resend Inbound webhook parses `In-Reply-To` and `References` headers; key threads off `Message-ID` not From. Test cases needed in QA: agent replies, agent forwards then replies, Out-Of-Office auto-reply, agent replies to a different recipient and CCs the alias.

### B12. Worldwide cold-start RLS latency

`properties` RLS policies do `EXISTS (SELECT 1 FROM organization_members WHERE ...)` per row. Cloudflare Pages runs globally; Supabase is in one region. Every public listing render fetches data across regions, then RLS executes joins.

**Fix:** for the SEO-critical anonymous path, expose listings via a `SECURITY DEFINER` function that bypasses user-context RLS and exposes only the public-safe columns where `status='active' AND published_at IS NOT NULL`. The function runs as the table owner, can't be tricked, and avoids the join. Faster *and* simpler than negotiating RLS for an anonymous request that has no user context to begin with.

---

## C. Technical correctness — smaller items, mostly resolvable inside §30

- **`plans.amount_cents int`** — change to `bigint`. INT4 overflows at 21M units, which JPY/COP/IDR plans can hit cheaply.
- **Currency convention** — spec is internally inconsistent: `properties.price_cents` is `bigint` (good), `plans.amount_cents` is `int` (overflow risk). Normalize to `bigint` cents everywhere before the first migration.
- **Slug NOT NULL** — `properties.slug_en/slug_es` are nullable but the public-readable RLS policy assumes published rows have all SEO fields. Either NOT NULL constraint when `status='active'`, or generate slugs in a BEFORE INSERT trigger.
- **`country_code` normalization** — uppercase ISO 3166-1 alpha-2 by convention; add a CHECK or `BEFORE INSERT` trigger to prevent `dr`/`Dr`/`DR` divergence.
- **`social_accounts` index** — unique constraint on `(org_id, platform, external_account_id)` is good. Missing index for the daily token-refresh cron's access pattern: `(platform, is_active, token_expires_at)`.
- **Refunds** — `payments.stripe_payment_intent_id unique` is too narrow; a single payment intent can be partially refunded multiple times. Add a separate `refunds` table FK'd to `payments`.
- **`admin_actions.target_id text`** — fine for polymorphic targets but loses FK enforcement. Compromise: keep `text` but add `target_user_id`, `target_org_id`, `target_property_id` mirror columns with FKs for query performance.
- **HSTS preload (§21.2)** — preload is irreversible at scale. Don't preload until *every* subdomain (including `staging.`, `mail.`, `tx.`, future `agencies.`) is HTTPS-only. Set `max-age=300; includeSubDomains` first, ramp to a year, then submit to hstspreload.org.
- **Robots.txt `Disallow: /search?` (§16.7)** — robots.txt is for crawl budget, not de-indexing. Use `<meta name="robots" content="noindex">` (or `X-Robots-Tag`) on those pages instead. Combine both.
- **next-intl v3 + RSC** — known quirks in static rendering with dynamic locale selection on App Router. Validate in Phase 0 not Phase 4.
- **Drizzle in Workers** — connection strategy unspecified. Recommend Hyperdrive when GA-stable in your Cloudflare account region; postgres-js with PgBouncer transaction-mode pooling otherwise.
- **5-min SLA push delivery (§17.5)** — for v1, SMS via Twilio is the realistic primary; PWA Web Push is unreliable across iOS Safari and battery-optimized Android. Don't promise the SLA without an SMS fallback.
- **Impersonation kill-switch** — spec logs impersonation but no explicit kill switch or banner for the impersonated user. Add: 30-min hard TTL, banner shown to impersonator, audit-log notification mailed to impersonated user (defer to v1.1 for that mail).
- **`admin_actions.actor_id` for AI events (§13.7)** — "actor_user_id = system" but `admin_actions.actor_id` is FK NOT NULL to `profiles`. Either: nullable + check constraint, dedicated system user row, or separate `system_actions` table.

---

## D. Sequencing recommendations

### Phase 0 must include (before any feature code)

Run all of these in parallel during weeks 1–2; failing to start any of them pushes launch back by review-cycle time:

- Cloudflare zone, Pages project, R2 bucket, KV namespace for feature flags, Queues for social fan-out
- Supabase project (EU region — see `OPEN_QUESTIONS.md` for the GDPR rationale), schema scaffolding, RLS skeletons, test harness with one fixture user per tier
- Stripe products in test mode (real prices set later from product owner)
- Sentry projects (Pages + Worker) and PostHog project
- Domain DNS migrated to Cloudflare; SPF/DKIM/DMARC for `mail.` and `tx.`; **email warm-up started now** (30-day burn-in before launch)
- Meta + LinkedIn app review submissions with placeholder Privacy/ToS at canonical domain (`advertisehomes.online`)

### Within Phase 2 (Agent tier)

- Stripe Checkout + webhook → entitlement *first* — highest-risk plumbing, prove end-to-end before adding features that depend on it.
- Property CRUD + image pipeline second.
- Public property page with full SEO third.
- Social-share UX last, gated on app-review approval. Until then: the manual-share fallback from B2.

### Cut from v1

- **Premium buyer tier** — defer to v1.1. Listing platforms generate value on the agent side first; buyer subscriptions are a v1.5 conversation once you have agent traction.
- **Expert tier (AI features, auto-blog, integrations)** — defer entirely to v1.5+. You can't sell upgrades to agents who aren't yet customers.
- **TikTok integration** — defer to v1.5 or never. Confirmed scope flag in §10.1.
- **X integration** — defer to v1.5. Pricing volatility + niche real-estate value.
- **Auto-blog** — defer to v1.5 per B6.
- **AI description polish + AI follow-ups** — defer to v1.5 (Expert features anyway).
- **Bulk CSV/API import (Agency+)** — defer to v1.5.

**Result of cuts:** v1 = Free + Registered + Agent + (lightweight) Agency. Social = FB + IG + WhatsApp. No AI features. This is achievable. Add LinkedIn and Premium in v1.1 as early upgrade paths.

---

## E. Realistic timeline at maximum scope

The spec gives two estimates that disagree:

- §1.5: 14–18 weeks to private beta with one strong full-stack dev
- §27: 9–14 months solo, or 5–7 months for a team of three

The §27 number is the honest one. §1.5 is optimistic by ~2x.

| Scope | Solo strong full-stack dev | Confidence |
|---|---|---|
| v1 at maximum scope (all tiers, all socials, AI, auto-blog) | 9–12 months to private beta; 12–15 months to public launch | medium-low |
| v1 at recommended scope (cuts above) | 5–7 months to private beta; 7–9 months to public launch | medium |
| Slice 1 (your proposal, with my modifications below) | 8–10 weeks end-to-end | medium-high |

Add a 25–40% buffer per §27 for app-review delays, lawyer turnaround, integration surprises, and AI tuning.

---

## F. Recommended first build slice

Your proposed slice was well-chosen. Modifications below.

**Acceptance test for end of slice 1:**

> An anonymous user lands on `/en/properties/{slug}-{shortId}` for a real listing. They click "Chat on WhatsApp" or fill the contact form; the agent receives the lead. The agent paid via Stripe Checkout (test mode → live before public launch) to publish that listing. The page renders in EN or ES with full SEO and a working theme toggle. Lighthouse mobile ≥ 90.

**Sequence within slice 1 (8–10 weeks, solo strong dev):**

| Week | Work |
|---|---|
| 1 | Cloudflare / Supabase / Stripe-test / Sentry / PostHog bootstrap. Domain on Cloudflare. Email DNS records published; warm-up started. Meta + LinkedIn app review submitted with placeholder pages at canonical domain. |
| 2 | Auth (email/pw + Google + magic link), `profiles`, `organizations`, `organization_members` tables with full RLS scaffolding. Tier helper functions (per B7). Test fixture: one user per tier. |
| 3 | Stripe Checkout + webhook → entitlement (Agent tier only). End-to-end test card → DB row → entitlement granted. Webhook signature verify + idempotency proven. Customer portal embedded. |
| 4–5 | Property CRUD with cap enforcement (advisory-lock or denormalized count, per B4). Image pipeline (signed R2 upload → CF Images variants → DB row reconciler per B10). |
| 6–7 | Public property page in EN + ES (next-intl path-prefix routing). Full SEO: title, description, canonical, hreflang, OG, Twitter Card, JSON-LD. Theme toggle (light/dark/system). Hero image preload, lazy below the fold. Lighthouse mobile ≥ 90. |
| 8 | Contact form → lead row → email to agent via Resend. WhatsApp click-to-chat (`wa.me`) with click-tracked lead. Phone/email reveal: out of slice 1 (no Premium yet) — show "Sign up to contact agent" for Free/Registered. |
| 9 | Hardening: rate limits on auth + form submit, CSRF, CSP report-only, RLS test pass for every policy, manual QA checklist, Lighthouse audit. Stripe live mode with real product/price IDs from product owner. |
| 10 | Soft beta with 3–5 real agents in Santo Domingo (or whichever anchor market lands). Real listings, real photos. Iterate. |

**Out of slice 1, into slice 2:**

- Saved searches + email alerts
- Agent profile pages + reviews
- Admin dashboard (basic — enough to suspend a bad listing or refund)
- Lead inbox UI for agents (slice 1 = email forward only)
- Search/filter/map page with PostGIS
- City landing pages

**Out of slice 1, into slice 3:**

- Agency tier (org seats, lead routing, CRM-lite)
- Social posting (depends on app review)
- Featured placements

---

## G. Summary of recommended decisions for product owner

These need product-owner answers before slice 1 starts. Captured in `OPEN_QUESTIONS.md` for tracking.

1. **Cut v1 scope** to Free + Registered + Agent + (light) Agency, FB + IG + WhatsApp, no AI, no auto-blog. Premium and Expert in v1.1. Yes/no?
2. **Anchor launch market** — Santo Domingo (recommended) or other? Worldwide stays in code but is not the launch story.
3. **Drop the no-language-fallback rule** (§11.3 / §15.2) — allow single-language listings in v1 marked with their language, translate later. Yes/no?
4. **Submit Meta + LinkedIn app reviews this week** with placeholder Privacy/ToS pages at `advertisehomes.online`. Yes/no?
5. **Anchor budget for Slice 1 (10 weeks)** before scope creeps. If cuts above are accepted, the team works to that timebox; over-runs require explicit re-scoping.

Once these five are decided, slice 1 work can begin.
