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

## R14 — Leaked-password protection (HaveIBeenPwned) not enabled
**Status:** open (accepted — no upgrade)
**Risk:** Supabase Auth can optionally check new passwords against the HaveIBeenPwned (HIBP) breach corpus on signup + password-change paths. We currently have `password_hibp_enabled = false`. Users can therefore set passwords that have already appeared in past breaches (e.g. `password123`, `qwerty12345`, leaked email/password pairs from third-party breaches). For an attacker, the practical impact is that credential-stuffing attacks land more reliably against AHO accounts than they would with HIBP active.
**Why we're not enabling it:** Supabase gates `password_hibp_enabled` behind their Pro plan (~$25/mo). PO directive 2026-05-12: stay on Free tier, accept the gap rather than upgrade. Existing controls partially compensate: the progressive auth-failure lockout (5/10/20 thresholds, migration 0039) raises the cost of credential stuffing per email, and the new device-OTP flow (migrations 0046+0047, commit 0d43d1e) blocks first-login from a stolen credential unless the attacker also has the victim's inbox.
**Reconsider if:** (a) we upgrade to Pro for unrelated reasons (database branches, larger compute) — flip the bit, ~1 min via Management API; (b) we see real evidence of credential-stuffing in `auth_failure_log` (sustained high-volume guesses against a single account from many IPs); (c) we move to a regulated jurisdiction where breach-corpus password checks become a compliance requirement (DR / regional financial regulation).
**Owner:** PO (billing decision).

---

## R13 — Supabase advisor flags `public.spatial_ref_sys` (PostGIS reference table) as RLS-disabled
**Status:** closed (accepted as permanent noise floor — 2026-05-12)
**Risk:** Supabase's security advisor flags `public.spatial_ref_sys` (8500 EPSG coordinate-reference-system rows shipped by the PostGIS extension) as CRITICAL because RLS is not enabled. PostgREST automatically exposes the table at `/rest/v1/spatial_ref_sys` to anyone holding the (public) anon key. Confirmed live: anon read returns full rows. The table contains no user data — every row is a published EPSG standard, also available at epsg.io — but the flag inflates our advisor surface and signals a posture inconsistency.
**Cannot self-mitigate:** the table is owned by `supabase_admin`, a role we cannot `set role` into from any path we have access to. Tried: direct `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` from migration runner (42501), `set local role supabase_admin` in transaction (42501 "permission denied to set role"), Supabase Management API `/database/query` endpoint (42501 same error). Same blocker for `REVOKE` on the underlying grants — only the owner can adjust them.
**Mitigation path:** Originally written as "acknowledge in dashboard", but confirmed live 2026-05-12 that the Supabase Advisor UI in our project version has NO per-finding Acknowledge / Dismiss button. The available row-level actions are Resolve (links to docs), Ask Assistant (AI tutor), View policies, Learn more. Splinter (the underlying linter) reruns and re-flags on every refresh; there is no persistence layer for "user marked this as accepted." The advisor noise floor will persist until Supabase ships a platform-side fix OR adds a UI dismiss feature.
**Operational note:** We accept the 29-finding baseline as documented (see PROGRESS 2026-05-12 entry "Supabase advisor audit + baseline lock" for the full categorized list of which findings are platform-blocked vs intentional). Real security exposure: zero (EPSG data is public; the other intentional findings are auth-checked or service-role-only).
**Owner:** Supabase platform (filed informally 2026-05-10; we have no path to fix from our side).

---

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

---

## R12 — Cloudflare Images activation + R2→CFI backfill (RESOLVED 2026-05-07)
**Status:** resolved
**Risk:** `property_images.cf_image_id` was null on every row because Cloudflare Images was not yet provisioned. `buildImageUrl()` fell back to R2 originals at upload resolution. Observed on `/pl/properties/wwww-siemianowice-pl-cQF9BN`: 34.5 MB page weight, 33.5 MB image-delivery waste, LCP 28.9 s, Performance score 42. Capped every listing page across every locale.
**Resolution (2026-05-07):**
1. PO activated Cloudflare Images on the account; supplied account hash `Sl-ceWby0IYMRC5pXgwVxg`.
2. PO created an API token with `Cloudflare Images: Edit` scope (alongside the existing Pages + R2 + Workers scopes).
3. `scripts/setup-cf-images-variants.ts` provisioned 8 variants: `public` (1366×768 scale-down), `card` (600×400 cover), `thumbnail` (200×200 cover), `og` (1200×630 cover), `full` (1920² scale-down), `fbfeed` (1200×630 cover), `igsquare` (1080² cover), `igreel` (1080×1920 cover). CF Images rejects both `_` and `-` in variant ids — only alphanumeric, hence `fbfeed` not `fb-feed` for the ad-pipeline names.
4. `scripts/backfill-r2-to-cf-images.ts` walked every `property_images` row, uploaded the R2 original to CF Images, wrote `cf_image_id` back. Idempotent + paged + paced 5 req/sec. First run: 7/7 PL property photos uploaded successfully.
5. `.github/workflows/deploy.yml` now bakes `NEXT_PUBLIC_CF_IMAGES_HASH` into the build; the post-backfill deploy serves `imagedelivery.net/<hash>/<id>/<variant>` URLs from `buildImageUrl()`.
**Result on `/pl/property` Lighthouse:** Perf 42 → **73**; total bytes 34.5 MB → **1.9 MB** (-95%); LCP 28.9 s → 7.3 s; TBT 2.29 s → 170 ms; A11y/BP held at 100. Remaining LCP gap (target Perf 90+) is now addressable via preload + srcset on the primary image, not infrastructure.
**Follow-ups:** (a) the upload pipeline still writes to R2 only — new uploads fall back to R2 until they're backfilled; the upload route should push directly to CF Images at write time. Tracked separately. (b) `meta-description` Lighthouse audit still fails on this URL despite the tag being in the HTML; not a CF Images issue, looks like a Lighthouse quirk on dynamic pages. Tracked separately.
**Owner:** PO + dev (resolved)
