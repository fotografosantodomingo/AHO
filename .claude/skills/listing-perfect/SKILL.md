---
name: listing-perfect
description: Audit / debug a property-listing page to hit ~98/100 on Lighthouse Performance + Accessibility + Best Practices + SEO (incognito)
---

# When to use this skill

Use when:
1. A property page (`/[locale]/properties/[slug]`) shows Lighthouse < 95 in any category — in **incognito** with extensions disabled (logged-in profile runs are 99% extension noise).
2. After a change to `src/components/listings/property-gallery.tsx`, `src/lib/listings/seo.ts`, or `src/lib/listings/image-url.ts`.
3. Investigating CLS, LCP, or "missing meta description" regressions on individual listings.
4. Before publishing a new property-page surface (city landing, agent profile) so it starts at 95+ rather than being audited later.

# Sibling skill: `blog-perfect`

The blog and listing pages share the page-shell + Cloudflare-Pages edge-cache plumbing. Many invariants are identical (Tailwind v4 purge, `loading="eager"` on LCP, `s-maxage` via `next.config.ts`). Read `blog-perfect` first; this skill covers only the listing-specific deltas.

# The four invariants — listing-specific

## 1. Performance ≥ 95

| Rule | Where enforced | Common regression |
|---|---|---|
| Gallery hero `<img>` has `loading="eager" fetchPriority="high" decoding="async"` | `src/components/listings/property-gallery.tsx:240-280` | If someone splits the gallery into a server-render-via-Suspense pattern, the hero might re-acquire `loading="lazy"` |
| `<link rel="preload" as="image" href={primaryUrlPublic}>` in `<head>` | `src/app/[locale]/properties/[slug]/page.tsx:319-328` | The preload is conditional on `primaryUrlPublic` existing; archived listings with deleted images skip it (correct) |
| Cache-Control `public, max-age=60, s-maxage=300, stale-while-revalidate=1800` | `next.config.ts:headers()` under the `listingCacheGlobs` block | Anyone adding `force-no-store` somewhere will tank LCP |
| Photo gallery uses Cloudflare Images variants via `buildImageUrl({ variant: 'card' \| 'public' })` | `src/lib/listings/image-url.ts` | Bypassing CF Images and using raw R2 URLs ships 2-3 MB image instead of optimized variant |
| `<img width height>` set from DB's `images.width` / `images.height` | `src/components/listings/property-gallery.tsx:269-272` | Legacy rows have `width=null height=null` and ship without dimensions — CLS regression. Backfill via the photo-import pipeline |
| Image `sizes="(max-width: 768px) 100vw, (max-width: 1024px) 800px, 1067px"` | `src/components/listings/property-gallery.tsx:265` | Wider `sizes` causes the browser to pull the largest variant unnecessarily |

## 2. Accessibility ≥ 95

| Rule | Where enforced | Common regression |
|---|---|---|
| Every `<img>` has descriptive `alt` (NOT empty / not just the filename) | `src/lib/listings/photo-seo.ts:buildPhotoAlt` — called by upload pipeline + gallery | Legacy photos may have null alt; the page falls back to the listing title which is OK but not optimal |
| Color contrast on all interactive elements | `src/app/globals.css` design tokens | Never use `--color-surface-band` as a card background (it's the always-dark feature-band — `#16382a` — not a light surface). See `blog-perfect` pitfall list. |
| Form labels exist on the contact form (`#contact`) | `src/components/listings/contact-form.tsx` | Every `<input>` should have an associated `<label>` (visible or `sr-only`) |
| Lightbox is keyboard-navigable (ESC closes, arrows page) | `src/components/listings/property-gallery.tsx` | The portal-mounted lightbox manually wires Esc + Arrow handlers; if a refactor removes the listener, accessibility regresses |
| Skip link / landmarks | The page uses `<main>`, `<article>`, `<aside>`, `<footer>` semantically | Don't refactor to a flat `<div>` soup |

## 3. Best Practices ≥ 95

| Rule | Where enforced | Common regression |
|---|---|---|
| No 404s in console (incl. image variants, OG image, CSS chunks) | Cron tooling + image-import pipeline maintain valid URLs | A CF-Images variant deletion can break legacy listings — see `RISKS.md` R12 |
| HTTPS only | Cloudflare Pages enforces | n/a |
| `X-Robots-Tag: noindex` NOT applied to public listings | `next.config.ts:headers()` authedPathGlobs doesn't include `/properties/*` | Don't add /properties/* to that list |
| Source maps off in prod | Next 15 default; deliberate per `DECISIONS.md` | n/a — the missing-source-map warning is unscored |

## 4. SEO ≥ 95

| Rule | Where enforced | Common regression |
|---|---|---|
| `<meta name="description">` ALWAYS present | `src/lib/listings/seo.ts:seoDescription` falls back to `synthDescription` when the listing has empty `descriptionEn`/`Es` | If `synthDescription` ever returns an empty string (e.g., missing price + bedrooms), Lighthouse flags the page |
| `<title>` ≤ 70 chars (Google truncates at ~580px) | `src/lib/listings/seo.ts:titleBudget` caps the listing title + facts | The previous-day bug: `buildSeoMeta` appended ` \| AHO` AND the layout template ALSO wrapped with `%s \| AHO`, producing `... \| AHO \| AHO`. Fixed 2026-05-19 — keep the builder brand-free; layout owns the suffix uniformly |
| Canonical URL set, hreflang to other locale | `src/app/[locale]/properties/[slug]/page.tsx:generateMetadata.alternates` | n/a — the `urls.es`/`urls.en` resolver is the source of truth |
| RealEstateListing JSON-LD valid + complete | `src/lib/listings/structured.ts` + emitted by the page | Missing `priceCurrency` (zero-cents listings emit `0` + currency → "free", which confuses Google) |
| BreadcrumbList JSON-LD emitted | `src/app/[locale]/properties/[slug]/page.tsx:breadcrumbJsonLd` | Don't remove the manual breadcrumb script — it parallels the visible HTML breadcrumb on the page (required for Google's breadcrumb-in-SERP rich result) |
| og:image valid, 1200×630 | `src/app/[locale]/properties/[slug]/opengraph-image.tsx` | Per-listing OG image route already exists; if it 404s the SEO score docks 5+ points (we hit this with the blog `.png` mistake — see `blog-perfect` pitfalls) |

# How to verify (test loop)

```bash
# 1. Open https://advertisehomes.online/en/properties/<slug> in INCOGNITO
#    F12 → Lighthouse → Analyze page load (Mobile, all categories)
#    Expected: Perf 90+, A11y 95+, BP 95+, SEO 95+

# 2. After deploy lands, confirm caching is taking effect:
curl -sI "https://advertisehomes.online/en/properties/<slug>" | grep -iE 'cache-control|cf-cache-status|x-edge-runtime'
# Expect:  cache-control: public, max-age=60, s-maxage=300, stale-while-revalidate=1800
#          cf-cache-status: DYNAMIC (first load) / HIT (subsequent loads)

# 3. Inspect the meta description for a specific listing:
curl -s "https://advertisehomes.online/en/properties/<slug>" \
  | python3 -c "
import re, sys
html = sys.stdin.read()
print('Title:    ', (re.search(r'<title>([^<]*)', html) or [None,'(missing)'])[1])
print('Desc:     ', (re.search(r'<meta name=\"description\" content=\"([^\"]*)', html) or [None,'(missing)'])[1])
print('OG image: ', (re.search(r'<meta property=\"og:image\" content=\"([^\"]*)', html) or [None,'(missing)'])[1])
"
```

# Files involved (canonical map)

```
src/app/[locale]/properties/[slug]/page.tsx           — property detail page (force-dynamic)
src/app/[locale]/properties/[slug]/opengraph-image.tsx — per-listing OG image
src/components/listings/property-gallery.tsx          — hero + lightbox gallery (Client Component)
src/components/listings/contact-form.tsx              — bottom-of-page lead capture
src/components/listings/share-to-socials.tsx          — agent-only one-click distribution

src/lib/listings/
  seo.ts             — buildSeoMeta() — title, description, canonical, hreflang
  image-url.ts       — buildImageUrl() — CF Images variant resolution
  photo-seo.ts       — buildPhotoAlt() / buildPhotoCaption() — alt + figcaption per locale
  similar.ts         — "Similar listings" section data
  search.ts          — public listing search
  structured.ts      — RealEstateListing JSON-LD builder

src/app/globals.css :: design tokens                  — surface / ink / action / contrast tokens

next.config.ts :: headers()                           — Cache-Control for /properties/:slug + agents + city landings
src/middleware.ts                                     — next-intl rewrite + Supabase session refresh (don't add anything heavy here)
```

# Manual fixes when scores dip

## Performance < 90

1. **LCP > 4s** → cache headers aren't taking effect. Verify with `curl -sI`. If `Cache-Control` missing, check the wildcard in `next.config.ts:listingCacheGlobs` matches the actual path (Spanish slug `propiedades`?).
2. **TBT > 600ms** → a heavy Client Component snuck in. Check the page tree for newly-added `'use client'` components.
3. **CLS > 0.05** → an `<img>` lost its `width`/`height`. Check whether legacy listings have NULL dims in DB. Backfill via the photo-import pipeline.

## Accessibility < 95

1. **Contrast failure on a card** → `surface-band` misuse (see `blog-perfect` pitfalls).
2. **Missing form label** → contact form regression. Restore the `<label htmlFor>` or `aria-label`.

## SEO < 95

1. **Missing meta description** → the listing has empty `descriptionEn` + `descriptionEs`. The `synthDescription` fallback should kick in; if it returns empty, the listing is missing price + bedrooms + city. Either populate the listing or extend the fallback.
2. **Title too long / duplicated brand** → the `| AHO` suffix double-bug. Keep `buildSeoMeta:tail` brand-free; the layout template owns the suffix.
3. **Broken og:image** → per-listing `opengraph-image.tsx` route. Verify it returns 200 + image/png at `<post-url>/opengraph-image` (NO `.png` suffix).

# Pitfalls already encountered (don't re-introduce)

- **Double brand suffix** in `<title>`: `buildSeoMeta` returned `... | AHO` AND the layout's `metadata.title.template: '%s | AHO'` wrapped that → `... | AHO | AHO`. Fixed 2026-05-19. The builder MUST stay brand-free.
- **Cache-Control via `next.config.ts:headers()` does NOT work for Edge Function responses** on next-on-pages. That config only applies to truly-static assets. Public-page Cache-Control belongs in `src/middleware.ts`, gated on "is the visitor anonymous" so signed-in users never get a cached body. Diagnosed 2026-05-19 — first attempt put cache rules in next.config; `curl -sI` showed NO `cache-control` header in the response.
- **`Set-Cookie: NEXT_LOCALE=…` blocks CF Pages caching**. By default Cloudflare treats any response with `Set-Cookie` as uncacheable (regardless of Cache-Control). next-intl was writing the cookie on every response even when the URL already had a locale prefix. Fixed by `localeDetection: false` in `src/i18n/routing.ts` — with `localePrefix: 'always'`, the URL is authoritative and the cookie is redundant. After the change, anon /properties/[slug] responses ship without Set-Cookie and CF Pages caches them.
- **`force-dynamic` without Cache-Control + Set-Cookie suppression** = ~1.1s server response on every request. Always pair `force-dynamic` with BOTH the middleware Cache-Control header AND the absence of unnecessary Set-Cookie writes.
- **Tailwind v4 purges plain CSS rules inside `@layer components`** when the selector references a class not seen in scanned source. The same gotcha that nuked the blog typography on 2026-05-19 — listing-specific CSS that targets DB-rendered class names must live at top level.
- **Hero image with `loading="lazy"`** regresses LCP by 1-2s. Property gallery already uses `loading="eager" fetchPriority="high"`; don't refactor that away.
- **Calling Lighthouse from a logged-in profile** with extensions = score is corrupted by extension noise (Coupert + AI Sidebar = 5-9 MB of injected JS). Always test in incognito.

# Caveats

- The `force-dynamic` runtime export on `/properties/[slug]/page.tsx` IS intentional — the page reads the row from Supabase per cold-cache request. The s-maxage in Cache-Control gives a 5-minute CDN cache hit window which dominates the LCP outcome in practice.
- **Image preload + eager `<img>` is a coordinated pair.** The `<link rel="preload" as="image">` in `<head>` hints the browser to start fetching the LCP image during HTML parse; the eager `<img>` in the body picks up the same URL once the parser reaches it (browser dedupes the request). Removing one half breaks the LCP win.
- The agent profile (`/[locale]/agents/[slug]`) shares ~80% of the same surface; it's covered by the same listingCacheGlobs and inherits the same invariants. City landing pages (`/properties-in/[country]/[city]`) also inherit them.
