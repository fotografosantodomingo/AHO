import 'server-only';

// AI customer-service agent fetches context here so every channel (web chat,
// email, WhatsApp, voice) grounds on the same data; pure function so it's
// unit-testable without spinning up a real Supabase.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Locale } from '@/i18n/config';

const SITE_ORIGIN = 'https://advertisehomes.online';
const LISTINGS_CAP = 20;
const FAQ_CAP = 10;
const REVIEW_SNIPPET_MAX = 300;

export interface KnowledgeContext {
  agent: {
    id: string;
    name: string;
    languages: string[];
    specialties: string[];
    bio: string | null;
  };
  org: {
    id: string;
    name: string;
    faqs: Array<{ q: string; a: string }>;
  };
  listings: Array<{
    id: string;
    shortId: string;
    title: string;
    description: string | null;
    propertyType: string;
    transactionType: 'sale' | 'rent' | 'short_term';
    priceCents: number;
    currency: string;
    pricePeriod: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    areaSqm: number | null;
    city: string;
    countryCode: string;
    url: string;
  }>;
  reviews: { count: number; avg: number; recentTopReview: string | null };
  buyer: { savedSearchesCount: number } | null;
}

export interface FetchKnowledgeArgs {
  supabase: SupabaseClient;
  agentId: string;
  /** When set, surfaces this listing first in the listings array. */
  focusListingId?: string;
  /** When set, looks up the lead's saved searches for context. */
  leadId?: string;
  /** Drives language selection on title/description (en | es content; rest fall back to en). */
  buyerLocale: Locale;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  bio: string | null;
  specialties: string[] | null;
  languages_spoken: string[] | null;
}

interface MembershipRow {
  org_id: string;
  organizations: {
    id: string;
    name: string;
    slug: string;
  } | Array<{ id: string; name: string; slug: string }> | null;
}

interface ListingRow {
  id: string;
  short_id: string;
  title_en: string | null;
  title_es: string | null;
  description_en: string | null;
  description_es: string | null;
  slug_en: string | null;
  slug_es: string | null;
  property_type: string;
  transaction_type: 'sale' | 'rent' | 'short_term';
  price_cents: number | string;
  currency: string;
  price_period: string | null;
  bedrooms: number | null;
  bathrooms: number | string | null;
  area_sqm: number | string | null;
  city: string;
  country_code: string;
  published_at: string | null;
  featured_until: string | null;
}

interface FaqRow {
  question_en: string | null;
  question_es: string | null;
  answer_en: string | null;
  answer_es: string | null;
  sort_order: number | null;
}

interface ReviewRow {
  rating: number;
  body: string;
  created_at: string;
}

interface LeadRow {
  user_id: string | null;
}

function emptyContext(agentId: string, leadId: string | undefined): KnowledgeContext {
  return {
    agent: { id: agentId, name: '', languages: [], specialties: [], bio: null },
    org: { id: '', name: '', faqs: [] },
    listings: [],
    reviews: { count: 0, avg: 0, recentTopReview: null },
    buyer: leadId ? { savedSearchesCount: 0 } : null,
  };
}

function firstOrgFromMembership(row: MembershipRow | null):
  | { id: string; name: string; slug: string }
  | null {
  if (!row) return null;
  const o = row.organizations;
  if (!o) return null;
  if (Array.isArray(o)) return o[0] ?? null;
  return o;
}

/**
 * Pick the buyer-locale title with EN/ES cross-fallback. Marketing locales
 * (pl/pt/de/fr/it) fall back to EN content; this matches the established
 * `narrowContentLocale` pattern. Final 'Listing' fallback only fires if a
 * listing has neither EN nor ES title — uncommon since the listing form
 * requires at least one, but defensive.
 */
function pickLocalizedString(
  buyerLocale: Locale,
  en: string | null,
  es: string | null,
  fallback?: string,
): string {
  if (buyerLocale === 'es') return es ?? en ?? fallback ?? '';
  return en ?? es ?? fallback ?? '';
}

function pickLocalizedNullable(
  buyerLocale: Locale,
  en: string | null,
  es: string | null,
): string | null {
  if (buyerLocale === 'es') return es ?? en ?? null;
  return en ?? es ?? null;
}

function buildListingUrl(
  buyerLocale: Locale,
  slugEn: string | null,
  slugEs: string | null,
  shortId: string,
): string {
  // Mirrors `lib/listings/seo.ts:listingUrls` shape. Per-locale segment is
  // /properties (en + marketing locales) vs /propiedades (es). Slug picks
  // the matching locale with the cross-language fallback.
  const isEs = buyerLocale === 'es';
  const segment = isEs ? 'propiedades' : 'properties';
  const slug = isEs ? slugEs ?? slugEn : slugEn ?? slugEs;
  if (slug) return `${SITE_ORIGIN}/${buyerLocale}/${segment}/${slug}-${shortId}`;
  // Slugless listings shouldn't appear in this fetcher (active+published
  // requires a slug), but defend against it — return a search-page URL.
  return `${SITE_ORIGIN}/${buyerLocale}`;
}

/**
 * Returns the agent + org + active listings + FAQ + review aggregate +
 * buyer context that the per-agent AI persona grounds on. RLS-safe — uses
 * the caller-provided supabase client without escalation.
 */
export async function fetchKnowledge(args: FetchKnowledgeArgs): Promise<KnowledgeContext> {
  const { supabase, agentId, focusListingId, leadId, buyerLocale } = args;

  // ─── Profile + org membership (sequential — every downstream query needs
  // the org_id). One round-trip; everything else runs in parallel below.
  const profileQ = supabase
    .from('profiles')
    .select('id, full_name, bio, specialties, languages_spoken')
    .eq('id', agentId)
    .maybeSingle<ProfileRow>();

  const membershipQ = supabase
    .from('organization_members')
    .select('org_id, organizations!inner(id, name, slug)')
    .eq('user_id', agentId)
    .limit(1)
    .maybeSingle<MembershipRow>();

  const [profileRes, membershipRes] = await Promise.all([profileQ, membershipQ]);

  if (profileRes.error) {
    console.error('[knowledge.fetchKnowledge] profile error', {
      code: profileRes.error.code,
      message: profileRes.error.message,
      details: profileRes.error.details,
      hint: profileRes.error.hint,
      agentId,
    });
    return emptyContext(agentId, leadId);
  }
  if (membershipRes.error) {
    console.error('[knowledge.fetchKnowledge] membership error', {
      code: membershipRes.error.code,
      message: membershipRes.error.message,
      details: membershipRes.error.details,
      hint: membershipRes.error.hint,
      agentId,
    });
    return emptyContext(agentId, leadId);
  }

  const profile = profileRes.data;
  const org = firstOrgFromMembership(membershipRes.data);

  if (!profile || !org) {
    // Agent doesn't exist (RLS hid the row, profile deleted, or never
    // joined an org). Soft-beta-phase agents land here; the system prompt
    // handles the "no listings yet" path gracefully.
    return emptyContext(agentId, leadId);
  }

  // Org slug guard — never serve test-fixture orgs to a live AI session.
  if (org.slug.startsWith('aho-test-org-')) {
    return emptyContext(agentId, leadId);
  }

  // ─── Parallel fan-out for the per-org context. All RLS-bound to the
  // supabase client passed in. Each destructures `{ error }` per CLAUDE.md
  // (supabase-js does NOT throw on row errors).
  const listingsQ = supabase
    .from('properties')
    .select(
      'id, short_id, title_en, title_es, description_en, description_es, slug_en, slug_es, property_type, transaction_type, price_cents, currency, price_period, bedrooms, bathrooms, area_sqm, city, country_code, published_at, featured_until',
    )
    .eq('org_id', org.id)
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .order('featured_until', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(LISTINGS_CAP * 2); // headroom for fixture filtering below

  const faqsQ = supabase
    .from('agent_faqs')
    .select('question_en, question_es, answer_en, answer_es, sort_order')
    .eq('org_id', org.id)
    .order('sort_order', { ascending: true })
    .limit(FAQ_CAP);

  // Aggregate reviews + a single recent top-rated snippet. Two separate
  // queries because the aggregate is across all published reviews and the
  // snippet picks just one row.
  const reviewsAggQ = supabase
    .from('reviews')
    .select('rating', { count: 'exact', head: false })
    .eq('agent_id', agentId)
    .eq('status', 'published');

  const topReviewQ = supabase
    .from('reviews')
    .select('rating, body, created_at')
    .eq('agent_id', agentId)
    .eq('status', 'published')
    .gte('rating', 4)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ReviewRow>();

  // Saved-searches lookup only when leadId is set. Two-step: lead → user_id
  // → count(saved_searches). We don't fetch the queries themselves — just a
  // count signal for the system prompt.
  const leadQ = leadId
    ? supabase
        .from('leads')
        .select('user_id')
        .eq('id', leadId)
        .maybeSingle<LeadRow>()
    : Promise.resolve({ data: null, error: null } as const);

  const [listingsRes, faqsRes, reviewsAggRes, topReviewRes, leadRes] = await Promise.all([
    listingsQ,
    faqsQ,
    reviewsAggQ,
    topReviewQ,
    leadQ,
  ]);

  // ─── Listings — fixture filter + focus-first sort + cap.
  let listings: KnowledgeContext['listings'] = [];
  if (listingsRes.error) {
    console.error('[knowledge.fetchKnowledge] listings error', {
      code: listingsRes.error.code,
      message: listingsRes.error.message,
      details: listingsRes.error.details,
      hint: listingsRes.error.hint,
      orgId: org.id,
    });
  } else {
    const rows = (listingsRes.data as ListingRow[] | null) ?? [];
    const filtered = rows.filter(
      (r) =>
        !r.slug_en?.startsWith('aho-fixture-') &&
        !r.slug_es?.startsWith('aho-fixture-'),
    );
    // Focus listing first when present.
    if (focusListingId) {
      filtered.sort((a, b) => {
        if (a.id === focusListingId && b.id !== focusListingId) return -1;
        if (b.id === focusListingId && a.id !== focusListingId) return 1;
        return 0;
      });
    }
    listings = filtered.slice(0, LISTINGS_CAP).map((r) => ({
      id: r.id,
      shortId: r.short_id,
      title: pickLocalizedString(buyerLocale, r.title_en, r.title_es, 'Listing'),
      description: pickLocalizedNullable(buyerLocale, r.description_en, r.description_es),
      propertyType: r.property_type,
      transactionType: r.transaction_type,
      priceCents: Number(r.price_cents),
      currency: r.currency,
      pricePeriod: r.price_period,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
      areaSqm: r.area_sqm != null ? Number(r.area_sqm) : null,
      city: r.city,
      countryCode: r.country_code,
      url: buildListingUrl(buyerLocale, r.slug_en, r.slug_es, r.short_id),
    }));
  }

  // ─── FAQs — locale-pair pick. Skip rows where the buyer-locale pair is
  // missing (no cross-language fallback for Q+A — a half-translated FAQ
  // would render as "Q (es)? — A (en)." which is jarring).
  let faqs: Array<{ q: string; a: string }> = [];
  if (faqsRes.error) {
    console.error('[knowledge.fetchKnowledge] faqs error', {
      code: faqsRes.error.code,
      message: faqsRes.error.message,
      details: faqsRes.error.details,
      hint: faqsRes.error.hint,
      orgId: org.id,
    });
  } else {
    const isEs = buyerLocale === 'es';
    faqs = ((faqsRes.data as FaqRow[] | null) ?? [])
      .map((r) => {
        const q = isEs ? r.question_es ?? r.question_en : r.question_en ?? r.question_es;
        const a = isEs ? r.answer_es ?? r.answer_en : r.answer_en ?? r.answer_es;
        return q && a ? { q, a } : null;
      })
      .filter((x): x is { q: string; a: string } => x !== null)
      .slice(0, FAQ_CAP);
  }

  // ─── Reviews — count + avg + most-recent top snippet.
  let reviewSummary: KnowledgeContext['reviews'] = { count: 0, avg: 0, recentTopReview: null };
  if (reviewsAggRes.error) {
    console.error('[knowledge.fetchKnowledge] reviews-agg error', {
      code: reviewsAggRes.error.code,
      message: reviewsAggRes.error.message,
      details: reviewsAggRes.error.details,
      hint: reviewsAggRes.error.hint,
      agentId,
    });
  } else {
    const ratingRows = (reviewsAggRes.data as Array<{ rating: number }> | null) ?? [];
    const count = reviewsAggRes.count ?? ratingRows.length;
    const avg =
      ratingRows.length > 0
        ? ratingRows.reduce((sum, r) => sum + Number(r.rating), 0) / ratingRows.length
        : 0;
    let snippet: string | null = null;
    if (topReviewRes && !topReviewRes.error && topReviewRes.data) {
      const body = topReviewRes.data.body ?? '';
      snippet =
        body.length > REVIEW_SNIPPET_MAX ? body.slice(0, REVIEW_SNIPPET_MAX - 1) + '…' : body;
    } else if (topReviewRes && topReviewRes.error) {
      console.error('[knowledge.fetchKnowledge] top-review error', {
        code: topReviewRes.error.code,
        message: topReviewRes.error.message,
      });
    }
    reviewSummary = {
      count,
      avg: count > 0 ? Math.round(avg * 100) / 100 : 0,
      recentTopReview: snippet,
    };
  }

  // ─── Buyer saved-searches count.
  let buyer: KnowledgeContext['buyer'] = null;
  if (leadId) {
    buyer = { savedSearchesCount: 0 };
    if (leadRes.error) {
      console.error('[knowledge.fetchKnowledge] lead error', {
        code: leadRes.error.code,
        message: leadRes.error.message,
        leadId,
      });
    } else if (leadRes.data?.user_id) {
      const { count, error: ssErr } = await supabase
        .from('saved_searches')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', leadRes.data.user_id);
      if (ssErr) {
        console.error('[knowledge.fetchKnowledge] saved-searches error', {
          code: ssErr.code,
          message: ssErr.message,
          leadId,
        });
      } else {
        buyer = { savedSearchesCount: count ?? 0 };
      }
    }
  }

  return {
    agent: {
      id: profile.id,
      name: profile.full_name ?? '',
      languages: profile.languages_spoken ?? [],
      specialties: profile.specialties ?? [],
      bio: profile.bio,
    },
    org: {
      id: org.id,
      name: org.name,
      faqs,
    },
    listings,
    reviews: reviewSummary,
    buyer,
  };
}
