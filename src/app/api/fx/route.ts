import { NextResponse, type NextRequest } from 'next/server';
import { getOrFetchUsdRates } from '@/lib/currency/rates';

export const runtime = 'edge';

/**
 * GET /api/fx
 *
 * Returns the latest USD-base FX rate snapshot for the worldwide
 * price-tile converter. Anon-readable (rates are public information).
 *
 * Edge-cached 1 hour at the route layer — short relative to the
 * 24h DB cache because we want clients to pick up fresh rates within
 * an hour of a refresh. The DB cache absorbs the actual OXR-call cost.
 *
 * Returns:
 *   { ok: true, base: 'USD', rates: {...}, fetchedAt: '...', isFresh: bool }
 *   { ok: false, errorCode: 'rates_unavailable' } when neither cache
 *   nor live API is reachable. Callers fall back to source-currency
 *   rendering in that case.
 *
 * Used by:
 *   - Server-rendered price tiles call `getOrFetchUsdRates()` directly,
 *     not this route — saves a network hop.
 *   - Client-side currency switching + future admin/debug tooling.
 */
export async function GET(_req: NextRequest) {
  const result = await getOrFetchUsdRates();
  if (!result) {
    return NextResponse.json(
      { ok: false, errorCode: 'rates_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      base: 'USD',
      rates: result.rates,
      fetchedAt: result.fetchedAt,
      isFresh: result.isFresh,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    },
  );
}
