# Replication Guide — New Brand in ~5 minutes (after upstream setup)

The pipeline itself is generic — only secrets and one brand-voice block in
the Claude prompt change between brands. This guide assumes you've already
copied `workers/drive-pipeline/` into the new project and applied the SQL
migrations (`processed_drive_files`, `cross_post_jobs`, `blog_posts` columns).

## 0. Prerequisites (one-time per machine)

```bash
# Cloudflare CLI
npm i -g wrangler
wrangler login

# Supabase CLI
brew install supabase/tap/supabase
supabase login
```

## 1. Cloudflare Worker (2 min)

```bash
cd workers/drive-pipeline
cp wrangler.toml wrangler.<brand>.toml
# Edit wrangler.<brand>.toml:
#   name = "<brand>-drive-pipeline"
#   SUPABASE_URL = "https://<project-ref>.supabase.co"
#   SITE_URL = "https://<brand>.com"
#   WORKER_BASE_URL = "https://<brand>-drive-pipeline.<your-subdomain>.workers.dev"
#   REVIEW_EMAIL_FROM = "<Brand> <info@<brand>.com>"
#   REVIEW_EMAIL_TO = "info@<brand>.com"
#   cron schedule

wrangler deploy --config wrangler.<brand>.toml
# Note the deployed URL → use it for redirect URIs below
```

## 2. Google Cloud (5 min one-time, 1 min per brand)

One-time:

1. <https://console.cloud.google.com/projectcreate> — create a project
2. <https://console.cloud.google.com/apis/library/drive.googleapis.com> — Enable Drive API
3. <https://console.cloud.google.com/iam-admin/serviceaccounts> — create service account, no roles, download JSON key

Per brand:

1. Create a Drive folder, copy its ID from the URL
2. Share it with the service account email (`<sa-name>@<project>.iam.gserviceaccount.com`) as **Viewer**
3. (Optional but recommended) Use a Workspace Shared Drive instead of personal Drive — invite the service account as a Member

```bash
# Push secrets:
wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON < service-account.json
wrangler secret put GOOGLE_DRIVE_FOLDER_ID
```

## 3. Supabase (3 min)

```bash
# Create new project at app.supabase.com
supabase link --project-ref <new-project-ref>
supabase db push    # applies migrations from supabase/migrations/

# Make blog_media bucket public via dashboard:
#   Storage → blog_media → Edit → Public
```

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# (Settings → API in Supabase dashboard)
```

## 4. Anthropic (1 min)

```bash
# Get key at https://console.anthropic.com/settings/keys
wrangler secret put ANTHROPIC_API_KEY
# Add credits: console.anthropic.com/settings/billing (start with $5)
```

## 5. Brevo (3 min)

1. <https://app.brevo.com/settings/keys/api> — create API key
2. <https://app.brevo.com/senders/list> — add and verify your sender domain (DNS records)

```bash
wrangler secret put BREVO_API_KEY
wrangler secret put EMAIL_LINK_SECRET
# Generate locally first: openssl rand -base64 32 | tr -d '\n' | pbcopy
```

## 6. Meta (10-15 min — slowest)

Per brand:

1. <https://developers.facebook.com/apps/create/> — type: **Business**
2. Inside the app → **Use Cases** → add:
   - "Manage everything on your Page"
   - "Manage messaging & content on Instagram"
3. Verify ownership of the brand's FB Page + IG Business account (linked
   to the Page in Meta Business Suite)
4. **Enable 2FA** on the FB account that owns the Page (Meta's Business
   policy may require it before API publishing works)
5. **Graph API Explorer** (developers.facebook.com/tools/explorer):
   - Select the app from the Meta App dropdown
   - Permissions: `pages_show_list`, `pages_read_engagement`,
     `pages_manage_posts`, `instagram_business_basic` (or `instagram_basic`),
     `instagram_business_content_publish` (or `instagram_content_publish`)
   - Generate Access Token → in popup, **explicitly select the Page** +
     **the IG account**

```bash
# In a python session or with a local helper:
#   1. Exchange short-lived user token for long-lived (60d) via /oauth/access_token
#   2. GET /{page-id}?fields=access_token,instagram_business_account using the
#      long-lived user token → this gives you a PERMANENT Page Access Token
#      and the IG Business Account ID
# (See workers/drive-pipeline/scripts/derive-meta-tokens.py if present, or
# the inline Python in the original session's git log.)

wrangler secret put META_PAGE_ACCESS_TOKEN
wrangler secret put META_PAGE_ID
wrangler secret put META_IG_BUSINESS_ID
```

**Important — IG account cooling-off**: brand new IG Business accounts often
return `code=2 transient` errors for the first 24-72h, even with everything
correct. Start with `META_IG_ENABLED=false`, post 2-3 photos manually from
the IG app, wait 24h, then flip to true and test via `/debug-ig` endpoint
(which creates a container without publishing — safe).

## 7. LinkedIn (~5 min for personal, weeks for Company Page)

1. <https://developer.linkedin.com/apps/new> — create app, associate with
   the brand's Company Page
2. **Products** tab → request:
   - "Sign In with LinkedIn using OpenID Connect" (instant)
   - "Share on LinkedIn" (instant for personal profile use)
3. **Auth** tab → add Redirect URL:
   `<WORKER_BASE_URL>/auth/linkedin/callback`
4. Copy Client ID + Secret:

```bash
wrangler secret put LINKEDIN_CLIENT_ID
wrangler secret put LINKEDIN_CLIENT_SECRET
```

5. Open `<WORKER_BASE_URL>/auth/linkedin/start` in your browser. Consent on
   LinkedIn. The callback page shows the access token and author URN.
6. Push them:

```bash
wrangler secret put LINKEDIN_ACCESS_TOKEN
wrangler secret put LINKEDIN_AUTHOR_URN
```

7. Flip `LINKEDIN_ENABLED=true` in `wrangler.toml` and redeploy.

For Company Page posting, apply for **Marketing Developer Platform**
separately (Products tab → request). Approval takes 1-4 weeks. Once approved,
change `LINKEDIN_AUTHOR_URN` from `urn:li:person:X` to
`urn:li:organization:<company-id>`. Code is unchanged.

## 8. Customize the brand voice (per brand)

Edit `workers/drive-pipeline/src/anthropic.ts`:

- `ECOSYSTEM_LINKS` constant — replace with this brand's URLs (online shop,
  flagship store, physical location map, reservation page, etc.)
- `STRUCTURE_RULES` constant — section names + word counts + brand-specific
  data callout (terroir card, product specs, etc.)
- Both `langPromptEs` and `langPromptEn` — voice description, sample tone,
  forbidden claims

Redeploy:

```bash
wrangler deploy --config wrangler.<brand>.toml
```

## 9. Site-side brand strings (consistency audit)

The pipeline itself doesn't touch the site code — but the brand site IS a
consumer of the same content and must reference the same social handles for
JSON-LD `sameAs` consistency. Each new brand must audit and update:

| File (typical SPA layout) | What to change |
|---|---|
| `src/components/Footer.jsx` | Social icon links: IG, FB, TikTok, LinkedIn URLs |
| `src/components/SchemaMarkup.jsx` (Organization `sameAs` array) | Same URLs as Footer — must match exactly or Google flags inconsistency |
| `src/components/ProtectedAdminRoute.jsx` (or wherever `ADMIN_EMAIL` lives) | The reviewer email — same as `REVIEW_EMAIL_TO` |
| Page metadata (`<title>`, `<meta>`, `og:*`) | Brand name + tagline |
| `src/i18n/*.json` (or equivalent) translation strings | Replace brand-specific phrases |

**Common gotcha**: a brand's Instagram handle on the live IG account does NOT
always match a vanity URL in old footer code. After every social-handle
rename, run a `grep -r "<old-handle>" src/` to catch every reference.
Inconsistent `sameAs` URLs are a real SEO/identity-graph problem because
Google uses them to verify brand ownership.

## 10. Verify

```bash
# Health
curl <WORKER_BASE_URL>/health    # → "ok"

# Token (first 24 chars of service role key)
TOK=$(wrangler secret list | grep ... )   # or copy from Supabase dashboard

# Meta link probe
curl "<WORKER_BASE_URL>/meta/status?token=${TOK:0:24}"
# Expect: { "id": "...", "name": "...", "instagram_business_account": {...} }

# Drop a test image with descriptive Spanish filename into the Drive folder
# Trigger manually:
curl -X POST "<WORKER_BASE_URL>/run?token=${TOK:0:24}"

# Watch live:
wrangler tail <brand>-drive-pipeline --format pretty
```

Email arrives at `REVIEW_EMAIL_TO` within ~30s. Approve → blog post live,
cross-posts firing. Done.

## Troubleshooting cheat sheet

| Symptom | Cause | Fix |
|---|---|---|
| `waitUntil() cancelled` warning | Claude generation > 30s | Trim word counts in prompt, or upgrade to Workers Paid |
| Drive 403 on listing | API not enabled, or folder not shared with SA | Enable Drive API in GCP console; re-share folder |
| Meta page 401 / token error | Page not in BM, or owner missing 2FA | Enable 2FA, add Page to a Business Portfolio, redo OAuth |
| IG `code=2 transient` after publish but post DID appear | Meta API quirk | Already handled by `verifyRecentPublish` in social.ts |
| Same group reprocessed every cron | Dedup row missing | Check `processed_drive_files` table; row should exist with status='draft_pending' or 'approved' |
| Pipeline succeeds but no review email | `sendReviewEmail` cancelled by waitUntil timeout | Use `/resend-review?token=X&post_id=Y` to backfill |
| LinkedIn 401 after a few weeks | Personal token expired (~60 days) | Re-visit `/auth/linkedin/start`, push new `LINKEDIN_ACCESS_TOKEN` |

## Files to copy when forking for a new brand

```
workers/drive-pipeline/          # whole folder
supabase/migrations/             # whole folder
skills/content-automation-system/ # this doc set
```

Site code (the SPA that reads from `blog_posts`) is brand-specific and does
NOT belong in the skill. It's just a Supabase consumer.
