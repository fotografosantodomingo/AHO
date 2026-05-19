---
name: blog-perfect
description: Author / debug a programmatic-SEO blog post that hits 100/100 (incognito) on Lighthouse Performance + Accessibility + Best Practices + SEO
---

# When to use this skill

Use when:
1. A scheduled blog post landed but Lighthouse shows a score < 95 in any category (in **incognito** — Chrome extensions are noise; never trust a logged-in profile run).
2. Tightening the generator prompt or the validator in `src/lib/blog/html-validate.ts`.
3. Adding a NEW field to `blog_posts` (e.g. translation, image-pool, distribution channel) — anything that touches the article's HTML structure.
4. Cron failures (`status='ai_failed'`) — diagnose the failure_reason code + decide whether to relax validator vs. tighten prompt.

# What this skill enforces — the four Lighthouse 100 invariants

**These are the rules that an AHO blog post must satisfy to score 100 across all four Lighthouse axes (in incognito).** Every code path involved is listed; if you change one, audit the others.

## 1. Performance 100

| Rule | Where enforced | Common regression |
|---|---|---|
| LCP image declares **explicit `width="1200" height="630"`** | Prompt rule #6 in `src/lib/blog/generate-post.ts:buildPrompt` | Model slips up — the validator does NOT yet enforce this; spot-check in the cron success email; future improvement: add to `validateBlogHtml` |
| `loading="lazy" decoding="async"` on the in-article `<img>` | Same prompt rule | If the AI emits `loading="eager"` the LCP rises ~200ms |
| Hero image URL uses Next OG endpoint **WITHOUT `.png` suffix** | `src/app/api/cron/blog-publish/route.ts:heroImageUrl` | Easy mistake — Next OG endpoint serves `image/png` at `<segment>/opengraph-image` (no extension). The `.png` URL 404s with text/html. |
| Chat widget DOES NOT mount on `/blog` routes | `src/components/chat/conditional-aho-assistant.tsx:SKIP_SEGMENTS` | If someone removes `'blog'` from SKIP_SEGMENTS, ~290 KB of unused JS lands on /blog/[slug] |
| Per-agent chat widget DOES NOT mount on `/blog` | Only mounts on `/properties/[slug]` + `/agents/[slug]` — not the blog | n/a |
| Page is server-rendered (no client-side fetching for the article body) | `src/app/[locale]/blog/[slug]/page.tsx` is `runtime='edge'` + `dynamic='force-dynamic'` reading direct from Supabase | If someone wires a client-side hydration step, TBT spikes |

## 2. Accessibility 100

| Rule | Where enforced | Common regression |
|---|---|---|
| ToC + author bio + blockquote backgrounds use `--color-surface-warm` (NOT `--color-surface-band`) | `src/app/globals.css .aho-blog-prose` | If someone re-uses `surface-band` for a card on /blog, forest-green links land on a forest-green background → contrast ~1.1:1 (was the bug on the first publish, fixed 2026-05-19) |
| Every `<h2>`/`<h3>` has an `id` AND every ToC link points at one | `src/lib/blog/html-validate.ts:extractHeadingIds + extractTocAnchors` | Validator catches; failure code = `toc_anchor_orphan` |
| Author bio block exists at the bottom (`<aside class="author-bio-box">`) | `src/lib/blog/html-validate.ts` rule 5 | Failure code = `missing_author_bio` |
| Breadcrumb nav at the top (`<nav aria-label="Breadcrumb">`) | Same | Failure code = `missing_breadcrumb` |
| `<img>` has descriptive `alt` text (not empty, not "blog hero") | Prompt rule #6 | Validator does NOT check alt; trust the prompt + spot-check |
| NO Microdata attributes (`itemprop` / `itemscope` / `itemtype`) anywhere in body | `src/lib/blog/html-validate.ts` regex check | Failure code = `microdata_present` |

## 3. Best Practices 100

| Rule | Where enforced | Common regression |
|---|---|---|
| No 404s on referenced resources | Cron stamps real URLs (hero image, body) | The `.png` mistake (see Perf rule above) — a 404 on og:image drops Best Practices |
| HTTPS only | Cloudflare Pages enforces | n/a |
| No deprecated console APIs | Standard | n/a |
| No console errors | Standard | If any first-party `console.error()` fires (e.g. failed Supabase query in the page render), Best Practices drops 5+ points |

## 4. SEO 100

| Rule | Where enforced | Common regression |
|---|---|---|
| `<title>` set per locale | `src/app/[locale]/blog/[slug]/page.tsx:generateMetadata` | n/a |
| `<meta name="description">` set, ≤160 chars | Same — `description: post.summary` (the generator caps summary at 180) | If a future generator change uncaps summary, the SEO score may drop |
| Canonical URL set | Same — `alternates: { canonical }` | n/a |
| `og:image` resolves to a valid PNG (200, image/png) | The Next OG route at `<slug>/opengraph-image` | `.png` URL mistake (see above) |
| `BlogPosting` + `Person` + `Organization` + `BreadcrumbList` JSON-LD | `src/lib/seo/jsonld.ts:buildBlogPosting` + page render | If `dateModified` is older than `datePublished`, Google's validator warns |
| Robots = `index, follow` | `generateMetadata.robots` | n/a |
| Hreflang to other locale translations | `src/app/sitemap-blog.xml` per-row entries (when ES post lands, it'll auto-pick up) | v1 ships EN only; ES translation pass is queued |

# How to verify (the actual test loop)

The CRUCIAL caveat: **Lighthouse in a normal Chrome profile is heavily contaminated by extensions.** A typical contaminated run shows:
- Perf 60-75 (extension JS = 5-10 MB of unused script)
- Accessibility 60-75 (extension DOM injects `aiinhbfoop-*` / `coupert-*` classes with broken ARIA)
- Best Practices 85-95 (extension console errors)

**Always test in incognito** with extensions disabled. The number that matters is the incognito number.

```bash
# Local test workflow (preferred)
# 1. Open https://advertisehomes.online/en/blog/<slug> in a NEW INCOGNITO window
# 2. F12 → Lighthouse tab → "Analyze page load" with:
#      - Mode: Navigation
#      - Device: Mobile (or Desktop — both should be 100)
#      - Categories: all 4 (Perf / A11y / BP / SEO)
#    Expected: 95-100 across the board (in incognito; profile runs are unreliable)
# 3. If a score < 95: read the diagnostics, find the first-party row,
#    and check this skill for whether it's a documented rule
```

Programmatic verification via `wrangler tail` + DB inspection:
```bash
# Watch a real cron run (last 30 seconds of logs)
npx wrangler tail aho-blog-publish --format pretty

# Inspect the most-recent post + its distribution log
set -a && source .env.local && set +a && node -e "
const postgres = require('./node_modules/postgres');
const sql = postgres(process.env.SUPABASE_POOLER_URL, { max: 1, prepare: false });
(async () => {
  const rows = await sql\`select slug, status, hero_image_url, distribution, failure_reason from public.blog_posts order by created_at desc limit 1\`;
  console.log(JSON.stringify(rows[0], null, 2));
  await sql.end();
})();
"
```

# Manual fixes when the score dips

## Performance < 95

1. **TBT high but FCP/LCP fine** → check if the chat widget snuck back onto `/blog`. Grep: `grep -n 'blog' src/components/chat/conditional-aho-assistant.tsx` should show `'blog'` in `SKIP_SEGMENTS`.
2. **CLS > 0** → the `<img>` is missing `width`/`height`. The prompt requires it; if a recent post is missing it, retract the row (`UPDATE blog_posts SET status='archived' WHERE slug='...'`) and retry the cron.
3. **LCP > 2.5s** → hero image route is slow. Check `/blog/[slug]/opengraph-image` returns under 800ms (it should — Satori on Edge is ~200-400ms).
4. **Unused first-party JS large** → someone added a new client component to the global layout. Audit `[locale]/layout.tsx` for recent additions and move them into route segments instead.

## Accessibility < 95

1. **Contrast failure on ToC/author bio** → confirm `globals.css .aho-blog-prose` uses `--color-surface-warm` not `--color-surface-band`. Re-running an existing post WON'T fix it; only the CSS class needs the right token.
2. **Missing form labels** → the chat widget snuck back. See Performance #1.
3. **ARIA invalid value** → extension noise (incognito test should clear it).

## Best Practices < 100

1. **404 in console** → check what URL 404s. If it's `*.png`, the hero URL has a stale `.png` suffix. Patch in source + back-fill via DB UPDATE.
2. **Source map missing** → low priority; Next 15 strips them in prod by default. To enable: `productionBrowserSourceMaps: true` in `next.config.ts` (adds ~30 KB per chunk).

## SEO < 100

1. **og:image invalid** → same as the 404 issue. The OG route MUST return 200 + `Content-Type: image/png`.
2. **Description too long / too short** → the generator caps at 180 chars; Lighthouse warns above 160. The trim happens in `src/lib/blog/generate-post.ts:summary`.
3. **Missing canonical** → `src/app/[locale]/blog/[slug]/page.tsx:generateMetadata` sets it; check the SHA on the deployed code matches what the cron expects.

# Files involved (canonical map)

```
src/app/api/cron/blog-publish/route.ts             — orchestrator (jitter + topic + generate + insert + distribute + email)
src/app/[locale]/blog/page.tsx                      — index page
src/app/[locale]/blog/[slug]/page.tsx               — article page (force-dynamic; reads body_html from DB)
src/app/[locale]/blog/[slug]/opengraph-image.tsx    — Satori hero card (1200x630 PNG; one URL serves all surfaces)
src/app/sitemap-blog.xml/route.ts                   — per-post sitemap

src/lib/blog/
  topic-pool.ts        — 12 real-estate topics + pickTopic() with 90-day dedup
  author.ts            — Michał Babula byline (Hard rule #8 — no fake authors)
  generate-post.ts     — Anthropic Sonnet 4.6 call + system+user prompt + validation hook
  html-validate.ts     — regex-based structural-contract enforcer (Microdata reject, ToC anchors, etc.)
  slug.ts              — buildBlogSlug() — ASCII kebab + 6-char DJB2 hash suffix
  distribute.ts        — FB Page + IG Business + LinkedIn publish (uses admin ad_platform_tokens)

src/lib/seo/jsonld.ts:buildBlogPosting              — JSON-LD generator (BlogPosting + Person + Organization)
src/lib/email/templates/blog-publish-success.ts     — operator confirmation email
src/lib/email/templates/blog-publish-failure.ts     — operator failure email with failure_reason

src/app/globals.css :: .aho-blog-prose              — typography + ToC + author bio styling
src/components/chat/conditional-aho-assistant.tsx   — MUST keep 'blog' in SKIP_SEGMENTS

workers/blog-publish/                               — Cloudflare Worker (cron 0 9 * * *; calls into /api/cron/blog-publish)
src/db/migrations/0075_blog_posts.sql               — DB schema

tests/unit/blog-html-validate.test.ts               — 10 structural-contract tests
tests/unit/blog-topic-pool.test.ts                  — 8 topic-randomizer + slug tests
```

# How the structural contract pieces fit together

```
                 ┌──────────────────────────────┐
   topic-pool ──▶│ generateBlogPost()           │── ▶ raw AI HTML
                 │   (Anthropic Sonnet 4.6)     │
                 └──────────────────────────────┘
                              │
                              ▼
                 ┌──────────────────────────────┐
                 │ validateBlogHtml()           │── ▶ ok=true  → continue
                 │   (regex contract check)     │   ok=false → ai_failed row + email
                 └──────────────────────────────┘
                              │
                              ▼
                 ┌──────────────────────────────┐
                 │ stampBodyPlaceholders()      │── ▶ HTML with real hero URL,
                 │   {HERO_IMG} → real URL      │     today's date, reading time
                 │   {today}    → ISO date      │
                 │   {N}        → reading min   │
                 └──────────────────────────────┘
                              │
                              ▼
                 ┌──────────────────────────────┐
                 │ INSERT blog_posts            │── ▶ live at /en/blog/<slug>
                 │   status='published'         │
                 └──────────────────────────────┘
                              │
                              ▼
                 ┌──────────────────────────────┐
                 │ distributeBlogPost()         │── ▶ FB Page (photo card)
                 │   reads admin OAuth tokens   │     IG Business (single-img post)
                 │   from ad_platform_tokens    │     LinkedIn (thumbnail)
                 └──────────────────────────────┘
                              │
                              ▼
                 ┌──────────────────────────────┐
                 │ sendEmail()                  │── ▶ info@advertisehomes.online
                 │   blog-publish-success.ts    │     (HTML + plain text with
                 │   includes distribution log  │      per-channel status)
                 └──────────────────────────────┘
```

# Pitfalls already encountered (don't re-introduce)

- **Wrong model id** — used `claude-sonnet-4-6-20250508` (Anthropic 404). Canonical: `claude-sonnet-4-6`. Cross-ref: `src/lib/listings/import-from-url.ts:MODEL_ID`.
- **`.png` suffix on the OG URL** — Next OG route serves at `<segment>/opengraph-image` with no extension. Adding `.png` returns 404 + HTML.
- **`--color-surface-band`** is the always-dark feature-band token (`#16382a`), NOT a light surface. Using it as a card background tanks contrast.
- **Migration trigger function name** — `touch_updated_at()` (from migration 0001), NOT `set_updated_at()` (doesn't exist).
- **woff2 fonts in Satori** — Satori parses TTF/OTF only. The OG route imports `interBoldFontEntry()` from `src/lib/og/load-font.ts` which loads `inter-700.ttf` from `/public/fonts/`.
- **Tailwind v4 purges plain CSS rules inside `@layer components`** when the selector references a class that doesn't appear in scanned source files. The blog typography uses `.aho-blog-prose .table-of-contents`, `.aho-blog-prose .author-bio-box`, etc. — those nested classes only exist in DB-rendered `body_html`, not in any TSX file Tailwind scans. Result: the whole stylesheet gets stripped from prod. **Fix**: put the entire `.aho-blog-prose` block OUTSIDE any `@layer` directive (top-level CSS is never purged). The comment in `src/app/globals.css` above the block calls this out — leave it.
- **`loading="lazy"` on the LCP element** — the hero `<img>` is the LCP for an editorial article. Loading lazy regresses LCP by 1-2 seconds because the browser deprioritizes it. The prompt requires `loading="eager" fetchpriority="high"` and the validator should flag if either is missing (future improvement).
- **`revalidate` does NOT work cleanly on next-on-pages Edge runtime.** ISR persistence isn't there. To get CDN caching, set `Cache-Control` via `src/middleware.ts` for the `/blog/:slug` pattern (NOT next.config.ts:headers() — that only applies to static assets, NOT Edge Function responses). CF Pages picks up `s-maxage` and caches the rendered HTML at the edge. The article page stays `force-dynamic` (renders per cold-cache request) but the warm-cache path is <100ms from a POP.
- **`Set-Cookie: NEXT_LOCALE` was blocking the cache entirely.** next-intl's default `localeDetection: true` writes the cookie on every response — CF Pages treats Set-Cookie as uncacheable. Fixed 2026-05-19 by setting `localeDetection: false` in `src/i18n/routing.ts`; URL-prefix routing is authoritative with `localePrefix: 'always'`, so the cookie is redundant.

# Caveats

- `BLOG_DISTRIBUTION_ENABLED=false` on Cloudflare Pages env kills distribution while keeping publication live. Useful for soft-beta spot-checks.
- The first-party JS chunks Lighthouse flags as "unused" (chunks 3949 + 7045 + 3c6892b9) come from the global layout. Stripping ALL of them requires a route-group split (move `/blog` into a sibling route group with its own minimal layout). Cost/benefit hasn't been worth it yet — keep the option in mind if Lighthouse Perf score doesn't break 90 in incognito after the chat-widget removal.
- Spanish translation pass is queued but not built. When it ships, expect a new `language` column value + matching `/es/blog` index entries — the sitemap-blog.xml already handles the multi-language case.
