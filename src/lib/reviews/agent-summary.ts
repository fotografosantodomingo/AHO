import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Tiny helper: resolve the agent (= property.created_by) for a listing
 * and pull their published-review aggregate (count + avg). Used to
 * decorate the listing's JSON-LD RealEstateAgent node with an
 * AggregateRating block when the agent actually has reviews on AHO.
 *
 * Two queries on purpose: skipping the listing-wrapper join keeps the
 * second query usable from any context that already has the agent_id
 * directly (avoid a re-fetch in callers that already loaded the property).
 *
 * Returns null when the listing has no created_by row, no reviews, or
 * either query errors — JSON-LD just omits the aggregateRating block
 * in that case (Google accepts the omission; a fake/zero rating would
 * actively hurt the rich result).
 */
export async function fetchAgentReviewSummaryForListing(
  propertyId: string,
): Promise<{ count: number; avg: number } | null> {
  const supabase = await createServerSupabaseClient();

  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('created_by')
    .eq('id', propertyId)
    .maybeSingle();
  if (propErr || !prop?.created_by) return null;

  const { data: aggData, error: aggErr } = await supabase.rpc(
    'aggregate_rating_for_agent',
    { p_agent_id: prop.created_by as string },
  );
  if (aggErr) {
    console.warn('[agent-summary] aggregate_rating_for_agent failed', aggErr);
    return null;
  }
  const aggRow = Array.isArray(aggData) ? aggData[0] : aggData;
  if (!aggRow) return null;
  const count = Number(aggRow.review_count ?? 0);
  const avg = Number(aggRow.avg_rating ?? 0);
  if (count === 0) return null;
  return { count, avg };
}
