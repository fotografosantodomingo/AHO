/**
 * Real-estate marketing topic pool for the programmatic SEO cron.
 *
 * Per PO 2026-05-19: real-estate-marketing focus only (not SaaS
 * engineering). Audience is split:
 *   - ~60% AGENT-side topics (the buyer of AHO's $29-$99 subscription)
 *   - ~40% PRIVATE-SELLER / FSBO topics (the buyer of the $5 product)
 *
 * Each topic has a stable `key` (used for dedup in blog_posts) and a
 * `prompt` (the angle the AI is told to take). The cron picks a topic
 * with weighted-random selection AFTER filtering out topics that
 * already have a published post within the last 90 days.
 *
 * Adding topics: pick a free `key` slot, give it a real-estate angle,
 * mark the audience, and add it to the array. The cron-side dedup
 * means a topic shipped 91+ days ago can ship again with a different
 * slug; we keep the key constant so we can track topical coverage
 * over time.
 */

export type BlogAudience = 'agent' | 'seller' | 'mixed';

export interface BlogTopic {
  /** Stable identifier — unique across the pool, never renamed.
   *  Used as `topic_key` on blog_posts for cross-time dedup. */
  key: string;
  /** Human-facing working title; the AI may refine this in the
   *  finished article's <title>. */
  title: string;
  /** The angle / brief the AI is given. ~1-3 sentences. The
   *  generator wraps this in the full system prompt with style
   *  rules + structure rules. */
  prompt: string;
  audience: BlogAudience;
}

export const BLOG_TOPIC_POOL: readonly BlogTopic[] = [
  // ─── Agent-audience (real-estate professional) ───
  {
    key: 'listing-descriptions-rank',
    title: 'How to Write a Listing Description That Ranks on Google',
    prompt:
      'Write for a working real-estate agent. Cover: keyword-rich opening line, neighborhood signals search engines pick up, when to lead with price vs. feature, the 1,200-word sweet spot for indexed depth, and the specific phrases that trigger Google\'s real-estate rich result. Include before/after examples on a fictional 3-bedroom listing.',
    audience: 'agent',
  },
  {
    key: 'whatsapp-lead-capture-agents',
    title: 'WhatsApp Lead Capture for Real Estate Agents in 2026',
    prompt:
      'Practical guide for agents on capturing buyer leads via WhatsApp Business. Cover: setting up a click-to-chat button on listing pages, pre-filling property context in the opener, response-time SLA expectations buyers actually have (median 3 minutes), and how to triage hot vs. cold inbound. Mention that AHO\'s lead-capture stack writes WhatsApp + email leads to a unified dashboard, but keep the article useful even for agents who don\'t use AHO.',
    audience: 'agent',
  },
  {
    key: 'instagram-real-estate-2026',
    title: 'Instagram for Real Estate Agents: What Actually Works in 2026',
    prompt:
      'Concrete tactics, not platitudes. Cover: Reels vs. carousels vs. stories for lead generation (with engagement-rate ranges from the 2025-2026 NAR survey), the right hashtag count after Meta\'s algorithm changes, when to post location-specific neighborhood content, and how to convert profile visitors to DM conversations. Include 3-4 example caption templates.',
    audience: 'agent',
  },
  {
    key: 'multi-channel-distribution',
    title: 'One Listing, Five Channels: A Multi-Channel Distribution Playbook',
    prompt:
      'How a single listing turns into platform-specific content for Facebook Page, Instagram Feed, Instagram Reels, LinkedIn, and the agent\'s own website. Cover: why each platform needs different captions (length, hashtag count, CTA voice), the right image aspect ratios per channel, and how often to repost (frequency that grows reach without filtering as spam).',
    audience: 'agent',
  },
  {
    key: 'fair-housing-fsbo-marketing',
    title: 'Fair Housing for Private Sellers: What You Can and Cannot Say',
    prompt:
      'Plain-language guide for FSBO sellers (private owners) covering Fair Housing Act protected classes + the EU Race Equality Directive equivalents. Specific phrases to avoid in listing copy and Facebook Marketplace posts. The line between describing a neighborhood and steering. Where to seek legal review if unsure. Reference real-world enforcement cases (HUD-cited language) without being preachy.',
    audience: 'seller',
  },
  {
    key: 'listing-photos-conversion',
    title: 'The Listing Photos That Actually Convert (Backed by Eye-Tracking Data)',
    prompt:
      'Walk through the photo order + composition that drives clicks-to-tour. Cover: the hero shot (exterior wide vs. living room), why 9-15 photos beat both 6 and 25, the time-of-day for kitchen + bedroom shots, and the editing limits before photos cross into "misleading." Include the eye-tracking heatmap finding that buyers spend 41% of their photo time on the kitchen.',
    audience: 'mixed',
  },
  {
    key: 'fsbo-vs-agent-tradeoffs',
    title: 'FSBO vs. Hiring an Agent: An Honest Cost Breakdown',
    prompt:
      'Even-handed comparison of selling privately versus listing with an agent. Cover: typical commission savings (5-6% of sale price), the offsetting marketing + legal + showing-time burden, the specific markets where FSBO clears faster (urban condos, small-town homes) and where it stalls (luxury, commercial). Include a one-paragraph honest case for using AHO\'s $5 private-owner listing as the middle path.',
    audience: 'seller',
  },
  {
    key: 'vacation-rental-marketing',
    title: 'How to Market a Vacation Rental Beyond Airbnb',
    prompt:
      'Direct-booking playbook for short-term-rental owners. Cover: building a one-page property site that ranks for "{city} vacation rental," capturing repeat guests via email lists, why Instagram + Google Business Profile beat paid ads for sub-$500/night properties, and the legal disclosures (occupancy tax, local ordinances) you must show on the listing page.',
    audience: 'seller',
  },
  {
    key: 'seo-for-real-estate-agents',
    title: 'SEO for Real Estate Agents Who Don\'t Want to Become SEO Experts',
    prompt:
      'A short, honest guide for agents on the SEO basics that actually move needle in real-estate search. Cover: city + neighborhood landing pages, agent-profile schema (real estate agent JSON-LD), the difference between "{city} homes for sale" and "{city} real estate agent" intent, and three things you can stop doing today (keyword stuffing, exact-match anchor text, low-effort backlink trades).',
    audience: 'agent',
  },
  {
    key: 'open-house-promotion',
    title: 'Promoting an Open House Online: The 7-Day Checklist',
    prompt:
      'Day-by-day plan from "I\'ve scheduled the open house" to "the day arrives." Cover: when to post on which channel (FB Page on day -7, Instagram Story on -3, neighborhood Facebook Group on -1), the wording that drives RSVP commitments, what to NOT post (full address until -1), and how to follow up with attendees within 48 hours.',
    audience: 'agent',
  },
  {
    key: 'lead-magnets-real-estate',
    title: '5 Lead Magnets That Actually Work for Real Estate Agents',
    prompt:
      'Specific content offers that capture buyer + seller emails. Cover: neighborhood market reports (cadence: quarterly), "what your home is worth in 2026" instant-estimate forms (CTA copy + form fields that don\'t scare visitors away), buyer-prep checklists, school-district guides, and seller staging tip sheets. Include realistic opt-in conversion ranges (8-22% for landing-page-driven; 1-3% for cold website widgets).',
    audience: 'agent',
  },
  {
    key: 'cross-border-buyers',
    title: 'Marketing to Cross-Border Buyers: A Practical Guide for Agents in Vacation Markets',
    prompt:
      'For agents in markets that attract international buyers (Spain, Portugal, Mexico, DR, Italy). Cover: which languages to translate listings into (data-driven, not all 7), the buyer-journey steps that fall off when language switches mid-flow, currency-display expectations on the listing page, and the legal disclosures non-resident buyers need to see upfront. Mention AHO\'s 7-language auto-translation as one solution but keep the article useful even without it.',
    audience: 'agent',
  },
];

/**
 * Pick a topic for today's run.
 *
 * @param recentlyCoveredKeys keys from blog_posts published in the
 *   last `dedupWindowDays` days; those topics are excluded.
 * @param rand seeded random for testability (default Math.random).
 */
export function pickTopic(
  recentlyCoveredKeys: ReadonlySet<string>,
  rand: () => number = Math.random,
): BlogTopic | null {
  const eligible = BLOG_TOPIC_POOL.filter((t) => !recentlyCoveredKeys.has(t.key));
  if (eligible.length === 0) return null;
  const idx = Math.floor(rand() * eligible.length);
  return eligible[idx] ?? null;
}
