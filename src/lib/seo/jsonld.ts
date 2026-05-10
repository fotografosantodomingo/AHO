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
