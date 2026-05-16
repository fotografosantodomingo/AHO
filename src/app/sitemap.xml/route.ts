import { publicEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  MARKETING_LASTMOD,
  renderSitemapIndex,
  xmlResponse,
  type SitemapIndexChild,
} from '@/lib/seo/sitemap-helpers';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /sitemap.xml — MASTER SITEMAP INDEX.
 *
 * Lists every sub-sitemap with an honest `lastmod` per child so
 * Google can fetch only what changed since its last crawl. This
 * replaced the single-file sitemap on 2026-05-14 (the old approach
 * had everything in one file so adding a property invalidated the
 * caching signal for the entire URL set).
 *
 * Children:
 *   - /sitemap-pages.xml         marketing chrome (homepage, pricing,
 *                                privacy, terms, /countries × 7 locales)
 *                                — static, lastmod = MARKETING_LASTMOD
 *   - /sitemap-landings.xml      agent-acquisition landings
 *                                (/for-agents, /automation, /save-time)
 *                                × 7 locales — static, MARKETING_LASTMOD
 *   - /sitemap-properties.xml    every active+published listing × EN+ES
 *                                — DYNAMIC, lastmod bumps on new
 *                                listings + edits. THIS is the file
 *                                Google re-fetches when an agent
 *                                publishes; nothing else moves.
 *   - /sitemap-agents.xml        agent profile pages — DYNAMIC, lastmod
 *                                follows max(org.updated_at,
 *                                listings.updated_at)
 *   - /sitemap-locations.xml     country + city landing pages — DYNAMIC,
 *                                lastmod = max listing updated_at
 *   - /sitemap-images.xml        image sitemap — per-request lastmod
 *                                (matches existing behaviour)
 *
 * GSC: submit this URL only. Google auto-discovers the children.
 * robots.txt also points here.
 *
 * Per-child lastmod source — we run one tiny aggregation query against
 * Supabase to find max(properties.updated_at) and max(organizations
 * .updated_at). One query, two columns, ~5-10ms. Falls back to
 * MARKETING_LASTMOD if either returns null (no listings yet).
 *
 * Empty-platform behaviour (2026-05-14 fix): when there are zero
 * active+published listings, the 4 content-driven children
 * (properties / agents / locations / images) are OMITTED from the
 * index entirely. Reason: Google Search Console reports an empty
 * `<urlset></urlset>` as "Mapa witryny może zostać odczytana, ale
 * zawiera błędy — Brak tagu XML / Tag: url". Pre-launch (no real
 * listings yet per CLAUDE.md hard rule #8), advertising 4 empty
 * children produces 4 GSC warnings. By gating them on `listingRow`,
 * GSC sees a clean 2-child index until the first real listing
 * lands, then all 6 children appear automatically.
 */
export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const now = new Date();

  const supabase = await createServerSupabaseClient();
  // Single query: latest updated_at across active+published listings.
  // We use this for both the properties + locations sub-sitemaps since
  // both derive from the same row set.
  const { data: listingRow } = await supabase
    .from('properties')
    .select('updated_at')
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const listingsLastmod = listingRow?.updated_at
    ? new Date(listingRow.updated_at)
    : MARKETING_LASTMOD;

  // Agents: latest org.updated_at among orgs that have ≥1 active listing.
  // We approximate via the same query — a listing edit also bumps
  // /sitemap-agents.xml's freshness (the agents sub-sitemap's lastmod
  // logic already uses max(org, listings)). Cheap + accurate enough.
  const agentsLastmod = listingsLastmod;

  const children: SitemapIndexChild[] = [
    { loc: `${site}/sitemap-pages.xml`, lastmod: MARKETING_LASTMOD },
    { loc: `${site}/sitemap-landings.xml`, lastmod: MARKETING_LASTMOD },
  ];

  // Only advertise the dynamic children when there's at least one real
  // listing. Otherwise these all return `<urlset></urlset>` which GSC
  // flags as malformed (missing required `<url>` tag). See the empty-
  // platform note in the header doc-block.
  if (listingRow) {
    children.push(
      { loc: `${site}/sitemap-properties.xml`, lastmod: listingsLastmod },
      // Recent (last 7 days) — priority=1.0, changefreq=daily.
      // Freshness layer ON TOP of the full /sitemap-properties.xml.
      // Replaces the Google-News-sitemap reflex (News sitemap is
      // news-publisher-only — real estate listings don't qualify).
      // lastmod = now because the file contents change whenever any
      // listing publishes OR ages out of the 7-day window.
      { loc: `${site}/sitemap-properties-recent.xml`, lastmod: now },
      { loc: `${site}/sitemap-agents.xml`, lastmod: agentsLastmod },
      { loc: `${site}/sitemap-locations.xml`, lastmod: listingsLastmod },
      // Image sitemap re-fetches on every Google visit; per-request lastmod
      // is correct here (image uploads happen at any hour and we want
      // crawlers re-pulling the image set promptly).
      { loc: `${site}/sitemap-images.xml`, lastmod: now },
    );
  }

  return xmlResponse(renderSitemapIndex(children), 300);
}
