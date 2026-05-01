import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type PriceHistoryEvent =
  | {
      kind: 'listed';
      at: string;
      priceCents: number;
      currency: string;
    }
  | {
      kind: 'price_changed';
      at: string;
      fromCents: number | null;
      toCents: number;
      currency: string;
    }
  | {
      kind: 'sold' | 'rented';
      at: string;
      priceCents: number | null;
      currency: string;
    };

interface FetchArgs {
  propertyId: string;
  publishedAt: string | null;
  currentPriceCents: number;
  currency: string;
}

/**
 * Build a chronological price/state history for a property by combining
 * its first-publish marker (from `properties.published_at + price_cents`)
 * with the audit_log slice exposed to public readers in 0014.
 *
 * Public readers see only `listing.price_changed`, `listing.marked_sold`,
 * and `listing.marked_rented` events for active+published properties —
 * RLS does the gating; we just trust the result.
 *
 * Returns an empty array for never-published listings (drafts). Callers
 * should hide the block when the result has < 2 events (a single "listed"
 * row is just the current price restated, not history).
 */
export async function fetchPriceHistory({
  propertyId,
  publishedAt,
  currentPriceCents,
  currency,
}: FetchArgs): Promise<PriceHistoryEvent[]> {
  if (!publishedAt) return [];

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('audit_log')
    .select('kind, payload, created_at')
    .eq('target_id', propertyId)
    .in('kind', ['listing.price_changed', 'listing.marked_sold', 'listing.marked_rented'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[fetchPriceHistory]', error);
    return [];
  }

  const events: PriceHistoryEvent[] = [
    {
      kind: 'listed',
      at: publishedAt,
      // For the "Listed at" line, use the *earliest known* price. If the
      // first audit row is a price_changed with from_cents != null, prefer
      // that; otherwise fall back to the current price (no history yet).
      priceCents: currentPriceCents,
      currency,
    },
  ];

  for (const row of data ?? []) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const at = (payload.changed_at as string | undefined) ?? row.created_at;
    if (row.kind === 'listing.price_changed') {
      const fromRaw = payload.from_cents;
      const toRaw = payload.to_cents;
      const fromCents = typeof fromRaw === 'number' ? fromRaw : null;
      const toCents = typeof toRaw === 'number' ? toRaw : currentPriceCents;
      events.push({ kind: 'price_changed', at, fromCents, toCents, currency });
    } else {
      const closeKind: 'sold' | 'rented' =
        row.kind === 'listing.marked_sold' ? 'sold' : 'rented';
      const priceRaw = payload.sold_price_cents;
      const priceCents = typeof priceRaw === 'number' ? priceRaw : null;
      events.push({ kind: closeKind, at, priceCents, currency });
    }
  }

  // If the very first audit_log row is a price change with a known
  // `from_cents`, retroactively use it as the original list price.
  const firstChange = events.find((e) => e.kind === 'price_changed');
  if (firstChange && firstChange.kind === 'price_changed' && firstChange.fromCents != null) {
    events[0] = {
      ...events[0],
      priceCents: firstChange.fromCents,
    } as PriceHistoryEvent;
  }

  return events;
}
