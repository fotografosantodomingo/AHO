---
name: new-page
description: Add a new public-facing page with bilingual i18n, full SEO, and a Lighthouse pass
---

# When to use this skill
Use when adding a new user-facing page that should be indexable: property detail, search results, agent profile, blog post, location landing page, etc. Skip for authenticated app pages (dashboards, settings) — those have lower SEO requirements.

# Required reading before starting
- `docs/HANDOFF.md` §11 (i18n routing strategy, hreflang, translation workflow)
- `docs/HANDOFF.md` §8.3 (slug + short_id URL pattern)
- `CLAUDE.md` — language fallback rule (no cross-language fallback)

# Steps
1. **Route in both locales.** Add the page under both `app/(site)/[locale]/...` paths (or whatever the chosen pattern is). EN and ES URLs must be defined together — never ship one without the other.
2. **i18n strings.** Add all UI strings to `messages/en.json` and `messages/es.json`. Do **not** machine-translate UI strings without human review.
3. **`<title>` and meta description.** Per spec §8 / SEO guide — title pattern `{primary fact} | {brand}`, description 150–160 chars summarizing the page's distinct value. Per-locale.
4. **Canonical link.** Self-canonical for the current locale variant.
5. **`hreflang` tags.** EN and ES alternates plus `x-default` (defaults to EN).
6. **Open Graph + Twitter Card.** `og:title`, `og:description`, `og:url`, `og:image` (1200×630), `og:type=website`, `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`.
7. **JSON-LD structured data.** For property pages: `RealEstateListing` (or `Product` with `offers`). For other types, the appropriate schema.org type. Validate with the Rich Results test.
8. **Sitemap entry.** Add the page (both locales) to the dynamic sitemap generator. If the page is paginated or filterable, decide what's indexable vs `noindex`.
9. **Image SEO.** Per spec — descriptive alt text per language, `width`/`height` set, `loading="lazy"` below the fold, `srcset` and `sizes`, served via Cloudflare Images variants.
10. **Robots.** `index,follow` for public pages; `noindex,nofollow` for drafts/private/staging.
11. **Lighthouse / Core Web Vitals pass.** LCP ≤ 2.5s on simulated 4G mobile (success criterion in §1.6). Run `pnpm lighthouse <url>` (or equivalent) on the preview deploy before requesting review.
12. **RLS sanity check.** If the page reads from a tier-gated table, confirm the public-facing read works for anonymous users via the appropriate RLS policy. Test from an incognito browser.

# Caveats
- TODO: link to the actual sitemap generator and SEO helpers once implemented.
- TODO: document the JSON-LD helper module path.
- For listing detail pages: slug may change on edit; `short_id` does not. Old slugs 301 to current — verify the redirect.
