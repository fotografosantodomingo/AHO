import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, clientFor, ensureFixtures } from './_setup';

/**
 * RLS tests for the SEO knowledge graph (migration 0082).
 *
 * Policy matrix:
 *   geo_countries / geo_cities / geo_neighborhoods / data_sources /
 *   market_metrics → public SELECT (using true), service-role-only writes
 *     (anon + authenticated REVOKE'd on insert/update/delete).
 *   content_guides → public SELECT only where status='published'; admin reads
 *     all (incl. drafts); service-role-only writes.
 *
 * Plus the data_origin immutability guard (seed → real blocked by trigger).
 *
 * Fixtures use ISO 3166 user-assigned code 'ZZ' + `aho-fixture-` slugs so they
 * never collide with real geo rows (mirrors the R11 fixture-isolation pattern).
 *
 * NOTE: like every RLS test, this is gated by the prod-host hard-stop in
 * _setup.ts and only runs against a dedicated test Supabase project. It is the
 * Hard Rule #2 paired test for the 0082 policies.
 */

const FIX_COUNTRY = 'ZZ';
const FIX_CITY_SLUG = 'aho-fixture-testville';
const FIX_PUB_GUIDE = 'aho-fixture-published-guide';
const FIX_DRAFT_GUIDE = 'aho-fixture-draft-guide';
const FIX_SOURCE_SLUG = 'aho_fixture_source';
const FIX_ORG_SLUG = 'aho-test-org-data-origin';

let sourceId: string;

beforeAll(async () => {
  await ensureFixtures();
  const a = admin();

  // Clean any prior run.
  await a.from('content_guides').delete().in('slug', [FIX_PUB_GUIDE, FIX_DRAFT_GUIDE]);
  await a.from('geo_cities').delete().eq('country_iso2', FIX_COUNTRY);
  await a.from('geo_countries').delete().eq('iso2', FIX_COUNTRY);
  await a.from('market_metrics').delete().eq('entity_id', FIX_COUNTRY);
  await a.from('data_sources').delete().eq('slug', FIX_SOURCE_SLUG);
  await a.from('organizations').delete().eq('slug', FIX_ORG_SLUG);

  const src = await a
    .from('data_sources')
    .insert({
      slug: FIX_SOURCE_SLUG,
      name: 'AHO Fixture Source',
      license: 'public',
      attribution_text: 'Fixture source.',
    })
    .select('id')
    .single();
  if (src.error) throw new Error(`fixture data_source: ${src.error.message}`);
  sourceId = src.data.id as string;

  const country = await a
    .from('geo_countries')
    .insert({
      iso2: FIX_COUNTRY,
      names: { en: 'Fixtureland' },
      region: 'Test',
      source_id: sourceId,
    })
    .select('iso2')
    .single();
  if (country.error) throw new Error(`fixture country: ${country.error.message}`);

  const city = await a.from('geo_cities').insert({
    country_iso2: FIX_COUNTRY,
    slug: FIX_CITY_SLUG,
    names: { en: 'Testville' },
    source_id: sourceId,
  });
  if (city.error) throw new Error(`fixture city: ${city.error.message}`);

  const metric = await a.from('market_metrics').insert({
    entity_type: 'country',
    entity_id: FIX_COUNTRY,
    metric: 'population',
    value: 1000,
    unit: 'people',
    as_of_date: '2024-01-01',
    source_id: sourceId,
  });
  if (metric.error) throw new Error(`fixture metric: ${metric.error.message}`);

  const guides = await a.from('content_guides').insert([
    {
      scope: 'country',
      entity_id: FIX_COUNTRY,
      locale: 'en',
      slug: FIX_PUB_GUIDE,
      title: 'Published fixture guide',
      status: 'published',
      published_at: new Date().toISOString(),
    },
    {
      scope: 'country',
      entity_id: FIX_COUNTRY,
      locale: 'en',
      slug: FIX_DRAFT_GUIDE,
      title: 'Draft fixture guide',
      status: 'draft',
    },
  ]);
  if (guides.error) throw new Error(`fixture guides: ${guides.error.message}`);
});

afterAll(async () => {
  const a = admin();
  await a.from('content_guides').delete().in('slug', [FIX_PUB_GUIDE, FIX_DRAFT_GUIDE]);
  await a.from('market_metrics').delete().eq('entity_id', FIX_COUNTRY);
  await a.from('geo_cities').delete().eq('country_iso2', FIX_COUNTRY);
  await a.from('geo_countries').delete().eq('iso2', FIX_COUNTRY);
  await a.from('data_sources').delete().eq('slug', FIX_SOURCE_SLUG);
  await a.from('organizations').delete().eq('slug', FIX_ORG_SLUG);
});

describe('geo reference tables — public read, no public write', () => {
  it('anon CAN read geo_countries', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('geo_countries')
      .select('iso2')
      .eq('iso2', FIX_COUNTRY);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it('anon CAN read geo_cities + market_metrics + data_sources', async () => {
    const c = await clientFor('anon');
    const city = await c.from('geo_cities').select('slug').eq('slug', FIX_CITY_SLUG);
    expect(city.error).toBeNull();
    expect(city.data?.length).toBe(1);
    const metric = await c
      .from('market_metrics')
      .select('metric')
      .eq('entity_id', FIX_COUNTRY);
    expect(metric.error).toBeNull();
    expect(metric.data?.length).toBeGreaterThanOrEqual(1);
    const src = await c.from('data_sources').select('slug').eq('slug', FIX_SOURCE_SLUG);
    expect(src.error).toBeNull();
    expect(src.data?.length).toBe(1);
  });

  it('anon CANNOT insert a country', async () => {
    const c = await clientFor('anon');
    const { error } = await c
      .from('geo_countries')
      .insert({ iso2: 'YY', names: { en: 'Hackland' } });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission|policy|denied|insufficient/i);
  });

  it('registered (authenticated) CANNOT update a city', async () => {
    const c = await clientFor('registered_a');
    await c.from('geo_cities').update({ population: 999 }).eq('slug', FIX_CITY_SLUG);
    // Confirm the value did not change.
    const { data } = await admin()
      .from('geo_cities')
      .select('population')
      .eq('slug', FIX_CITY_SLUG)
      .single();
    expect(data?.population ?? null).toBeNull();
  });

  it('registered CANNOT insert a market_metric (no source-faking)', async () => {
    const c = await clientFor('registered_a');
    const { error } = await c.from('market_metrics').insert({
      entity_type: 'country',
      entity_id: FIX_COUNTRY,
      metric: 'fake_price',
      value: 1,
      as_of_date: '2024-01-01',
      source_id: sourceId,
    });
    expect(error).not.toBeNull();
  });
});

describe('content_guides — published public, drafts hidden', () => {
  it('anon CAN read a published guide', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('content_guides')
      .select('slug')
      .eq('slug', FIX_PUB_GUIDE);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it('anon CANNOT read a draft guide', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('content_guides')
      .select('slug')
      .eq('slug', FIX_DRAFT_GUIDE);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('admin CAN read a draft guide', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('content_guides')
      .select('slug, status')
      .eq('slug', FIX_DRAFT_GUIDE);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.status).toBe('draft');
  });

  it('anon CANNOT insert a guide', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('content_guides').insert({
      scope: 'topic',
      locale: 'en',
      slug: 'aho-fixture-anon-guide',
      title: 'Spam',
      status: 'published',
    });
    expect(error).not.toBeNull();
  });
});

describe('data_origin immutability guard', () => {
  it('blocks laundering a seed row back to real (even via service role)', async () => {
    const a = admin();
    // Throwaway org so we never strand a shared fixture in seed state
    // (seed → real is intentionally irreversible).
    const created = await a
      .from('organizations')
      .insert({ slug: FIX_ORG_SLUG, name: 'Data Origin Guard', type: 'agent', listing_cap: 5 })
      .select('id')
      .single();
    if (created.error) throw new Error(`org: ${created.error.message}`);
    const orgId = created.data.id as string;

    // real → seed is allowed.
    const toSeed = await a.from('organizations').update({ data_origin: 'seed' }).eq('id', orgId);
    expect(toSeed.error).toBeNull();

    // seed → real is blocked by the trigger (fires regardless of role).
    const toReal = await a.from('organizations').update({ data_origin: 'real' }).eq('id', orgId);
    expect(toReal.error).not.toBeNull();
    expect(toReal.error?.message).toMatch(/immutable|seed/i);

    // Cleanup (DELETE is not guarded).
    await a.from('organizations').delete().eq('id', orgId);
  });
});
