# Architecture decision log

One entry per significant choice. Newest on top. Format:

```
## YYYY-MM-DD — Decision
**Decision:** what we picked.
**Why:** rationale.
**Alternatives considered:** what we rejected and why.
**Reconsider if:** trigger that would justify revisiting.
```

---

## 2026-05-01 — Reviews are agent-targeted with email-token verification and admin moderation (Batch A1)
**Decision:** Reviews target the agent's `profiles.id`, not individual listings or organizations. Verification is email-token (32-char hex, 7-day TTL, single-use atomic flip via SECURITY DEFINER `verify_review_token`). Moderation is mandatory: every review passes through `pending_moderation` before going public. Star scale 1–5 required; body 50–5000 chars; agent reply 10–2000 chars (single per review, public). Self-review blocked at DB-CHECK level. AggregateRating JSON-LD is rendered ONLY when `count > 0` (schema.org rejects empty aggregates). Reports go to admin queue without auto-hiding the review (auto-hide invites brigading; admin makes the call).
**Why:**
- **Agent-targeted** because agents persist across listings; listings disappear when sold. Buyers searching "real estate agent in {city}" land on `/agents/[slug]` — that's where the trust signal needs to live.
- **Email-token** as the v1 verification mechanism per the strategic-doc default. Transaction-lookup verification waits for v1.1 (needs a `transactions` table that doesn't exist yet).
- **Admin moderation gate** because at v1 scale we'd rather pay support cost than ship reviews that could expose the platform to defamation claims.
- **Locale-locked at submission** — review locale is captured at write time so the verification email and the agent-notification email both go in the language the reviewer wrote in. Cross-locale fallback would require runtime translation, which is out of scope.
- **No Turnstile in v1** — the email-token gate already kills 99% of script abuse; Turnstile would add friction in markets where Cloudflare is sometimes throttled. Reconsider in Batch A6 (lead-form work) where Turnstile is the primary anti-abuse layer.
**Alternatives considered:**
- Listing-level reviews — rejected; spam risk + listings disappear after sold.
- Auto-publish-after-verification (no admin queue) — rejected; defamation exposure.
- Owned reviews vs. embed Trustpilot/Google — chose owned for v1; lock-in benefit + can layer external embeds later.
- Auto-hide on N reports — rejected for v1; brigading mitigation needs more thought; keep human in the loop.
**Reconsider if:** (a) admin moderation queue volume becomes unmanageable (>50/day) — auto-publish trusted reviewers (verified-via-transaction in v1.1), (b) defamation suits actually arrive in any market — tighten policy + add right-of-reply automation, (c) we want reviewer identity verification beyond email-token (e.g., Stripe Identity) for premium agent badges.
**Build implications:**
- `audit_log` is NOT used for reviews — they get their own table because the access pattern (anon-read by agent_id, count + avg aggregates) doesn't fit `audit_log`'s shape.
- `review_reports` is parallel to `audit_log` but separate — different anti-abuse posture (anyone can report, dedup at route, admin processes manually).
- AggregateRating omission is a contract pinned by visual review — no automated test of "count=0 → no JSON-LD" because it's a server-render conditional. Reconsider if we add a JSON-LD validation step.

---

## 2026-05-01 — Audit-log payload contract: public-safe lifecycle facts only
**Decision:** `audit_log.payload` for ANY kind is restricted to public-safe lifecycle facts only. Specifically excluded everywhere: `closing_notes` (private agent deal notes, max 2000 chars) and `prior_status` (lifecycle transitions: `draft`/`pending`/`coming_soon`). The rule is enforced at the writer side via `lib/audit/audit-payload.ts` builders; new audit writers MUST go through a builder, not assemble a payload inline. Migration `0015` retroactively scrubbed any rows written between Phase 1A deploy and the patch (idempotent jsonb minus-operator). Pinned by 6 unit tests in `tests/unit/audit-payload.test.ts`.
**Why:** 0014's anon-read policy makes `payload` content publicly readable for `kind in (listing.marked_sold, listing.marked_rented, listing.price_changed)`. The original Phase 1A writer included `closing_notes` and `prior_status` — both fields the PO explicitly identified as private. Tightening the policy is the wrong fix (the public-read policy is needed for the price-history block); tightening the payload is the right fix.
**Alternatives considered:**
- Tighten the 0014 policy to redact specific JSON keys. Postgres RLS doesn't support field-level filtering on jsonb; would require a view or a SECURITY DEFINER function returning a curated row. Way more complex than scrubbing at write time.
- Move private fields to a parallel `audit_log_private` table. Over-engineered for the current event volume; may revisit if private audit needs grow.
- Defensively scrub on read in the property page Server Component. Doesn't help; anon can still query via the Supabase JS client directly.
**Reconsider if:** (a) a new audit kind is added to the 0014 IN-list (extend the contract, audit ALL existing payloads against the new exposure), (b) an "agent-only audit view" feature is requested — build it as a separate table/policy, do NOT widen this one.

---

## 2026-05-01 — Phase 1B test-debt triage (post-Phase-1B audit punch list)
**Decision:** The Phase 1B test-coverage audit surfaced 6 should-have gaps and 4 nice-to-have gaps. Disposition:

**Should-haves — queue as Phase 2 prep tickets, one per route, NOT batched:**
1. `audit_log_self_insert` policy untested — **bumped to top priority within Phase 2**. Same risk profile as the "audit log silently failing for weeks" bug from Phase 1A: silent INSERT failures are invisible until the trail is needed and missing.
2. `mark-sold` route-level tests (sold_date defaulting, audit-failure-doesn't-unwind, RLS forbid mapping, rented kind branch).
3. `archive` route-level tests (status flip, undo, audit row, RLS interaction with status changes).
4. `/api/cities` route tests (param validation, fixture exclusion, cache header).
5. `/api/me/avatar` route tests (auth, 2 MB cap, MIME guard, R2 prefix, DELETE).
6. `getCountryName` actual-behavior documentation — already addressed via inline comment in `src/lib/i18n/countries.ts` (locale → ISO only; no cross-locale chain). No code change needed; the gap was a doc-vs-impl mismatch, fixed.

**Nice-to-haves — known gaps with triage notes:**
- **Avatar orphan cleanup (#9):** chosen approach is delete-on-upload (single `DeleteObjectCommand` keyed off the prior `avatar_url` before writing the new one), NOT a quarterly sweep cron. Cron adds infrastructure cost and accumulates tech debt; per-upload delete is one extra round-trip on a path that's already async. Implementation deferred to Phase 2 — touches the avatar route which is in the 1A/1B smoke-test scope, hold until smoke-test green.
- `getCountryName` edge cases (#10): empty/null/whitespace input, lowercase ISO, malformed input. Tiny unit test file. Phase 2.
- `fetchPriceHistory` helper edge cases (#11): empty publishedAt, single-event hide rule, retroactive `from_cents` rewrite. Phase 2.
- `require_sold_date_on_close` trigger isolated test (#12): Phase 2, alongside the broader `recompute_agent_stats` trigger coverage (blocker #2 from the same audit).

**Why batch this in DECISIONS rather than as separate tickets per gap:** there's no issue tracker wired up (no `gh` CLI installed; project tracks PO decisions in `OPEN_QUESTIONS.md` and architectural choices here). One DECISIONS entry preserves the triage rationale alongside the gap list, so future-Claude reading the log understands what was deliberately deferred vs. forgotten.

**Reconsider if:** (a) the smoke-test surfaces a regression in any of the should-have areas — promote that ticket immediately, don't wait for Phase 2, (b) a future contributor adds a test for one of these areas without referencing this triage — point them here so they understand the priority order, (c) issue tracking gets formalized — port the should-haves over and reference this entry from each.

---

## 2026-05-01 — audit_log gets a public-read policy for listing-state events (Phase 1B)
**Decision:** Migration `0014` adds an additive RLS policy `audit_log_public_read_listing_events` that lets `anon` and `authenticated` read `audit_log` rows where `kind in ('listing.price_changed', 'listing.marked_sold', 'listing.marked_rented')` AND the `target_id` points at an `active|sold|rented` + `published_at IS NOT NULL` property. The existing admin/self read policies stand; RLS policies OR together so a row visible to admins via the existing policy stays visible.
**Why:** The Phase 1B price-history block on `/properties/[slug]` needs to render a chronological timeline visible to anonymous visitors. The block reads `audit_log` directly (the alternative — using the service-role client from a user-facing page — was explicitly rejected by `src/lib/supabase/admin.ts`'s own docstring, which forbids that import outside webhooks/queues/scripts). Limiting the policy to (a) a closed set of event kinds and (b) properties already public-visible keeps the surface narrow: nothing about drafts, archived listings, or admin-internal events ever escapes.
**Alternatives considered:**
- Use the service-role client from the property page. Rejected for the architectural reason above.
- A dedicated `price_history` table populated by triggers. More normalization work for marginal benefit; the audit_log already captures the events at write time.
- Public `SELECT` over the whole `audit_log` table. Rejected — the table holds admin-internal events (`admin.user.promoted`) that must not leak.
**Reconsider if:** (a) we add audit kinds that should be public on the same property surfaces (extend the IN list and ship a paired test), (b) we add audit kinds that are emphatically private but where someone tries to widen this policy to cover them (block in review), (c) RLS performance suffers — the `EXISTS` subquery hits a primary-key lookup so it should stay cheap, but worth re-measuring after a few hundred K rows.

---

## 2026-05-01 — Avatar upload: direct server PUT, not presigned URL (Phase 1B)
**Decision:** `POST /api/me/avatar` accepts a multipart file ≤2 MB and PUTs the bytes server-side to R2 in a single round-trip (object key `avatars/{userId}/{ts}-{rand}.{ext}`), then writes the resulting public URL to `profiles.avatar_url`. This is different from the property-images flow, which uses the presigned-URL two-step (`POST /api/properties/:id/images` returns an upload URL; client PUTs directly; `POST /:imageId/confirm` finalizes).
**Why:** Avatars are tightly bounded (2 MB cap) so the file fits in an edge-runtime request body without straining limits. A single round-trip is simpler for the agent UX (pick → done) than the two-step dance, and the security posture is identical because the server is still the trust boundary on type + size validation. Property images are different: they can be 10 MB+ each, often in batches, and benefit from offloading the bytes path away from the edge route directly to R2.
**Alternatives considered:**
- Presigned URL flow identical to property images. Rejected — overhead without benefit at 2 MB.
- Cloudflare Images variant pipeline (the same one property images use). Rejected for v1 — the Images token isn't enabled in this account yet (waiting on a separate paid-plan opt-in), and avatars don't need responsive variants the way listing photos do.
- Same R2 bucket as property images, different prefix (`avatars/`). Adopted. Avoids needing to provision a second bucket + env var; the `aho-pages-uploads` bucket already exists, and the prefix is a clean enough boundary for orphan sweeps later.
**Reconsider if:** (a) an avatar exceeds 2 MB regularly enough that the cap is hostile (bump it; the architecture doesn't change), (b) Cloudflare Images becomes available and we want resized avatar variants (`/avatar-s`, `/avatar-m`) — switch to the Images flow then, (c) we want server-side resize/crop before storing (bring in `sharp` via a worker, not the edge route).

---

## 2026-04-30 — UI/UX polish phase: 21st.dev "Magic" MCP wired; nextlevelbuilder skill optional
**Decision:** Polish phase uses the [21st.dev "Magic" MCP server](https://21st.dev) for component generation, configured in `.mcp.json` at project root with the API key supplied via `${TWENTY_FIRST_DEV_API_KEY}` env-var substitution (key in `.env.local`; not committed per CLAUDE.md hard rule #1). The earlier framing — that the [`ui-ux-pro-max-skill`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) from `nextlevelbuilder` was "backed by" 21st.dev — was inaccurate; they're independent products. The Magic MCP is what consumes the API key. The nextlevelbuilder skill is a self-contained design-intelligence engine that can be layered in later if useful but is not required to begin polish work.
**Why:** PO directive on 2026-04-30 + key paste 2026-04-30. The current design system (HashiCorp tokens + Inter, per `2026-04-29 — Visual design language`) is intentionally minimal. 21st.dev Magic generates production-grade components (hero sections, marquees, testimonial walls, pricing tables, animated transitions) on demand. Each surface gets polished as a separate commit, composing Magic-generated primitives against existing design tokens so the palette stays coherent.
**Setup state (now):**
1. ✅ API key rotated and stored as `TWENTY_FIRST_DEV_API_KEY` in `.env.local`.
2. ✅ `.mcp.json` at project root with `21st-magic` server config (`npx -y @21st-dev/magic@latest`), API key via env-var substitution.
3. ⏳ Verify MCP server reachable — needs Claude Code session restart with `TWENTY_FIRST_DEV_API_KEY` exported in the parent shell (no direnv on this machine; source `.env.local` before launching Claude).
4. (Optional) Install the `ui-ux-pro-max` skill via `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` then `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`. Self-contained; doesn't consume the 21st.dev key.
**Alternatives considered:**
- Hand-craft every component on top of the current tokens. Rejected for ROI — the design system underpins everything but doesn't ship "wow" moments by itself; building those from scratch would consume weeks.
- Use a different component library (shadcn/ui, Material, etc.). Rejected — we're already past the "pick a base library" decision (Tailwind v4 + design tokens), and shadcn-style components don't carry the same level of "stunning marketing surfaces" curation.
- Defer entirely. Rejected — visual polish drives signup conversion and agent perception. Shipping a functional-but-plain product to soft-beta agents will get muted reactions.
**Reconsider if:** (a) 21st.dev's terms or pricing change in a way that makes us pay more than the polish phase's value, (b) a particular surface needs a custom component Magic can't produce well, (c) the API key gets re-exposed (rotate again).
**Build implications:**
- Polish phase scheduled AFTER slice 2 functionally lands (admin dashboard now complete). Don't polish a surface that's still being designed structurally.
- Each polish PR touches one surface and composes Magic-generated primitives against existing design tokens. We don't import 21st.dev's color system; the palette stays HashiCorp.
- Magic MCP runs `npx -y @21st-dev/magic@latest` on server start — third-party npm executable. PO has explicitly authorized this in this entry; supply-chain risk is accepted as part of the polish-phase scope.

---

## 2026-04-29 — Cloudflare adapter: `@cloudflare/next-on-pages` + Pages (despite npm-level deprecation), all routes opt into Edge runtime
**Decision:** Wire AHO's Cloudflare deploy via **`@cloudflare/next-on-pages` v1.13.16** targeting **Cloudflare Pages**. Not OpenNext. Every non-static route declares `export const runtime = 'edge'` (25 routes total), `wrangler.toml` sets `compatibility_flags = ["nodejs_compat"]`, build output is `.vercel/output/static`. Deploys via `wrangler pages deploy` from a GitHub Actions workflow on push to `main`.
**Why:** PO explicitly chose this path on 2026-04-29 with awareness that the package is npm-deprecated and Cloudflare officially recommends `@opennextjs/cloudflare` (which targets Workers, not Pages). The reasoning was "matches the spec, older tooling" — `CLAUDE.md` and `HANDOFF.md` §3.4 nominate Cloudflare Pages, and PO valued spec adherence over chasing the latest tool. The migration debt is acknowledged and accepted.
**Alternatives considered:**
- `@opennextjs/cloudflare` → Workers (the modern Cloudflare-recommended path; better Node.js compat; targets `*.workers.dev` instead of `*.pages.dev`). Rejected per PO direction; spec says Pages.
- Bumping the Next.js peer-dep cap via pnpm `peerDependencyRules.allowedVersions` (we're on 15.5.15; adapter caps at 15.5.2). Not done — peer-dep mismatch is silent at runtime today; logging here so we know to revisit if a future Next.js bump breaks the adapter.
- Cloudflare Workers Static Assets directly (no adapter at all). Rejected — would require rewriting our Server Components and middleware to vanilla Workers, no Next.js conventions, multi-week refactor.
**Reconsider if:** (a) `@cloudflare/next-on-pages` becomes incompatible with a Next.js minor we need (the Next.js peer-dep cap is the leading indicator), (b) Cloudflare formally end-of-lifes the adapter, or (c) we hit a feature limitation that OpenNext supports cleanly (notably: Node.js runtime for specific routes, ISR with on-demand revalidation, Image Optimization that needs Sharp).
**Build implications:**
- All 25 non-static routes now have `export const runtime = 'edge'` at the top. New routes must add it too — added to the `new-page` skill.
- Local pages-build wrapper: corepack-managed `pnpm` isn't on PATH for adapter subprocesses, so `node_modules/.bin/pnpm` is a tiny shell shim (`exec corepack pnpm@9.12.3 "$@"`) created post-install. CI uses `pnpm/action-setup@v4` and doesn't need the shim.
- `wrangler.toml`: `name="aho-web"`, `compatibility_date="2025-09-23"`, `compatibility_flags=["nodejs_compat"]`, `pages_build_output_dir=".vercel/output/static"`.
- `.gitignore`: added `.vercel/`.
- Deps: added `@cloudflare/next-on-pages`, `wrangler`, `vercel` as devDeps. The npm install logs a deprecation banner — expected.

---

## 2026-04-29 — Visual design language: HashiCorp-style (`getdesign.md` HashiCorp template), parent palette only, Inter substituted for HashiCorp Sans
**Decision:** AHO's visual language adopts the HashiCorp design system as documented in the `getdesign.md` HashiCorp template (npm `getdesign@0.6.10`, captured to `docs/DESIGN_REFERENCE.md`). We use the **parent** palette and component patterns — black/white + dual-mode (light surface + `#15181e` / `#0d0e12` dark hero), micro-shadows at 0.05 opacity, tight-headings (1.17–1.21) over relaxed body (1.50–1.69), 2–8px radius scale (no pills), uppercase 13px/600/1.3px-tracking labels, 3px solid focus rings — and explicitly **drop** the multi-product color tokens (Terraform purple, Vault yellow, etc.) since AHO is a single product. Brand font HashiCorp Sans is replaced with **Inter** (variable, weights 500–700, OFL-licensed); system-ui remains the body stack.
**Why:** PO requested the HashiCorp visual style on 2026-04-29. The template's enterprise-clean aesthetic suits a real-estate marketplace where trust + density of data matters more than expressive flourish. The spec is concrete enough (specific hex codes, exact line-heights, asymmetric button padding) to be copy-pasted into Tailwind v4 `@theme` tokens, which eliminates ambiguity in implementation. The product brand colors are tied to HashiCorp's portfolio scope and would just be noise here. Inter is the closest free analog to HashiCorp Sans's geometric, kerned-tightly feel.
**Alternatives considered:**
- Adopt verbatim including HashiCorp Sans — rejected on licensing (proprietary brand font; no public license).
- Leave the existing `zinc-*` Tailwind defaults as-is — rejected; PO wants a deliberate brand voice, not Tailwind defaults.
- Pick a different `getdesign.md` template (Stripe / Linear / Vercel are also strong fits for fintech-adjacent SaaS) — rejected per PO's specific request.
**Reconsider if:** the brand voice needs to push warmer/more residential (real-estate buyers may resonate with softer surfaces than enterprise infra users), or if user research shows the dark hero panels reduce trust in the LATAM market specifically.
**Build implications:**
- Add `docs/DESIGN_REFERENCE.md` as the source of truth (done).
- Define a `@theme` block in `src/app/globals.css` mapping the HashiCorp tokens to Tailwind v4 CSS variables (`--color-surface`, `--color-surface-dark`, `--color-helper`, `--color-action`, `--radius-card`, `--shadow-whisper`, etc.). New components use the named tokens; existing `zinc-*` utilities migrate as components are touched (no big-bang refactor).
- Wire Inter via `next/font/google` in the root layout; remove any default-font fallbacks. Keep system-ui for body via the CSS stack.
- Add a `<DesignTokensTest>` page or Storybook-equivalent at `/design` (gated to dev) once the token block lands, so we can eyeball the palette without spinning up real screens.

---

## 2026-04-29 — Migration tooling: hand-written SQL files, applied by `drizzle-kit migrate`; Drizzle's TS schema is the runtime types source, not the migration source
**Decision:** Database migrations are **hand-written SQL files** under `src/db/migrations/`, applied via `pnpm db:migrate` (= `drizzle-kit migrate`). The Drizzle TS schema in `src/db/schema.ts` is maintained alongside as the **runtime types source** (used by Drizzle ORM queries from Workers and Server Actions), not as the canonical schema source. Schema and migrations are kept in sync manually; any drift is a PR review concern.
**Why:** The original recommendation in spec §3.3 ("Drizzle for migrations + TS types") was correct in spirit but glosses over a real friction: Drizzle generates clean DDL but its support for RLS policies, `SECURITY DEFINER` functions, custom CHECK constraints, advisory locks, and PostGIS specifics is awkward to non-existent. Hand-written SQL is honest about what's actually running against the database, which is critical when RLS is the *primary* tier-enforcement layer (per CLAUDE.md hard rule #2). The Drizzle types still provide their value (typed queries; compile-time validation of column names) without paying the indirection cost of generated migrations.
**Alternatives considered:** Drizzle-generated migrations with hand-edited SQL after generation (rejected — invites drift between what Drizzle thinks the schema is and what's actually deployed; encourages people to "just regenerate" and lose hand-edits). Supabase CLI migrations (`supabase migration new` / `supabase db push`) — viable; equivalent in practice. Going with `drizzle-kit migrate` because we already have Drizzle as a dep and the tool runs raw SQL files happily; one fewer CLI to learn. Reconsider if local-Supabase development becomes painful enough that adopting Supabase CLI's full workflow (local stack via `supabase start`) is worth the dep.

**Build implications:**
- `src/db/schema.ts` is the canonical TS schema. Drift detection: a CI step runs `drizzle-kit pull` against staging and fails if the introspected schema doesn't match `schema.ts` — added once the first migration runs.
- The `supabase-migration` skill's checklist updates to require: (1) write SQL migration; (2) update `schema.ts` to match; (3) write paired RLS test; (4) note any non-obvious choice in DECISIONS.md.
- Migration ordering is by filename (Drizzle journal handles application). Use `0001_init.sql`, `0002_xxx.sql` numbering.
- For the very first migration: extensions (`postgis`, `pg_trgm`, `uuid-ossp`, `citext`), all 5 core tables (`profiles`, `organizations`, `organization_members`, `plans`, `subscriptions`), RLS enable + initial public-read policies, fixture-user seeding for the RLS test harness.

---

## 2026-04-29 — Stripe trial period configured on the Price, not in Checkout
**Decision:** The 7-day trial for the AHO Agent monthly plan (and the founder-rate monthly) is configured at the **Stripe Price level** via `recurring.trial_period_days: 7`, not hard-coded in the checkout-session creation code. The annual price has no trial.
**Why:** Trial config on the Price is reusable, auditable in the Stripe dashboard, and survives code changes without re-touching every checkout path. Hard-coding `trial_period_days` into Checkout Session creation means: (a) different Stripe price IDs at different lifecycle stages all need the same trial logic kept in code; (b) marketing/billing changes (extending the trial, adding a no-trial corporate price) require code deploys instead of Stripe dashboard config; (c) future webhook handlers and admin tooling can read trial status from the Price without parsing the original checkout call's parameters.
**Alternatives considered:** Hard-code `trial_period_days` in the checkout-session creation (rejected for reasons above). No trial at all (rejected — spec §7.2 calls for 7-day trial on monthly Premium and Agent; PO confirmed).
**Reconsider if:** Stripe deprecates Price-level trials (unlikely) or we want different trial lengths per-customer cohort (would handle as a coupon or one-off Price, not by changing this default).

**Build implications:**
- `scripts/setup-stripe-products.ts` (idempotent setup script) sets `recurring.trial_period_days: 7` on `agent_monthly` and `agent_founder_monthly`. Annual gets no trial.
- Checkout-session creation code is trial-agnostic — it just selects the right Price ID and lets Stripe apply whatever trial is configured.
- Webhook handlers use `subscription.trial_end` to know when a subscription transitions from trial to billed.

---

## 2026-04-29 — `customer.subscription.updated` handler: fresh-fetch from Stripe (not event-diff)
**Decision:** The `customer.subscription.updated` handler treats the Stripe event purely as a trigger. Inside the handler, it calls `stripe.subscriptions.retrieve(subscription.id)` to fetch the current authoritative state, then writes that to our `subscriptions` row. The event payload's `data.object` is read only for the subscription ID; all field values come from the fresh fetch.
**Why:** Stripe's docs are explicit that webhook events are not delivered in order. `subscription.updated` fires multiple times per minute during a state cascade (e.g., trial-to-active transition, plan change with proration, dunning retries). Last-write-wins on the event payload corrupts state when an older event arrives after a newer one. Two defenses are commonly cited: (a) compare `event.created` timestamps and skip stale events; (b) fresh-fetch the subscription inside the handler. Stripe's own integration docs recommend (b) and it eliminates the ordering question entirely. Cost: one API call per event (~50–100ms; rate-limit headroom is large).
**Alternatives considered:** Event-diff with `event.created` timestamp guard (rejected — fragile under partial event loss; one missed event leaves us silently wrong). Trust event order (rejected — explicitly contradicted by Stripe docs). Fetch-only-on-conflict (rejected — adds a code path that almost never fires, undertested).
**Reconsider if:** Stripe rate limits become a real bottleneck (would surface as 429s; we'd revisit only then; current free-tier limits are far above our scale).

**Build implications:**
- All `customer.subscription.*` handlers use the fresh-fetch pattern: receive event, extract `subscription.id`, call `stripe.subscriptions.retrieve(id)`, write to DB.
- The same pattern applies to `invoice.paid` / `invoice.payment_failed` — fetch the invoice fresh.
- Per-event idempotency dedup (existing `markEventProcessed`) still applies; fresh-fetch is orthogonal — it solves ordering, dedup solves redelivery.

---

## 2026-04-29 — `invoice.paid` for fulfillment; `invoice.payment_succeeded` explicitly NOT handled
**Decision:** The webhook dispatcher handles `invoice.paid` for "subscription paid up, extend access through next period." It does NOT handle `invoice.payment_succeeded`; that event is silently ignored with an explicit comment in the dispatch table.
**Why:** Both `invoice.paid` and `invoice.payment_succeeded` fire for the same underlying transition, but at slightly different points in Stripe's pipeline. `invoice.paid` fires after the invoice is fully reconciled (the safer choice for subscription extension); `invoice.payment_succeeded` can fire before reconciliation completes. Stripe's docs document both as suitable for "use this for fulfillment" — that ambiguity is the trap. Picking one explicitly and rejecting the other in code prevents future-me from "completing the dispatch table" and accidentally double-extending the subscription period.
**Alternatives considered:** Handle both with a marker that the side effects only run once (rejected — adds state plus logic for what's effectively dedup we already have). Handle `payment_succeeded` only (rejected — fires before reconciliation; risk of acting on rolled-back charges).
**Reconsider if:** Stripe deprecates one of the two events. Until then, the picked-one + explicit-not-handled comment is the durable answer.

**Build implications:**
- `src/app/api/webhooks/stripe/route.ts` dispatch table has `'invoice.paid': handleInvoicePaid` AND a sibling comment line `// 'invoice.payment_succeeded' — intentionally not handled, see DECISIONS.md` so the omission is conspicuous.
- The handler refreshes the subscription via Stripe API (per fresh-fetch decision above) and writes the new `current_period_end`.

---

## 2026-04-29 — Founder-rate atomic claim: `UPDATE ... RETURNING` on a counter row, not advisory-locked check + increment
**Decision:** The "first 50 founder-rate grants" cap is enforced by an atomic SQL statement against a singleton counter row:
```sql
UPDATE public.founder_rate_counter
SET claimed = claimed + 1, updated_at = now()
WHERE id = 1 AND claimed < cap
RETURNING claimed;
```
Rows-affected = 1 means the slot was claimed; rows-affected = 0 means we're at cap. The webhook handler runs this inside the same transaction as the `founder_rate_grants` insert and the `subscriptions` row write — all-or-nothing.
**Why:** Earlier sketch was "advisory lock around `count(*) + insert`." Lock scope is the trap: if the lock wraps just the increment but not the check, two concurrent transactions both see count=49, both pass the check, both grant — one over cap. Wrapping both check and increment correctly works but is easy to scope wrong under pressure. The `UPDATE … RETURNING` pattern collapses check + increment into a single atomic statement at the row level — race-impossible by construction, no advisory lock needed.
**Alternatives considered:** `pg_advisory_xact_lock` around `count + insert` (rejected — correct but easier to scope wrong; harder to review). Postgres sequences with a max-value (rejected — sequences don't enforce a hard cap, only generate). Stripe-side enforcement via inventory/coupon limits (rejected — Stripe doesn't natively enforce "first N grandfathered" with lifetime locks).
**Reconsider if:** The counter row becomes a hot-write contention point (very unlikely at 50 lifetime grants and projected signup volume).

**Build implications:**
- `0008` migration adds a singleton `founder_rate_counter (id=1, claimed, cap=50)` row + a `claim_founder_rate_slot()` function returning `int` (slot claimed) or `null` (no slot).
- `founder_rate_grants` row insertion happens conditionally based on the function's return value.
- Release on pre-billing cancellation: a sibling `release_founder_rate_slot()` function decrements `claimed` (floor at 0) and sets `released_at` on the grant row.

---

## 2026-04-29 — Subscription-status priority ordering correction
**Decision:** The priority ordering in `recompute_org_current_subscription()` is corrected to:
```
active > trialing > past_due > canceled > suspended ≈ unpaid ≈ expired > incomplete > incomplete_expired
```
With Stripe's American spelling `canceled` (not the British `cancelled` originally in the schema). The CHECK constraint on `subscriptions.status` is widened to cover Stripe's full status set: `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`, plus our derived `suspended` (admin action) and `expired` (post-dunning).
**Why:**
- `incomplete` represents a subscription that was created but never paid — effectively non-existent. Original ordering had it 4th, ahead of `canceled`/`expired`/`suspended`; that's wrong because a canceled-but-still-in-period subscription has more "currentness" than one that never started. **Fix**: `incomplete` and `incomplete_expired` rank dead last.
- `unpaid` is Stripe's terminal state when retries have given up — equivalent to `expired` in our taxonomy. Original ordering omitted it entirely; that's a write-time CHECK violation when the webhook arrives. **Fix**: add to the CHECK and rank with `expired`/`suspended`.
- British `cancelled` vs Stripe's `canceled`: when the webhook delivers `subscription.status = 'canceled'`, the original CHECK constraint rejected the write. **Fix**: switch the schema to Stripe's spelling.
**Alternatives considered:** Translate at ingest (e.g., `status === 'canceled' ? 'cancelled' : status`) (rejected — adds a translation layer that has to be remembered everywhere; cleaner to match Stripe's vocabulary).
**Reconsider if:** Stripe introduces new statuses we haven't enumerated.

**Build implications:**
- `0008_subscription_status_fix.sql`: drops + re-adds the CHECK with the new status list; replaces `recompute_org_current_subscription` with the corrected priority CASE.
- Drizzle `SUBSCRIPTION_STATUSES` union updated to match.
- All future handler code uses `'canceled'` (Stripe spelling). Any leftover `'cancelled'` in pre-existing code is a bug.

---

## 2026-04-29 — Image-cap enforcement: trigger-counter pattern (not RLS subquery)
**Decision:** The 30-images-per-property cap is enforced by a denormalized `properties.image_count int` column with a `CHECK image_count >= 0 AND image_count <= 30` constraint, maintained by an AFTER INSERT/DELETE trigger on `property_images`. The route layer still returns a friendly `409 image_cap_reached` error before reaching the DB; the constraint is the backstop that catches a future code path that forgets the route check.
**Why:** Original 0006 left enforcement at the route layer only — the rationale was "no INSERT policy on `property_images` outside the standard org-member path." That's true but incomplete: an org member with direct DB access, or a future second route that forgets the cap, can still blow past 30 because the standard org-member path doesn't itself include a count. A `CHECK` on an RLS WITH CHECK clause that did `select count(*) from property_images where property_id = ...` would work but adds a 25-row subquery to every image insert, which gets expensive at any meaningful scale. The trigger-counter pattern sidesteps the subquery cost (constant-time UPDATE on the count column) and gives us a real DB-side backstop.
**Alternatives considered:** RLS WITH CHECK with the count subquery (rejected — performance). Pure-route enforcement with a comment in `0006` (rejected — see above). A view-based abstraction over `property_images` that does the count for queries (rejected — overkill for an integer).
**Reconsider if:** We discover a write path that legitimately needs to bypass the trigger (highly unusual — the trigger is `SECURITY DEFINER` and runs regardless of caller). Or if we move to an architecture where image rows live somewhere other than `property_images` (e.g., R2 lifecycle policies become the source of truth, not the DB).

**Build implications:**
- `0007_denormalizations_and_latlng.sql` adds the `image_count` column + trigger.
- The route in `src/app/api/properties/[id]/images/route.ts` now uses the denormalized count for its precondition check (faster than `select count(*)`); the trigger is the constraint.
- Tests added in a future turn covering the trigger directly: insert 30, assert 31st fails with `check_violation`; delete one, assert 31st succeeds.

---

## 2026-04-29 — Property lat/lng: trigger-maintained plain columns (not generated columns)
**Decision:** `properties.latitude` and `properties.longitude` are plain `double precision` columns kept in sync with the PostGIS `location` column by a `BEFORE INSERT OR UPDATE OF location` trigger. They are queryable directly via Supabase REST and used to populate the `geo: { '@type': 'GeoCoordinates' }` block in the property page's JSON-LD.
**Why:** Original plan (logged in PROGRESS.md "Properties migration shipped") was to use `STORED GENERATED` columns. PostgreSQL requires generated-column expressions to be IMMUTABLE — `ST_Y(location::geometry)` chains a cast through `ST_Y` and neither leg of the chain is marked IMMUTABLE in PostGIS. Postgres rejects with `generation expression is not immutable`. A trigger sidesteps the immutability requirement; runs on `BEFORE INSERT OR UPDATE OF location` only (not every UPDATE) so the cost is one function call per location change, near zero on read.
**Alternatives considered:** `STORED GENERATED` (rejected — doesn't work). A view that exposes the derived columns (rejected — clutters the query path; PostgREST select syntax through views adds complexity). RPC function returning the parsed property (rejected — adds a separate API surface that diverges from the standard `from('properties').select(...)`).
**Reconsider if:** PostGIS marks `ST_Y` and the geography→geometry cast IMMUTABLE in a future release (would simplify to generated columns). Or if performance profiling shows the trigger is a hot path (unlikely — it's a per-row constant-time computation).

**Build implications:**
- `0007_denormalizations_and_latlng.sql` adds the columns + trigger + indexes (`idx_properties_latitude`, `idx_properties_longitude`).
- The JSON-LD geo block in `src/lib/listings/seo.ts` can now be re-enabled (deferred from the original property-detail-page work).
- Map view (slice-1 weeks 6–7) uses these columns directly.

---

## 2026-04-29 — Entitlement shape: hybrid (subscriptions mirror + denormalized current_* on organizations)
**Decision:** Subscription state lives in two places, kept in sync by a trigger:
1. **`subscriptions` table** — full mirror of Stripe subscription state, source of truth for history, idempotent target for webhook side effects, RLS-gated for read access by org members. Already exists from `0003_billing.sql`.
2. **`organizations.current_subscription_id`, `current_plan_id`, `current_status`, `current_period_end`** — denormalized columns updated by a trigger on `subscriptions` INSERT/UPDATE/DELETE. Authz reads consult these columns directly without joining through `subscriptions`.
**Why:** The PO laid out three options (subscriptions-only / organizations-columns-only / live-from-Stripe) as either-or. Pure subscriptions adds a join cost on every authz check (page renders, API calls). Pure denorm columns lose history (can't replay dunning, can't audit downgrades). Live-from-Stripe puts the network on the hot path. The hybrid eliminates the join cost while preserving history; the cost is one trigger and four columns.
**Alternatives considered:** All three options the PO described. Plus: a materialized view over subscriptions joined to organizations (rejected — refresh semantics under high-write load are fiddly; trigger is more direct).
**Reconsider if:** We end up with multiple concurrent active subscriptions per org (legitimate, e.g., add-on subscriptions in v2 for extra featured-credits packs). The current trigger picks ONE "best" subscription per priority order (`active > trialing > past_due > incomplete > suspended > cancelled > expired`); v2 would need a per-feature entitlement model rather than a single `current_*` row.

**Build implications:**
- `0007_denormalizations_and_latlng.sql` adds the 4 columns + 2 SQL functions + 1 trigger.
- The `recompute_org_current_subscription(p_org_id)` SECURITY DEFINER function is the authoritative derivation logic; called from the trigger and (later) directly by webhook handlers when needed.
- Authz checks (e.g., "is this org allowed to publish a new listing?") read `organizations.current_status` instead of joining through `subscriptions`. Status set: active subscription = `current_status IN ('trialing','active','past_due')` within `current_period_end` grace.
- Drizzle schema in `src/db/schema.ts` exposes the new columns.

---

## 2026-04-29 — Live-mode Stripe objects created in error; archived; process gap closed
**Decision:** The Stripe Product + 3 Prices created in LIVE mode on 2026-04-29 (during the firing-order execution earlier this same day) were created in error and have been archived. All v1 development uses TEST mode going forward. Live-mode setup happens at launch, after a separate DECISIONS.md entry approves it with rollback plan and date.
**Why:** Original "Pricing locked" entry specified TEST mode first ("once created, product owner reviews price IDs, then we promote to LIVE mode with new price IDs"). When PO replied to a query about an `sk_live_` key in env with "keep live and nobody is going to pay - the website is far away from being shown to people", I read it as authorization to proceed in live mode. It wasn't — the PO meant retain the live key configuration but expected test-mode dev. Process gap: ambiguous "keep live" + presence of live key was treated as implicit consent for billable-resource creation. Now closed via CLAUDE.md hard rule #9 and a new guardrail in `scripts/setup-stripe-products.ts`.
**Alternatives considered:** Leave the live objects in place and skip test-mode entirely (rejected — it polluted the live Stripe account, blocked test-card iteration during checkout-flow development in week 3, and made unverified-business-profile artifacts visible). Delete the live objects (rejected — Stripe doesn't allow deleting prices that have been used; archive is the only durable disposal).
**Reconsider if:** Never. Re-creating these specific IDs is forbidden — they remain in archived state in the live Stripe account.

**Live mode objects archived in error on 2026-04-29 — DO NOT REUSE:**
- Product `prod_UQNAhtN4rTQm3Y` ("AHO Agent") — archived
- Price `price_1TRWQTHkr4MqMDqIi73Swonq` (agent_monthly, $29/mo) — archived
- Price `price_1TRWQTHkr4MqMDqICouAeiPe` (agent_annual, $290/yr) — archived
- Price `price_1TRWQUHkr4MqMDqIf2Y9P6jc` (agent_founder_monthly, $19/mo) — archived (was already archived by the original setup script's `archive: true` flag)

**Operational artifacts of the cleanup:**
- One-off archive script preserved at `scripts/stripe-archive-2026-04-29.ts` — refuses to run without `sk_live_` key. Not part of `pnpm` lifecycle. Retained as audit evidence; do not re-run.
- `scripts/setup-stripe-products.ts` now has a **LIVE-MODE GUARDRAIL** that aborts on `sk_live_` keys. Removing the guard requires a DECISIONS.md entry approving the specific live-mode operation.
- New CLAUDE.md hard rule #9: "Any operation that creates billable resources or live-mode payment infrastructure requires explicit confirmation in chat before execution. The presence of a live API key is not implicit consent."

**Next steps still required (await PO):**
- PO actually swap `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env.local` from `sk_live_*` / `pk_live_*` to `sk_test_*` / `pk_test_*` (per the same Stripe dashboard, with the "Test mode" toggle on, Developers → API keys).
- After swap: re-run `pnpm stripe:setup` (now guard-protected — would refuse if accidentally run with live key); audit test mode with `pnpm stripe:audit` (or via dashboard) and confirm zero pre-existing test products; capture new `price_test_*` IDs; PO reviews; PO updates the four `STRIPE_AGENT_*` env vars; re-run `pnpm db:seed` to update the `plans` rows with the new test price IDs.

---

## 2026-04-29 — Account ownership: product owner owns all third-party accounts; secrets reach Claude via `.env.local`
**Decision:** Every third-party service (Stripe, Cloudflare, Supabase, Resend, Sentry, PostHog, GitHub, OAuth apps for Meta/LinkedIn) is registered under the product owner's name and email, billed to the product owner. There is no separate human developer at this stage; **Claude Code is an AI agent running locally** on the product owner's machine. Credentials reach Claude via the gitignored `.env.local` in this repo, not via collaborator invitations or shared-vault membership. The product owner uses 1Password as their personal secrets store; `.env.local` is the working copy on the dev machine.
**Why:** Initial planning assumed a separate human developer who could be invited as a collaborator on each service. That mental model doesn't apply to Claude Code, which has no email or service identity. Trying to operate as if it did would deadlock on impossible steps (1Password invites, GitHub Maintainer accepts, Stripe team-member roles). The simpler model — PO owns everything, secrets land in `.env.local` — is faster, fewer moving parts, and matches how local-dev tooling actually works.
**Alternatives considered:** Bring on a human contractor and use the multi-collaborator model from day 1 (rejected for cost and pace reasons; this is a solo founder build with AI assistance). Use a service principal / machine identity per provider (rejected as overkill at this stage; revisit if/when CI deploys to production from GitHub Actions).
**Reconsider if:** Product owner brings on a human dev — at that point, the human gets invited as a collaborator on each service and added to 1Password; Claude continues reading from `.env.local` on its own machine.

**Build implications:**
- All "invite the dev" steps in the planning notes are scratched.
- Secrets handoff mechanism is **paste into `.env.local`** for each provisioned service.
- 1Password remains the product owner's master copy, sound practice but not in Claude's loop.
- GitHub repo: product owner is the sole owner; PR reviews happen as the PO approving Claude's PRs against `main`. No second-pair-of-eyes constraint at this stage; the safety budget comes from the test suite + RLS enforcement + CI gates, not from human review of every PR.

---

## 2026-04-29 — Supabase region: US East (overrides CRITIQUE recommendation of EU)
**Decision:** The Supabase project for AHO is provisioned in **US East (Northern Virginia / `us-east-1`)**.
**Why:** Anchor launch market is Santo Domingo, DR. US East gives DR users ~30–50 ms round-trip; EU gives them ~120–150 ms. Latency on the property-detail render and listing-form save is a direct UX cost at every page load. EU was originally recommended for GDPR + future EU customer fit, but AHO has no EU customers at launch and Supabase supports cross-region read replicas if/when EU expansion happens. Pay the regional-migration cost later, against revenue, not now against vapor.
**Alternatives considered:** EU (`eu-west-1`) per CRITIQUE §B/F — rejected for the latency reason above. South America (`sa-east-1`, São Paulo) — closer to DR than US East, but Supabase regional pricing and feature parity are weaker; US East is the safer choice.
**Reconsider if:** EU customer count (paying agents and/or buyers) crosses ~20% of total. At that point, evaluate either migrating the primary region or adding an EU read replica.

**Build implications:**
- All Supabase API calls go to the US East region; Cloudflare Workers running globally hit a US East database. Hot path: anonymous property reads should bypass user-context RLS via `SECURITY DEFINER` functions exposing only `status='active' AND published_at IS NOT NULL` rows (per CRITIQUE §B12) and aggressive edge-cache for SEO traffic, to keep cross-region cost bounded.
- DR-region buyers are the majority of read traffic and benefit; US-region buyers (future) are unaffected; EU-region buyers (future) take the latency hit until we add a replica or migrate.
- GDPR posture: still defensible (data resides in a SOC2-compliant region; sub-processor list discloses; DPA available). Get explicit lawyer review before claiming EU-readiness in marketing.

---

## 2026-04-29 — Founder-rate pricing is application-gated, not Stripe-gated
**Decision:** The "$19/mo for first 50 agents, locked for life" founder rate is enforced by **application code**, not by a Stripe-side limit (Stripe doesn't natively enforce "first N customers"). Mechanism: a `founder_rate_grants` table (or KV counter for atomic check) tracks how many founder-rate subscriptions are currently active. The Stripe Checkout creation endpoint runs a guarded counter increment and selects the founder price ID *only if* the counter is below 50 *and* the user signed up within the 60-day promotional window; otherwise it selects the standard monthly price ID. The price IDs themselves both exist in Stripe; the choice is ours.
**Why:** Stripe Promotional Codes can give a percentage discount for a duration but don't natively enforce "first N customers" with a permanent grandfathered price. Building this in application code is straightforward (an atomic counter + a check), gives us full control over edge cases (refunds, cancellations within trial), and keeps the standard / founder prices as separately reportable line items in MRR analytics.
**Alternatives considered:** Stripe Coupons with redemption limits (rejected — coupons typically apply for a fixed duration like "first 3 months 30% off," not lifetime; building lifetime via a coupon is hacky). One product with two prices and a manual coupon (rejected for the same reason). Pre-mint 50 unique promo codes and distribute (rejected — operational pain, friction in onboarding).
**Reconsider if:** Stripe ships native "first N grandfathered" support — unlikely.

**Build implications:**
- Schema: add `founder_rate_grants(subscription_id pk, granted_at, agent_email, original_price_id)` table OR a single integer counter in Cloudflare KV (`founder_rate_active_count`). Counter is faster but DB row gives auditability — recommend the table with a partial unique index.
- Edge case: if a founder-rate subscription is **cancelled before billing**, the slot returns to the pool. If cancelled after at least one successful billing cycle, the slot is gone (50 founders means 50 unique grants, not 50 active at any time). Document this so users aren't gaming the cancel-and-rejoin loop.
- 60-day promo window starts at public launch (not at any earlier date). Window end timestamp lives in env (`AHO_FOUNDER_RATE_WINDOW_END`).
- The founder rate is **archived in Stripe** (not on `/pricing`). Application code is the only path that can select that price ID for a checkout session.

---

## 2026-04-29 — v1 scope locked (cut deeper than the engineering critique recommended)
**Decision:** v1 ships with **Free + Registered + Agent only**. Social = **Facebook + Instagram + WhatsApp** only. **No Premium, no Agency, no Expert, no AI features, no auto-blog.** Premium and Agency move to v1.1; Expert moves to v2. LinkedIn integration is v1.1 but the Meta and LinkedIn app reviews are submitted in week 1 anyway because approvals take weeks.
**Why:** Product owner directive after reviewing `docs/CRITIQUE.md`. The reasoning: Zillow took 12 years and ~$2B to become Zillow; AHO competes by being better than incumbents at one specific thing in one specific market, then expanding. Slice 1 already delivers everything that's actually new for LATAM real estate (modern stack, mobile-first, one-click FB+IG share, WhatsApp first-class, clean bilingual SEO). Adding more features doesn't make the platform "newer" — it just delays revenue. Path B (cut + ship in 10 weeks) wins on every dimension over Path A (full scope, 12+ months pre-revenue).
**Alternatives considered:** Engineering critique recommended Free + Registered + Agent + light-Agency. Product owner cut Agency too — accepted as safer for the 10-week timebox. Holding full scope was rejected for the dev-cost-vs-revenue reason above.
**Reconsider if:** Slice 1 ships and the first 5–10 paying agents pull strongly toward a specific deferred feature (most likely Agency-tier seats once an agent's brokerage wants in). Promote v1.1 features one at a time based on what paying users actually pay for, not what the spec describes.

**Build implications:**
- Spec content for Premium, Agency, Expert, AI, auto-blog stays in `docs/HANDOFF*.md` — labeled as "v1.1+" or "v2" in the new scope section at the top of HANDOFF.md, not deleted.
- Listing CRUD, contact-info reveal, social posting, lead routing, CRM, AI tooling — all read v1's scope from the matrix below before shipping. Anything outside v1 must be feature-flagged off and not exposed in UX.
- Tier matrix in spec §6.1 still reflects the eventual six-tier system; the database schema supports it; only Free + Registered + Agent are *enabled* and *visible* in v1.

**v1 capability matrix (what ships):**

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
| Manual share fallback (pre-rendered text + image, opens platform composer) | ❌ | ❌ | ✅ (until app review approves) |
| Agent profile + listings page | ❌ | ❌ | ✅ |
| Performance analytics (basic: views, saves, contacts) | ❌ | ❌ | ✅ |
| Stripe checkout + customer portal | ❌ | ❌ | ✅ |

Everything not in this table is v1.1+ or v2 and must be feature-flagged off.

---

## 2026-04-29 — Pricing locked for v1 Agent tier
**Decision:** Agent tier ships at **$29/month** or **$290/year** (~17% annual discount). **First 50 agents** locked at **$19/month for life** as a founder rate, conditional on signup within 60 days of public launch. Currency: USD. DOP / multi-currency display is a v1.1 concern; LATAM customers pay in USD via card with their bank's FX in v1.
**Why:** Product owner decision after market research. Zillow's $300–$1,000+/mo Premier Agent is the wrong benchmark — Zillow charges for *lead generation*, not for listing rights, so it sells a different thing. AHO's actual peers are Idealista, Inmuebles24, ZonaProp, MercadoLibre Inmuebles, which charge $30–$150/mo for listing rights. $29/mo sits below the LATAM peer floor — easy yes for an agent (one extra closing/year covers ~30 years of subscription) and easy to grow up from. Founder rate locks early adopters who'll be the case studies.
**Alternatives considered:** Higher prices anchored against Zillow (rejected — wrong category, wrong market). Free tier with paid promoted listings (rejected for v1 — adds product surface; revisit in v1.5). Per-listing pay-as-you-go (rejected — kills monthly-recurring-revenue predictability that funds the next phases).
**Reconsider if:** Conversion from beta-user to paid is below 30% — pricing may be too high for the value delivered, OR the value isn't yet there. Conversion above 70% suggests room to raise the standard rate (don't touch founder rate).

**Stripe configuration to create (TEST mode first; LIVE after PO review):**
- Product: `aho_agent` (display name: "AHO Agent")
- Price: `aho_agent_monthly_usd_29` — $29.00 USD recurring monthly
- Price: `aho_agent_annual_usd_290` — $290.00 USD recurring annually
- Price: `aho_agent_founder_monthly_usd_19` — $19.00 USD recurring monthly, **archived** (only assignable via coupon or admin action; not on `/pricing`)
- Trial: 7-day free trial on the standard monthly price (per spec §7.2)
- Tax: Stripe Tax in `automatic-no-collection` mode for v1 (per CRITIQUE §B9 — register jurisdictions only as revenue justifies)

Once created, product owner reviews price IDs, then we promote to LIVE mode with new price IDs. Both sets get stored in `public.plans` via env vars.

---

## 2026-04-29 — Anchor launch market: Santo Domingo, Dominican Republic
**Decision:** AHO launches publicly with **Santo Domingo as the anchor market**. Brand messaging, homepage hero, default search location, and beta-agent outreach all lead with Santo Domingo / DR. Product owner handles in-market agent outreach personally for the beta cohort (5–10 agents in months 8–10 of slice 1's tail).
**Why:** Per `docs/CRITIQUE.md` §B1 — the empty-platform problem is real for any single launch market and worse for worldwide. Anchoring narrows the cold-start problem to one geography where the product owner has on-the-ground access to acquire supply. The codebase stays worldwide-capable (no architectural narrowing); only the marketing and seed acquisition narrow.
**Alternatives considered:** Worldwide launch (rejected — covered in CRITIQUE). Multi-city LATAM launch (rejected — multiplies acquisition work without commensurate code complexity reduction).
**Reconsider if:** Santo Domingo agent acquisition stalls below 5 paying agents by month 4 post-launch — pivot to a second market. Or a strong organic signal from another city (DR or LATAM) emerges in analytics — extend marketing there.

---

## 2026-04-29 — Drop the no-language-fallback rule for listings
**Decision:** Listings may exist in **a single language** (EN or ES) in v1. Each listing is tagged with its source language. When a user requests the locale that's missing, the page renders the available-language version under a "Translation pending" banner. Agents get a one-click **Auto-translate** button that runs an AI translation, opens an editor pre-filled with the result, and saves only on the agent's confirmation.
**Why:** Per `docs/CRITIQUE.md` §B3 — the original no-fallback rule (HANDOFF §11.3 / §15.2) creates real friction for monolingual agents and produces two bad outcomes (low publish rate, or low-quality auto-translated content that hurts SEO). Allowing single-language listings, marked honestly, lets agents publish in their native language without compromising quality.
**Alternatives considered:** Keep no-fallback (rejected — friction). Auto-translate without agent review (rejected — SEO and quality risk). Force EN+ES at publish time with AI fill-in (rejected — user wouldn't be able to edit a language they don't read; this is the worst of both options).
**Reconsider if:** SEO data shows the single-language listings are out-ranked consistently by competitors with both. Low likelihood given honest "Translation pending" UX.

**Build implications:**
- Database `properties.title_es`, `description_es`, `slug_es` already nullable — no schema change.
- RLS policies for the public-readable path must allow rows where the requested-locale fields are null; the page renders the source-language with the "Translation pending" notice.
- `hreflang` strategy unchanged for listings that have both languages; for single-language, only that locale gets a `hreflang` tag (don't lie to Google about a translation that doesn't exist).
- Auto-translate button is an Anthropic API call (Claude); cost-managed via the same per-org budget pattern as future Expert AI features (capped attempts/day).

---

## 2026-04-29 — Submit Meta + LinkedIn app reviews in slice-1 week 1
**Decision:** Both Meta (Facebook + Instagram) and LinkedIn app review submissions go out in week 1 of slice 1, even though LinkedIn integration is v1.1 work. Placeholder Privacy Policy and Terms of Service pages live at `https://advertisehomes.online/privacy` and `/terms` (real content from the lawyer drops in before public launch).
**Why:** Per `docs/CRITIQUE.md` §B2 — review timelines are 4–8+ weeks. Submitting on week 1 puts approval in flight while the build runs in parallel; submitting later means launching without the flagship Agent feature (one-click social share). Submitting LinkedIn now (even though we don't ship it until v1.1) banks the approval against future need at zero ongoing cost.
**Alternatives considered:** Submit only Meta in week 1 and LinkedIn later (rejected — same engineering cost, more delay). Wait for real lawyer ToS/Privacy (rejected — placeholder pages that load and look real are sufficient for review submission per Meta's documented requirements).
**Reconsider if:** Meta or LinkedIn changes their review process meaningfully before submission. Verify current requirements at submission time.

**Build implications:**
- Week-1 deliverable: `/privacy` and `/terms` pages live at canonical domain with placeholder copy that's structurally complete (sections headers, "this page will be updated by [date]" disclaimer, contact info). Real lawyer text replaces the body before public launch.
- Meta App: business-verified, Live mode, scopes `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`. Privacy Policy + Data Deletion + Terms URLs all on `advertisehomes.online`.
- LinkedIn App: Marketing Developer Platform partner application. `Share on LinkedIn` + organization-page scopes.
- Meta and LinkedIn submissions are **product owner's responsibility** to file (PO owns the developer accounts); dev provides the screencast of the publish flow against staging once that flow exists.

---

## 2026-04-29 — Slice 1 timeboxed at 10 weeks; over-runs require explicit re-scoping
**Decision:** Slice 1 (per `docs/CRITIQUE.md` §F) is timeboxed at **10 weeks from week 1 start**. Over-runs do **not** silently extend; they require an explicit re-scoping conversation with the product owner where features are cut from the slice rather than the timeline being slipped.
**Why:** Per `docs/CRITIQUE.md` §E — solo-dev estimate for slice 1 is 8–10 weeks at medium-high confidence. Holding the timebox forces the discipline of cutting scope (not quality) when reality bites. Silent extension is the failure mode that turns a 10-week slice into a 6-month one. PROGRESS.md updated weekly, every Friday end-of-day, surfaces drift early.
**Alternatives considered:** Open-ended timeline (rejected — the whole point of cutting v1 was speed-to-revenue). Tighter timebox (rejected — 8 weeks is the floor of my estimate, not a target).
**Reconsider if:** Within slice 1, an unexpected dependency (Stripe Tax in DR, Meta review rejection, Supabase regional issue) consumes a week and the remaining work is mechanical — case-by-case extension may be cheaper than re-scoping. Default position: re-scope.

---

## 2026-04-29 — Spec scope-marker strategy: top-of-document v1 banner, no inline annotations
**Decision:** v1 scope is documented in a single dedicated section at the top of `docs/HANDOFF.md` (right after §1.6 Success Criteria). Deferred sections inside the spec body (Premium, Agency, Expert, AI, auto-blog) are **not** annotated inline because the spec narrative is already tied together — banner-marking each one breaks readability without adding clarity.
**Why:** Product owner directive was to "archive deferred sections under a clearly labeled v1.1+ appendix rather than deleting them." A top-of-document scope summary that explicitly lists what's IN and what's OUT (with section refs) fulfills that directive while keeping the spec narrative intact. The matrix at the top is canonical; section bodies are reference material.
**Alternatives considered:** Inline `[v1.1+]` banners on every deferred section (rejected — a lot of touch-points across two files; readers stop noticing repeated banners; the spec becomes a maze). Move deferred content to a separate `HANDOFF_v1.1.md` file (rejected — splits the spec's coherence; defers cause cross-references to break).
**Reconsider if:** A future contributor unfamiliar with the spec history misreads scope by reading section bodies in isolation. Add inline banners to specific sections then.

---

## 2026-04-29 — Canonical domain is `advertisehomes.online`
**Decision:** `advertisehomes.online` is the canonical AHO domain. `advertisehomesonline.com` is to be acquired defensively and 301-redirected to `advertisehomes.online`. All public URLs, emails (`mail.advertisehomes.online`, `tx.advertisehomes.online`, `inbound.advertisehomes.online`), staging (`staging.advertisehomes.online`), agency subdomains (`{slug}.advertisehomes.online`), and OAuth Privacy/Data Deletion URLs submitted to Meta and LinkedIn use the `.online` form.
**Why:** Product owner confirmed in writing on 2026-04-29 ("yes" to the question of whether `advertisehomes.online` is canonical). The original kickoff message used `.com` but a later message — "the domain will be advertisehomes.online" — and the part-2 patch instructions ("Park it [the .com] and 301 to .online") both pointed at `.online` as canonical.
**Alternatives considered:** `.com` as canonical (rejected — product owner directive). Using both equally (rejected — splits SEO authority and confuses social-platform app reviews; the canonical/redirect pattern is the standard fix).
**Reconsider if:** Never. This is a brand decision and changing it post-launch is a significant SEO + email-deliverability cost.

**Build implications:**
- All Stripe metadata, Cloudflare zone records, and OAuth app submissions (Meta, LinkedIn, future X/TikTok) must use `advertisehomes.online`.
- Email warm-up starts on `mail.advertisehomes.online` (transactional split into `tx.` per spec §20.4); do not warm `.com` subdomains — the `.com` zone only needs an apex 301 once acquired.
- A few code-block examples inside `docs/HANDOFF_part2.md` (§15.3 hreflang, §16.7 robots.txt, §25.1 environments table, §26.4 status page) still show `advertisehomesonline.com` because they're verbatim spec text. The spec is annotated inline pointing at this DECISIONS entry; future PRs should normalize the spec text when those sections are touched, not in a sweep.

---

## 2026-04-29 — Real-only data; no demo content, no stock photography
**Decision:** AHO operates with only real listings, real photos, and real agents in any environment a user can reach. No seeded demo listings or agents in staging or production. No stock photography (Unsplash, Pexels, etc.) in property image slots or the marketing site. Empty states are shown as honest emptiness ("no listings yet"), never filled with mock data. Test fixtures are permitted under `tests/` and in ephemeral local dev databases only — they must not be reachable from any deployed environment.
**Why:** Product owner directive ("real project, no fake adverts, no stock photos"). For a real estate marketplace, trust is the whole product — fake listings or stock photography in property slots are the canonical signals of a scam site, and once detected the damage is irreversible across the entire domain.
**Alternatives considered:** Seed a few "example" listings to show the platform's capabilities pre-launch (rejected — visitors will judge by what they see; an obviously empty real platform reads more honest than an obviously seeded fake one). Use stock photography for marketing pages only and real photos for listings (rejected — the inconsistency itself signals deception, and stock-photo "agents" are easy to reverse-search).
**Reconsider if:** Never. This is a project-defining principle, not an engineering tradeoff.

**How this affects the build:**
- No `seed-prod.sql`, no "demo data" toggle, no synthetic agents.
- Acceptance criteria (HANDOFF_part2.md §29) augmented: "every environment users can reach contains only real, owner-submitted content."
- Local dev seed scripts are explicitly local-only; CI must not run them against any deployed DB.
- Listing form validation rejects placeholder-looking content (title equals "Test", description is Lorem Ipsum, single stock-photo image set).
- Marketing site (homepage, blog, /pricing, footer features) shows real listings or omits the slot.

---

## 2026-04-29 — Stack baseline per HANDOFF.md §3
**Decision:** Next.js 15 (App Router, RSC) on Cloudflare Pages + Supabase (Auth + Postgres + PostGIS + RLS) + Stripe (Checkout, Billing, Tax) + Cloudflare R2 / Images / Queues + Resend for transactional email.
**Why:** Matches the spec; aligns with the edge-first SEO requirement; RLS gives a strong tier-enforcement primitive; Cloudflare ecosystem keeps egress costs low and unifies edge logic with storage and queues.
**Alternatives considered:** Vercel + Neon + Clerk (more managed, higher cost, less RLS-native). Plain AWS (more flexibility, much more ops burden). Both rejected for this stage.
**Reconsider if:** A concrete blocker emerges — e.g., Cloudflare Pages limits incompatible with the social-fan-out latency budget, or Supabase RLS performance becomes a hot path bottleneck.

## 2026-04-29 — Drizzle for ORM and migrations
**Decision:** Drizzle (per spec §3.3 recommendation), with migration files in `supabase/migrations/`.
**Why:** Edge-runtime friendly, less magic than Prisma, TypeScript-first, plays well with Supabase.
**Alternatives considered:** Prisma (heavier runtime; edge support uneven). Raw SQL + supabase CLI (least magic, but loses TS type generation).
**Reconsider if:** Drizzle's migration tooling or RLS authoring ergonomics prove limiting at scale.

## 2026-04-29 — Hold on application code until critique is reviewed
**Decision:** No application code until `HANDOFF_part2.md` is received, the critique is written, and a build slice is approved.
**Why:** The spec was AI-drafted and explicitly flagged for senior review. Cheaper to argue on paper than in code. Avoids rework if the critique surfaces a load-bearing issue.
**Alternatives considered:** Start scaffolding the Next.js app and Supabase project in parallel. Rejected — even small scaffolding choices (locale routing, auth client setup) are downstream of the critique.
**Reconsider if:** Product owner explicitly green-lights starting before the critique lands.
