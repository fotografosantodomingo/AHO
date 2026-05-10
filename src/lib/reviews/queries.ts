import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { ReviewLocale } from '@/db/schema';

/**
 * Server-side reviews query helpers. Used by:
 *   - /agents/[slug] page — reviews block + AggregateRating JSON-LD
 *   - /dashboard/reviews page — agent's own reviews + reply UI
 *   - /admin/reviews page — moderation queue (admin RLS)
 *
 * All queries respect RLS, so the agent profile page sees only published
 * reviews (the public_select_published policy from 0016), the agent
 * dashboard sees all statuses for their own reviews (agent_select_own
 * policy), and the admin queue sees everything (admin_select policy).
 */

export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  locale: ReviewLocale;
  reviewerName: string;
  /** Empty when no reply has been written yet. */
  agentReply: string | null;
  agentRepliedAt: string | null;
  createdAt: string;
}

export interface AggregateRating {
  count: number;
  avg: number; // 0 when count = 0; callers should omit JSON-LD in that case
}

interface FetchAgentReviewsArgs {
  agentId: string;
  /** Default: 20 */
  limit?: number;
}

interface FetchAgentReviewsResult {
  reviews: PublicReview[];
  aggregate: AggregateRating;
}

export async function fetchPublishedReviewsForAgent(
  args: FetchAgentReviewsArgs,
): Promise<FetchAgentReviewsResult> {
  const supabase = await createServerSupabaseClient();
  const limit = args.limit ?? 20;

  // Two queries: the page slice (20 most recent) + the AggregateRating
  // numbers (across all published, not just the page). RPC for the
  // aggregate is cheaper than a SELECT count + avg under load because
  // Postgres can use the partial index on (agent_id, created_at) WHERE
  // status='published' for both passes.
  const [{ data: rows, error: rowsErr }, { data: aggData, error: aggErr }] =
    await Promise.all([
      supabase
        .from('reviews')
        .select('id, rating, body, locale, reviewer_name, agent_reply, agent_replied_at, created_at')
        .eq('agent_id', args.agentId)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase.rpc('aggregate_rating_for_agent', { p_agent_id: args.agentId }),
    ]);

  if (rowsErr) {
    console.error('[fetchPublishedReviewsForAgent] rows query failed', rowsErr);
    return { reviews: [], aggregate: { count: 0, avg: 0 } };
  }
  if (aggErr) {
    console.error('[fetchPublishedReviewsForAgent] aggregate rpc failed', aggErr);
  }

  const reviews: PublicReview[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    rating: r.rating as number,
    body: r.body as string,
    locale: r.locale as ReviewLocale,
    // For published reviews we expose the reviewer's display name only —
    // never the email or auth.uid().
    reviewerName: (r.reviewer_name as string | null) ?? '',
    agentReply: r.agent_reply as string | null,
    agentRepliedAt: r.agent_replied_at as string | null,
    createdAt: r.created_at as string,
  }));

  const aggRow = Array.isArray(aggData) ? aggData[0] : aggData;
  const aggregate: AggregateRating = aggRow
    ? {
        count: Number(aggRow.review_count ?? 0),
        avg: Number(aggRow.avg_rating ?? 0),
      }
    : { count: 0, avg: 0 };

  return { reviews, aggregate };
}

export interface AgentDashboardReview {
  id: string;
  rating: number;
  body: string;
  locale: ReviewLocale;
  reviewerName: string;
  status: string;
  agentReply: string | null;
  agentRepliedAt: string | null;
  createdAt: string;
  verifiedAt: string | null;
  moderatedAt: string | null;
}

/**
 * For /dashboard/reviews — the signed-in agent sees all reviews about
 * themselves at every status (RLS policy reviews_agent_select_own
 * gates this). Used so the agent can see "1 review pending moderation"
 * + reply to published ones.
 */
export async function fetchOwnReviews(
  agentUserId: string,
): Promise<AgentDashboardReview[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('reviews')
    .select(
      'id, rating, body, locale, reviewer_name, status, agent_reply, agent_replied_at, created_at, verified_at, moderated_at',
    )
    .eq('agent_id', agentUserId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[fetchOwnReviews] failed', error);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    rating: r.rating as number,
    body: r.body as string,
    locale: r.locale as ReviewLocale,
    reviewerName: (r.reviewer_name as string | null) ?? '',
    status: r.status as string,
    agentReply: r.agent_reply as string | null,
    agentRepliedAt: r.agent_replied_at as string | null,
    createdAt: r.created_at as string,
    verifiedAt: r.verified_at as string | null,
    moderatedAt: r.moderated_at as string | null,
  }));
}

export interface ModerationQueueReview {
  id: string;
  agentId: string;
  agentSlug: string | null;
  agentName: string | null;
  rating: number;
  body: string;
  locale: ReviewLocale;
  reviewerName: string;
  reviewerEmail: string | null;
  status: string;
  verifiedAt: string | null;
  createdAt: string;
  reportCount: number;
}

/**
 * For /admin/reviews — admin sees pending_moderation queue + open-report
 * queue. Two distinct flows but rendered on the same page.
 */
export async function fetchModerationQueue(): Promise<ModerationQueueReview[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('reviews')
    .select(
      `id, agent_id, rating, body, locale, reviewer_name, reviewer_email, status, verified_at, created_at,
       agent:profiles!reviews_agent_id_fkey(full_name)`,
    )
    .in('status', ['pending_moderation', 'published'])
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('[fetchModerationQueue] failed', error);
    return [];
  }

  // Second pass: report counts per review id. Cheap aggregate.
  const ids = (data ?? []).map((r) => r.id as string);
  const reportCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: reports } = await supabase
      .from('review_reports')
      .select('review_id')
      .in('review_id', ids)
      .eq('status', 'open');
    for (const rep of reports ?? []) {
      const k = rep.review_id as string;
      reportCounts.set(k, (reportCounts.get(k) ?? 0) + 1);
    }
  }

  // Third pass: resolve each agent's org public_slug so the moderation
  // UI can link straight to /agents/{slug} (QA #20). Single grouped
  // query keyed by user_id; missing rows leave agentSlug null and the
  // UI falls back to a non-link.
  const agentIds = Array.from(
    new Set((data ?? []).map((r) => r.agent_id as string)),
  );
  const slugByAgent = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: memberships } = await supabase
      .from('organization_members')
      .select('user_id, organizations!inner(slug, public_slug)')
      .in('user_id', agentIds);
    for (const m of memberships ?? []) {
      const userId = m.user_id as string;
      if (slugByAgent.has(userId)) continue;
      const org = Array.isArray(m.organizations)
        ? (m.organizations[0] as { slug?: string; public_slug?: string | null } | undefined)
        : (m.organizations as { slug?: string; public_slug?: string | null } | null);
      const slug = org?.public_slug ?? org?.slug ?? null;
      if (slug) slugByAgent.set(userId, slug);
    }
  }

  return (data ?? []).map((r) => {
    const agentJoin = r.agent as { full_name?: string | null } | null;
    return {
      id: r.id as string,
      agentId: r.agent_id as string,
      agentSlug: slugByAgent.get(r.agent_id as string) ?? null,
      agentName: agentJoin?.full_name ?? null,
      rating: r.rating as number,
      body: r.body as string,
      locale: r.locale as ReviewLocale,
      reviewerName: (r.reviewer_name as string | null) ?? '',
      reviewerEmail: r.reviewer_email as string | null,
      status: r.status as string,
      verifiedAt: r.verified_at as string | null,
      createdAt: r.created_at as string,
      reportCount: reportCounts.get(r.id as string) ?? 0,
    };
  });
}
