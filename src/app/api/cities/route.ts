import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCountryCities } from '@/lib/listings/countries';

export const runtime = 'edge';

/**
 * GET /api/cities?country=XX
 *
 * Returns the list of cities (with active listing counts) inside the given
 * ISO-3166-1 alpha-2 country. Backs the homepage hero's City dropdown,
 * which only enables once a Country has been picked.
 *
 * Edge cache: 5 min `s-maxage`. Listings churn at most every few minutes
 * (publish/unpublish), and the city set itself only shifts when a new
 * city's first listing publishes — which is rare. 5 min keeps the
 * dropdown snappy across users without going stale on a real new-city
 * launch.
 *
 * Test fixture exclusion is inherited from `getCountryCities` (the same
 * helper the country landing page uses).
 *
 * Response: { cities: [{ city, citySlug, listingCount }, …] }
 */

const QuerySchema = z.object({
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ country: url.searchParams.get('country') });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_country' },
      { status: 400 },
    );
  }

  const { cities } = await getCountryCities(parsed.data.country);

  return NextResponse.json(
    { cities },
    {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    },
  );
}
