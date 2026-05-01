# Risk register

Live document. Update as risks materialize, are mitigated, or close. Status values: **open**, **mitigating**, **closed**.

---

## R1 — Worldwide scope chicken-and-egg
**Status:** open
**Risk:** Without an MLS/IDX feed, listings are agent-entered. Worldwide launch makes the cold-start problem worse, not better — supply density per market matters more than country count. No listings in a market = no buyer traffic = no agent willingness to pay.
**Mitigation:** Seed an anchor market first (suggested: Dominican Republic + LATAM Spanish + US English). Architecture stays worldwide; go-to-market starts narrow. Track listings-per-market as a KPI from day 1.
**Owner:** product

## R2 — Social platform app review timelines
**Status:** open
**Risk:** Meta (Facebook + Instagram), LinkedIn, X, and TikTok all require app review before production posting permissions are granted. Reviews historically take weeks each, and back-and-forth rejections are common.
**Mitigation:** Submit all four week 1 with sandbox/test apps. Build against sandbox until approved. Track review status in this register and surface blocked tiers in `OPEN_QUESTIONS.md` if they slip.
**Owner:** product (account ownership) + dev (technical submission)

## R3 — TikTok requires a video for every post
**Status:** open
**Risk:** Real estate listings are typically photo-first. TikTok's Content Posting API has no plain-image or text-only post type. Auto-generating a slideshow video (FFmpeg in a Worker container) is feasible but is multiple weeks of additional engineering and may not pay back — many agents already post to TikTok manually with their own walk-through video.
**Mitigation:** Confirm scope with product owner before starting TikTok integration. If kept, prototype the slideshow generator early to flush out cost and quality issues. Default position: defer to v1.5.
**Owner:** product

## R4 — X (Twitter) API paid pricing volatility
**Status:** open
**Risk:** X API tiers and pricing have changed multiple times in recent years. Costs could become uneconomic at scale, or pricing could shift mid-build.
**Mitigation:** Build a "bring your own key" (BYO-key) flow for X first — agents supply their own developer credentials. Only consider platform-managed posting if the economics make sense at projected volume. Re-check pricing on the X developer portal at the moment we start the X integration, not just now.
**Owner:** dev

## R5 — All six tiers at launch increases UX, billing, and admin surface
**Status:** open
**Risk:** Six tiers × monthly/annual × multi-currency × prorations × downgrades × six RLS-enforced capability matrices = many edge cases. The Premium buyer tier in particular is unproven.
**Mitigation:** Sequence Premium and Expert *last* within v1. If timeline slips, descope cleanly to Free + Registered + Agent + Agency without touching the database schema (the tier model already supports this).
**Owner:** product

## R6 — Email deliverability cold start
**Status:** open
**Risk:** A new sending domain on `mail.advertisehomes.online` will land in spam without proper auth records and gradual warm-up. Verification, welcome, dunning, and password-reset emails are critical-path — failures here block real money.
**Mitigation:** Set up SPF, DKIM, DMARC week 1 (requires DNS access — see `OPEN_QUESTIONS.md`). Warm up sending volume gradually per Brevo's recommendations. Monitor bounces and complaints from the first send onward.
**Owner:** dev (technical) + product (DNS access)

## R7 — RLS bypass through service-role misuse
**Status:** open
**Risk:** The Supabase service-role key bypasses RLS by design. A Next.js Route Handler that should run as the user but accidentally uses the service-role client silently bypasses tier enforcement, potentially exposing private data or allowing over-cap listings.
**Mitigation:** Restrict service-role imports to a small, named server-only module. Add a lint rule to flag service-role usage outside that module. Penetration test before launch (per spec §1.6 success criteria — "zero RLS bypass incidents").
**Owner:** dev

## R8 — Stripe webhook ordering and replay
**Status:** open
**Risk:** Stripe delivers webhooks at-least-once, in arbitrary order. A `customer.subscription.updated` can arrive before the `checkout.session.completed` it logically follows. Naïve handlers either lose state or double-write.
**Mitigation:** Idempotency dedup table keyed on `stripe_event_id`. Handlers must be designed to compute final state from the event payload, not from event ordering. Use the Stripe CLI's webhook replay during development to test out-of-order scenarios.
**Owner:** dev

## R9 — Slug collisions across orgs
**Status:** open
**Risk:** Two different orgs in the same city can each publish "Luxury Penthouse Miami Florida" — slug collision at the URL level.
**Mitigation:** Spec already appends a `short_id` (6-char base62) to the slug — collisions are tolerated visually but resolved by the suffix. RLS on `short_id` uniqueness in DB. Document in `new-page` skill.
**Owner:** dev (verify implementation matches spec §8.3)

## R11 — RLS test fixtures live in the same Supabase project as production
**Status:** open
**Risk:** `tests/rls/_setup.ts` creates fixture users (emails `*@aho.test`), fixture orgs (slugs `aho-test-org-*`), a fixture plan (id `aho_agent_monthly_test`, `is_visible=true`), and a fixture subscription/payment/founder-grant in whichever Supabase project the test is pointed at. Today there's only one Supabase project, so test fixtures sit alongside production data. If `/pricing` queries `plans` unfiltered, the fixture plan would appear. If admin tooling counts subscriptions, the fixture sub is included. Names are deliberately namespaced (`*@aho.test`, `aho-test-org-*`, `_test` suffix on plan ID) so collision is unlikely, but the dual-purpose DB is a bug magnet at scale.
**Mitigation:** Short-term — filter UI / admin queries by an explicit `stripe_price_id NOT LIKE 'price_test_%'` and `slug NOT LIKE 'aho-test-org-%'` everywhere. Long-term — dedicated test Supabase project, or use Supabase database branches (per-PR ephemeral DBs) once that feature is GA-stable in the chosen tier. The test harness in `_setup.ts` already refuses to run against staging or production hostnames; once a separate test project exists, just point the env there.
**Owner:** dev

---

## R10 — Spec was AI-drafted and not yet senior-reviewed
**Status:** mitigating
**Risk:** Internal contradictions, technical errors, or unrealistic estimates that only surface when implementation starts.
**Mitigation:** Critique pass before any code is written. Critique to be added to this repo as `docs/CRITIQUE.md` (or merged into `DECISIONS.md`) once `HANDOFF_part2.md` is received.
**Owner:** dev
