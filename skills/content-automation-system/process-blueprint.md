# Process Blueprint — Data Flow

```
                       ┌──────────────────┐
                       │  Google Drive    │
                       │  watched folder  │
                       └────────┬─────────┘
                                │ (cron polls)
                                ▼
   ┌──────────────────────────────────────────────────────┐
   │  Cloudflare Worker — scheduled() handler             │
   │                                                       │
   │  1. listImageGroups()                                 │
   │     - root images → single-image groups               │
   │     - subfolders  → multi-image groups (max 5)        │
   │                                                       │
   │  2. for each group:                                   │
   │     - check processed_drive_files (dedup by group_id) │
   │     - download images from Drive                      │
   │     - upload to Supabase Storage (public bucket)      │
   │     - call Claude Vision (parallel ES+EN)             │
   │     - substitute {{IMAGE_N}} placeholders with        │
   │       <figure><img> blocks                            │
   │     - INSERT blog_posts (published=false)             │
   │     - INSERT processed_drive_files                    │
   │     - send Brevo email with HMAC-signed magic links   │
   └────────┬─────────────────────────────────────┬───────┘
            │                                     │
            ▼                                     ▼
   ┌────────────────┐                  ┌─────────────────────┐
   │  Supabase DB   │                  │  info@brand.com     │
   │  blog_posts    │                  │  Brevo review email │
   │  storage       │                  │  [Approve] [Reject] │
   └────────────────┘                  └──────────┬──────────┘
                                                  │ (user clicks)
                                                  ▼
                                  ┌────────────────────────────┐
                                  │ Worker — fetch() /approve  │
                                  │                            │
                                  │ - verify HMAC signature    │
                                  │ - UPDATE published=true    │
                                  │ - ctx.waitUntil(crossPost) │
                                  │ - return confirmation HTML │
                                  └──────────┬─────────────────┘
                                             │ (background)
                       ┌─────────────────────┼─────────────────────┐
                       ▼                     ▼                     ▼
                ┌─────────────┐      ┌─────────────┐       ┌──────────────┐
                │  FB Page    │      │  Instagram  │       │   LinkedIn   │
                │  /photos    │      │  carousel   │       │  /ugcPosts   │
                │  or /feed   │      │  (3-step)   │       │  + asset     │
                └─────────────┘      └─────────────┘       │    upload    │
                                                          └──────────────┘
                                             │
                                             ▼
                                  ┌────────────────────────────┐
                                  │ Brevo "results email"      │
                                  │ summary of FB / IG / LI    │
                                  │ posted | failed | skipped  │
                                  └────────────────────────────┘
```

## Phase 1 — Trigger

**Cloudflare Workers cron** runs the `scheduled()` handler on a configurable
schedule. Default: `0 19 * * *` (daily, 19:00 UTC = 3 PM AST). For instant
ingestion, add Google Drive Push Notifications (Drive Changes API + webhook
to `/run`).

Manual trigger endpoint: `POST /run?token=<first-24-of-supabase-service-role>`.

## Phase 2 — Fetch

Authentication: a Google service account stored as
`GOOGLE_SERVICE_ACCOUNT_JSON` secret. JWT is signed with RS256 using Web
Crypto (no Node dependencies). Token is cached in-memory for the Worker
invocation lifetime.

Two passes:
1. List folders inside the watched folder (`mimeType = 'application/vnd.google-apps.folder'`).
2. List root-level images (`mimeType contains 'image/'`).

Grouping convention:
- Each root-level image = single-image group, keyed by file id
- Each subfolder = multi-image group (max 5 images, sorted alphabetically),
  keyed by folder id

Dedup table `processed_drive_files` is keyed on the group key
(string). If a row exists, the group is skipped on subsequent runs.
**To force reprocess**: delete the dedup row. To force reprocess after
adding/removing images in a subfolder, change the folder name or recreate it
(new folder id).

## Phase 3 — Process

Per group:

1. **Download** each image via Drive `files/<id>?alt=media`.
2. **Upload** each to Supabase Storage at
   `blog_media/auto/<group_key>/<file_id>.<ext>`. Returns public URL.
3. **Generate** via two parallel Claude calls:
   - **Primary** (ES): returns shared fields — slug, alt_text, tags,
     reading_time, social captions (FB/IG/LinkedIn), data callout, pull
     quote, FAQs — plus ES body_html.
   - **Alt** (EN): returns only translated body_html, title, seo_description,
     faqs/callout/quote.
   - Both prompts include `{{IMAGE_N}}` placeholders for inline figures.
4. **Substitute** placeholders post-generation with
   `<figure><img src="..." alt="..."></figure>` blocks. Any leftover
   placeholders are stripped (defensive).
5. **Insert** into `blog_posts` (Spanish in primary fields, English in
   `auto_draft_meta.en`).
6. **Insert** into `processed_drive_files` (dedup).
7. **Send** Brevo email with HMAC-signed magic links.

Failure handling: each step is in a try block. On failure the dedup row is
recorded with `status='failed'` so the same group isn't retried infinitely.

## Phase 4 — Publish (on approve)

User clicks **Approve & Publish** in the review email.

The Worker `fetch()` handler:

1. Verifies the HMAC signature (`EMAIL_LINK_SECRET` + payload + timestamp).
   Links expire 7 days after issue.
2. `UPDATE blog_posts SET published=true`.
3. `UPDATE processed_drive_files SET status='approved'`.
4. `ctx.waitUntil(runCrossPost(blog_post_id))` — fan-out runs in background.
5. Returns a confirmation HTML page to the user.

`runCrossPost`:

1. Enqueues 3 rows in `cross_post_jobs` (one per platform: fb, ig, li).
2. Calls `postToFacebook` + `postToInstagram` + `postToLinkedIn` in parallel.
3. Updates each `cross_post_jobs` row with status + platform_post_id + error.
4. Sends a results email summarizing what posted.

### Platform specifics

**Facebook Page** — single image uses `/photos` endpoint with caption inline.
Multi-image uses album flow: upload each photo with `published=false`, then
POST `/feed` with `attached_media` array. Caption gets `Read more: <link>`
appended.

**Instagram Business** — single image uses 2-step container/publish. Carousel
uses 3-step: per-image `is_carousel_item=true` containers polled to FINISHED,
then CAROUSEL container, then publish. **Critical quirk**: Meta returns
`code=2 "transient" error` on the publish step EVEN WHEN the post succeeded.
Mitigation: after such a response, query
`GET /{ig-id}/media?fields=id,timestamp,caption&limit=5` and look for a post
matching the caption head from the last 60s. If found, treat as success.

**LinkedIn** — 3-step UGC posts: (1) register upload at
`/v2/assets?action=registerUpload`, (2) PUT image bytes to the returned
upload URL, (3) POST `/v2/ugcPosts` with the asset URN. Single-image only in
MVP. Header `X-Restli-Protocol-Version: 2.0.0` is required.

### Feature flags

Each platform is independently gated:
- `META_ENABLED` — covers both FB and IG
- `META_IG_ENABLED` — independent IG gate (useful when account is brand-new
  and Meta silently blocks API publishing for 24-72h)
- `LINKEDIN_ENABLED` — needs an actual access token + author URN before
  flipping to true

A `skipped` result with a clear reason is recorded in the cross_post_jobs row
when a flag is off — easy to debug from the results email or the DB.
