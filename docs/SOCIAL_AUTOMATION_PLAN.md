# Social Automation — the $99 Pro Automation feature

> **Why this doc exists.** Social automation is the *only* differentiator of the $99 Pro Automation plan (per `docs/social media shering on 99$ plan.rtf` — lower tiers see the locked module, higher revenue depends entirely on this feature working). It is the marquee value of AHO's strategic vision (`aho_strategic_vision.md` — "paste a link → full multi-channel campaign"). The bar is **100% functional from the moment the first paying agent clicks "Connect Facebook"**. This doc captures what's already built, every problem we've hit before, what "100% functional" means in acceptance-criteria terms, and the phased plan to get there.
>
> Last updated: 2026-05-12 · Owner: dev (with PO action items called out explicitly).

---

## 1. What "100% functional" means

Hard acceptance bar before this is offered to any paying $99 agent:

1. **A first-time agent on Pro Automation can connect Facebook in ≤ 60 seconds** via the production OAuth dialog — *not* via the manual-token-import script. No 502 from Meta. No "you're not a tester" wall. No silent failure modes.
2. **A connected agent can click "Share to my socials" on a published listing and receive a deterministic per-platform result inside 5 seconds:** ✓ Posted (with a clickable external URL) or ✗ Failed: `<human-readable reason>`. Never a hung spinner. Never a generic "something went wrong".
3. **Posting actually lands on Facebook** (and Instagram Business if linked) with an AHO permalink in the post body — *not* a swallowed 200 OK that didn't reach Meta. Verified by fetching `https://graph.facebook.com/v21.0/{post_id}` and confirming it exists.
4. **Token expiry doesn't silently break the feature.** Meta long-lived user tokens last ~60 days; FB Page tokens are non-expiring once derived. We must (a) detect token-expired errors at publish time and surface them as "Reconnect Facebook" UX, and (b) have a daily cron that refreshes user tokens approaching expiry.
5. **Lower-tier agents see the upsell, never a 5xx.** Every entry point gate-checks `org.current_plan_id === 'pro_automation'` and returns 403 with a clear errorCode — *frontend never decides what a user can do* (CLAUDE.md hard rule #4).
6. **An admin can audit which agent posted what, when, and the outcome.** `social_posts` + `social_post_attempts` rows persist forever; no UI deletion path.
7. **A retry doesn't double-post.** Posts are idempotent on `(social_post_id, external_account_id)` so a "Retry failed" click after a transient 502 doesn't create two Facebook posts.
8. **The whole feature is RLS-gated end-to-end.** No service-role bypass on user reads of their own post history. Paired RLS tests per CLAUDE.md hard rule #2.

If any of these eight is "best-effort" instead of "guaranteed", we don't ship to a paying agent. The $99/mo expectation gap between "I clicked the button" and "my listing is on Facebook now" is unforgiving.

---

## 2. Current state — 2026-05-13 (Phases A-F + J + K shipped today)

### What's built and working end-to-end

| Surface | Status | Where |
|---|---|---|
| `ad_platform_tokens` — encrypted user/page/IG tokens, 5-platform check, RLS + decrypt RPCs | ✅ Live | migration 0036 |
| Meta OAuth (start + callback) — Login-for-Business, encrypted upsert of FB pages + linked IG | ✅ Live | [src/app/api/oauth/meta/*](src/app/api/oauth/meta) |
| Connect UI on `/dashboard/social` — Connect button + accounts list | ✅ Live | [src/components/social/connect-meta-section.tsx](src/components/social/connect-meta-section.tsx) |
| `social_posts` + `social_post_attempts` — audit + idempotency tables (Phase B) | ✅ Live | migration 0052 |
| `social_post_attempts.used_override` — Phase J audit column | ✅ Live | migration 0053 |
| Post formatter (FB / IG / LinkedIn, pure, deterministic) — Phase C | ✅ Live | [src/lib/social/post-formatter.ts](src/lib/social/post-formatter.ts) |
| Picker helpers — Phase J part 2 (override-aware) | ✅ Live | same file |
| Meta publish primitives (FB Page + IG single + IG carousel 3-step) — Phase D + K | ✅ Live | [src/lib/social/publish.ts](src/lib/social/publish.ts) |
| LinkedIn publish stub — Phase D | ⚠️ Returns `oauth_not_implemented` until partner approval | same file |
| `PublishErrorCode` taxonomy + `buildSupportRef` — error UX | ✅ Live | same file |
| `/api/social/post` real handler — Phase E + Phase J overrides | ✅ Live | [src/app/api/social/post/route.ts](src/app/api/social/post/route.ts) |
| AI drafter lib + `/api/social/ai-draft` route — Phase J part 1 | ✅ Live | [src/lib/social/ai-drafter.ts](src/lib/social/ai-drafter.ts), [src/app/api/social/ai-draft/route.ts](src/app/api/social/ai-draft/route.ts) |
| `<ShareToSocials>` UI: connected-accounts pre-flight + Generate AI draft + edit + Share + per-attempt result panel + supportRef Copy + Email-support — Phase F + J part 3 | ✅ Live | [src/components/listings/share-to-socials.tsx](src/components/listings/share-to-socials.tsx) |
| Custom domain `advertisehomes.online` | ✅ Live | DNS + Cloudflare Pages (PO confirmed 2026-05-13) |

### What's broken / missing

| Gap | Impact | Note |
|---|---|---|
| Connection-test endpoint (skill step #8) | Agent can't pre-flight token validity without trying to post | Phase G — dev work, deferrable until App Review |
| Token-refresh cron (skill step #10) | User tokens silently expire at 60d | Phase G |
| `ANTHROPIC_API_KEY` in Cloudflare Pages Production env | Without it, AI draft returns `no_api_key` and UI silently falls back to template | PO action — quick env-var add |
| Cloudflare Pages prod env `NEXT_PUBLIC_SITE_URL` confirmation | Deployed sitemap/canonical/OG could still emit `.pages.dev` until verified | PO action — open prod, view-source, check `<link rel="canonical">` |

### External blockers (NOT under our control)

| Blocker | Status | Workaround | Real fix |
|---|---|---|---|
| **Meta OAuth dialog returns 502** ("Sorry, something went wrong") for the PO's Configuration | OPEN since 2026-05-07 | `scripts/import-meta-token.ts` to manually encrypt-upsert a Graph-API-Explorer token | Deep-debug App Mode + App Roles + Configuration redirect URI in the Meta dashboard. PO action |
| **Meta App Review pending** (no `pages_manage_posts` / `instagram_content_publish` for non-tester users) | Submission package never went out (Day 3 of EXECUTION_PLAN deferred 2026-05-07) | Only Page admins added as App Testers can OAuth and publish in dev mode | Submit App Review package (Privacy + Terms URLs + screencast + business justification). PO + dev action |
| **App Mode = Development** | Same | Tester-only access | App Mode → Live (requires App Review approved) |
| **No LinkedIn OAuth yet** | OPEN | Manual share template existed in OLD method (being removed) | LinkedIn Marketing Developer Platform partner approval (weeks). Defer to v1.1 per `DECISIONS.md` 2026-04-29 |

---

## 3. History — every problem this feature has hit

Documented so we don't repeat them. Sources: PROGRESS.md (search `social|meta|copywriter|oauth|publish`), DECISIONS.md, CRITIQUE.md.

### P1. 2026-05-07 — Meta OAuth dialog 502s (UNRESOLVED)
PO created Login-for-Business Configuration `27924900597099409`. We updated `buildAuthUrl` to use `config_id=` (per the platform's v18+ migration away from `scope=`). The dialog still returns "Sorry, something went wrong" mid-flow. Suspected cause: App Mode = Development + App Roles not configured for the PO's FB account + Configuration redirect URI mismatch.
**Status:** PO action item (Meta dashboard work). Until resolved, only manual-token-import gets tokens into the DB. Day-3 of the original execution plan (Meta App Review submission) is parked behind this.

### P2. 2026-05-07 — OAuth scope= → config_id= migration
Meta switched to "Login for Business" Configurations: instead of passing `scope=...` in the URL, you reference a Configuration created in the Meta dashboard that bundles permissions + login variant + asset access. We migrated `buildAuthUrl` in commit `9c6c829`. This is now the *correct* shape; the 502 (P1) is a separate issue downstream of this.

### P3. 2026-05-07 — Pivot from OAuth to AI Copywriter
When the OAuth dialog blocked, the Day-3 plan pivoted from "ship the social-publish flow" to "ship the AI Copywriter caption generator". This was a tactical workaround that delivered immediate value but created the dual-track surface this doc is partly about: the agent could *generate* posts but had to *manually paste* them. That dual track is what we're now collapsing into one button.

### P4. 2026-05-01 — Phase 3 "manual share" stopgap was always meant to die
Per the PROGRESS entry 2026-05-01 "the marquee feature degraded into a copy-paste stopgap." [src/lib/social/share-templates.ts](src/lib/social/share-templates.ts) + [src/components/listings/manual-share-module.tsx](src/components/listings/manual-share-module.tsx) shipped explicitly as a bridge until Phase 4+ OAuth + auto-posting comes online. That bridge has been load-bearing for ~2 weeks because Phase 4 never landed. **The PO directive 2026-05-12 (this doc) is: bridge demolition + Phase 4 build, together.**

### P5. CRITIQUE §B5 — master-key compromise = total social-account compromise
Today every encrypted token in `ad_platform_tokens` is encrypted with the same symmetric key (`AHO_TOKEN_ENCRYPTION_KEY` in the Worker env). Compromise of that one secret decrypts every social token for every org on every platform. The skill spec accepts this for v1 ("never roll new crypto for a new platform" → use the existing key-management module) but flags per-org key derivation as the v1.5+ uplift. Logged here so it doesn't get lost.

### P6. CRITIQUE §A — `social_accounts` index spec drift
The spec called for a unique index on `(org_id, platform, external_account_id)` in `social_accounts`. We ended up with `ad_platform_tokens` instead, keyed on `(user_id, platform, external_account_id)` (per-USER not per-ORG). For agents-with-one-org this is identical. For agency owners with multiple sub-accounts, this is a divergence worth documenting in `HANDOFF.md` §10 alongside the implementation.

### P7. CRITIQUE §B2 — App-review serial dependency on the value prop (STILL OPEN)
Agent tier's flagship feature is one-click social posting; Meta and LinkedIn reviews take 4-8 weeks. Submitting App Review in week 1 of slice 1 was the documented mitigation (DECISIONS.md 2026-04-29). **Submission never went out.** Today this is the single biggest external blocker — every other piece of the build can ship, but a $99 agent who isn't an App Tester will hit the dev-mode wall on Connect.

### P8. 2026-04-29 — Stripe live-mode process gap (analogy, not the same feature)
Ambiguous "keep live" guidance was read as authorization to create live Stripe products. CLAUDE.md hard rule #9 was added. **Direct application here:** the FB pages the PO manually-imported tokens for are real PO-owned pages. The moment `/api/social/post` works, an accidental run against `propertyId=...` will publish a real post on a real page. We need an environment-level "this is a dry run" toggle, and the production cut-over needs an explicit DECISIONS.md entry. Same posture as Stripe live promotion.

### P9. Phase 4-7 shells deliberately return 501
[src/app/api/social/post/route.ts](src/app/api/social/post/route.ts), [.../connect/[platform]/start/route.ts](src/app/api/social/connect/[platform]/start/route.ts), [.../connect/[platform]/disconnect/route.ts](src/app/api/social/connect/[platform]/disconnect/route.ts) — per the PROGRESS entry shipping the locked module: "The current shells deliberately 501 so a Pro Automation customer signing up today gets a clean 'rolling out soon' UX rather than a feature stub that misbehaves." This was correct at the time. **It is now blocking revenue.** A $99 customer hitting 501 today gets exactly the wrong message.

### P10. No social_posts table — we have metrics, not events
`listing_post_metrics` (migration 0038) is for *snapshots of cumulative engagement* (reach, impressions, clicks, leads), populated by future crons. It is **not** an audit table of "agent X clicked Publish at T, fan-out succeeded on FB Page Y, failed on IG Z with reason W". That gap is what `social_posts` + `social_post_attempts` (Phase B below) fills.

---

## 4. The phased plan

Eight phases. A-F are dev work; G + H are PO-blocked.

### Phase A — Surgical removal of the OLD compose-then-copy flow (1 day)
Demolish the bridge so the new path has somewhere to land. Files deleted:

- [src/components/listings/manual-share-module.tsx](src/components/listings/manual-share-module.tsx)
- [src/components/dashboard/social-grid.tsx](src/components/dashboard/social-grid.tsx)
- [src/components/dashboard/copywriter-playground.tsx](src/components/dashboard/copywriter-playground.tsx)
- [src/app/[locale]/dashboard/copywriter/page.tsx](src/app/[locale]/dashboard/copywriter/page.tsx)
- [src/app/api/ai/copywriter/route.ts](src/app/api/ai/copywriter/route.ts)
- [src/lib/ai/copywriter.ts](src/lib/ai/copywriter.ts)
- [src/lib/social/share-templates.ts](src/lib/social/share-templates.ts)
- [src/app/api/social/connect/[platform]/start/route.ts](src/app/api/social/connect/[platform]/start/route.ts)
- [src/app/api/social/connect/[platform]/disconnect/route.ts](src/app/api/social/connect/[platform]/disconnect/route.ts)

Edits to remove imports + JSX:
- [src/app/[locale]/dashboard/properties/[id]/page.tsx](src/app/[locale]/dashboard/properties/[id]/page.tsx) (lines 19-20 imports; 169-184 + 191-193 JSX)
- [src/app/[locale]/properties/[slug]/page.tsx](src/app/[locale]/properties/[slug]/page.tsx) (line 31 import; 366-381 JSX)
- All 7 message files: strip `manualShare.*`, `socialTones.*`, `metaConnect.unlocked*` (where stale)

Verification: `grep -rn 'ManualShareModule\|SocialGrid\|CopywriterPlayground\|share-templates\|manual-share\|/api/ai/copywriter' src/ messages/` returns zero.

**Done when:** typecheck + lint pass, `pnpm build` green via deploy workflow, no orphan i18n keys in JSON.

### Phase B — DB foundation (0.5 day)
Migration `0052_social_posts.sql`:

```sql
public.social_posts (
  id uuid pk default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  org_id uuid references organizations(id),
  user_id uuid references auth.users(id),
  requested_platforms text[] not null,  -- ['facebook','instagram']
  created_at timestamptz default now()
)

public.social_post_attempts (
  id uuid pk default gen_random_uuid(),
  social_post_id uuid references social_posts(id) on delete cascade,
  platform text not null,
  external_account_id text not null,  -- 'page:{id}' / 'ig:{id}'
  status text check (status in ('queued','posting','succeeded','failed','skipped')),
  external_post_id text,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (social_post_id, external_account_id)  -- idempotency
)
```

RLS: org-members SELECT both for their org's listings; service-role writes only. **Paired RLS test** under `tests/rls/social-posts.test.ts` per CLAUDE.md hard rule #2.

### Phase C — Post formatter (0.5 day)
New `src/lib/social/post-formatter.ts` — pure functions per (platform, locale):
- `formatFacebookPost(property, locale)` → `{ message, link }` (link generates FB's preview card automatically)
- `formatInstagramPost(property, locale)` → `{ caption, imageUrl }` (IG strips URLs from captions — push agent to read full details "in bio")

Unit tests (skill step #5): long titles, missing fields, non-Latin chars, empty amenities. New `tests/unit/post-formatter.test.ts`.

### Phase D — Meta publish primitives (1 day)
New `src/lib/social/publish-meta.ts`:

- `publishToFacebookPage({ pageId, pageToken, message, link, imageUrl? })` → POST `/{page-id}/photos` (when imageUrl) or `/{page-id}/feed` (link-only). Returns `{ externalPostId, externalUrl }`.
- `publishToInstagramBusiness({ igId, pageToken, caption, imageUrl })` → POST `/{ig-id}/media` then POST `/{ig-id}/media_publish` (the IG 2-step). Returns same.
- Per-error categorization: 5xx + rate-limit + transient-token = retryable; permission-denied + permanent-token-invalid = fatal-fail. Map Meta error subcodes to our internal `error_code` enum.

### Phase E — `/api/social/post` real handler (1 day)
Replace the 501 stub:

1. Auth + Pro-Automation gate (already there) — keep, tighten error codes.
2. Validate property: ownership (RLS on `properties` does the org check) + `status='active'` + `published_at not null`.
3. List active `meta` tokens for caller (`platform='meta' AND revoked_at IS NULL`). Distinguish FB Page rows (`external_account_id LIKE 'page:%'`) and IG Business rows (`'ig:%'`).
4. Insert `social_posts` + N `social_post_attempts(status='queued')`.
5. For each attempt **in parallel** (Promise.allSettled): decrypt token (service-role RPC), call publish, update row with success+id or failure+code.
6. Return `{ socialPostId, attempts: [{ platform, externalAccountId, status, externalPostId?, errorCode?, errorMessage? }] }`.
7. Idempotency: if a `social_post_attempts` row for `(social_post_id, external_account_id)` is already `succeeded`, skip. Lets the agent retry without double-posting.

### Phase F — "Share to my socials" UI (1 day)
New `src/components/listings/share-to-socials.tsx` — mounted on `dashboard/properties/[id]` where the old SocialGrid + ManualShareModule used to be:

- Pre-flight: lists connected accounts ("2 Facebook Pages, 1 Instagram"). Empty state: "Connect Facebook" → `/api/oauth/meta/start`.
- Action: POSTs to `/api/social/post`.
- Result panel: per-attempt row with status badge (✓ green / ✗ red / ⏳ amber), external URL (when ✓), retry button (when ✗).
- "Last shared" history pulled from `social_posts` + `social_post_attempts` so the agent can see what's already gone out.

### Phase J — AI caption drafter (pre-share editor) [SHIPPED 2026-05-13]

Three parts shipped this session.

**Part 1 (commit `041babf`)** — `src/lib/social/ai-drafter.ts` + `/api/social/ai-draft` route. Anthropic Claude Haiku via fetch, tool-use schema forces structured JSON, 8s AbortController timeout. Categorized failure modes (`no_api_key`, `timeout`, `rate_limited`, `transient_5xx`, `refusal`, `malformed_json`, `unknown`) — on any failure returns empty drafts; UI falls back to deterministic template silently. System prompt enforces HARD RULES: use ONLY listing-JSON facts; no superlatives; locale-strict. 12-case test suite mocking Anthropic.

**Part 2 (commit `5715b9a`)** — extends `/api/social/post` with optional `overrides`. New picker helpers `pickFacebookPost`, `pickInstagramPost`, `pickLinkedInPost` in `post-formatter.ts`: when override present, agent prose replaces formatter prose but PLUMBING (UTM link, imageUrl, LinkedIn contentTitle + contentDescription) stays deterministic. IG image requirement enforced regardless of override. LinkedIn commentary clamp at 2800 chars defensively. Route writes `used_override boolean` per attempt to migration `0053`'s column. 9-case test suite for the pickers.

**Part 3 (commit `2b2f6a8`)** — `<ShareToSocials>` UI: "Generate AI draft" button → per-platform editable textareas pre-filled with AI text + character counters + Reset / Use-template per card. On AI failure: amber inline note "AI draft unavailable", agent still publishes via template. `submit()` builds `overrides` from non-empty edits. New i18n: `social.share.{generateDraft, regenerateDraft, generating, reviewBeforeShare, resetDraft, useTemplate, aiUnavailable, platformDraftLabel.*}`.

**Cost envelope:** Haiku at ~$0.002/call × ~32 calls/agent/month ≈ $0.07/agent/month. Comfortable inside $99 MRR.

**Dependency:** `ANTHROPIC_API_KEY` must be set in Cloudflare Pages Production env. Without it, the route returns `no_api_key` and UI falls back to template — feature degrades cleanly, not catastrophically.

### Phase K — Instagram carousel (multi-image) [SHIPPED 2026-05-13]

Commit `75d86db`. Extends IG publishing from single-image to multi-image carousels (1-10 photos per Meta's hard limit). `IG_CAROUSEL_MAX = 10`; `InstagramPost.imageUrl` → `imageUrls: string[]`; FB + LinkedIn use `imageUrls[0]` as their hero (no FB carousel via Graph API today).

`publishToInstagramBusiness` dispatches:
- length 1 → existing `publishIgSingle` 2-step (refactored out, all Phase D tests still pass)
- length 2-10 → new `publishIgCarousel` 3-step (N sequential child containers with `is_carousel_item=true` + parent CAROUSEL container with comma-joined `children` + `caption` + `media_publish`)

Sequential children per the skill (`skills/content-automation-system/process-blueprint.md §"IG carousel"`) — Meta rate-limits aggressive parallel `/media` POSTs for the same IG account; sequential adds ~200ms/photo but avoids spurious `rate_limited` mid-batch.

Route fetches `property_images` sorted (`is_primary desc, position asc`) limited to `IG_CAROUSEL_MAX`, builds the URL array.

6 new carousel test cases: happy 2-image (4 fetches asserting is_carousel_item on children + caption only on parent + children comma-list), happy 5-image (7 fetches), child fail at index 2/5 (3 fetches, "child 3/5" in error message), parent fail with image_url_unreachable (no publish call), publish fail with container_not_ready (retryable), sequentiality probe via setTimeout-delayed responses.

### Phase G — Connection test endpoint + token-refresh cron (PO-blocked on App Review)
- `GET /api/social/connection-test?platform=meta&account_id=...` — calls a benign endpoint (`/me` for user token, `/{page-id}` for page token), returns `{ ok, scopes, expiresAt }`. Skill step #8.
- New Cloudflare Worker `aho-meta-token-refresh.ts` running daily — for each non-revoked user token approaching 7 days of expiry, refresh via `fb_exchange_token`. Skill step #10.

Both buildable now; only meaningful once App Review is approved (because without `pages_manage_posts` we can't publish on a fresh page token anyway). Land in same PR as Phase A-F or split, dev's call.

### Phase H — Pre-flight checklist before exposing to first paying agent
- [ ] Meta App Review submission package complete (Privacy/Terms URLs on `advertisehomes.online` confirmed; screencast for `pages_manage_posts` + `pages_show_list` + `instagram_basic` + `instagram_content_publish`; business justification text per permission). PO action.
- [ ] OAuth dialog 502 root-caused and fixed in the Meta dashboard. PO action (with dev support).
- [ ] App Mode flipped to Live (requires Review approved). PO action.
- [ ] Domain `advertisehomes.online` live on Cloudflare Pages (PO_ACTIONS.md #2) — Meta dashboard redirect URIs and Privacy URLs all point at the canonical domain.
- [ ] End-to-end smoke from a non-tester FB account: Connect → see pages → click Share on a listing → see ✓ on production FB Page → verify post visible at `https://facebook.com/{page-slug}`.
- [ ] DECISIONS.md entry: "2026-05-XX — Meta social-publish promoted to live mode for $99 Pro Automation." Per CLAUDE.md hard rule #9.

---

## 5. Risks specific to this feature

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **App Review takes 6-8 weeks**, no $99 sales possible until then | High | Critical | Submit week 1 (overdue). Keep manual-token-import path as the soft-beta workaround — agent's PO gives us their Page admin email, we add them as App Tester, they can post in dev mode |
| **Meta API breaking change mid-build** (Graph version sunsets, permission renames) | Medium | High | Pin Graph version `v21.0` in `META_GRAPH_VERSION`. Subscribe to Meta Platform Updates RSS in PROGRESS triage |
| **Encryption key compromise** — one secret decrypts every agent's tokens (CRITIQUE §B5) | Low (today), Medium (at scale) | Critical | Rotate `AHO_TOKEN_ENCRYPTION_KEY` quarterly. Per-org key derivation tracked as v1.5 backlog |
| **Accidental real-page publish during dev** — same shape as Stripe live-mode 2026-04-29 | Medium | High (PO trust) | `AHO_SOCIAL_DRY_RUN=true` env flag in non-prod; route handler refuses to call Meta API when set. Explicit DECISIONS.md entry to promote to live |
| **IG 2-step publish stalls between `/media` and `/media_publish`** | Medium | Medium | 30-second hard timeout on the publish step; if it fires the attempt is marked `failed` with `error_code='ig_publish_timeout'` and a retry is allowed (idempotency table handles dedup) |
| **Rate limit per FB page** — Graph API has 200 calls/hour/user as a soft floor, harder for write actions | Low at soft-beta scale | Medium at 100+ agents | Skill step #7: track posts-per-window per `external_account_id`, back off before hitting limit |
| **Agent reconnects FB and the second flow rewrites their token row** — already handled by the upsert RPC's `on conflict (user_id, platform, external_account_id) do update`, but worth covering in a unit test | Low | Low | One test on `upsert_platform_token` re-call with new token bytes |

---

## 6. Why this is properly tracked here (and not just in CLAUDE.md "Current focus")

- This is **revenue-gating work**. Not slice-1 polish.
- This is **the only differentiator** of the $99 tier (per the rtf). Lower tiers don't get it; that asymmetry is the whole pricing story.
- This is **historically scarred** — at least 10 documented problems (§3 above). A casual "rebuild it" pass without reading the history will repeat them.
- This sits **across PO + dev** ownership boundaries. PO actions (P1, P7, Phase H) and dev actions (Phase A-G) interleave. One doc keeps both sides honest.
- This is **the natural endpoint of `aho_strategic_vision.md`** (Super Pro vision). Until it ships, the strategic frame is aspirational; once it ships, the vision is operational.

## 7. Cross-references

- `docs/CONTENT_HUB_VISION.md` — the strategic frame for Pro Automation
- `docs/EXECUTION_PLAN.md` — Day-by-day breakdown (this doc supersedes Sprint 1 Day 3 onward for the social-publish thread)
- `docs/HANDOFF.md` §10 — the spec for one-click social share (will be updated to match implementation in same PR as Phase B)
- `docs/CRITIQUE.md` §B2 + §B5 — pre-existing risk analysis of this exact feature
- `docs/RISKS.md` R2 (app review timelines), R3 (TikTok video), R4 (X pricing) — platform-level risks
- `docs/PO_ACTIONS.md` — Meta + LinkedIn developer-account credentials (pending), custom-domain DNS (pending)
- `.claude/skills/social-platform-integration/SKILL.md` — the playbook this implementation must obey
- `docs/social media shering on 99$ plan.rtf` — original PO requirements document for the Pro Automation tier
