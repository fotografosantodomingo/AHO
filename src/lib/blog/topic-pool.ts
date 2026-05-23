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

  // ─── Agent-audience — added 2026-05-21 (pool 12 → 20 agent topics) ───
  {
    key: 'video-tour-script',
    title: 'How to Script a 60-Second Listing Video (For Reels, TikTok, and Shorts)',
    prompt:
      'Practical guide for agents on scripting a 60-second vertical listing video — Reels / TikTok / YouTube Shorts. Cover: the 3-act structure (hook in 2 seconds, 3 selling features at 5 sec each, address + CTA at the end), what footage to shoot in what order, how to write captions that hold attention without sound, and which feature wins on each platform (TikTok = lifestyle hook; Reels = aesthetic + price; Shorts = neighborhood). Include a fictional 2-bedroom example script line-by-line.',
    audience: 'agent',
  },
  {
    key: 'agent-referral-system',
    title: 'Building a Real Estate Referral Pipeline That Compounds',
    prompt:
      'For working agents on building a structured referral system rather than waiting for word-of-mouth. Cover: the 30-day post-close follow-up that turns clients into referrers, the database tag system (raving fan / past client / sphere / community) that segments outreach, the quarterly value drop (market update, not a sales pitch) that keeps you top-of-mind, and the math on why 1 raving fan = 4-7 referrals over 5 years. Concrete templates, not vague advice.',
    audience: 'agent',
  },
  {
    key: 'follow-up-cadence',
    title: 'The Follow-Up Cadence That Converts Cold Buyer Leads',
    prompt:
      'For agents whose lead conversion rate is dropping despite more lead volume. Cover: the median 3-minute first-response window (post-form-submit), what to send in the first 24 hours vs. days 2-7 vs. days 8-30, the difference between high-intent (saved search + viewing) and low-intent (downloaded a guide), the specific subject lines that get reopened, and when to give up gracefully (NOT after 3 attempts — after 12, spaced over 90 days). Include a sample 8-touch sequence.',
    audience: 'agent',
  },
  {
    key: 'solo-agent-branding',
    title: 'Building a Personal Brand as a Solo Real Estate Agent',
    prompt:
      'For solo practitioners building a recognizable brand in a crowded market. Cover: the 3 brand pillars that compound over time (specialty / voice / consistency), why posting daily on Instagram is worse than posting twice a week with substance, the local-news / market-data / behind-the-scenes content rotation that earns audience without burnout, and the specific design moves (one font, one accent color, one filter) that signal professionalism on a $0 budget. Honest about how long this takes (18-24 months to compound).',
    audience: 'agent',
  },
  {
    key: 'drone-photography-rules',
    title: 'Drone Photography for Real Estate Listings: When to DIY, When to Hire',
    prompt:
      'For agents weighing drone footage on listings. Cover: the FAA Part 107 (US) and CAA (UK/EU) certification requirements that determine whether you can fly commercially yourself, the insurance question that 80% of self-flying agents skip, what professional drone photographers actually charge ($150-$400 per listing depending on market), the 3 angles that sell (cul-de-sac aerial, property line walk, neighborhood orientation), and when drone footage hurts a listing (low-end homes, dense urban, weather-dependent).',
    audience: 'agent',
  },
  {
    key: 'listing-pricing-strategy',
    title: 'Pricing a Listing: Under, At, or Above Market?',
    prompt:
      'For agents on the pricing conversation with sellers. Cover: when under-market (5-10% below comp avg) drives a bidding war vs. when it just leaves money on the table, the data-driven case for "at market" being the highest-EV default in 70% of markets, the trap of pricing above market (3-week DOM threshold after which buyers assume something is wrong), how to read the local absorption rate, and the specific comps-presentation script that gets the seller to agree to a lower number without feeling shorted.',
    audience: 'agent',
  },
  {
    key: 'agent-content-marketing',
    title: 'A 12-Month Content Calendar for Real Estate Agents',
    prompt:
      'For agents who know they should be posting but don\'t know what about. Cover: a month-by-month calendar tied to the seasonal real-estate cycle (Jan = year-ahead predictions, March = spring-prep guide, July = back-to-school relocation, Oct = year-end market update), the 4-bucket rotation (educational / local / personal / listing — 40/30/20/10), how to repurpose one piece into 6 posts across platforms, and the 90-minute Sunday batch that ships the whole week. Concrete examples for each month.',
    audience: 'agent',
  },
  {
    key: 'open-house-data',
    title: 'What Open-House Attendance Data Actually Tells You',
    prompt:
      'For agents weighing the time investment of open houses against alternatives. Cover: the median 4-12 visitors per open house in suburban markets, what 0-2 visitors means (mispriced) vs. 15+ means (mispriced low or hot market), the conversion math (3-5% of visitors become clients within 12 months, but mostly for OTHER properties), the sign-in-sheet capture rate (40% if you ask passively, 80% if you stand at the door), and when an open house is wasted time (luxury, vacant rural, anything over $2M).',
    audience: 'agent',
  },

  // ─── Seller-audience — added 2026-05-21 (pool 2 → 6 seller topics) ───
  {
    key: 'home-staging-budget',
    title: 'Home Staging on a $500 Budget: What Actually Moves a Listing',
    prompt:
      'For private sellers who can\'t justify a professional stager. Cover: the 5 highest-ROI moves on a $500 budget (declutter every flat surface, repaint the front door, fresh white linens in the primary bedroom, hardware swap on the kitchen, fresh mulch on the front bed), what NOT to spend money on (new furniture, custom art, high-end accessories), the $100 hardware-swap that adds $3-5K to perceived value, and how to stage photos differently from in-person showings. Specific products + price ranges.',
    audience: 'seller',
  },
  {
    key: 'fsbo-pricing-mistakes',
    title: 'The 3 Pricing Mistakes Private Sellers Make (And How to Avoid Them)',
    prompt:
      'For FSBO sellers about to list. Cover: mistake #1 — pricing on what you paid plus improvements (the market doesn\'t care about your costs); mistake #2 — pricing on the highest comp in the neighborhood without adjusting for condition / lot / view differences; mistake #3 — pricing in round numbers ($400K vs. $399K affects search bracketing — $399K shows in <$400K searches, doubling impressions). Concrete pricing-math examples, plus the 3-comp methodology that gets you within 3% of fair value without a professional appraisal.',
    audience: 'seller',
  },
  {
    key: 'cash-buyer-negotiation',
    title: 'Negotiating With Cash Buyers: It\'s Not Always the Highest Offer',
    prompt:
      'For sellers comparing cash offers vs. financed offers. Cover: when a 5% lower cash offer beats a financed offer at full price (appraisal contingency risk, 30-45 day faster close, no lender-required repairs), the questions to ask a cash buyer to verify funds (proof-of-funds letter, escrow earnest deposit size), the 3 cash-buyer types (institutional / iBuyer / individual investor) and which one wants to lowball you, and when to actually take the higher financed offer (strong appraisal comps + buyer with 20%+ down + lender pre-approval, not pre-qualification).',
    audience: 'seller',
  },
  {
    key: 'seller-marketing-no-mls',
    title: 'How to Market a Home Without an MLS Listing',
    prompt:
      'For private sellers in markets where MLS access is gated to agents. Cover: the syndication portals that accept FSBO directly (Zillow, Trulia, Realtor.com in the US; idealista, Otodom, Immoscout in Europe), the photo + description checklist that mimics MLS-quality listing standards, the social-proof signals buyers expect (HOA docs, recent improvements with receipts, neighborhood comp letter), the open-house cadence that compensates for lower indexed reach, and the moment FSBO sellers should call an agent (week 4 with no offers, or any offer that requires negotiation skill the seller doesn\'t have).',
    audience: 'seller',
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
