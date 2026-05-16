# Instagram sharing — current state + activation plan

> Owner: dev (with PO checkpoints called out) · Last updated: 2026-05-16

## TL;DR — Instagram sharing is **already built**. It activates automatically once an agent links an IG Business Account to their FB Page in Meta Business Suite. No additional dev work needed for the v1 flow; the gap is a discoverability + onboarding UX nudge.

---

## 1. What's already in place

### Database
- `ad_platform_tokens` table supports `platform='meta'` with `external_account_id` prefix conventions:
  - `meta` user-token row keyed on FB user id
  - `page:{fb_page_id}` for FB Pages
  - `ig:{ig_business_id}` for **Instagram Business accounts linked to those FB Pages**

### OAuth flow
- `src/app/api/oauth/meta/callback/route.ts` already iterates over the user's FB Pages and, for each page with `page.instagram_business_account?.id` returned by Graph API, **stores an `ig:{id}` token row automatically** (see lines 184-201).
- The token row uses the **same page token** as the FB Page — Meta's IG Content Publishing API consumes the page token, not a separate IG token.

### Publish primitive
- `publishToInstagramBusiness` in `src/lib/social/publish.ts` — handles both:
  - Single-image post (`/media` + `/media_publish` 2-step)
  - Carousel post (3-step: per-child `/media` → carousel container `/media` → `/media_publish`) capped at `IG_CAROUSEL_MAX = 10` photos
- `pickInstagramPost` formatter in `src/lib/social/post-formatter.ts` — composes caption with locale-aware "Enlace en bio:" / "Link in bio:" convention (IG strips URL clickability from caption body, so we surface the URL plainly with the "link in bio" framing).

### Share-to-Socials UI
- `src/components/listings/share-to-socials.tsx` — renders per-account checkboxes for ALL connected accounts including IG. The fan-out POST to `/api/social/post` honors the per-account selection.
- Currently: when `ig:%` row exists, IG appears in the account list with the 📷 emoji.

### Meta App Configuration (server-side)
- `META_LOGIN_CONFIG_ID=27924900597099409` — current Configuration ID covers the FB-side scopes (`pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `business_management`). PO has confirmed (2026-05-16) that the IG scopes (`instagram_basic`, `instagram_content_publish`) are **already added** to this Configuration — but for them to actually grant on OAuth, the agent's FB account must have an IG Business linked to one of their FB Pages.

---

## 2. Why no IG accounts surface in production today

Confirmed via DB query 2026-05-16 — PO's Meta connection has 7 FB Pages tokens stored, **zero `ig:%` tokens**. Meta's Graph API returned no `instagram_business_account` field on any of those Pages because **none of them have an IG Business Account linked at the Meta Business Suite level**.

This is a **per-Page setup the agent does once** in business.facebook.com → Business Settings → Accounts → Instagram accounts → Add → connect each IG account → assign to the corresponding FB Page.

Until that linking happens at Meta's side, the OAuth callback simply doesn't see the IG account to store. Same will be true for every new agent who connects Meta on AHO.

---

## 3. Activation plan — what to ship next

### Phase 1 — UX nudge (1-2 hours dev, no Meta-side work)
**Goal:** when a Pro Automation agent has connected Meta but ends up with 0 `ig:%` tokens, surface an explainer + linked help guide instead of leaving them puzzled.

Concrete change in `src/components/social/connect-meta-section.tsx`:
- Detect `pageTokens.length > 0 && igTokens.length === 0`
- Render a yellow callout: "Connected Facebook ✓ — Instagram not detected. To enable Instagram sharing, link your IG Business Account to your FB Page in Meta Business Suite, then click Reconnect."
- Link to a NEW short help doc at `/docs/instagram-setup` (3-step guide with screenshots — write once, applies to every agent).

### Phase 2 — Self-serve help doc (1 hour content)
**New page**: `/docs/instagram-setup` in 7 locales (or EN-only initially per `DECISIONS.md` if scope-conscious).

Content outline:
1. Why you need it ("AHO posts to FB feed + IG feed in one click; without the link, IG slots are skipped")
2. Convert personal IG → IG Business (5 taps in IG app: Settings → Account → Switch to Professional → Business → done)
3. Link IG Business to FB Page (Meta Business Suite → Settings → Instagram accounts → Add)
4. Return to AHO `/dashboard/social` → click "Reconnect / refresh permissions"
5. Verify: the Meta panel now lists IG accounts under 📷 alongside the 📘 FB Pages

### Phase 3 — Auto-detect drift (defer to slice-3)
Daily cron that fetches each user's `/me/accounts` and re-checks `instagram_business_account` — flag any FB Page that newly linked an IG Business so we can prompt a Reconnect via email. Not blocking; nice-to-have once we have ≥10 agents to optimize for.

### Phase 4 — Story / Reels publishing (post-MVP)
Today's pipeline only handles **IG Feed posts** (single + carousel). IG Story (24h) + IG Reels (vertical video) require:
- Different Graph endpoints (`/media` with `media_type=STORIES` or `=REELS`)
- For Reels: actual video file (currently we only have property photos; Reels = Stage-1 auto-video feature per `docs/SUPER_PRO_STAGE_1_PLAN.md` Phase 4)
- For Stories: 1080×1920 vertical crop (need new CF Images variant `ig-story`)
**Defer until Auto-Video Engine ships in Super Pro Stage 1.**

---

## 4. PO actions required

1. **Right now:** Make sure the IG scopes `instagram_basic` + `instagram_content_publish` are actually saved in Configuration `27924900597099409` (Meta Login for Business dashboard). Verified earlier this session — should be done.

2. **To test IG sharing yourself:** Link one of your existing IG Business Accounts to one of your existing FB Pages via Meta Business Suite → return to `/en/dashboard/social` → click "Reconnect / refresh permissions" on the Meta panel → IG account should appear under 📷.

3. **For soft-beta:** include the `/docs/instagram-setup` link in onboarding emails so every new agent sees the IG link prereq.

---

## 5. Why this isn't bigger work

Real-estate agents typically already have:
- ✅ FB Page (their agency / personal brand page)
- ✅ IG Business Account (every modern agent runs one)
- ⚠️ The two LINKED — variable; some have it, some don't

The "missing step" rate is probably 30-50% based on industry data. With a help doc + a one-time Reconnect, every agent that wants IG sharing gets it. We don't need to build new infrastructure — we need to teach the prerequisite.

---

## 6. Cross-references

- `docs/SOCIAL_AUTOMATION_PLAN.md` — Phase D (publish primitives) + Phase J (AI drafter) — both already cover IG
- `docs/SUPER_PRO_STAGE_1_PLAN.md` Phase 4 — Auto-Video Engine that unlocks IG Reels
- `src/app/api/oauth/meta/callback/route.ts` lines 184-201 — IG token storage on OAuth
- `src/lib/social/publish.ts` — `publishToInstagramBusiness` (single + carousel)
- `src/lib/social/post-formatter.ts` — `formatInstagramPost` + `pickInstagramPost`
