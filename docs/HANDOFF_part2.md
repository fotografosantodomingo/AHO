# Real Estate Platform — Full Technical Specification (Part 2)

**Project:** AHO (advertisehomes.online)
**Continuation of:** `HANDOFF.md` — picks up at §12 and runs through §30.
**Date:** April 29, 2026

> This file continues directly from Part 1. Read Part 1 first. Part 1 was truncated mid-§12 (one-click social share); the full §12 is reproduced here from the start so the section is self-contained, then continues through the rest of the spec.
>
> **Part 2 also arrived truncated** — content stops mid-§29 (Social Share acceptance criteria, line ending "Realtime status UI updates within 5s of pl"). §29 remainder and all of §30 (Open Questions for the Developer) need to be re-sent. Tracked in `docs/PROGRESS.md` and `docs/OPEN_QUESTIONS.md`.

---

## Table of Contents (Part 2)

12. One-Click Social Share — full section
13. AI Features (Expert Tier)
14. Auto-Blog Generation
15. Bilingual EN/ES + Light/Dark Theme
16. SEO Implementation
17. WhatsApp & Lead Contact
18. Admin Dashboard
19. Agent / Agency / Expert Consoles
20. Email, SMS & Notifications
21. Security
22. Compliance & Legal
23. Performance & Core Web Vitals
24. Testing & QA
25. DevOps & Deployment
26. Monitoring & Observability
27. Project Phases & Timeline
28. Cost Estimate
29. Acceptance Criteria *(truncated mid-section — see top note)*
30. Open Questions for the Developer *(missing — to be re-sent)*

---

## 12. One-Click Social Share (Agent/Agency/Expert)

This is the flagship paid feature. Every platform has its own gotchas — read the entire section before touching code.

### 12.1 Tier-by-Tier Channel Access

| Tier | FB Page | Instagram | LinkedIn | X | TikTok | WhatsApp link |
|---|---|---|---|---|---|---|
| Agent | ✓ | ✓ | – | – | – | ✓ |
| Agency | ✓ | ✓ | ✓ | – | – | ✓ |
| Expert | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Channel availability is enforced server-side via the entitlements module (Part 1 §7). Agents see disabled "Upgrade to unlock" buttons for higher-tier channels.

### 12.2 Connecting Accounts

Agent dashboard → Settings → Connected Accounts → "Connect [Platform]" buttons. Each launches a platform-specific OAuth flow. Tokens encrypted with `pgsodium` and stored in `social_accounts` (Part 1 §4).

Disconnect flow: revoke the token at the platform first, then delete the row. Never just delete locally — leaves an orphaned grant on the platform.

### 12.3 Per-Platform Implementation Notes

**Reminder: app review timelines below are based on Anthropic's training data and historical patterns. Verify current requirements at submission time — Meta and LinkedIn change their review processes routinely.**

#### Facebook Page (Meta Graph API)

- **App needed:** Meta App, Business verified, Live mode
- **Permissions:** `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
- **Required URLs on Meta app:** Privacy Policy, Data Deletion, Terms of Service
- **App Review:** Required before going live. Submit a screencast showing the publish flow end-to-end. Plan **4–6 weeks**, sometimes longer.
- **Posting endpoint:** `POST /{page_id}/feed` with `message`, `link`, `published`
- **Image post:** `POST /{page_id}/photos` with `url` + `caption`
- **Multi-image post:** Multi-step — upload each photo as `published=false`, collect IDs, then create the post referencing them as `attached_media`
- **Token type:** Page access token (long-lived, ~60 day expiry, can be exchanged for never-expiring via debug_token if business verified)

#### Instagram Business

- Linked to a Facebook Page; account must be Business or Creator
- **Permissions:** `instagram_basic`, `instagram_content_publish`
- **Critical limitation:** No clickable links in caption. UI must remind agent. The link goes in their bio (out of scope for this feature) or in a comment posted by the agent after publish.
- **Image post — two steps:**
  1. `POST /{ig_user_id}/media` (creates a container with `image_url` + `caption`)
  2. `POST /{ig_user_id}/media_publish` with the container ID
- **Carousel (up to 10 images):** Create a child container per image (with `is_carousel_item=true`), then a carousel container referencing the children, then publish
- **Reels / video:** Supported but adds complexity. v1 = images only. Reels = v1.1.

#### LinkedIn

- **App:** LinkedIn Developer App
- **Products to enable:** "Share on LinkedIn" + "Marketing Developer Platform"
- **Marketing Developer Platform requires Partner approval** — apply Day 1, expect weeks of back-and-forth
- **Personal share:** `POST /v2/ugcPosts` with `author: "urn:li:person:{id}"`
- **Company page:** Same endpoint, `author: "urn:li:organization:{id}"`, requires `w_organization_social` scope
- **Image upload (3 steps):**
  1. Register upload (`POST /v2/assets?action=registerUpload`) — get a presigned URL
  2. PUT the binary to the presigned URL
  3. Reference the asset URN in the post
- **Token expiry:** 60 days. Refresh tokens available with proper scopes. Build a daily cron to refresh tokens approaching expiry.

#### X (Twitter)

- **API tier:** Basic (paid). Pricing was around $200/mo as of 2024 and has changed since — **verify current pricing during dev kickoff** before committing.
- **Auth:** OAuth 2.0 with PKCE
- **Posting:** `POST /2/tweets` with `text` and optional `media.media_ids[]`
- **Media upload:** Use the v1.1 `media/upload` endpoint (chunked for video; single-shot for images < 5 MB)
- **Length:** 280 characters for free/Basic API access. Truncate templates accordingly.
- **Risk:** X policy and pricing have been volatile. Build with a clean abstraction so it's easy to disable/remove without breaking other channels.

#### TikTok Content Posting API

- **Approval required:** Apply through TikTok for Developers; review is restrictive
- **Video only** — for "share a listing" you must generate a video from listing photos. Options:
  - Cloudflare Workflow + `ffmpeg-wasm` → slideshow video (cheap, ugly)
  - External service (e.g., Bannerbear, Shotstack, Creatomate) → polished slideshow video (per-render fee)
  - Defer to v1.1 unless a paying Expert customer specifically requires it
- **Posting (two-step):**
  1. Initialize upload — get an upload URL
  2. Upload chunks
  3. Publish with caption + hashtags
- **Recommendation:** Defer to v1.1. Note in pricing page: "TikTok integration coming Q3."

#### WhatsApp "Share" Link (channel for completeness, not a real API post)

- Generates `https://wa.me/?text={encoded_message_with_link}`
- One-tap shares the listing to the agent's WhatsApp contacts via the WhatsApp app
- **Critical for LATAM market** — in DR, Mexico, Brazil, Argentina, WhatsApp is how real estate happens
- No OAuth, no review, no API cost. Ship it day one.

### 12.4 Per-Platform Content Templates

Each platform has its own content rules. Centralize in `/lib/social/templates.ts`.

```typescript
type ListingContext = {
  title: string;
  description: string;
  price: string;          // pre-formatted with currency
  city: string;
  country: string;
  bedrooms: number;
  bathrooms: number;
  area: string;           // pre-formatted, e.g. "1,200 sqft"
  url: string;            // canonical property URL
  agentName: string;
  hashtags: string[];     // generated from city, type, etc.
  locale: 'en' | 'es';
};

export const templates = {
  facebook: (l: ListingContext) => `
🏡 ${l.title}

📍 ${l.city}, ${l.country}
💰 ${l.price}
🛏 ${l.bedrooms} · 🛁 ${l.bathrooms} · 📐 ${l.area}

${l.description.slice(0, 800)}

👉 ${l.url}

${l.hashtags.map(h => `#${h}`).join(' ')}
`.trim(),

  instagram: (l: ListingContext) => `
${l.title} 🏡

📍 ${l.city}
💰 ${l.price}
🛏 ${l.bedrooms} | 🛁 ${l.bathrooms} | 📐 ${l.area}

${l.locale === 'es' ? 'DM para más detalles · Link en bio' : 'DM for details · Link in bio'}

${l.hashtags.slice(0, 15).map(h => `#${h}`).join(' ')}
`.trim(),

  linkedin: (l: ListingContext) => `
New listing in ${l.city}: ${l.title}

A ${l.bedrooms}-bedroom property at ${l.price}. ${l.bathrooms} bathrooms, ${l.area}.

${l.description.slice(0, 1200)}

Full details: ${l.url}

${l.hashtags.slice(0, 5).map(h => `#${h}`).join(' ')}
`.trim(),

  twitter: (l: ListingContext) => {
    const base = `🏡 ${l.title}\n📍 ${l.city} · ${l.price}\n${l.bedrooms}bd ${l.bathrooms}ba · ${l.area}\n${l.url}`;
    return base.slice(0, 270);
  },

  tiktok: (l: ListingContext) =>
    `${l.title} in ${l.city} · ${l.price} ${l.hashtags.slice(0, 5).map(h => `#${h}`).join(' ')}`,
};
```

Templates have ES variants for the marketing copy lines. Listing fields (title, description) come pre-localized from `properties.title_es` / `description_es` if locale=es.

### 12.5 Fan-Out Worker

When the agent clicks "Publish to Social," create one queue message per connected platform:

```typescript
// /workers/social-fanout/index.ts
type SocialPostJob = {
  id: string;              // social_posts.id
  propertyId: string;
  platform: 'facebook' | 'instagram' | 'linkedin' | 'twitter' | 'tiktok';
  socialAccountId: string;
  retryCount: number;
};

export default {
  async queue(batch: MessageBatch<SocialPostJob>, env: Env) {
    for (const msg of batch.messages) {
      const job = msg.body;
      try {
        await postToPlatform(job, env);
        msg.ack();
      } catch (err) {
        const isRetryable = !err.message.includes('AUTH_INVALID');
        if (isRetryable && job.retryCount < 3) {
          // Exponential backoff: 1m, 5m, 15m
          msg.retry({ delaySeconds: [60, 300, 900][job.retryCount] });
        } else {
          await markFailed(job.id, err.message);
          msg.ack();
        }
      }
    }
  }
};
```

Auth-invalid errors should not retry — they need user reconnection. Mark the row as failed with a clear reason.

### 12.6 Status UI for Agent

Realtime channel pushes status updates as posts complete. Agent sees:

```
┌─────────────────────────────────────────────────┐
│  Posted to:                                     │
│  ✅ Facebook    · 2 min ago · View post         │
│  ✅ Instagram   · 2 min ago · View post         │
│  ⏳ LinkedIn    · Posting...                    │
│  ❌ X/Twitter   · Token expired · Reconnect     │
│  ⏸ TikTok      · Not connected                  │
└─────────────────────────────────────────────────┘
```

### 12.7 Scheduling

- Agent picks "Post now" or a datetime per platform
- Stored as `social_posts.scheduled_for`; cron Worker (every minute) enqueues due posts
- Limits: max 50 scheduled per agent at once; max 5 posts per platform per listing per week (anti-spam)

### 12.8 Metrics Refresh

- Daily cron Worker fetches metrics for posts < 30 days old
- Update `metrics` jsonb (likes, shares, comments, clicks)
- Display per-listing aggregate in Performance dashboard

### 12.9 Agent UX for First-Time Setup

When an agent first publishes a listing, surface the social-share opt-in inline rather than buried in settings:

> **Reach more buyers** — Connect your Facebook Page and Instagram Business account to share new listings with one click.
> [Connect Facebook] [Connect Instagram] [Skip for now]

Friction here directly determines adoption of the feature you're paying for.

---

## 13. AI Features (Expert Tier)

### 13.1 Reality Check

The original spec promised "AI pricing suggestions," "predictive market analytics," and "comp engine." Be honest with stakeholders:

- Real ML pricing models require training data (sale prices, time on market, comp transactions) you won't have at launch.
- Zillow's iBuying program shut down in part because they couldn't price homes accurately enough at scale.
- **What you can ship at v1:** rule-based "pricing assistant" + LLM-powered text generation. Position as "data-driven insights," not "AI predictions." Switch to ML in v2 once you have data.

### 13.2 Pricing Assistant (rule-based for v1)

Given a draft listing:
1. Pull last 90 days of `active` + `sold` listings within 2 km, same property type, same listing type
2. Filter to ±25% bedrooms, ±25% area
3. Compute: median, p25, p75 price-per-area
4. Show agent: "Suggested range: $X – $Y based on N comps"
5. Soft warning if agent's price is outside the range

```sql
-- Comp query
with target as (
  select geom, bedrooms, area_sqft, listing_type, property_type
  from properties where id = $1
)
select
  percentile_cont(0.50) within group (order by p.price_amount / nullif(p.area_sqft, 0)) as median_psf,
  percentile_cont(0.25) within group (order by p.price_amount / nullif(p.area_sqft, 0)) as p25_psf,
  percentile_cont(0.75) within group (order by p.price_amount / nullif(p.area_sqft, 0)) as p75_psf,
  count(*) as n
from properties p, target t
where p.status in ('active', 'sold')
  and p.listing_type = t.listing_type
  and p.property_type = t.property_type
  and p.bedrooms between t.bedrooms - 1 and t.bedrooms + 1
  and p.area_sqft between t.area_sqft * 0.75 and t.area_sqft * 1.25
  and ST_DWithin(p.geom, t.geom, 2000)
  and p.published_at > now() - interval '90 days';
```

### 13.3 Comp Selection
- Show top 6 comps with thumbnail, price, beds/baths, distance, sold-date if applicable
- Agent can include/exclude individual comps; recompute median
- Export comp set to PDF (Premium tier also gets this view, read-only)

### 13.4 AI Description Polish
- Agent writes rough description → "Enhance with AI" button
- Calls Claude API with a prompt to improve grammar/structure, **preserve all factual content**
- Returns 3 variants; agent picks one
- System prompt: "Do not change price, address, bedroom count, bathroom count, area, or any other factual claim. Only improve clarity and flow."

### 13.5 AI Follow-Up Sequences
- Lead arrives → if no agent response in N hours → AI drafts follow-up email
- Agent reviews and approves before send (human-in-the-loop, **never auto-send**)
- Templates per lead source, language, listing type
- Audit log entry for every AI-suggested message

### 13.6 Predictive Analytics — Label Honestly

v1 = trend lines from existing data, not forecasts:
- Price/sqft trend in city/neighborhood (last 12 months)
- Days-on-market trend
- Inventory levels
- Demand heatmap = search volume in area, from internal logs (not public)

**Do not promise "predictions of future prices."** That phrase is regulated in some jurisdictions and creates liability.

### 13.7 Audit Log for AI Actions
Every AI-generated content (descriptions, blog drafts, follow-up drafts) writes an entry in `admin_actions` with `actor_user_id = system`, `action_type` prefixed `ai.*`. Admin can review and undo.

### 13.8 Cost Containment

LLM API calls cost money per token. Budget per Expert account:
- Pricing assistant: free (no LLM, just SQL)
- Description polish: 3 generations per listing, hard cap 20/day per agent
- Follow-up drafts: 5 per lead, hard cap 100/day per org
- Blog generation: 2 per listing, hard cap 5/day per org

Track usage in `ai_usage_ledger` table (similar to `featured_credits_ledger`). Show usage meter in Expert dashboard.

---

## 14. Auto-Blog Generation

### 14.1 SEO Risk

Google's spam policies target "scaled content abuse" and "AI-generated content with no editorial value." A pipeline that auto-publishes one templated blog per listing across thousands of listings will get penalized — possibly across the whole domain, not just the blog section.

### 14.2 How to Do This Without Tanking SEO

1. **Generate, don't auto-publish.** AI creates a draft. Agent reviews, edits, publishes.
2. **Inject unique local context.** Each post pulls neighborhood data, recent comp sales, walkability, transit, school info — not just the listing fields.
3. **Long-form, not blurbs.** Target 800–1500 words minimum. Short posts compound the spam signal.
4. **Rate-limit publishing.** Max 5 published posts per domain per day, regardless of listing volume. This is enforced at publish time, not draft time.
5. **Distinct URL pattern.** `/{locale}/insights/{slug}` — separate from listings.
6. **Editor pass required.** Agent must spend at least 60 seconds on the edit page (tracked) before "Publish" is enabled. Discourages mass-publish.
7. **Disclosure.** Footer of each post: "Drafted with AI assistance, edited by [agent name]." Honest and avoids future trust issues.

### 14.3 Generation Prompt (Claude API)

```
You are writing a real estate market insight piece for {city}, {country}, in {locale}.

Listing context:
{property_json}

Local data:
- Median price/sqft in this neighborhood: {median_psf}
- Days-on-market median: {dom_median}
- Inventory change vs 90 days ago: {inventory_delta}%
- Notable nearby: {nearby_landmarks}

Write 1000–1200 words. Structure:
1. Hook: what makes this property notable
2. Neighborhood context: what buyers should know about {neighborhood}
3. Market context: how it compares to recent activity
4. Buyer profile: who this property suits
5. Practical considerations: commute, schools, lifestyle

Rules:
- Do NOT invent facts. If a data point isn't given, omit it.
- Do NOT include the price prominently — the listing page does that.
- Do NOT use sales language ("don't miss", "act fast", "perfect for").
- Tone: knowledgeable local advisor, not a salesperson.
- Output: Markdown only, no preamble.
```

### 14.4 Workflow

```
Listing published (Expert tier)
  ↓
Worker enqueues blog job
  ↓
Worker calls Claude with context + local data
  ↓
Saves draft to blog_posts (status='draft', ai_generated=true)
  ↓
Email agent: "Your draft is ready"
  ↓
Agent edits in dashboard (timer enforced)
  ↓
Agent clicks "Publish"
  ↓
Daily-rate-limit check passes
  ↓
Post goes live + indexed in sitemap + linked from property page + linked from city landing
```

---

## 15. Bilingual EN/ES + Light/Dark Theme

### 15.1 i18n Setup

Use `next-intl` v3+. Locale-prefixed routes:

```
/en/properties/luxury-penthouse-santo-domingo-dominican-republic-3xk9wz
/es/propiedades/penthouse-lujo-santo-domingo-republica-dominicana-3xk9wz
```

### 15.2 Translation Strategy

| Content | Source | Method |
|---|---|---|
| UI strings | `messages/en.json`, `messages/es.json` | Human-translated, version-controlled |
| Property titles/descriptions | DB columns `title_en`, `title_es`, `description_en`, `description_es` | Agent enters one, AI suggests the other, agent confirms |
| Blog posts | `blog_posts.locale` → separate row per locale | Originally written or AI-translated + edited |
| Slugs | `property_slugs` table, one row per (property, locale) | Generated from translated title |
| Emails | i18n template files | `user.locale` |

### 15.3 Hreflang

Render in `<head>`:

```html
<link rel="alternate" hreflang="en" href="https://www.advertisehomes.online/en/properties/..." />
<link rel="alternate" hreflang="es" href="https://www.advertisehomes.online/es/propiedades/..." />
<link rel="alternate" hreflang="x-default" href="https://www.advertisehomes.online/en/..." />
```

> **Note:** the spec text uses the old `.com` domain in places. Substitute `advertisehomes.online` everywhere when implementing. This is the canonical domain.

### 15.4 Locale Detection (first visit)

1. User preference if logged in
2. `Accept-Language` header
3. IP → country (Cloudflare provides `cf-ipcountry` header)
4. Default to EN

**Never auto-redirect.** Always let user click the language toggle. Auto-redirect frustrates link-sharing and confuses search engines.

### 15.5 Theme Toggle

```typescript
// /providers/theme-provider.tsx
import { ThemeProvider } from 'next-themes';

<ThemeProvider
  attribute="class"
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
>
```

Tailwind config:

```js
// tailwind.config.ts
{
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // CSS variables so themes can be customized per agency (branding)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // ...
      }
    }
  }
}
```

### 15.6 Photo Display in Dark Mode
- Property photos shown on a slightly tinted (`#0c0c0c` not pure black) background
- Add subtle 1px border on photos in dark mode for separation
- Hero images: never invert; never apply CSS filters to listing photography

### 15.7 Language Toggle UI
- Top-right header: globe icon + current locale (`EN ▾` / `ES ▾`)
- Dropdown lists available locales
- Switching the locale on a property page navigates to the translated slug (lookup in `property_slugs` by `locale`)
- If no translation exists yet, fall back to source locale with a small "Translation pending" notice — do not 404

---

## 16. SEO Implementation

### 16.1 URL Structure

| Page | URL |
|---|---|
| Home | `/{locale}/` |
| Search | `/{locale}/search?...` |
| City landing | `/{locale}/properties-in/{country}/{city}` |
| Neighborhood landing | `/{locale}/properties-in/{country}/{city}/{neighborhood}` |
| Property detail (EN) | `/en/properties/{slug}-{shortId}` |
| Property detail (ES) | `/es/propiedades/{slug}-{shortId}` |
| Agent profile | `/{locale}/agents/{slug}` |
| Agency page | `/{locale}/agencies/{slug}` |
| Blog post | `/{locale}/insights/{slug}` |

### 16.2 Slug Format

`{title-words}-{city}-{country}` truncated to 60 chars, plus `-{shortId}` (6-char base36).

Example: `luxury-penthouse-santo-domingo-dr-3xk9wz`

ShortId is stable across slug renames. Old slugs 301 to current.

### 16.3 Property Page Head

```html
<head>
  <title>{price} · {bedrooms}bd in {city} | AHO</title>
  <meta name="description" content="{auto_generated_160_char}" />
  <link rel="canonical" href="{canonical_url}" />

  <link rel="alternate" hreflang="en" href="..." />
  <link rel="alternate" hreflang="es" href="..." />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="..." />
  <meta property="og:description" content="..." />
  <meta property="og:image" content="{og_image_1200x630}" />
  <meta property="og:url" content="..." />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="..." />
  <meta name="twitter:description" content="..." />
  <meta name="twitter:image" content="..." />

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "name": "...",
    "url": "...",
    "image": ["..."],
    "address": { "@type": "PostalAddress", ... },
    "geo": { "@type": "GeoCoordinates", "latitude": ..., "longitude": ... },
    "offers": { "@type": "Offer", "price": ..., "priceCurrency": "USD" },
    "numberOfRooms": ...,
    "numberOfBedrooms": ...,
    "numberOfBathroomsTotal": ...,
    "floorSize": { "@type": "QuantitativeValue", "value": ..., "unitCode": "FTK" }
  }
  </script>
</head>
```

### 16.4 Sitemaps

- `/sitemap-index.xml` — index file
- `/sitemap-properties-{n}.xml` — split into 50k URLs each
- `/sitemap-agents.xml`
- `/sitemap-blog.xml`
- `/sitemap-cities.xml`
- `/sitemap-images.xml` — hero image per property with caption

Daily cron Worker generates and caches them at edge.

### 16.5 Slug Changes & Redirects

When a property's title changes, generate a new slug and 301 the old:

```typescript
const oldSlug = property.current_slug;
const newSlug = generateSlug(newTitle, city, country);
if (oldSlug !== newSlug) {
  await db.transaction(async (tx) => {
    await tx.update(propertySlugs)
      .set({ is_current: false })
      .where({ property_id: propId, locale });
    await tx.insert(propertySlugs)
      .values({ property_id: propId, locale, slug: newSlug, is_current: true });
  });
  // Old slug still resolves; middleware 301s to current
}
```

### 16.6 IndexNow

Submit URL changes to Bing/Yandex IndexNow API. Cron Worker submits on publish, update, unpublish.

### 16.7 Robots.txt

```
User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /dashboard/
Disallow: /*?utm_*
Disallow: /search?

Sitemap: https://www.advertisehomes.online/sitemap-index.xml
```

Disallowing `/search?` prevents infinite faceted-URL crawling. Provide canonical city/neighborhood landing pages for indexable browse.

### 16.8 Internal Linking

Every property page links to:
- City landing
- Neighborhood landing
- Listing agent's profile
- Up to 6 similar properties (same type, ±20% price, same city)
- Blog posts tagged with this neighborhood (if any exist)

City landing pages link to:
- Each neighborhood within the city
- Top agents in the city
- Property type subpages (Houses for sale in X, Condos for rent in X, etc.)

### 16.9 Performance for SEO

| Metric | Target | Critical for |
|---|---|---|
| LCP | < 2.5s | Property page, search |
| INP | < 200ms | All interactions |
| CLS | < 0.1 | Page load |
| TTFB | < 600ms | All pages |

Hero image: WebP via CF Images, preloaded with `<link rel="preload" as="image" fetchpriority="high">`. Above-fold content rendered server-side.

---

## 17. WhatsApp & Lead Contact

### 17.1 Contact Pattern by Tier

| Viewer Tier | Form | Phone | Email | WhatsApp |
|---|---|---|---|---|
| Free | redirect to register | – | – | – |
| Registered | ✓ relay | – | – | – |
| Premium | ✓ direct | ✓ visible | ✓ visible | ✓ wa.me |
| Agent (logged in viewing other agent's listing) | ✓ direct | ✓ | ✓ | ✓ |

### 17.2 WhatsApp Click-to-Chat

```typescript
function buildWhatsAppLink(agentPhone: string, listing: Property, viewerLocale: 'en' | 'es') {
  const messages = {
    en: `Hi, I'm interested in "${listing.title_en}" — ${listing.url}`,
    es: `Hola, me interesa "${listing.title_es}" — ${listing.url}`,
  };
  const phone = agentPhone.replace(/\D/g, ''); // E.164 without +
  const text = encodeURIComponent(messages[viewerLocale]);
  return `https://wa.me/${phone}?text=${text}`;
}
```

Track clicks: button is a link to `/api/contact/whatsapp/{listing_id}`, which:
1. Records a lead with `source='whatsapp_click'`
2. 302-redirects to the wa.me URL

### 17.3 Form Relay
- Free/Registered submit form → server creates lead → email/SMS to agent
- Agent's contact details never exposed
- Reply via email-relay: emails go through `lead-{id}@inbound.advertisehomes.online`, forwarded to agent, reply returns through the relay
- Inbound email handling via Cloudflare Email Routing or Resend's inbound webhook

### 17.4 Lead Routing (Agency / Expert)

Default: round-robin among assigned agents. Configurable rules:
- By zip/postal code
- By price band
- By language (EN agents get EN leads)
- By listing-type specialty
- "Sticky" — same lead returns to same agent for repeat inquiries

### 17.5 SLA Timer (Expert)
- 5-min first-response target
- If unanswered after threshold, escalate (notify manager, reroute)
- Visible countdown in agent inbox

---

## 18. Admin Dashboard

### 18.1 Pages

#### Overview
- MRR (current month vs previous, sparkline)
- Active subscriptions by tier (stacked bar)
- New signups today / this week
- Conversion funnel: Free → Registered → Paid
- Listings: total, active, pending review, suspended
- Top 10 cities by activity
- Recent admin actions (last 20)

#### Users
- Searchable table: email, tier, status, country, signup date, last login
- Filters: tier, status, MFA enabled, country
- Detail view: profile, subscription history, activity log, devices, listings, leads, payments
- Actions: edit profile, reset password, force MFA, suspend, reactivate, change tier (with proration warning), impersonate (logs to `admin_actions`, 30-min time-limited, banner shown to impersonator)

#### Subscriptions
- Status board: trialing / active / past_due / cancelled
- Filters: plan, status, MRR contribution
- Per-row: customer, plan, amount, next bill, actions (refund — RBAC, extend trial, change plan)
- Bulk: apply coupon, migrate plan

#### Properties
- All listings with filter: status, country, owner org, has flags
- Pending review queue with side-by-side comparison
- Suspend/restore with reason captured
- Featured placement scheduler
- Bulk actions

#### Leads
- Cross-org lead funnel
- SLA breach report
- Spam/abuse review queue

#### Analytics
- Revenue: MRR, ARR, ARPA by tier, cohort retention, gross/net churn
- Users: signups, conversions, DAU/WAU/MAU
- Listings: published per day, time to publish, fill rate (% with all fields)
- Search: top queries, zero-result queries
- Social: posts succeeded/failed by platform
- Export: CSV, PDF, schedule by email

#### Content / Blog
- Approve AI-generated drafts before publish
- Featured / pinned blog posts
- Editorial calendar

#### System Config
- Plans & pricing (synced from Stripe)
- Trial lengths
- Coupons (Stripe sync)
- Feature flags (Cloudflare KV)
- Email/SMS templates (i18n)
- Rank boost weights
- Rate limits
- Maintenance mode toggle
- Feature kill-switches (e.g., disable social posting globally if a platform breaks)

#### Compliance
- DMCA takedown queue
- GDPR data requests (export/delete)
- Flagged content review
- Agent license verifications pending

### 18.2 Audit Log
Every admin action writes to `admin_actions` with before/after JSON. Read-only audit log page filterable by actor, target, action type, date range.

---

## 19. Agent / Agency / Expert Consoles

### 19.1 Agent Console

- **Dashboard** — listings count (X / 5), active leads, this month's views/saves, featured credits balance, social post status
- **My Listings** — grid with status, edit, archive, feature button
- **Create / Edit Listing** — multi-step form (basics → location → media → description → pricing → review)
- **Inbox** — leads with filters; thread view with email/SMS/WhatsApp history
- **Performance** — per-listing analytics; views, saves, contact rate, ranking position
- **My Profile** — public profile editing; license number, bio, photo, languages, specialties
- **Reviews** — incoming reviews; respond publicly; flag for admin
- **Featured Credits** — balance, usage history, buy more
- **Social Accounts** — connect/disconnect FB, IG, LinkedIn, X, TikTok per tier
- **Billing** — Stripe Customer Portal embed
- **Settings** — notification preferences, language, theme

### 19.2 Agency Console (adds to Agent)

- **Team** — invite agents (email), manage roles, transfer listings between agents, deactivate seats
- **Lead Routing** — set rules: round-robin / rule-based; edit per-rule
- **CRM Pipeline** — kanban: new → contacted → qualified → appointment → offer → closed
- **Bulk Import** — CSV upload, mapping wizard, preview, confirm
- **Branding** — agency logo, primary color, custom subdomain (`{slug}.advertisehomes.online` if available), email signature template
- **Reports** — agent leaderboards, source attribution, revenue per agent

### 19.3 Expert Console (adds to Agency)

- **AI Assistant** — pricing suggestions, comp explorer, follow-up drafts queue
- **Auto-Blog** — drafts queue, edit before publish
- **Automation Flows** — visual builder (or n8n/Cloudflare Workflows embed) for: new lead → AI follow-up → SMS if no response → assign to manager
- **Integrations** — connect Salesforce, HubSpot, custom webhook URL; outbound API keys
- **Predictive Analytics** — territory heatmaps, demand by neighborhood, price trend visualizations (clearly labeled as estimates)
- **Priority Support** — direct chat to support, < 4-hour SLA

---

## 20. Email, SMS & Notifications

### 20.1 Channels
- **Transactional email:** Resend
- **Marketing email:** Resend or Postmark/SendGrid for higher volume; honor unsubscribe
- **SMS:** Twilio (consider Infobip for LATAM cost)
- **Push** (v2): Web Push, expo-push for mobile app

### 20.2 Required Templates (EN + ES)

| Trigger | Email | SMS |
|---|---|---|
| Welcome | ✓ | – |
| Email verification | ✓ | – |
| Password reset | ✓ | – |
| MFA code | ✓ (fallback) | ✓ |
| New lead (agent) | ✓ | ✓ if opted in |
| Lead SLA breach (Expert) | ✓ to manager | ✓ |
| Listing approved | ✓ | – |
| Listing rejected | ✓ | – |
| Listing about to expire | ✓ at -7d, -1d | – |
| Saved-search match | ✓ | – |
| Trial ending in 3 days | ✓ | – |
| Payment failed | ✓ | ✓ on T+5 |
| Subscription cancelled | ✓ | – |
| Subscription downgraded | ✓ | – |
| Win-back (90 days post-cancel) | ✓ | – |

### 20.3 Notification Preferences
User → Settings → Notifications: toggle per channel × per category. Unsubscribe links in marketing email; transactional cannot be opted out.

### 20.4 Email Deliverability
- SPF, DKIM, DMARC configured for `mail.advertisehomes.online`
- Subdomain isolation: marketing on `mail.`, transactional on `tx.`
- Warm up the domain over 30 days before launch
- Monitor bounce rate (< 2%) and spam reports (< 0.1%)
- BIMI (later) for logo display in supporting clients

---

## 21. Security

### 21.1 At Rest
- Postgres: encryption at rest (Supabase default)
- R2: encryption at rest (Cloudflare default)
- Sensitive columns (OAuth tokens, MFA secrets): app-layer AES-256-GCM via `pgsodium` extension
- Backups: Supabase daily; export weekly to off-account R2 bucket

### 21.2 In Transit
- TLS 1.3 everywhere
- HSTS with `max-age=31536000; includeSubDomains; preload`
- Cloudflare in front of everything

### 21.3 Secrets
- Cloudflare Workers Secrets for Workers
- `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, OAuth client secrets — Workers Secrets only
- Never commit secrets. Pre-commit hook with `detect-secrets`

### 21.4 Rate Limiting

Cloudflare WAF + KV-backed counters in Workers:

| Endpoint | Limit |
|---|---|
| `/auth/login` | 5/min per IP |
| `/auth/register` | 5/hour per IP |
| `/auth/reset-password` | 3/hour per IP |
| Lead form submit | 10/hour per IP |
| Public search | 60/min per IP |
| Property create | 30/day per agent |
| Bulk import | 1/hour per org |
| Social post | 20/hour per agent |
| API (Expert) | 1000/hour per key |

### 21.5 Input Validation
- All API inputs validated with Zod schemas — reject before DB hit
- HTML in user content sanitized with `isomorphic-dompurify`
- No raw SQL; parameterized queries / Supabase client only

### 21.6 CSRF / XSS / CSP
- Next.js Server Actions use built-in CSRF protection
- API routes verify `Origin` header
- Strict Content-Security-Policy header in middleware:

```
Content-Security-Policy: default-src 'self';
  script-src 'self' 'nonce-{nonce}' https://js.stripe.com https://challenges.cloudflare.com;
  img-src 'self' data: https://imagedelivery.net https://*.r2.dev;
  connect-src 'self' https://*.supabase.co https://api.stripe.com;
  frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com;
  object-src 'none'; base-uri 'self';
```

### 21.7 File Upload Validation
- Magic-byte sniffing (don't trust extension or `Content-Type`)
- Reject SVG (XSS risk); allow PNG/JPEG/WebP/HEIC
- Strip EXIF (geolocation leakage)
- Max 25 MB per image
- Virus scan via ClamAV or Cloudflare on upload

### 21.8 Account Security
- Suspicious login (new country/device) → MFA challenge + email alert
- Device list in user settings; revoke individual sessions
- Password breach check via HaveIBeenPwned k-anonymity API on signup/change

### 21.9 Stripe Webhook Security
- Verify signature on every event
- Idempotency: store event ID in `stripe_events` table; reject duplicates
- Respond < 5s; do heavy work async via Queues

### 21.10 OAuth Token Security (Social)
- Encrypt at rest with `pgsodium`
- Refresh tokens never sent to client
- Scope minimization
- Revoke flow when user disconnects (call platform's revoke endpoint)

### 21.11 Audit & Logging
- All admin actions logged with before/after
- Login history per user (IP, country, device, success/fail)
- Failed-login alerts after 5 attempts
- Retention: 1 year

---

## 22. Compliance & Legal

### 22.1 Required Documents (get a lawyer)
- Terms of Service
- Privacy Policy (GDPR + CCPA + LGPD compliant)
- Cookie Policy + cookie banner
- Acceptable Use Policy
- DMCA Policy & takedown process
- Refund Policy

### 22.2 Fair Housing (if any US listings)
- Cannot use language like "perfect for [demographic]," "exclusive neighborhood," "no children"
- Listing form: client-side warning if such phrases detected (regex + word list)
- Banner on every US listing page: "This listing complies with the Fair Housing Act"

### 22.3 Agent License Verification
- On agent registration: collect license number + jurisdiction
- v1: manual verification by admin (queue in admin panel)
- v2: integration with state license boards where APIs exist
- Display verified badge on agent profile

### 22.4 GDPR (EU users)
- Right to access: user can export data (Settings → Download my data)
- Right to deletion: account deletion removes PII, anonymizes leads, retains transactional records 7 years for tax
- Right to rectification: profile edit
- Cookie consent: banner with granular toggles (necessary / analytics / marketing)
- DPA available on request
- Sub-processor list public

### 22.5 CCPA / LATAM equivalents
- "Do Not Sell My Info" link in footer
- Honor regional data requests within 30 days

### 22.6 Listing Accuracy
- Disclaimer on every listing: prices/details subject to change, verify with agent
- Last-updated timestamp visible
- Sold/rented listings clearly labeled, kept for transparency (not deleted)

### 22.7 Anti-Fraud
- Manual review queue for new agents and flagged listings
- Image reverse-search to detect copied listings (Google Vision API or perceptual hashing)
- Phone number reputation check (Twilio Lookup)
- Block listings posted from VPN/proxy IPs (with override for verified agencies)

### 22.8 Records Retention
- Financial records: 7 years
- Lead data: 3 years post-last-activity
- Login logs: 1 year
- Deleted account PII: purged within 30 days; anonymized records retained per above

---

## 23. Performance & Core Web Vitals

### 23.1 Targets

| Metric | Target | Critical for |
|---|---|---|
| LCP | < 2.5s | Property pages, search |
| INP | < 200ms | All interactions |
| CLS | < 0.1 | Page load layout |
| TTFB | < 600ms | All pages |

### 23.2 Techniques
- **SSR for SEO pages** (property, search, city landing); RSC where possible
- **Edge caching** for anonymous responses (Cloudflare Cache API)
- **Image optimization:** CF Images variants, lazy below-the-fold, `fetchpriority=high` on hero
- **Font loading:** `font-display: swap`, subset to needed glyphs, self-hosted
- **Code splitting:** route-based by default; dynamic imports for heavy components (map, chart libs)
- **Avoid layout shift:** explicit width/height on images, reserved space for ads/banners
- **No client-only data fetches above the fold**

### 23.3 Cache Strategy

| Resource | TTL | Strategy |
|---|---|---|
| Property page (anon) | 60s edge / SWR | Stale-while-revalidate |
| Property page (logged in) | private, no edge cache | Per-user RSC |
| Search results (anon) | 30s edge | Bypass for premium filters |
| Static assets | 1y immutable | Versioned filenames |
| OG images | 1d | Regenerate on update |
| Sitemaps | 1h | Cron-regenerated |

---

## 24. Testing & QA

### 24.1 Unit Tests (Vitest)
- All entitlement logic
- Slug generation
- Currency conversion
- All Zod schemas
- Pure utility functions
- Coverage target: 80% on `/lib/`

### 24.2 Integration Tests
- Supabase RLS — write tests that simulate users from each tier and verify access
- Stripe webhook handlers — fixture events for every webhook type
- Social posting — mock platform APIs

### 24.3 E2E Tests (Playwright)
- Sign up → verify email → upgrade to Agent → create listing → publish → see listing live
- Free user views listing → click contact → prompted to register
- Premium user views listing → sees agent contact info
- Agent connects Facebook → publishes listing → social post sent
- Payment failure → user sees banner → updates card → access restored
- Switch language → persists across pages
- Switch theme → persists across reloads

### 24.4 Manual QA Checklist (before each release)
- Sign up flows: email/pw, Google, magic link
- All paid plan checkouts (Stripe test card)
- All webhooks process correctly (Stripe CLI replay)
- Cap enforcement: 6th listing for Agent should block
- Downgrade flow: archive overflow listings
- EN ↔ ES toggle preserves context on every page type
- Light ↔ dark theme toggles cleanly, persists
- Property page Lighthouse score ≥ 90 mobile
- Mapbox loads on all map pages
- All forms keyboard-navigable (WCAG 2.2 AA)
- Screen reader test on 5 key flows
- Mobile responsive 320px → 1920px
- All emails render correctly in Gmail, Outlook, Apple Mail (use Litmus or similar)

### 24.5 Load Testing
- Target: 1000 concurrent users browsing
- Target: 100 concurrent searches/sec
- Target: 10 listing publishes/sec
- Tool: k6 or Artillery, run against staging before launch

### 24.6 Security Testing
- OWASP ZAP automated scan against staging
- Manual penetration test (3rd party) before launch
- Quarterly dependency audit (`pnpm audit`, `npm audit`, Dependabot)

---

## 25. DevOps & Deployment

### 25.1 Environments

| Env | Domain | Purpose |
|---|---|---|
| Local | `localhost:3000` | Dev |
| Preview | `*.aho.pages.dev` | Per-PR |
| Staging | `staging.advertisehomes.online` | Pre-prod testing |
| Production | `www.advertisehomes.online` | Live |

Each environment has its own:
- Supabase project (or schema in dev)
- Stripe account / mode (test in non-prod, live in prod)
- Cloudflare account / Pages project
- R2 bucket
- Domain & DNS

### 25.2 CI/CD (GitHub Actions)

- **On PR:** lint, typecheck, unit tests, integration tests, preview deploy
- **On merge to `main`:** all of the above + E2E tests against preview, then deploy to staging
- **On tag `v*`:** deploy to production after manual approval

### 25.3 Database Migrations
- Tool: Drizzle Kit (per `DECISIONS.md` entry)
- Migrations in `/db/migrations`
- Forward-only; never edit applied migrations
- Apply via CI to staging on merge; to prod on tag with manual approval
- Test rollback strategy: snapshot before each prod migration, document rollback SQL in PR

### 25.4 Branching Strategy
- `main` = staging-deployable always
- Feature branches: `feat/*`, `fix/*`, `chore/*`
- PR required for all changes; squash-merge
- Tagged releases: `v0.1.0` etc. for prod deploys

### 25.5 Backups & DR
- Supabase daily backup (built-in)
- Weekly export to off-account R2 bucket via cron
- Backup retention: 30 days rolling, 12 monthly snapshots
- Quarterly DR drill: restore staging from backup, verify integrity
- RTO target: 4 hours
- RPO target: 24 hours

### 25.6 Feature Flags
- Cloudflare KV namespace `aho-flags`
- Read in middleware + server actions
- Admin UI for toggling flags
- Use cases: kill-switch broken features, gradual rollout of risky changes, A/B tests

---

## 26. Monitoring & Observability

### 26.1 Errors
- **Sentry** — frontend errors, Worker errors, API errors
- Source maps uploaded on deploy
- Alert rules: > 5 errors/min, any error in payment flow, any error in webhook handler

### 26.2 Performance
- Cloudflare Analytics — traffic, RUM Core Web Vitals
- Sentry Performance — slow transactions, N+1 queries
- Custom RUM via Web Vitals API → Cloudflare Analytics Engine

### 26.3 Logs
- Cloudflare Workers logs → Logpush → R2 (or external like Better Stack)
- Supabase logs accessible in dashboard
- Application logs structured JSON, with `request_id`, `user_id`, `org_id` tags

### 26.4 Uptime
- Cloudflare Health Checks on key endpoints (home, property, login, webhook)
- External monitor (Better Stack / UptimeRobot) — independent of CF
- Status page (status.advertisehomes.online) — public

### 26.5 Business Metrics
- MRR / ARR — Stripe Sigma or custom dashboard from Supabase data
- Signup → paid conversion — internal dashboard
- Lead SLA compliance — internal dashboard
- Social post success rate — internal dashboard

### 26.6 Alerts (PagerDuty or equivalent)
- P0 (page on call): site down, payment processor down, database down, > 1% error rate
- P1 (slack alert): elevated errors, slow response, webhook backlog
- P2 (email digest): warning thresholds, cost anomalies

---

## 27. Project Phases & Timeline

**Realistic timeline at maximum scope: 9–14 months solo senior dev, or 5–7 months team of 3.** Below assumes a team of 3 (1 backend, 1 frontend, 1 integrations/mobile) for sequencing illustration.

### Phase 0 — Foundation (Weeks 1–3)
- Repo, CI/CD, environments
- Supabase + RLS scaffolding
- Auth (email/pw, Google, magic link, MFA)
- Base Next.js app, i18n, theming
- Submit Meta + LinkedIn app reviews **on day 1** — they take weeks
- Domain DNS + email DKIM/SPF/DMARC + warm-up start

### Phase 1 — Buyer Side (Weeks 4–7)
- Property data model + image pipeline
- Search (Postgres FTS + PostGIS)
- Property detail page with full SEO
- Map view
- Favorites, saved searches, alerts
- City/neighborhood landing pages
- Sitemap pipeline
- WhatsApp / phone / email contact flows
- Lead capture & form relay

### Phase 2 — Agent Tier (Weeks 8–11)
- Stripe checkout + customer portal
- Listing CRUD with cap enforcement
- Agent profile & reviews
- Agent inbox & lead management
- Performance analytics
- Featured credits ledger
- Social account connect (FB, IG)
- One-click social share (FB + IG only initially)
- Manual listing review queue

### Phase 3 — Premium Buyer Tier (Weeks 12–13)
- Premium checkout
- Contact-info gating
- Advanced filters
- Full analytics views (price history, comp set view)
- Virtual tour support
- CSV/PDF export
- Saved-search instant alerts

### Phase 4 — Agency Tier (Weeks 14–18)
- Org model & seats
- Team invitation & role management
- Lead routing rules
- CRM-lite (kanban pipeline)
- Bulk CSV import
- Branding page / agency profile
- Add LinkedIn to social share (if approved by then)

### Phase 5 — Expert Tier (Weeks 19–24)
- Pricing assistant (rule-based)
- Comp explorer
- AI description polish
- AI follow-up drafts
- Auto-blog generation
- Predictive analytics views
- Salesforce/HubSpot connectors
- API access + webhooks
- Add X to social share (if Basic API budget approved)

### Phase 6 — Polish & Launch Prep (Weeks 25–28)
- Compliance review (Fair Housing, GDPR, ToS finalization)
- Penetration test
- Load test
- DR drill
- Migrate from staging to production data
- Finalize public marketing site
- Beta with 20 agents in pilot market
- Tax setup in Stripe for launch markets
- TikTok integration if approved

### Phase 7 — Launch (Weeks 29–32)
- Soft launch to a focused market (recommend single country)
- Customer support runbook
- On-call rotation
- Iteration based on first-week feedback
- Public launch + PR

### Risk-Adjusted Timeline
Add 25–40% buffer for:
- App review delays (Meta, LinkedIn, TikTok)
- Stripe Tax setup per jurisdiction
- Compliance lawyer turnaround
- Unforeseen integration issues
- AI feature tuning

---

## 28. Cost Estimate

**Verify all prices at kickoff** — Cloudflare, Supabase, Stripe, and the social platforms change pricing periodically. Numbers below are order-of-magnitude.

### 28.1 At 0 Users (Pre-Launch)

| Service | Monthly |
|---|---|
| Cloudflare Pages + Workers | $0 (free tier) |
| Cloudflare Images | $5 |
| Cloudflare R2 | ~$1 |
| Supabase Pro | $25 |
| Stripe | 0 (transaction fees only) |
| Resend | $0 (3k emails/mo free) |
| Twilio | $0 + per-message |
| Sentry | $0 (free tier) |
| Mapbox | $0 (50k loads/mo free) |
| Domain | ~$1 |
| **Subtotal** | **~$32** |
| LinkedIn / Meta / TikTok APIs | $0 |
| X API Basic | ~$200 (only if shipping X integration) |
| Anthropic Claude API | usage-based; budget $50 for testing |
| **With AI + X** | **~$282** |

### 28.2 At 1,000 Users / 200 Paid

| Service | Monthly |
|---|---|
| Cloudflare Workers (paid plan) | $5 |
| Cloudflare Images (50k stored, 500k delivered) | ~$8 |
| Cloudflare R2 (~50 GB) | ~$1 |
| Supabase Pro (8 GB DB) | $25 |
| Resend (50k emails) | ~$20 |
| Twilio SMS (5k messages) | ~$40 |
| Sentry Team | $26 |
| Mapbox (200k loads) | ~$25 |
| Stripe fees (2.9% + 30¢ × ~$10k MRR) | ~$320 absorbed in revenue |
| Anthropic Claude API | ~$100 |
| X API | $200 |
| **Total infra** | **~$450** |

### 28.3 At 10,000 Users / 2,000 Paid

| Service | Monthly |
|---|---|
| Cloudflare Workers (Paid + Unbound) | ~$50 |
| Cloudflare Images | ~$80 |
| Cloudflare R2 (500 GB) | ~$8 |
| Supabase Pro/Team (compute upgraded) | ~$100–500 |
| Resend (500k emails) | ~$100 |
| Twilio SMS (50k messages) | ~$400 |
| Sentry Business | $80 |
| Mapbox (2M loads) | ~$300 |
| Anthropic Claude API | ~$500–2000 |
| X API | $200 |
| **Total infra** | **~$1,800–3,700** |

### 28.4 One-Time / Project Costs
- Brand designer: $2k–10k
- Penetration test: $5k–15k
- Lawyer (ToS, Privacy Policy, Fair Housing, DPA): $3k–8k
- Stripe Tax setup per jurisdiction: minimal
- TikTok video generation service (if used): $0.10–0.30 per video

### 28.5 Stripe Transaction Fees
2.9% + $0.30 per charge (US/EU). Higher for cross-border, AmEx, etc. **Build into pricing model.** A $99/mo Agent plan nets ~$93 after Stripe.

---

## 29. Acceptance Criteria

### Per-Module Checklists

#### Auth
- All sign-up flows work and verify email
- MFA enrollment + recovery codes work
- Password reset works, expires correctly
- Suspicious login alert fires
- Sessions revocable per device

#### Subscriptions
- All 6 tiers can be purchased on test mode
- Stripe webhooks update subscription state correctly for every event type
- Idempotency: duplicate webhook = no duplicate side effects
- Dunning flow correctly degrades access at T+7
- Plan upgrade prorates correctly
- Plan downgrade enforces caps with grace period

#### Listings
- 6th listing on Agent tier blocked at publish
- 26th listing on Agency tier blocked at publish
- Cap enforcement is server-side (browser console can't bypass)
- Slug generation produces unique slugs
- Old slugs 301 to current after rename
- Pending review queue works

#### Search
- All filters return correct results (verified against fixtures)
- Map drag-to-search debounced and accurate
- Sort by price/recency/featured works
- Premium-gated filters return 403 for non-Premium
- Zero-result state shows helpful CTAs

#### Social Share
- OAuth connect/disconnect works for each platform
- Tokens encrypted at rest (verify via DB inspection)
- Auth-invalid errors don't retry; show clear reconnect CTA
- Successful posts have external_post_url stored
- Realtime status UI updates within 5s of platform response

#### SEO
- Lighthouse SEO score ≥ 95 on property page
- JSON-LD validates in Rich Results test
- All hreflang tags resolve to 200
- Sitemap covers all active listings within 1 hour of publish
- Canonical URL is correct and unique per listing

#### i18n / Theme
- Every public page exists in EN and ES
- Locale switch on a property page navigates to the correct translated slug (or shows "Translation pending" fallback, never 404)
- Theme persists across sessions
- No FOUC (flash of unstyled content) on theme load

#### Performance
- Property page LCP < 2.5s on simulated 4G
- INP < 200ms during typical interactions
- CLS < 0.1
- All images served from CDN

#### Security
- RLS verified for every table (see §24.2)
- CSP header present
- HSTS preload eligible
- No secrets in commits (verified by `git log`)
- OWASP ZAP scan: no high-severity findings
- Pen test passed

#### Compliance
- ToS, Privacy Policy, Cookie Policy live
- Cookie banner with granular consent
- Account deletion completes within 30 days
- Data export works (Settings → Download my data)

---

## 30. Open Questions for the Developer

These need decisions before or during build. Most belong in `OPEN_QUESTIONS.md` and should be resolved in writing (logged in `DECISIONS.md`).

### Already in OPEN_QUESTIONS.md (per scaffolding)
- Premium buyer tier scope (auto-converts trials? card-required trials?)
- TikTok integration timing (v1 / v1.1 / never)
- Launch market focus
- Commit/branch convention (squash vs. rebase)
- Package manager (pnpm vs. npm)

### To Add

1. **Service-role access pattern.** Where does service-role-keyed code run? Workers only, or Server Actions too? Lock this down before any RLS bypass exists. The narrower the surface that can bypass RLS, the smaller the audit perimeter.

2. **Drizzle vs. Supabase client.** When to use each? Suggested split: Drizzle for migrations + complex queries from Workers and Server Actions, Supabase client for client-side reads where RLS is doing the work. Document the rule and don't mix.

3. **Currency handling.** Store as integer cents in `price_amount_cents`, or `numeric(14,2)` as currently specified? For multi-currency: at what rate, refreshed how often, who's the source (ECB, Open Exchange Rates, fixer.io)? This affects search comparability and reporting.

4. **Address geocoding.** Mapbox Geocoding API, Google Geocoding, or self-hosted Nominatim? Per-call cost vs. cache strategy. Decide before the listing form is built — geocoding latency affects publish UX.

5. **Reverse-image fraud detection.** Google Vision API (per-call cost, robust) vs. perceptual hash (free, less robust). Decide based on early abuse rate; can start with pHash and upgrade.

6. **Agency seat billing.** Per-seat pricing (Stripe quantity-based) or flat? Per-seat has better unit economics but adds checkout/portal UX complexity. Reconcile with the Stripe model before building seats.

7. **Lead email relay.** Cloudflare Email Routing supports forwarding but not inbound webhooks for replies. To get reply-into-thread behavior, need Resend Inbound or SendGrid Inbound Parse. Pick one before lead inbox is built.

8. **Listing expiration.** 90 days then auto-archive? Auto-relist? Notify when? Affects sitemap, search ranking, agent UX, and data freshness.

9. **Sold/rented status.** Who can mark? Agent self-attests, buyer confirmation, or admin only? Affects data quality, analytics integrity, and trust signals to buyers.

10. **AI content disclosure.** Per-post disclosure (footer of each AI-assisted blog post) or sitewide footer disclosure only? Legal/PR call.

11. **Mobile app.** Native (React Native / Expo) vs. PWA. Out of v1 scope but affects API design now — REST shape, auth token model, file upload pattern.

12. **Sub-domain branding for agencies.** `{slug}.advertisehomes.online` vs. `agencies.advertisehomes.online/{slug}`. Subdomain has SEO + wildcard cert implications and adds DNS/Cloudflare config per agency.

13. **GDPR data residency.** Supabase region: US, EU, or both? Affects EU customer pitch and DPA terms. If both, need cross-region replication strategy or per-region tenancy.

14. **Currency display.** Always USD? User-selectable? Geo-detected? Document the policy and apply consistently. This is a UX call that locks down search comparability.

---

## End of Spec

Total length across Part 1 + Part 2: ~30 pages of structured specification. Treat as a living document — every change should land via PR with a paired entry in `DECISIONS.md` if it represents a non-obvious choice.

**Read both parts in order, then reply with the critique before writing any code.**

### Product-owner-side parallel work (not blocking dev critique)

- Confirm registrar control: ensure the domain is registered in your name (or your company's), not the dev's account or a host's. Lock the registrar with two-factor and registrar-lock.
- Buy the `.com` if available. `advertisehomesonline.com` for ~$15/year. Park it and 301 to `.online`. Prevents a squatter, captures typo traffic. Same for common typos: `advertisehome.online`, `advertisehomesonline.online`.
- Point DNS to Cloudflare as soon as the domain is in your registrar. Cloudflare needs to be the authoritative nameserver for the WAF, Pages, R2 routing, and email DNS records to work cleanly.
- Set up email sending records this week. SPF, DKIM, DMARC for `mail.advertisehomes.online` and `tx.advertisehomes.online`. Email reputation needs ~30 days to warm up — if you wait until launch, your welcome and verification emails will land in spam.
- Submit Meta and LinkedIn app reviews with the canonical domain (`advertisehomes.online`) from day one. The Privacy Policy URL and Data Deletion URL on the Meta App must match the canonical domain — if you submit with `.com` placeholders and change later, you re-do the review. Even placeholder ToS/Privacy stubs are fine for app review as long as they load and look real.
