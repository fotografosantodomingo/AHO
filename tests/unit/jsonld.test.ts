import { describe, it, expect } from 'vitest';
import {
  SCHEMA_CONTEXT,
  buildBreadcrumbList,
  buildCollectionPage,
  buildFAQPage,
  buildGraph,
  buildHowTo,
  buildItemList,
  buildOrganization,
  buildPlace,
  buildProduct,
  buildRealEstateAgent,
  buildService,
  buildSoftwareApplication,
  buildWebPage,
  buildWebSite,
  serializeJsonLd,
} from '@/lib/seo/jsonld';

describe('buildBreadcrumbList', () => {
  it('emits a BreadcrumbList with 1-indexed positions', () => {
    const node = buildBreadcrumbList([
      { name: 'Home', url: 'https://aho.test/en' },
      { name: 'Agents', url: 'https://aho.test/en/agents' },
      { name: 'Acme Realty', url: 'https://aho.test/en/agents/acme' },
    ]);
    expect(node['@context']).toBe(SCHEMA_CONTEXT);
    expect(node['@type']).toBe('BreadcrumbList');
    const items = node.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]?.position).toBe(1);
    expect(items[2]?.position).toBe(3);
    expect(items[0]?.item).toBe('https://aho.test/en');
  });

  it('handles an empty list', () => {
    const node = buildBreadcrumbList([]);
    expect((node.itemListElement as unknown[]).length).toBe(0);
  });
});

describe('buildItemList', () => {
  it('filters out entries that lack a URL and renumbers the rest', () => {
    const node = buildItemList({
      name: 'Properties in Santo Domingo',
      entries: [
        { url: 'https://aho.test/en/properties/a-1' },
        null,
        undefined,
        { url: '' },
        { url: 'https://aho.test/en/properties/b-2', name: 'Modern Villa' },
      ],
    });
    const items = node.itemListElement as Array<Record<string, unknown>>;
    expect(node.numberOfItems).toBe(2);
    expect(items).toHaveLength(2);
    expect(items[0]?.position).toBe(1);
    expect(items[1]?.position).toBe(2);
    expect(items[1]?.name).toBe('Modern Villa');
    // No name on item without one (kept tight).
    expect(items[0]).not.toHaveProperty('name');
  });

  it('attaches @id when provided', () => {
    const node = buildItemList({
      name: 'List',
      entries: [{ url: 'https://aho.test/x' }],
      id: 'https://aho.test/page#listings',
    });
    expect(node['@id']).toBe('https://aho.test/page#listings');
  });
});

describe('buildPlace', () => {
  it('emits city locality on a city page', () => {
    const node = buildPlace({
      name: 'Santo Domingo, Dominican Republic',
      city: 'Santo Domingo',
      countryCode: 'DO',
      url: 'https://aho.test/en/properties-in/do/santo-domingo',
      description: 'Browse properties for sale or rent in Santo Domingo.',
    });
    expect(node['@type']).toBe('Place');
    expect(node['@id']).toBe('https://aho.test/en/properties-in/do/santo-domingo');
    const address = node.address as Record<string, unknown>;
    expect(address.addressCountry).toBe('DO');
    expect(address.addressLocality).toBe('Santo Domingo');
    expect(node.description).toBe(
      'Browse properties for sale or rent in Santo Domingo.',
    );
  });

  it('omits addressLocality on a country-only place', () => {
    const node = buildPlace({
      name: 'Dominican Republic',
      countryCode: 'DO',
      url: 'https://aho.test/en/properties-in/do',
    });
    const address = node.address as Record<string, unknown>;
    expect(address).not.toHaveProperty('addressLocality');
    expect(node).not.toHaveProperty('description');
  });
});

describe('buildOrganization', () => {
  it('omits sameAs when empty', () => {
    const node = buildOrganization({
      name: 'AHO',
      url: 'https://aho.test/en',
      sameAs: [],
    });
    expect(node).not.toHaveProperty('sameAs');
  });

  it('attaches optional fields when present', () => {
    const node = buildOrganization({
      name: 'AHO',
      url: 'https://aho.test/en',
      logo: 'https://aho.test/icon.svg',
      alternateName: 'Advertise Homes Online',
      description: 'Worldwide real estate listings.',
      sameAs: ['https://twitter.com/aho'],
    });
    expect(node.alternateName).toBe('Advertise Homes Online');
    expect(node.logo).toBe('https://aho.test/icon.svg');
    expect(node.sameAs).toEqual(['https://twitter.com/aho']);
  });
});

describe('buildWebSite', () => {
  it('emits a SearchAction when a valid template is provided', () => {
    const node = buildWebSite({
      name: 'AHO',
      url: 'https://aho.test/en',
      inLanguage: 'en',
      searchUrlTemplate: 'https://aho.test/en/search?q={search_term_string}',
    });
    const action = node.potentialAction as Record<string, unknown>;
    expect(action['@type']).toBe('SearchAction');
    expect((action.target as Record<string, unknown>).urlTemplate).toBe(
      'https://aho.test/en/search?q={search_term_string}',
    );
    expect(action['query-input']).toBe('required name=search_term_string');
  });

  it('throws when the search template is missing the placeholder', () => {
    expect(() =>
      buildWebSite({
        name: 'AHO',
        url: 'https://aho.test/en',
        searchUrlTemplate: 'https://aho.test/en/search',
      }),
    ).toThrow(/search_term_string/);
  });

  it('omits potentialAction when no template is given', () => {
    const node = buildWebSite({ name: 'AHO', url: 'https://aho.test/en' });
    expect(node).not.toHaveProperty('potentialAction');
  });
});

describe('buildProduct', () => {
  it('emits a single Offer object when only one is provided', () => {
    const node = buildProduct({
      name: 'AHO Agent',
      description: 'Entry tier with up to 5 active listings.',
      url: 'https://aho.test/en/pricing#agent',
      brand: 'AHO',
      offers: [{ price: 29, priceCurrency: 'USD' }],
    });
    const offers = node.offers as Record<string, unknown>;
    expect(Array.isArray(offers)).toBe(false);
    expect(offers.price).toBe('29.00');
    expect(offers.priceCurrency).toBe('USD');
    expect(offers.availability).toBe('https://schema.org/InStock');
    expect((node.brand as Record<string, unknown>).name).toBe('AHO');
  });

  it('emits an array when multiple offers are provided', () => {
    const node = buildProduct({
      name: 'AHO Pro Automation',
      description: 'Top tier.',
      url: 'https://aho.test/en/pricing#pro_automation',
      offers: [
        { price: 99, priceCurrency: 'USD', description: 'Monthly' },
        { price: '990.00', priceCurrency: 'USD', description: 'Annual' },
      ],
    });
    const offers = node.offers as Array<Record<string, unknown>>;
    expect(Array.isArray(offers)).toBe(true);
    expect(offers).toHaveLength(2);
    expect(offers[0]?.price).toBe('99.00');
    expect(offers[1]?.price).toBe('990.00');
    expect(offers[1]?.description).toBe('Annual');
  });

  it('throws when no offers are provided', () => {
    expect(() =>
      buildProduct({
        name: 'X',
        description: 'Y',
        url: 'https://aho.test',
        offers: [],
      }),
    ).toThrow(/at least one offer/);
  });
});

describe('buildWebPage', () => {
  it('emits @id, url, name and the language tag', () => {
    const node = buildWebPage({
      name: 'Privacy Policy',
      url: 'https://aho.test/en/privacy',
      description: 'How AHO handles your data.',
      inLanguage: 'en',
      lastReviewed: '2026-05-06',
      publisherId: 'https://aho.test/#organization',
      isPartOfId: 'https://aho.test/#website',
    });
    expect(node['@type']).toBe('WebPage');
    expect(node['@id']).toBe('https://aho.test/en/privacy');
    expect(node.inLanguage).toBe('en');
    expect(node.lastReviewed).toBe('2026-05-06');
    expect((node.publisher as Record<string, unknown>)['@id']).toBe(
      'https://aho.test/#organization',
    );
    expect((node.isPartOf as Record<string, unknown>)['@id']).toBe(
      'https://aho.test/#website',
    );
  });

  it('omits optional fields when absent', () => {
    const node = buildWebPage({
      name: 'Page',
      url: 'https://aho.test/en/page',
    });
    expect(node).not.toHaveProperty('description');
    expect(node).not.toHaveProperty('inLanguage');
    expect(node).not.toHaveProperty('lastReviewed');
    expect(node).not.toHaveProperty('publisher');
    expect(node).not.toHaveProperty('isPartOf');
  });
});

describe('buildCollectionPage', () => {
  it('wires mainEntity to the hasPartId', () => {
    const node = buildCollectionPage({
      name: 'Countries',
      url: 'https://aho.test/en/countries',
      description: 'Browse all countries on AHO.',
      inLanguage: 'en',
      hasPartId: 'https://aho.test/en/countries#countries',
    });
    expect(node['@type']).toBe('CollectionPage');
    expect((node.mainEntity as Record<string, unknown>)['@id']).toBe(
      'https://aho.test/en/countries#countries',
    );
  });
});

describe('buildHowTo', () => {
  it('emits 1-indexed HowToStep entries', () => {
    const node = buildHowTo({
      name: 'How to publish your first listing',
      description: 'Four-step quickstart.',
      url: 'https://aho.test/en/share-guide',
      inLanguage: 'en',
      steps: [
        { name: 'Subscribe', text: 'Pick a plan and pay.' },
        { name: 'Connect Facebook', text: 'OAuth your Page.' },
        { name: 'Publish a listing', text: 'Paste the URL.' },
        { name: 'Click Share', text: 'Pick the channels.' },
      ],
    });
    expect(node['@type']).toBe('HowTo');
    const steps = node.step as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(4);
    expect(steps[0]?.position).toBe(1);
    expect(steps[3]?.position).toBe(4);
    expect(steps[0]?.name).toBe('Subscribe');
  });

  it('throws when no steps are provided', () => {
    expect(() =>
      buildHowTo({
        name: 'X',
        description: 'Y',
        url: 'https://aho.test',
        steps: [],
      }),
    ).toThrow(/at least one step/);
  });
});

describe('buildFAQPage', () => {
  it('wraps entries as Question + Answer', () => {
    const node = buildFAQPage({
      url: 'https://aho.test/en/instagram-setup',
      entries: [
        { q: 'Why no IG detected?', a: 'IG must be linked to a Page.' },
        { q: 'How do I link it?', a: 'In Meta Business Suite.' },
      ],
    });
    expect(node['@type']).toBe('FAQPage');
    expect(node['@id']).toBe('https://aho.test/en/instagram-setup#faq');
    const entries = node.mainEntity as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    expect(entries[0]?.['@type']).toBe('Question');
    expect(
      ((entries[0]?.acceptedAnswer as Record<string, unknown>).text as string),
    ).toContain('Page');
  });

  it('throws on empty entries', () => {
    expect(() =>
      buildFAQPage({ url: 'https://aho.test', entries: [] }),
    ).toThrow(/at least one entry/);
  });
});

describe('buildSoftwareApplication', () => {
  it('defaults applicationCategory and operatingSystem', () => {
    const node = buildSoftwareApplication({
      name: 'AHO',
      description: 'Real-estate social automation.',
      url: 'https://aho.test/en',
    });
    expect(node.applicationCategory).toBe('BusinessApplication');
    expect(node.operatingSystem).toBe('Web');
    expect(node).not.toHaveProperty('offers');
    expect(node).not.toHaveProperty('aggregateRating');
  });

  it('omits aggregateRating when reviewCount is 0 (no fabrication)', () => {
    const node = buildSoftwareApplication({
      name: 'AHO',
      description: 'X',
      url: 'https://aho.test/en',
      aggregateRating: { ratingValue: 4.8, reviewCount: 0 },
    });
    expect(node).not.toHaveProperty('aggregateRating');
  });

  it('emits Offer + aggregateRating when both are present', () => {
    const node = buildSoftwareApplication({
      name: 'AHO',
      description: 'X',
      url: 'https://aho.test/en',
      offers: [{ price: 29, priceCurrency: 'USD' }],
      aggregateRating: { ratingValue: 4.8, reviewCount: 42 },
    });
    expect((node.offers as Record<string, unknown>).price).toBe('29.00');
    const r = node.aggregateRating as Record<string, unknown>;
    expect(r.reviewCount).toBe(42);
    expect(r.ratingValue).toBe('4.8');
  });
});

describe('buildService', () => {
  it('wires provider by @id when given', () => {
    const node = buildService({
      name: 'Free Listing Audit',
      description: 'Free SEO audit for any listing URL.',
      url: 'https://aho.test/en/for-agents',
      providerId: 'https://aho.test/#organization',
      areaServed: 'Worldwide',
      serviceType: 'Real-estate marketing',
    });
    expect(node['@type']).toBe('Service');
    expect((node.provider as Record<string, unknown>)['@id']).toBe(
      'https://aho.test/#organization',
    );
    expect(node.areaServed).toBe('Worldwide');
    expect(node.serviceType).toBe('Real-estate marketing');
  });
});

describe('buildRealEstateAgent', () => {
  it('omits aggregateRating when reviewCount is 0', () => {
    const node = buildRealEstateAgent({
      name: 'Jane Doe',
      url: 'https://aho.test/en/agents/jane-doe',
      aggregateRating: { ratingValue: 5.0, reviewCount: 0 },
    });
    expect(node).not.toHaveProperty('aggregateRating');
  });

  it('attaches PostalAddress only when at least one part is provided', () => {
    const empty = buildRealEstateAgent({
      name: 'Jane',
      url: 'https://aho.test/en/agents/jane',
      address: {},
    });
    expect(empty).not.toHaveProperty('address');

    const filled = buildRealEstateAgent({
      name: 'Jane',
      url: 'https://aho.test/en/agents/jane',
      address: { addressLocality: 'Santo Domingo', addressCountry: 'DO' },
    });
    const addr = filled.address as Record<string, unknown>;
    expect(addr['@type']).toBe('PostalAddress');
    expect(addr.addressLocality).toBe('Santo Domingo');
  });
});

describe('buildGraph', () => {
  it('wraps multiple nodes and strips inner @context', () => {
    const org = buildOrganization({ name: 'AHO', url: 'https://aho.test' });
    const site = buildWebSite({ name: 'AHO', url: 'https://aho.test' });
    const graph = buildGraph([org, site]);
    expect(graph['@context']).toBe(SCHEMA_CONTEXT);
    const inner = graph['@graph'] as Array<Record<string, unknown>>;
    expect(inner).toHaveLength(2);
    // Inner @context fields are stripped — they'd be redundant under
    // the outer @graph and inflate payload.
    expect(inner[0]).not.toHaveProperty('@context');
    expect(inner[1]).not.toHaveProperty('@context');
    expect(inner[0]?.['@type']).toBe('Organization');
    expect(inner[1]?.['@type']).toBe('WebSite');
  });

  it('round-trips through JSON.parse', () => {
    const graph = buildGraph([
      buildOrganization({ name: 'AHO', url: 'https://aho.test' }),
      buildBreadcrumbList([{ name: 'Home', url: 'https://aho.test' }]),
    ]);
    const out = serializeJsonLd(graph);
    const parsed = JSON.parse(out.replace(/\\u003c/g, '<')) as Record<string, unknown>;
    expect(parsed['@context']).toBe(SCHEMA_CONTEXT);
    expect(Array.isArray(parsed['@graph'])).toBe(true);
  });
});

describe('serializeJsonLd', () => {
  it('escapes the `<` in `</script>` so it cannot break out of the host tag', () => {
    const node = buildOrganization({
      name: 'Evil </script><script>alert(1)</script>',
      url: 'https://aho.test',
    });
    const out = serializeJsonLd(node);
    // Only `<` is escaped (Google + browser parsers accept that). The
    // verbatim `</script>` MUST NOT appear, because that's what would
    // close the host <script> tag in the rendered HTML.
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script>');
    expect(out).toContain('\\u003cscript>');
  });

  it('round-trips through JSON.parse', () => {
    const node = buildBreadcrumbList([
      { name: 'Home', url: 'https://aho.test' },
    ]);
    const out = serializeJsonLd(node);
    const parsed = JSON.parse(out.replace(/\\u003c/g, '<')) as Record<string, unknown>;
    expect(parsed['@type']).toBe('BreadcrumbList');
  });
});
