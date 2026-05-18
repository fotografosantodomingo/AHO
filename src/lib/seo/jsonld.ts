/**
 * Typed builders for the schema.org JSON-LD blocks AHO emits on its
 * public pages. Centralizing here keeps the surface-page code focused
 * on data + layout and lets us cover the construction logic with
 * fast unit tests.
 *
 * Design rules:
 *   1. Builders accept already-fetched data; they NEVER call into
 *      Supabase / Stripe / fetch. Pure function in → pure JSON out.
 *   2. Fields are conditionally attached. We never emit a field with
 *      a fabricated default ("5.0", "0 reviews"). When the data isn't
 *      there, the key is omitted (CLAUDE.md hard rule #8).
 *   3. Returned shape is a plain `Record<string, unknown>` ready for
 *      `JSON.stringify` inside a <script type="application/ld+json">.
 *      We don't use `as const` literal-narrowing because conditional
 *      spreads require an indexable signature.
 *   4. URL inputs MUST be absolute (origin-prefixed). Builders trust
 *      callers — emitting a relative URL inside JSON-LD is silently
 *      broken (Google ignores it without surfacing an error).
 */

export const SCHEMA_CONTEXT = 'https://schema.org';

/** All builder outputs share this shape so we can render them via the
 *  same <script type="application/ld+json"> sink. */
export type JsonLdNode = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Breadcrumbs                                                                */
/* -------------------------------------------------------------------------- */

export interface BreadcrumbCrumb {
  /** Display name for the crumb (already localized). */
  name: string;
  /** Absolute URL for the crumb. The last crumb (current page) MAY
   *  also be the page's own URL — Google accepts that. */
  url: string;
}

/**
 * Construct a `BreadcrumbList` JSON-LD node from an ordered array of
 * crumbs. Position numbering starts at 1.
 */
export function buildBreadcrumbList(crumbs: BreadcrumbCrumb[]): JsonLdNode {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* ItemList                                                                   */
/* -------------------------------------------------------------------------- */

export interface ItemListEntry {
  /** Absolute URL of the item. Required — entries without a URL are
   *  dropped (a `ListItem` without a `url` is meaningless to crawlers). */
  url: string;
  /** Optional name to attach (richer signal — Google sometimes shows
   *  the list-item name in carousels). */
  name?: string;
}

/**
 * Build an `ItemList` JSON-LD node. Useful for city / country landing
 * pages where the page itself is a curated list of links to deeper
 * content. Entries without a URL are filtered out.
 */
export function buildItemList(args: {
  /** Display name for the list (typically the page H1). */
  name: string;
  entries: Array<ItemListEntry | null | undefined>;
  /** Optional `@id` so the node can be referenced from elsewhere on
   *  the page (e.g. a WebPage node points at its `mainEntity`). */
  id?: string;
}): JsonLdNode {
  const filtered = args.entries.filter(
    (e): e is ItemListEntry => !!e && typeof e.url === 'string' && e.url.length > 0,
  );
  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'ItemList',
    name: args.name,
    numberOfItems: filtered.length,
    itemListElement: filtered.map((e, idx) => {
      const item: JsonLdNode = {
        '@type': 'ListItem',
        position: idx + 1,
        url: e.url,
      };
      if (e.name) item.name = e.name;
      return item;
    }),
  };
  if (args.id) node['@id'] = args.id;
  return node;
}

/* -------------------------------------------------------------------------- */
/* Place                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Construct a `Place` JSON-LD node for a city or country landing page.
 * `addressLocality` is omitted when only a country is given (country
 * landing page). `containedInPlace` chains a city up to its country.
 */
export function buildPlace(args: {
  /** Display name (e.g. "Santo Domingo" or "Dominican Republic"). */
  name: string;
  /** Optional locality — set on city pages, omitted on country pages. */
  city?: string | null;
  /** ISO-3166-1 alpha-2 (uppercase). Always set; both city + country
   *  pages know the country. */
  countryCode: string;
  /** Absolute URL of the page describing the place. Used as the @id. */
  url: string;
  /** Optional descriptive blurb — usually the page's subheading. */
  description?: string | null;
}): JsonLdNode {
  const address: JsonLdNode = {
    '@type': 'PostalAddress',
    addressCountry: args.countryCode,
  };
  if (args.city) address.addressLocality = args.city;

  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Place',
    '@id': args.url,
    name: args.name,
    url: args.url,
    address,
  };
  if (args.description) node.description = args.description;
  return node;
}

/* -------------------------------------------------------------------------- */
/* Organization + WebSite (homepage)                                          */
/* -------------------------------------------------------------------------- */

export function buildOrganization(args: {
  name: string;
  url: string;
  /** Absolute URL to the org logo (icon.svg works). */
  logo?: string | null;
  /** Short tagline — emitted as `alternateName`. */
  alternateName?: string | null;
  description?: string | null;
  /** Absolute social / external profile URLs. Empty array is omitted. */
  sameAs?: string[];
}): JsonLdNode {
  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Organization',
    name: args.name,
    url: args.url,
  };
  if (args.alternateName) node.alternateName = args.alternateName;
  if (args.description) node.description = args.description;
  if (args.logo) node.logo = args.logo;
  if (args.sameAs && args.sameAs.length > 0) node.sameAs = args.sameAs;
  return node;
}

/**
 * `WebSite` node with optional `SearchAction`. When `searchUrlTemplate`
 * is provided, Google may render a sitelinks search box for branded
 * SERP results (e.g. typing "AHO" → search box appears).
 *
 * The template MUST contain `{search_term_string}` exactly once — the
 * builder sanity-checks this and throws if violated; that's a developer
 * mistake we want to fail loud, not a runtime fallback.
 */
export function buildWebSite(args: {
  name: string;
  url: string;
  /** BCP-47 language tag (e.g. "en", "es"). */
  inLanguage?: string;
  /** Absolute URL with `{search_term_string}` placeholder, e.g.
   *  `https://example.com/search?q={search_term_string}`. */
  searchUrlTemplate?: string;
}): JsonLdNode {
  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'WebSite',
    name: args.name,
    url: args.url,
  };
  if (args.inLanguage) node.inLanguage = args.inLanguage;
  if (args.searchUrlTemplate) {
    if (!args.searchUrlTemplate.includes('{search_term_string}')) {
      throw new Error(
        'buildWebSite: searchUrlTemplate must contain "{search_term_string}"',
      );
    }
    node.potentialAction = {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: args.searchUrlTemplate,
      },
      'query-input': 'required name=search_term_string',
    };
  }
  return node;
}

/* -------------------------------------------------------------------------- */
/* Product (pricing)                                                          */
/* -------------------------------------------------------------------------- */

export interface OfferInput {
  /** Decimal price as a string ("29.00") OR a finite number. We
   *  normalize to the schema.org canonical string form. */
  price: string | number;
  /** ISO-4217 currency code (e.g. "USD"). */
  priceCurrency: string;
  /** schema.org availability URL — defaults to InStock when unset. */
  availability?: string;
  /** Absolute URL where the offer can be acted on (the pricing page). */
  url?: string;
  /** Optional description — used to differentiate monthly vs annual. */
  description?: string;
}

/**
 * Construct a `Product` node with one or more `Offer` children.
 * SaaS plans ARE products in schema.org's vocabulary; this is the
 * pattern Stripe + Hubspot + Atlassian all use.
 *
 * `aggregateRating` is intentionally NOT supported on this builder —
 * we don't have plan-level ratings, and faking them would violate
 * CLAUDE.md hard rule #8.
 */
export function buildProduct(args: {
  name: string;
  description: string;
  /** Stable identifier — usually the pricing page anchor URL. */
  url: string;
  /** Optional brand string — defaults omitted. */
  brand?: string;
  offers: OfferInput[];
}): JsonLdNode {
  if (args.offers.length === 0) {
    throw new Error('buildProduct: at least one offer is required');
  }
  const offers = args.offers.map((o) => {
    const offer: JsonLdNode = {
      '@type': 'Offer',
      price: typeof o.price === 'number' ? o.price.toFixed(2) : o.price,
      priceCurrency: o.priceCurrency,
      availability: o.availability ?? 'https://schema.org/InStock',
    };
    if (o.url) offer.url = o.url;
    if (o.description) offer.description = o.description;
    return offer;
  });

  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Product',
    name: args.name,
    description: args.description,
    url: args.url,
    offers: offers.length === 1 ? offers[0] : offers,
  };
  if (args.brand) node.brand = { '@type': 'Brand', name: args.brand };
  return node;
}

/* -------------------------------------------------------------------------- */
/* WebPage (generic page wrapper)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Construct a `WebPage` node — the right generic for pages that don't
 * fit a more specific type (Privacy, Terms, Investors). When the page
 * has a breadcrumb, pass the BreadcrumbList node so it can be wired
 * via `breadcrumb`. `lastReviewed` is ISO 8601 date — useful on legal
 * pages where Google ranks freshness signals.
 */
export function buildWebPage(args: {
  name: string;
  url: string;
  description?: string | null;
  inLanguage?: string;
  /** ISO 8601 date — e.g. "2026-05-17". */
  lastReviewed?: string | null;
  /** Optional reference to the publishing organization (`@id` of the
   *  site-wide Organization node). */
  publisherId?: string;
  /** Optional reference to the site-wide WebSite node. */
  isPartOfId?: string;
}): JsonLdNode {
  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'WebPage',
    '@id': args.url,
    url: args.url,
    name: args.name,
  };
  if (args.description) node.description = args.description;
  if (args.inLanguage) node.inLanguage = args.inLanguage;
  if (args.lastReviewed) node.lastReviewed = args.lastReviewed;
  if (args.publisherId) node.publisher = { '@id': args.publisherId };
  if (args.isPartOfId) node.isPartOf = { '@id': args.isPartOfId };
  return node;
}

/* -------------------------------------------------------------------------- */
/* CollectionPage                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `CollectionPage` for index pages that primarily list links to other
 * pages (Countries index, Docs index). Use together with `buildItemList`
 * — pass the ItemList's `@id` as `hasPartId` to wire them.
 */
export function buildCollectionPage(args: {
  name: string;
  url: string;
  description?: string | null;
  inLanguage?: string;
  /** `@id` of an ItemList node on the same page. */
  hasPartId?: string;
  publisherId?: string;
  isPartOfId?: string;
}): JsonLdNode {
  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'CollectionPage',
    '@id': args.url,
    url: args.url,
    name: args.name,
  };
  if (args.description) node.description = args.description;
  if (args.inLanguage) node.inLanguage = args.inLanguage;
  if (args.hasPartId) node.mainEntity = { '@id': args.hasPartId };
  if (args.publisherId) node.publisher = { '@id': args.publisherId };
  if (args.isPartOfId) node.isPartOf = { '@id': args.isPartOfId };
  return node;
}

/* -------------------------------------------------------------------------- */
/* HowTo (step-by-step guides)                                                */
/* -------------------------------------------------------------------------- */

export interface HowToStep {
  /** Short step title (e.g. "Connect Instagram"). */
  name: string;
  /** Body text — one paragraph; HTML-stripped if needed by the caller. */
  text: string;
  /** Optional absolute image URL illustrating the step. */
  image?: string | null;
  /** Optional absolute URL — anchor inside the page for the step (e.g.
   *  `https://example.com/guide#step-2`). */
  url?: string | null;
}

/**
 * `HowTo` node for step-by-step guide pages (instagram-setup,
 * profile-guide, share-guide). Google can render these in a rich
 * "How to" carousel. Steps without text are dropped.
 */
export function buildHowTo(args: {
  name: string;
  description: string;
  url: string;
  inLanguage?: string;
  /** ISO 8601 duration (e.g. "PT5M" for 5 minutes). Optional. */
  totalTime?: string;
  steps: HowToStep[];
}): JsonLdNode {
  if (args.steps.length === 0) {
    throw new Error('buildHowTo: at least one step is required');
  }
  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'HowTo',
    '@id': args.url,
    name: args.name,
    description: args.description,
    url: args.url,
    step: args.steps.map((s, idx) => {
      const step: JsonLdNode = {
        '@type': 'HowToStep',
        position: idx + 1,
        name: s.name,
        text: s.text,
      };
      if (s.image) step.image = s.image;
      if (s.url) step.url = s.url;
      return step;
    }),
  };
  if (args.inLanguage) node.inLanguage = args.inLanguage;
  if (args.totalTime) node.totalTime = args.totalTime;
  return node;
}

/* -------------------------------------------------------------------------- */
/* FAQPage                                                                    */
/* -------------------------------------------------------------------------- */

export interface FaqEntry {
  /** Question text. */
  q: string;
  /** Answer text (plain or HTML — Google accepts both, prefer plain). */
  a: string;
}

/**
 * `FAQPage` node — emit on any page with ≥2 visible Q&A pairs. Google
 * renders these as an accordion in the SERP card.
 */
export function buildFAQPage(args: {
  url: string;
  entries: FaqEntry[];
}): JsonLdNode {
  if (args.entries.length === 0) {
    throw new Error('buildFAQPage: at least one entry is required');
  }
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'FAQPage',
    '@id': `${args.url}#faq`,
    mainEntity: args.entries.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: e.a,
      },
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* SoftwareApplication                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `SoftwareApplication` node — describes AHO itself as a SaaS product.
 * Useful on the homepage + `/for-agents`. Google sometimes shows star
 * ratings + price for SaaS results when present.
 */
export function buildSoftwareApplication(args: {
  name: string;
  description: string;
  url: string;
  /** schema.org applicationCategory (e.g. "BusinessApplication"). */
  applicationCategory?: string;
  /** Operating system (default "Web"). */
  operatingSystem?: string;
  /** Optional offer(s) — typically the cheapest paid tier. */
  offers?: OfferInput[];
  /** Optional aggregate rating — DO NOT fabricate; only pass when
   *  real review data exists. */
  aggregateRating?: { ratingValue: number; reviewCount: number } | null;
}): JsonLdNode {
  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'SoftwareApplication',
    name: args.name,
    description: args.description,
    url: args.url,
    applicationCategory: args.applicationCategory ?? 'BusinessApplication',
    operatingSystem: args.operatingSystem ?? 'Web',
  };
  if (args.offers && args.offers.length > 0) {
    const offers = args.offers.map((o) => {
      const offer: JsonLdNode = {
        '@type': 'Offer',
        price: typeof o.price === 'number' ? o.price.toFixed(2) : o.price,
        priceCurrency: o.priceCurrency,
        availability: o.availability ?? 'https://schema.org/InStock',
      };
      if (o.url) offer.url = o.url;
      if (o.description) offer.description = o.description;
      return offer;
    });
    node.offers = offers.length === 1 ? offers[0] : offers;
  }
  if (args.aggregateRating && args.aggregateRating.reviewCount > 0) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: args.aggregateRating.ratingValue.toFixed(1),
      reviewCount: args.aggregateRating.reviewCount,
      bestRating: '5',
      worstRating: '1',
    };
  }
  return node;
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `Service` node — describes a discrete offering (e.g. the Free Audit
 * wedge on /for-agents). Provider links back to the site-wide
 * Organization via `@id`.
 */
export function buildService(args: {
  name: string;
  description: string;
  url: string;
  /** `@id` of the site-wide Organization node. */
  providerId?: string;
  /** Free-text area served (e.g. "Worldwide"). */
  areaServed?: string;
  /** Schema.org service type (free-text, e.g. "Real estate marketing"). */
  serviceType?: string;
  offers?: OfferInput[];
}): JsonLdNode {
  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Service',
    '@id': args.url,
    name: args.name,
    description: args.description,
    url: args.url,
  };
  if (args.providerId) node.provider = { '@id': args.providerId };
  if (args.areaServed) node.areaServed = args.areaServed;
  if (args.serviceType) node.serviceType = args.serviceType;
  if (args.offers && args.offers.length > 0) {
    const offers = args.offers.map((o) => {
      const offer: JsonLdNode = {
        '@type': 'Offer',
        price: typeof o.price === 'number' ? o.price.toFixed(2) : o.price,
        priceCurrency: o.priceCurrency,
        availability: o.availability ?? 'https://schema.org/InStock',
      };
      if (o.url) offer.url = o.url;
      if (o.description) offer.description = o.description;
      return offer;
    });
    node.offers = offers.length === 1 ? offers[0] : offers;
  }
  return node;
}

/* -------------------------------------------------------------------------- */
/* RealEstateAgent                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Standalone `RealEstateAgent` node — used on agent profile pages.
 * Listing-level seller/broker embedding lives in `lib/listings/seo.ts`
 * because it inlines an `@id`-cross-referenced version.
 *
 * `aggregateRating` is only emitted when `reviewCount > 0` — never
 * fabricate (CLAUDE.md hard rule #8).
 */
export function buildRealEstateAgent(args: {
  name: string;
  url: string;
  image?: string | null;
  description?: string | null;
  telephone?: string | null;
  email?: string | null;
  /** `@id` of the site-wide Organization node. */
  worksForId?: string;
  /** Free-text specialties (e.g. ["Luxury homes", "Beachfront villas"]). */
  knowsAbout?: string[];
  /** Absolute external profile URLs. */
  sameAs?: string[];
  /** Address — when the agent operates from a specific city. */
  address?: {
    addressLocality?: string | null;
    addressRegion?: string | null;
    addressCountry?: string | null;
  };
  /** Only pass when real review data exists. */
  aggregateRating?: { ratingValue: number; reviewCount: number } | null;
}): JsonLdNode {
  const node: JsonLdNode = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'RealEstateAgent',
    '@id': args.url,
    name: args.name,
    url: args.url,
  };
  if (args.image) node.image = args.image;
  if (args.description) node.description = args.description;
  if (args.telephone) node.telephone = args.telephone;
  if (args.email) node.email = args.email;
  if (args.worksForId) node.worksFor = { '@id': args.worksForId };
  if (args.knowsAbout && args.knowsAbout.length > 0) node.knowsAbout = args.knowsAbout;
  if (args.sameAs && args.sameAs.length > 0) node.sameAs = args.sameAs;
  if (args.address) {
    const addr: JsonLdNode = { '@type': 'PostalAddress' };
    if (args.address.addressLocality) addr.addressLocality = args.address.addressLocality;
    if (args.address.addressRegion) addr.addressRegion = args.address.addressRegion;
    if (args.address.addressCountry) addr.addressCountry = args.address.addressCountry;
    if (Object.keys(addr).length > 1) node.address = addr;
  }
  if (args.aggregateRating && args.aggregateRating.reviewCount > 0) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: args.aggregateRating.ratingValue.toFixed(1),
      reviewCount: args.aggregateRating.reviewCount,
      bestRating: '5',
      worstRating: '1',
    };
  }
  return node;
}

/* -------------------------------------------------------------------------- */
/* @graph wrapper                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Wrap multiple nodes into a single `@graph` document — Google's
 * preferred form for pages that need to express relationships between
 * several typed entities. Each input node KEEPS its own `@type` and
 * `@id` but the outer `@context` becomes the single source.
 *
 * Inner nodes' `@context` is stripped — `JSON.stringify` would emit
 * it but it's redundant inside an `@graph` and bloats payload.
 */
export function buildGraph(nodes: JsonLdNode[]): JsonLdNode {
  const stripped = nodes.map((n) => {
    const copy: JsonLdNode = { ...n };
    delete (copy as { '@context'?: unknown })['@context'];
    return copy;
  });
  return {
    '@context': SCHEMA_CONTEXT,
    '@graph': stripped,
  };
}

/* -------------------------------------------------------------------------- */
/* Render helper                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Serialize a JSON-LD node for safe embedding in a <script> tag. We
 * escape `<` to `<` so an attacker-controlled string field can't
 * break out of the script element with `</script>`. Google + JSON
 * parsers both accept this escape.
 */
export function serializeJsonLd(node: JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(node).replace(/</g, '\\u003c');
}
