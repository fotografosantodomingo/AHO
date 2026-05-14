# Meta App Review — submission package

> Phase H of `docs/SOCIAL_AUTOMATION_PLAN.md`. The dev side (Phases A–F)
> shipped 2026-05-13 — code is ready. The remaining gate to "real $99
> customer can publish on Facebook + Instagram" is **Meta App Review**.
> This is a PO action (PO owns the developer account + App ID
> `2073516736922479` + Configuration `27924900597099409`). Dev has
> prepared this pack so PO can file the submission without translating
> any technical detail. Per CLAUDE.md hard rule #9 the submission
> itself is a PO decision — dev does not execute it.
>
> **Estimated turnaround:** 4–8 weeks historically. Submit ASAP; the
> calendar is the dependency, not the code.

---

## 1. Why submit now (decision gate)

| Factor | Where we stand |
|---|---|
| App Review fee | Free |
| Approval turnaround | 4–8 weeks (Meta's typical; can be longer) |
| Without approval | Only Meta App Roles testers can OAuth + publish in Development mode. The `scripts/import-meta-token.ts` workaround is the soft-beta unlock — works for individual PO-vetted agents added as App Testers but does NOT scale to public Pro Automation enrollment |
| With approval + App Live mode | Any FB user can grant AHO permission. Pro Automation tier becomes a real product |
| Code readiness | Phase A–F shipped 2026-05-13. End-to-end flow exists |
| Blocker for filing | OAuth dialog 502 (since 2026-05-07) MUST be fixed first — reviewers test the dialog and a 502 → rejection |

**Recommended sequence:** (a) fix the OAuth 502 → (b) record the screencast → (c) file the submission → (d) while waiting, soft-beta agents continue via the manual-token-import path → (e) on approval, flip App Mode to Live + write DECISIONS.md entry promoting the feature to production for the $99 tier.

---

## 2. Pre-submission checklist

### 2.1 App configuration — Meta Developer dashboard

Navigate to https://developers.facebook.com/apps/2073516736922479/ and verify each:

- [ ] **Settings → Basic → App Domains** includes both:
  - `aho-web.pages.dev`
  - `advertisehomes.online` (only meaningful after custom-domain DNS lands — `PO_ACTIONS.md` #2)
- [ ] **Settings → Basic → Site URL**: `https://advertisehomes.online` (or `https://aho-web.pages.dev` until DNS pivots)
- [ ] **Settings → Basic → Category**: "Business and Pages"
- [ ] **Settings → Basic → Business Verification**: complete (status = Verified, green check)
- [ ] **Settings → Basic → Privacy Policy URL**: `https://advertisehomes.online/en/privacy`
- [ ] **Settings → Basic → Terms of Service URL**: `https://advertisehomes.online/en/terms`
- [ ] **Settings → Basic → Data Deletion Instructions URL**: `https://advertisehomes.online/en/privacy#data-deletion`
  - Note: if a dedicated anchor doesn't exist yet on `/en/privacy`, add one. Section 8 of the privacy page already covers DSAR — we just need an anchor `id="data-deletion"`.

### 2.2 OAuth dialog 502 — fix first (BLOCKING)

The dialog has returned 502 ("Sorry, something went wrong") since 2026-05-07 for the PO's Configuration `27924900597099409`. Submission rejection-rate goes up if Meta reviewers also see a 502 when testing the OAuth flow. Work through this checklist before filing:

1. **App Roles → Administrators**: PO's Facebook account must be listed. Open https://developers.facebook.com/apps/2073516736922479/roles/roles/ → confirm presence. If missing, add it (this alone has resolved the 502 in similar reports).
2. **App Mode = Development**: Settings → Basic should show "Development" badge (yellow). Live mode requires approval first and breaks the dev-mode-tester flow.
3. **Configuration verification** at Use Cases → Login for Business → `27924900597099409`:
   - Login Type: **Customer** (not Business)
   - Permissions bundle includes ALL six: `public_profile`, `email`, `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `business_management`
   - Redirect URIs include the exact callback path: `https://advertisehomes.online/api/oauth/meta/callback` AND `https://aho-web.pages.dev/api/oauth/meta/callback`
4. **App Review → Permissions and Features**: each of the 4 publishing permissions must show "Available for Testing" (not "Not Available"). If "Not Available" — the permission requires Business Verification, which links back to 2.1.
5. **Test live (current branch is `main` @ `add2b28`)**: visit `https://aho-web.pages.dev/en/dashboard/social` as the PO Facebook account. Click "Connect Facebook". If the dialog renders permissions list → 502 fixed. If still 502 → check the browser console for the `?error_reason=...` returned to our callback.

### 2.3 Custom domain (recommended before submission)

Per `PO_ACTIONS.md` #2: DNS for `advertisehomes.online` → Cloudflare Pages.

Meta reviewers historically scrutinize `.pages.dev` / staging-style domains more harshly than custom domains. Submission can succeed against `aho-web.pages.dev`, but the success rate is higher with the canonical domain live. Plus the Privacy + Terms URLs already point at `advertisehomes.online` in our App Settings, so the domain must resolve.

If custom domain isn't ready by submission time: temporarily flip the Privacy + Terms URLs in the Meta dashboard to `https://aho-web.pages.dev/en/privacy` etc., and switch back after DNS lands.

---

## 3. Permissions to request — text Meta wants in the form

Four publishing permissions. Each has two text fields in the dashboard ("How will your app use this permission?" + "Step-by-step instructions"). Copy/paste verbatim:

### 3.1 `pages_show_list`

**How will your app use this permission?**

> AHO is a subscription platform where real estate agents publish property listings. Pro Automation tier subscribers can one-click publish listings to their Facebook Pages. We need `pages_show_list` to discover which Facebook Pages the agent manages, so they can select which Page each listing should publish to.

**Step-by-step instructions (for the reviewer):**

> 1. Log in at `https://advertisehomes.online/en/signin` with the test credentials provided in the App Roles section.
> 2. Navigate to `/en/dashboard/social`.
> 3. Click "Connect Facebook".
> 4. Approve the permission dialog on Facebook.
> 5. You return to `/en/dashboard/social`. The page now shows your managed Facebook Pages under "Facebook Pages" — this is `pages_show_list` rendering the page list.

### 3.2 `pages_manage_posts`

**How will your app use this permission?**

> When an agent has published a real estate listing on AHO and clicks "Share to my socials" on that listing, AHO publishes the listing's title, location, price, and photo as a post on the agent's selected Facebook Page, linking back to the listing on `advertisehomes.online`. Each post is the result of an explicit per-listing user action — never automatic, never bulk.

**Step-by-step instructions:**

> 1. Log in as above and connect Facebook (steps 1–4 of 3.1).
> 2. Navigate to `/en/dashboard/properties` and open any listing whose status is "Active".
> 3. Scroll to the "Share to my socials" card.
> 4. Click "Share now".
> 5. Within 3 seconds the card shows "✓ Posted" with a "View post →" link to the post on `facebook.com/{page-id}_{post-id}`.
> 6. Open the link — the post is visible on the selected Page. This is `pages_manage_posts` in action.

### 3.3 `instagram_basic`

**How will your app use this permission?**

> AHO checks whether the Facebook Page selected for publishing has a linked Instagram Business account. When linked, we offer the agent the option to publish the same listing to that Instagram account in the same one-click action. `instagram_basic` is used only to detect this linkage and display the Instagram account name in the connected-accounts list.

**Step-by-step instructions:**

> Same flow as 3.1. After approval, the Pages list is followed by an "Instagram Business accounts" list — that list comes from `instagram_basic`.

### 3.4 `instagram_content_publish`

**How will your app use this permission?**

> When an agent clicks "Share to my socials" on a published real estate listing, AHO publishes a photo + caption to the agent's Instagram Business account (in addition to the matching Facebook Page post). The caption includes the listing's title, location, price, and a link back to the listing on `advertisehomes.online`. Each post is the result of an explicit per-listing user action — never automatic.

**Step-by-step instructions:**

> Same as 3.2 — after clicking "Share now", the result card also shows "✓ Posted" for Instagram with a link to the published media. This is `instagram_content_publish`.

---

## 4. Screencast script

Meta requires a screencast (≤ 5 min) demonstrating each requested permission in action. Recording specs from Meta's guide: 720p+, MP4/MOV, narration in English, no music, no edits.

### 4.1 Setup before recording

1. Two browser windows side-by-side:
   - **Left:** `https://advertisehomes.online/en/dashboard/social` (signed in as test agent)
   - **Right:** the agent's Facebook Page + Instagram Business profile (signed in as the same FB user)
2. Have one **published** AHO listing ready in the test agent's dashboard. If none exists: take 2 minutes pre-record to create + publish one.
3. Clear the agent's existing connection in AHO (so the screencast shows the connect-from-scratch flow). To clear: in Supabase SQL editor, `update public.ad_platform_tokens set revoked_at = now() where user_id = '<test-user-id>'`.

### 4.2 Recording outline (~3:30)

| Time | What's on screen | Narration |
|---|---|---|
| 0:00–0:15 | Left window: `/dashboard/social` showing "Connect Facebook" button | "This is AHO — a real estate platform. I'm signed in as an agent on the Pro Automation plan. I want to enable one-click social publishing." |
| 0:15–0:30 | Click Connect Facebook → Meta OAuth dialog renders | "I click Connect Facebook. AHO redirects me to Meta's permission dialog." |
| 0:30–0:50 | ZOOM into the permissions list | "Meta shows the permissions AHO is requesting: public_profile, email, pages_show_list, pages_manage_posts, pages_read_engagement, business_management, and on the Instagram side instagram_basic and instagram_content_publish." |
| 0:50–1:00 | Click "Continue as <test-agent>" | "I approve, and AHO receives my consent." |
| 1:00–1:20 | Back on `/dashboard/social` showing Pages + IG list | "I'm back on AHO. It now lists my Facebook Pages — that's `pages_show_list` — and my linked Instagram Business account — that's `instagram_basic`." |
| 1:20–1:35 | Navigate to `/dashboard/properties/[id]` (a published listing) | "I open one of my published property listings." |
| 1:35–1:50 | Scroll to ShareToSocials card showing the connected accounts | "AHO's per-listing 'Share to my socials' card lists exactly where this listing will be published — my Facebook Page and my Instagram." |
| 1:50–2:00 | Click "Share now" | "I click 'Share now'. This is an explicit, per-listing action by the agent — never automatic, never bulk." |
| 2:00–2:20 | Loading state, then the success panel renders | "Within a few seconds AHO publishes to both platforms in parallel and shows me the result: green checkmarks with View post links." |
| 2:20–2:40 | Click "View post →" on the Facebook row → cuts to right window showing the live Facebook Page post | "The View post link takes me to the live post on my Facebook Page. The post is real — that's `pages_manage_posts` working end-to-end." |
| 2:40–3:00 | Switch to Instagram profile in right window → show the new IG post | "Same on Instagram — the photo and caption are live on my Business profile. That's `instagram_content_publish`." |
| 3:00–3:20 | Show post content on FB: caption includes listing title, location, price, and the advertisehomes.online URL | "Notice the post body — listing title, location, price, and an `advertisehomes.online` link back to the listing. The agent uses AHO to publish content; the content drives buyers back to AHO." |
| 3:20–3:30 | End on the AHO listing page showing the green success card | "That's the full one-click flow. Thanks for reviewing." |

### 4.3 What the screencast must NOT show

- Other agents' data (everything is the test agent's own account)
- Any pre-recorded segments or jump cuts (Meta scrutinizes for staged demos)
- Real customer leads or any PII besides the test agent's own profile
- Stripe billing screens (out of scope)

---

## 5. Submission text — "App details" + "Test instructions"

In the submission form Meta also asks for two pieces of free-form text. Copy/paste:

### 5.1 App details

> **AHO — Advertise Homes Online** (`https://advertisehomes.online`) is a subscription real estate platform. Agents subscribe to one of three tiers ($29 / $49 / $99); the top tier ("Pro Automation") includes the one-click social publishing feature this submission unlocks.
>
> The feature lets an agent who has published a property listing on AHO publish that listing in one click to their connected Facebook Page and Instagram Business account, with the platform-specific copy + image generated deterministically from the listing data + a permalink back to the listing on advertisehomes.online.
>
> Every publish is the result of a per-listing user action: the agent clicks a "Share now" button on each individual listing. There is no bulk publish, no scheduled posting, no AI-generated content (deterministic templates only), and no posting on the agent's behalf without their explicit click.

### 5.2 Test instructions / login

> Test credentials:
>
> URL: `https://advertisehomes.online/en/signin`
> Email: `[fill: aho-meta-review@<domain>]`
> Password: `[fill: secure password — generate fresh for this submission]`
>
> The test user is on the Pro Automation plan and has one published listing already in the dashboard. Steps:
>
> 1. Sign in at the URL above.
> 2. Navigate to "Dashboard → Social" — see the Connect Facebook button.
> 3. Click "Connect Facebook" → approve in the Meta dialog → return to AHO.
> 4. Navigate to "Dashboard → Listings" → open the listing titled "AHO Review Test Listing".
> 5. Scroll to "Share to my socials" → click "Share now".
> 6. After ~3s, the card shows "✓ Posted" for both Facebook and Instagram with View post links.
> 7. Click View post to verify the live post on each platform.

---

## 6. Post-approval steps (PO action when Meta approves)

1. **Switch App Mode** in Meta dashboard: Settings → Basic → App Mode → **Live**.
2. **Add a DECISIONS.md entry** in the AHO repo:

   ```
   ## 2026-MM-DD — Meta social-publish promoted to live for $99 Pro Automation
   **Decision:** App Mode flipped to Live for App `2073516736922479`. Any Facebook
   user can now grant AHO permission to publish on their Pages / Instagram Business
   accounts. Pro Automation tier offers the feature as a real product.
   **Why:** Meta App Review approved on YYYY-MM-DD (approval email at <link>).
   **Rollback plan:** Flip App Mode back to Development in Meta dashboard. The
   feature would then 502 for non-tester users; we'd switch to the manual-token-
   import workaround until the next investigation.
   ```

   Per CLAUDE.md hard rule #9.

3. **Run the end-to-end smoke test** (§7 below) before opening Pro Automation enrollment publicly.

4. **Update `docs/SOCIAL_AUTOMATION_PLAN.md`**: mark Phase H complete. Move the doc's status to "shipped — soft-beta live".

5. **Optional but recommended:** turn on Stripe live mode for the Pro Automation price IDs (separate DECISIONS.md entry per hard rule #9 — Stripe live promotion is its own decision).

---

## 7. End-to-end smoke test — final gate

Once App Review is approved AND custom domain is live, run this 9-step probe against production from a **fresh Facebook account that is NOT in App Roles** (to verify the public path, not just the dev-mode tester path):

1. Sign up for AHO at `https://advertisehomes.online/en/signup` as a new user.
2. Subscribe to Pro Automation in Stripe (live mode).
3. Navigate to `/en/dashboard/social`. Click "Connect Facebook".
4. Approve Meta dialog. Return to AHO.
5. Verify Pages + IG accounts listed in `ConnectMetaSection`.
6. Create a new listing + publish.
7. On the listing edit page, click "Share now".
8. Within 5s, see ✓ for both FB + IG.
9. Open each "View post →" link — verify the post is real on facebook.com and instagram.com.

If all 9 pass → green-light Pro Automation public enrollment.
If any fail → revert App Mode to Development, surface the failure (Meta response body + our `social_post_attempts` row), and fix before retrying.

---

## 8. Why this lives in its own doc

- The submission package is a discrete artifact PO will use ~once. Lives separately from `PO_ACTIONS.md` (which is a rolling todo) so the screencast script + permission texts stay together.
- The OAuth 502 debug checklist (§2.2) has been needed for 6+ days. Tracking it inside this submission doc keeps it visible — its resolution is part of "ready to submit", not a separate workstream.
- This doc gets ARCHIVED once submission is filed + approved. Future App Reviews (e.g. adding TikTok later) get their own version of this template.

## Cross-references

- `docs/SOCIAL_AUTOMATION_PLAN.md` Phase H — this doc is the implementation of that phase
- `docs/PO_ACTIONS.md` #2 (custom domain), #5 (lawyer review of Privacy/Terms — non-blocking for review submission)
- `docs/RISKS.md` R2 (app review timelines), R7 (RLS bypass on service-role)
- `docs/CRITIQUE.md` §B2 (app-review serial dependency on the value prop)
- `docs/DECISIONS.md` 2026-04-29 "Submit Meta + LinkedIn app reviews in slice-1 week 1" — the original commitment to file in week 1. This is the catch-up.
