/**
 * AHO platform knowledge base — the canonical "what does the AI know about
 * AHO itself" source of truth.
 *
 * Why this file exists
 * --------------------
 * The AI customer-service agent (Phase 1 of `docs/AI_AGENT_PLAN.md`) is a
 * SPECIALIST in advertisehomes.online. When a buyer asks "what does $99
 * get me?" or an agent asks "why isn't my Instagram detected?", the AI
 * needs authoritative, current platform facts in its context — not just
 * the listing it's talking about. This module is that facts pack.
 *
 * Consumers (current + future):
 *   - `src/lib/ai/knowledge.ts` — merges this KB into the per-turn
 *     grounded-context block alongside listings, FAQs, reviews.
 *   - The dashboard help bot ("how do I connect Instagram?").
 *   - Anonymous /docs chat (planned).
 *
 * Maintenance rule
 * ----------------
 * When AHO ships a new feature, a new tier, a renamed page — UPDATE THIS
 * FILE in the same PR. Stale KB = AI lies confidently to users. Treat it
 * the same way as `docs/HANDOFF.md`: source of truth, updated alongside
 * code.
 *
 * Constraints
 * -----------
 *   - Pure data + a pure function. Edge-runtime safe (no `server-only`).
 *   - Only `Locale` types from `@/i18n/config`. No DB calls, no fetches.
 *   - Total KB size in a single locale stays under ~14 KB (~3.5k tokens)
 *     so it fits comfortably in any LLM call's input budget.
 *   - Content-locale fallback: EN + ES have full translations; the v1
 *     marketing locales (PL / PT / DE / FR / IT) fall back to EN via
 *     the same `narrowContentLocale()` pattern used everywhere else.
 *   - No fabricated facts. If something isn't grounded in HANDOFF.md /
 *     plan-gating.ts / messages/*.json / the actual product surfaces,
 *     it doesn't go in here (per CLAUDE.md hard rule #8).
 */

import { narrowContentLocale, type Locale } from '@/i18n/config';

// ───────────────────────────────────────────────────────────────────────
// Public shape
// ───────────────────────────────────────────────────────────────────────

export type TierId = 'private_owner' | 'agent' | 'plus' | 'pro_automation' | 'super_pro';
export type TierGate =
  | 'free'
  | 'agent'
  | 'plus'
  | 'pro_automation'
  | 'super_pro'
  | null;

export interface AhoPlatformKb {
  /** One-line marketing description ("AHO is …"). */
  what_is_aho: string;

  /** Pricing tiers as of the file's last update. Super Pro is `planned`. */
  tiers: Array<{
    id: TierId;
    name: string;
    status: 'live' | 'planned';
    /** Recurring monthly subscription cost. NULL for one-time products
     *  (the private-owner tier uses `oneTimeUsd` instead). */
    priceMonthlyUsd: number | null;
    priceAnnualUsd: number | null;
    founderPriceMonthlyUsd?: number | null;
    /** One-time per-listing cost (USD cents → dollar units). Set for
     *  the private-owner tier ($5 = oneTimeUsd: 5); NULL for
     *  subscription tiers. */
    oneTimeUsd?: number | null;
    description: string;
    keyFeatures: string[];
    notIncluded: string[];
  }>;

  /** Core platform features. */
  features: Array<{
    id: string;
    name: string;
    description: string;
    tierGated: TierGate;
    howToShortDescription: string;
    relatedDocsUrl?: string;
  }>;

  /** Step-by-step how-tos for the most common user tasks. */
  howTos: Array<{
    id: string;
    title: string;
    audience: 'agent' | 'buyer' | 'both';
    steps: string[];
    tipsAndCaveats: string[];
    relatedDocsUrl?: string;
  }>;

  /** Top troubleshooting Q&A pairs. */
  troubleshooting: Array<{
    id: string;
    q: string;
    a: string;
    tags: string[];
    relatedDocsUrl?: string;
  }>;

  /** Pricing-comparison FAQ. */
  pricingFaq: Array<{ q: string; a: string }>;

  /** Subscription / billing FAQ. */
  billingFaq: Array<{ q: string; a: string }>;

  /** Privacy / legal / compliance summary. */
  privacyAndCompliance: Array<{ q: string; a: string }>;

  /** When to hand the user off to a human. */
  contact: {
    supportEmail: string;
    privacyEmail: string;
    docsHubUrl: string;
  };

  /** URLs the AI can confidently cite. Relative — caller prefixes /{locale}. */
  canonicalUrls: {
    pricing: string;
    docs: string;
    forAgents: string;
    automation: string;
    saveTime: string;
    instagramSetup: string;
    profileGuide: string;
    shareGuide: string;
    privacy: string;
    terms: string;
    investors: string;
    dashboard: {
      properties: string;
      leads: string;
      analytics: string;
      social: string;
      profile: string;
      aiInbox: string;
      reviews: string;
    };
  };
}

// ───────────────────────────────────────────────────────────────────────
// Canonical URLs — same across both content locales. The caller prefixes
// the locale segment (e.g. /en, /es) so we deliberately store relative
// paths only. Slug-localization happens via next-intl's pathname map
// when the AI surfaces a link in a user-visible place.
// ───────────────────────────────────────────────────────────────────────

const CANONICAL_URLS: AhoPlatformKb['canonicalUrls'] = {
  pricing: '/pricing',
  docs: '/docs',
  forAgents: '/for-agents',
  automation: '/automation',
  saveTime: '/save-time',
  instagramSetup: '/instagram-setup',
  profileGuide: '/profile-guide',
  shareGuide: '/share-guide',
  privacy: '/privacy',
  terms: '/terms',
  investors: '/investors',
  dashboard: {
    properties: '/dashboard/properties',
    leads: '/dashboard/leads',
    analytics: '/dashboard/analytics',
    social: '/dashboard/social',
    profile: '/dashboard/profile',
    aiInbox: '/dashboard/ai-inbox',
    reviews: '/dashboard/reviews',
  },
};

const CONTACT: AhoPlatformKb['contact'] = {
  supportEmail: 'info@advertisehomes.online',
  privacyEmail: 'privacy@advertisehomes.online',
  docsHubUrl: '/docs',
};

// ───────────────────────────────────────────────────────────────────────
// English content
// ───────────────────────────────────────────────────────────────────────

const KB_EN: AhoPlatformKb = {
  what_is_aho:
    'AHO (Advertise Homes Online) is a real-estate marketplace at advertisehomes.online — listings for buyers, a $5 one-time per-listing path for private homeowners + landlords, and subscription tiers ($29–$99/mo) for real-estate agents with one-click social distribution to Facebook, Instagram, LinkedIn. Worldwide, multilingual UI (EN/ES/PL/PT/DE/FR/IT), multi-currency.',
  tiers: [
    {
      id: 'private_owner',
      name: 'Private Owner',
      status: 'live',
      priceMonthlyUsd: null,
      priceAnnualUsd: null,
      oneTimeUsd: 5,
      description:
        'One-time $5 per listing. For homeowners, landlords, vacation-rental owners and FSBO sellers who want to advertise a single property without an agent. 90-day publication window; renewable for another $5.',
      keyFeatures: [
        '1 active listing for 90 days',
        'AI-generated captions in 7 languages',
        'Social publish to ONE channel (Facebook OR Instagram)',
        'WhatsApp + email lead capture on the listing',
        'Up to 25 photos',
        'AI graphics (3 per listing)',
        'Listed at /properties/{slug} alongside agent listings',
      ],
      notIncluded: [
        'No second listing (one paid product = one listing)',
        'No multi-channel auto-publish (FB + IG + LinkedIn = Pro Automation)',
        'No AI customer-service chat widget on the listing (contact form only)',
        'No lead routing / CRM / branded profile / reviews',
        'No analytics dashboard (views-only)',
      ],
    },
    {
      id: 'agent',
      name: 'Agent',
      status: 'live',
      priceMonthlyUsd: 29,
      priceAnnualUsd: 290,
      founderPriceMonthlyUsd: 19,
      description:
        'Entry plan for individual agents. Publish listings, capture leads, measure performance.',
      keyFeatures: [
        'Up to 5 active listings',
        'Manual share text for FB / IG / WhatsApp',
        'WhatsApp + email lead capture',
        'Lead inbox with status tracking',
        'Per-listing analytics',
        'Agent profile + verified reviews',
      ],
      notIncluded: [
        'No one-click social auto-publish (Pro Automation)',
        'No AI customer-service inbox',
      ],
    },
    {
      id: 'plus',
      name: 'Plus',
      status: 'live',
      priceMonthlyUsd: 49,
      priceAnnualUsd: 490,
      description:
        'For growing agents who need more inventory and trust signals on the public profile.',
      keyFeatures: [
        'Up to 15 active listings',
        'Verified Real Estate Agent badge',
        'Priority placement on city landings',
        'Multi-city listings',
        'Everything in Agent',
      ],
      notIncluded: [
        'No one-click social automation (Pro Automation)',
        'No AI customer-service agent',
      ],
    },
    {
      id: 'pro_automation',
      name: 'Pro Automation',
      status: 'live',
      priceMonthlyUsd: 99,
      priceAnnualUsd: 990,
      description:
        'The only AHO tier with social automation. Post once, publish everywhere. Includes AI customer-service web chat.',
      keyFeatures: [
        'Up to 30 active listings',
        'One-click publish to Facebook + Instagram + LinkedIn',
        'AI captions per platform (Claude Haiku 4.5)',
        'Post history, retries, UTM traffic tracking',
        '21-cell social grid: 3 platforms × 7 languages',
        'AI customer-service web chat (human-in-the-loop)',
        'Everything in Plus',
      ],
      notIncluded: [
        'WhatsApp + voice AI are usage-billed add-ons',
        'No auto-video generation (Super Pro)',
      ],
    },
    {
      id: 'super_pro',
      name: 'Super Pro',
      status: 'planned',
      priceMonthlyUsd: null,
      priceAnnualUsd: null,
      description:
        'Planned (~$199–249/mo, TBD). Paste URL → full multi-channel campaign: graphics, captions, auto-video, paid ads, full AI agent across chat + email + WhatsApp + voice.',
      keyFeatures: [
        'Everything in Pro Automation',
        'Paste URL → static graphics (FB / IG / Pinterest)',
        'Auto-generated Reel/TikTok video',
        'WhatsApp + voice AI included (capped)',
        'Auto-send AI replies on email + WhatsApp',
      ],
      notIncluded: ['Not yet live — pricing and scope TBD'],
    },
  ],
  features: [
    {
      id: 'listings',
      name: 'Property listings',
      description:
        'Bilingual EN/ES editor: title, description, price, beds/baths/area, address, attributes, up to 30 photos. Three import lanes: URL, voice, manual.',
      tierGated: 'agent',
      howToShortDescription: 'Dashboard → Properties → New.',
      relatedDocsUrl: '/docs',
    },
    {
      id: 'photos',
      name: 'Photo upload + AI alt text',
      description:
        'Originals upload to Cloudflare R2; variants generated by Cloudflare Images. Up to 30 per listing. AI auto-generates alt text for SEO + accessibility.',
      tierGated: 'agent',
      howToShortDescription: 'Drag photos onto the edit screen. First photo is cover.',
    },
    {
      id: 'search_map',
      name: 'Search + map view',
      description:
        'Map-driven search with bbox re-fetch (pan/zoom and the list refreshes). Filters: price, bedrooms, property type, sale/rent.',
      tierGated: null,
      howToShortDescription: 'Open /search, pan the map, apply filters.',
    },
    {
      id: 'saved_searches',
      name: 'Saved searches + email digests',
      description:
        'Save any filter combination and get email digests when new matches publish. Free for registered buyers.',
      tierGated: 'free',
      howToShortDescription:
        'Run a search, click "Save this search", pick frequency.',
    },
    {
      id: 'favorites',
      name: 'Saved favorites',
      description:
        'Heart any listing to save it. Anonymous favorites merge into your account on signup.',
      tierGated: null,
      howToShortDescription: 'Tap the heart icon on any listing card.',
    },
    {
      id: 'agent_profile',
      name: 'Agent profile + verified reviews',
      description:
        'Public agent page with bio, specialties, languages, listings, and double-verified reviews (email match + tokenized link).',
      tierGated: 'agent',
      howToShortDescription:
        'Dashboard → Profile. Reviews requested 7 days after a closed deal.',
      relatedDocsUrl: '/profile-guide',
    },
    {
      id: 'lead_capture',
      name: 'Lead capture (form + WhatsApp + phone)',
      description:
        'Every listing has a contact form, optional WhatsApp wa.me link, and (when the agent publishes it) phone. Turnstile + honeypot block bots.',
      tierGated: 'agent',
      howToShortDescription:
        'Buyers fill the form on the right side of any listing.',
    },
    {
      id: 'free_audit',
      name: 'Free Audit (paste URL → AI campaign)',
      description:
        'Anonymous visitors paste any listing URL on /for-agents → ~60s later get AI captions in 3 platforms × 3 locales = 9 ready posts.',
      tierGated: 'free',
      howToShortDescription: 'Visit /for-agents, paste your URL, submit.',
      relatedDocsUrl: '/for-agents',
    },
    {
      id: 'social_facebook',
      name: 'Social automation — Facebook Page',
      description:
        'One-click publish to your FB Page. AI drafts a platform-tuned caption; AHO posts via the Meta Graph API. Post history + retries.',
      tierGated: 'pro_automation',
      howToShortDescription: 'Dashboard → Social → Connect Facebook.',
      relatedDocsUrl: '/share-guide',
    },
    {
      id: 'social_instagram',
      name: 'Social automation — Instagram Business',
      description:
        'Publish to IG Business via the linked FB Page. Single image or carousel (up to 10 photos). Requires IG Business linked to a FB Page.',
      tierGated: 'pro_automation',
      howToShortDescription: 'See /instagram-setup for the full walkthrough.',
      relatedDocsUrl: '/instagram-setup',
    },
    {
      id: 'social_linkedin',
      name: 'Social automation — LinkedIn personal profile',
      description:
        'One-click publish to your LinkedIn personal profile. AI drafts a professional-tone caption.',
      tierGated: 'pro_automation',
      howToShortDescription: 'Dashboard → Social → Connect LinkedIn.',
      relatedDocsUrl: '/share-guide',
    },
    {
      id: 'ai_inbox',
      name: 'AI customer-service agent',
      description:
        'Per-agent AI persona with first-party RLS-protected access to that agent\'s listings, FAQs, reviews, and bio. Web chat LIVE; email/WhatsApp/voice credentials-gated.',
      tierGated: 'pro_automation',
      howToShortDescription: 'Configure in Dashboard → AI Inbox.',
      relatedDocsUrl: '/docs',
    },
  ],
  howTos: [
    {
      id: 'add_listing',
      title: 'Add a listing',
      audience: 'agent',
      steps: [
        'Dashboard → Properties → New.',
        'Choose URL import (paste portal link), voice (dictate), or manual.',
        'Review pre-filled fields; drag up to 30 photos (first = cover).',
        'Write description in EN and/or ES, then Publish.',
      ],
      tipsAndCaveats: [
        'Zillow / Redfin / Realtor.com block scrapers.',
        'Real-only data: no stock or AI-generated photos.',
      ],
      relatedDocsUrl: '/docs',
    },
    {
      id: 'upload_photos',
      title: 'Upload photos for a listing',
      audience: 'agent',
      steps: [
        'Open the listing in Dashboard → Properties.',
        'Drag photos. JPEG/WebP, <10 MB, 2400px long-edge recommended.',
        'Drag tiles to reorder. First photo is the cover.',
      ],
      tipsAndCaveats: [
        'Up to 30 photos per listing.',
        'Only real photos; moderators remove violators.',
      ],
    },
    {
      id: 'connect_facebook_instagram',
      title: 'Connect Facebook + Instagram',
      audience: 'agent',
      steps: [
        'Convert IG to Business or Creator (free, in the IG app).',
        'In FB, Page → Settings → Linked Accounts → Instagram, link your IG.',
        'In AHO: Dashboard → Social → Connect Facebook → approve permissions.',
        'AHO auto-detects the linked Instagram.',
      ],
      tipsAndCaveats: [
        'IG Personal cannot publish via API; switch to Business or Creator.',
        'IG must be linked to a FB Page, not a profile.',
      ],
      relatedDocsUrl: '/instagram-setup',
    },
    {
      id: 'connect_linkedin',
      title: 'Connect LinkedIn',
      audience: 'agent',
      steps: [
        'Dashboard → Social → Connect LinkedIn.',
        'Sign in and approve scopes (post on your behalf only).',
        'AHO stores the encrypted token + your LinkedIn profile id.',
      ],
      tipsAndCaveats: [
        'v1 posts to personal profile, not a Company Page.',
        'Revoke any time — token deleted immediately.',
      ],
    },
    {
      id: 'publish_to_social',
      title: 'Publish a listing to social',
      audience: 'agent',
      steps: [
        'Open the listing → "Share to socials" (or open the Social grid).',
        'Pick platforms (FB / IG / LinkedIn) and locale(s).',
        'Review AI caption + tone (warm / factual / hype / professional).',
        'Click Publish; progress shows in your dashboard.',
      ],
      tipsAndCaveats: [
        'Pro Automation only. Lower tiers get copy-paste text.',
        'Posts carry UTM-tagged listing URLs; traffic shows in Analytics.',
      ],
      relatedDocsUrl: '/share-guide',
    },
    {
      id: 'run_free_audit',
      title: 'Run a Free Audit',
      audience: 'agent',
      steps: [
        'Open /for-agents (no signup needed).',
        'Paste any listing URL.',
        '~60s later: preview with facts + 9 captions (3 platforms × 3 locales).',
      ],
      tipsAndCaveats: [
        'Anonymous limit: 5 audits/hour per IP.',
        'Works on otodom / idealista / immobilienscout24 / rightmove / leboncoin.',
      ],
      relatedDocsUrl: '/for-agents',
    },
    {
      id: 'view_leads',
      title: 'View and manage leads',
      audience: 'agent',
      steps: [
        'Dashboard → Leads.',
        'Click a row for full message, listing, and one-click reply.',
        'Update status (New / Contacted / Qualified / Won / Lost).',
      ],
      tipsAndCaveats: [
        'AHO never seeds demo leads.',
        'Turnstile + honeypot block bots before they reach you.',
      ],
    },
    {
      id: 'manage_billing',
      title: 'Manage billing',
      audience: 'agent',
      steps: [
        'Dashboard → Profile → "Open billing portal".',
        'Stripe Customer Portal: update card, invoices, switch plan, cancel.',
        'AHO syncs the change via webhook in seconds.',
      ],
      tipsAndCaveats: [
        'Cancellation effective at period end.',
        'VAT/sales tax handled by Stripe Tax per billing country.',
      ],
    },
    {
      id: 'save_favorite',
      title: 'Save a property as a favorite',
      audience: 'buyer',
      steps: [
        'Tap the heart on any card or detail page.',
        'Signed in: saves to account. Anonymous: saves to browser, merges on signup.',
        'See all at /saved-properties.',
      ],
      tipsAndCaveats: ['Free. No account needed to start.'],
    },
    {
      id: 'save_search',
      title: 'Save a search to get email digests',
      audience: 'buyer',
      steps: [
        'Run a search with your filters.',
        'Click "Save this search", name it, pick frequency.',
        'Manage from /saved-searches (rename, edit, frequency, delete).',
      ],
      tipsAndCaveats: ['Free for registered buyers.'],
    },
    {
      id: 'contact_agent',
      title: 'Contact an agent about a listing',
      audience: 'buyer',
      steps: [
        'Open the listing; find the contact form on the right.',
        'Fill name, email, optional phone, message; submit.',
        'The agent gets it; you get a copy by email.',
      ],
      tipsAndCaveats: [
        'AHO never sells or shares contact details. Agent is the only recipient.',
      ],
    },
    {
      id: 'use_ai_chat',
      title: 'Use the AI chat widget',
      audience: 'buyer',
      steps: [
        'Open any listing on a Pro Automation agent.',
        'Click the chat bubble at bottom right.',
        'Ask anything about the listing, area, or agent.',
      ],
      tipsAndCaveats: [
        'AI speaks your language (EN/ES/PL/PT/DE/FR/IT).',
        'Viewings + price negotiation hand off to the human agent.',
      ],
    },
  ],
  troubleshooting: [
    {
      id: 'instagram_not_detected',
      q: 'Instagram is not detected after I connect Facebook',
      a: 'IG connects via the linked FB Page. (1) IG must be Business or Creator — Personal cannot publish via API. (2) IG must be linked to a Facebook Page in FB Page Settings → Linked Accounts → Instagram. (3) Reconnect Facebook in Dashboard → Social. See /instagram-setup for the full walkthrough.',
      tags: ['instagram', 'meta', 'social', 'oauth'],
      relatedDocsUrl: '/instagram-setup',
    },
    {
      id: 'facebook_publish_failed',
      q: 'Facebook publishing failed with an error',
      a: 'Common causes: (1) Page token expired — reconnect in Dashboard → Social (AHO refreshes tokens daily, 60d expiry). (2) Image rejected by Meta — cover photo must be under 10 MB and JPEG/PNG/WebP. (3) Meta App Review pending for new Pages — use the copy-paste fallback. See the post error in Dashboard → Social → Post history.',
      tags: ['facebook', 'meta', 'social', 'publish'],
    },
    {
      id: 'photo_upload_error',
      q: 'Photo upload failed',
      a: 'Check size (<10 MB), format (JPEG or WebP), and dimensions (2400px long-edge recommended). If the file is fine, retry — R2 occasionally rate-limits parallel uploads. Persistent "queued" status: refresh the page; uploads resume.',
      tags: ['photos', 'upload', 'r2'],
    },
    {
      id: 'listing_not_public',
      q: 'My listing is not showing on the public site',
      a: 'Check (1) status is "Published" in Dashboard → Properties (drafts are dashboard-only); (2) subscription is active (cancelled = listings deactivated until you resubscribe); (3) moderation queue hasn\'t flagged it. New listings appear in search within ~30s. Still missing after 5 min: email info@advertisehomes.online.',
      tags: ['listings', 'moderation', 'publish'],
    },
    {
      id: 'digest_not_arriving',
      q: 'My saved-search email digest is not arriving',
      a: 'Check (1) profile email is current; (2) digest frequency is daily or weekly (not "off"); (3) the saved search actually has new matches — open and run it; (4) spam folder. Digests come from notifications@mail.advertisehomes.online — allowlist it.',
      tags: ['email', 'saved-searches', 'digests'],
    },
    {
      id: 'ai_chat_not_responding',
      q: 'The AI chat widget is not responding',
      a: 'AI chat is only enabled on agents with Pro Automation. On free-tier agents, the widget shows a static contact form. If the agent IS on Pro Automation and the AI still does not reply, it may have escalated to the agent (look for "An agent will reply shortly"). Persistent failures: info@advertisehomes.online.',
      tags: ['ai', 'chat', 'support'],
    },
    {
      id: 'lead_email_missing',
      q: 'I did not get an email when a lead came in',
      a: 'Check (1) the lead appears in Dashboard → Leads (if so, form worked, only email failed); (2) notification email on Profile is current; (3) spam folder for notifications@mail.advertisehomes.online; (4) lead-routing rules — a rule may have sent it to a colleague.',
      tags: ['leads', 'email', 'notifications'],
    },
    {
      id: 'reviews_not_appearing',
      q: 'A review I received is not showing on my profile',
      a: 'Reviews are double-verified: buyer email must match the deal record AND the buyer must click the tokenized confirmation link. Until both steps complete, the review stays pending. Check Dashboard → Reviews. Reviews flagged by moderators also stay pending.',
      tags: ['reviews', 'profile', 'moderation'],
    },
    {
      id: 'wrong_currency',
      q: 'Prices are showing in the wrong currency',
      a: 'Change display currency from the header toggle. AHO defaults to USD; the toggle reformats with daily FX rates while the underlying listing price stays unchanged. Your choice persists in your profile (signed-in) or localStorage (anonymous).',
      tags: ['currency', 'fx', 'display'],
    },
    {
      id: 'billing_portal_not_opening',
      q: 'The Stripe billing portal will not open',
      a: 'Causes: (1) pop-up blocker — allow popups for advertisehomes.online and retry; (2) signed in to another Stripe account in the same browser — try a private window; (3) subscription is in a state Stripe cannot portal to (e.g. cancelled long ago). Email info@advertisehomes.online; we can intervene server-side.',
      tags: ['billing', 'stripe', 'portal'],
    },
    {
      id: 'translation_wrong',
      q: 'A listing description looks wrong or is only in one language',
      a: 'Listing copy is written by the agent — AHO never auto-translates listing content. Single-language listings are allowed and appear only in that language\'s site. If you see a literal "TODO" or placeholder, flag it via the contact form for moderator review.',
      tags: ['i18n', 'translation', 'content'],
    },
    {
      id: 'account_locked',
      q: 'My account is locked after too many failed logins',
      a: 'AHO locks the account for 30 min after 10 failed logins from the same IP. Wait it out, or reset your password from the sign-in page (use the magic-link option). MFA users who lost their device: email info@advertisehomes.online with proof of identity — we can reset MFA only after verification, audit-logged.',
      tags: ['auth', 'lockout', 'mfa'],
    },
  ],
  pricingFaq: [
    {
      q: 'What does $99/mo (Pro Automation) add over $29/mo (Agent)?',
      a: 'One-click publish to FB+IG+LinkedIn with AI platform-specific captions, 21-cell social grid (3 platforms × 7 languages), retries, UTM traffic tracking, AI customer-service chat, and up to 30 listings vs. 5.',
    },
    {
      q: 'Is there an annual discount?',
      a: 'Yes — ~17% off. Agent $29/mo or $290/yr. Plus $49/mo or $490/yr. Pro Automation $99/mo or $990/yr.',
    },
    {
      q: 'What is the founder rate?',
      a: '$19/mo for life on Agent, reserved for the first 50 agents in the founder window. Monthly billing only; closes when filled.',
    },
    {
      q: 'Is there a free trial?',
      a: 'No free trial. AHO has never offered one — never mention 7-day, 14-day, or any trial period because it does not exist. Risk-free signup comes from two things instead: (1) the $5 one-time private-owner listing if you only need one property (no commitment beyond the $5), and (2) the founder-window $19/mo Agent rate locked for life (first 50 agents). Cancel any subscription anytime via the Stripe Customer Portal; listings stay live until the period end.',
    },
    {
      q: 'Do buyers pay AHO?',
      a: 'No. The buyer experience is entirely free. Only agents pay.',
    },
  ],
  billingFaq: [
    {
      q: 'How do I cancel?',
      a: 'Dashboard → Profile → Open billing portal → Cancel. Two clicks. Listings stay live until period end.',
    },
    {
      q: 'What happens to my listings if I cancel?',
      a: 'They go inactive (hidden from public search) but stay in your dashboard. Resubscribe and they come back instantly.',
    },
    {
      q: 'Which payment methods are accepted?',
      a: 'All major cards via Stripe Checkout, plus 3-D Secure where your bank requires it. Apple Pay + Google Pay where the device offers them.',
    },
    {
      q: 'How is VAT / sales tax handled?',
      a: 'Stripe Tax computes the right rate from your billing country and shows it on the invoice. AHO adds no markup on tax.',
    },
    {
      q: 'Can I switch plans?',
      a: 'Yes, via the Stripe Customer Portal. Upgrades prorate immediately; downgrades take effect at period end.',
    },
    {
      q: 'Do you offer refunds?',
      a: 'Cancel anytime and billing stops at period end. Current-period refunds are case-by-case — email info@advertisehomes.online.',
    },
  ],
  privacyAndCompliance: [
    {
      q: 'What does AHO do with my data?',
      a: 'We store the minimum needed: account info, listings you posted, favorites + saved searches (buyers), forms you sent to agents. We never sell data. Full breakdown in the privacy policy.',
    },
    {
      q: 'Where is my data stored?',
      a: 'Supabase (Postgres), Cloudflare R2 (photo originals), Cloudflare Images (variants), Stripe (payments). TLS in transit; encrypted at rest.',
    },
    {
      q: 'How do I delete my account?',
      a: 'Dashboard → Profile → Delete account. Cascades to favorites, saved searches, forms, reviews. Billing records anonymized but retained where tax law requires.',
    },
    {
      q: 'Is AHO GDPR-compliant?',
      a: 'Yes. We honor access, rectification, erasure, portability, objection rights. Email privacy@advertisehomes.online. Security incidents follow the 72-hour clock.',
    },
    {
      q: 'Does the AI store my chat messages?',
      a: 'Conversations are logged so the agent sees them in their AI Inbox and the AI has memory. Logs are scoped to the one agent you talked to. Delete via account deletion or privacy@advertisehomes.online.',
    },
  ],
  contact: CONTACT,
  canonicalUrls: CANONICAL_URLS,
};

// ───────────────────────────────────────────────────────────────────────
// Spanish content
// ───────────────────────────────────────────────────────────────────────

const KB_ES: AhoPlatformKb = {
  what_is_aho:
    'AHO (Advertise Homes Online) es un marketplace inmobiliario en advertisehomes.online — anuncios para compradores, un plan de $5 por anuncio para propietarios privados (vivienda, vacacional, FSBO), y planes por suscripción ($29–$99/mes) para agentes inmobiliarios con distribución social en un clic a Facebook, Instagram y LinkedIn. Mundial, interfaz multilingüe (EN/ES/PL/PT/DE/FR/IT), multidivisa.',
  tiers: [
    {
      id: 'private_owner',
      name: 'Propietario privado',
      status: 'live',
      priceMonthlyUsd: null,
      priceAnnualUsd: null,
      oneTimeUsd: 5,
      description:
        'Pago único de $5 por anuncio. Para propietarios particulares, dueños de alquiler vacacional y vendedores sin agente. Ventana de publicación de 90 días; renovable por otros $5.',
      keyFeatures: [
        '1 anuncio activo durante 90 días',
        'Textos generados por IA en 7 idiomas',
        'Publicación social en UN canal (Facebook O Instagram)',
        'Captura de contactos por WhatsApp + email en el anuncio',
        'Hasta 25 fotos',
        'Gráficas IA (3 por anuncio)',
        'Aparece en /properties/{slug} junto a los anuncios de agentes',
      ],
      notIncluded: [
        'Sin segundo anuncio (un pago = un anuncio)',
        'Sin publicación automática multi-canal (FB + IG + LinkedIn = Pro Automation)',
        'Sin chat IA en el anuncio (solo formulario de contacto)',
        'Sin enrutamiento de contactos / CRM / perfil con marca / reseñas',
        'Sin panel de estadísticas (solo visitas)',
      ],
    },
    {
      id: 'agent',
      name: 'Agente',
      status: 'live',
      priceMonthlyUsd: 29,
      priceAnnualUsd: 290,
      founderPriceMonthlyUsd: 19,
      description:
        'Plan inicial para agentes individuales. Publica anuncios, recibe contactos y empieza a medir el rendimiento.',
      keyFeatures: [
        'Hasta 5 anuncios activos',
        'Texto manual para compartir en FB / IG / WhatsApp (copiar y pegar)',
        'Captura de leads por WhatsApp + email desde tus anuncios',
        'Bandeja de contactos con seguimiento de estado',
        'Estadísticas de rendimiento por anuncio',
        'Perfil de agente + reseñas verificadas',
        'Editor bilingüe EN/ES',
      ],
      notIncluded: [
        'Sin publicación automática con un clic en redes (sube a Pro Automation)',
        'Sin subtítulos generados por IA específicos por plataforma',
        'Sin bandeja de IA para atención al cliente',
      ],
    },
    {
      id: 'plus',
      name: 'Plus',
      status: 'live',
      priceMonthlyUsd: 49,
      priceAnnualUsd: 490,
      description:
        'Para agentes en crecimiento que necesitan más inventario y señales de confianza en su perfil público.',
      keyFeatures: [
        'Hasta 15 anuncios activos',
        'Distintivo de Agente Inmobiliario Verificado en tu perfil público',
        'Posicionamiento prioritario en páginas de ciudad',
        'Anuncios en varias ciudades',
        'Todo lo del plan Agente',
      ],
      notIncluded: [
        'Todavía sin automatización social con un clic (solo Pro Automation)',
        'Sin agente IA de atención al cliente',
      ],
    },
    {
      id: 'pro_automation',
      name: 'Pro Automation',
      status: 'live',
      priceMonthlyUsd: 99,
      priceAnnualUsd: 990,
      description:
        'El único plan de AHO con automatización social. Publica una vez, aparece en todas partes — automáticamente. Incluye la bandeja IA de atención al cliente (chat web ya disponible; email/WhatsApp/voz requieren credenciales).',
      keyFeatures: [
        'Hasta 30 anuncios activos',
        'Publicación con un clic en Facebook + Instagram + LinkedIn',
        'Subtítulos generados por IA específicos por plataforma (Claude Haiku 4.5)',
        'Historial de publicaciones, reintentos y seguimiento de tráfico con UTM',
        'Cuadrícula social 21: 3 plataformas × 7 idiomas, todo redactado automáticamente',
        'Chat IA de atención al cliente en las páginas de anuncios (con revisión humana)',
        'Todo lo del plan Plus',
      ],
      notIncluded: [
        'WhatsApp + voz son canales IA con cargo por uso (o espera a Super Pro)',
        'Sin generación de vídeo automática estilo Reel (Super Pro)',
      ],
    },
    {
      id: 'super_pro',
      name: 'Super Pro',
      status: 'planned',
      priceMonthlyUsd: null,
      priceAnnualUsd: null,
      description:
        'Plan previsto (~$199–249/mes, precio por confirmar). Automatización completa de campañas multicanal: pega una URL de anuncio y obtén gráficos, subtítulos, vídeo automático, sugerencias de anuncios pagados y sustitución completa del agente IA en chat + email + WhatsApp + voz.',
      keyFeatures: [
        'Todo lo de Pro Automation',
        'Pega URL → gráficos (FB 1200×630, IG 1080², Pinterest 1000×1500)',
        'Vídeo Reel/TikTok generado automáticamente (Ken-Burns con las fotos)',
        'Canales IA WhatsApp + voz incluidos (uso con tope)',
        'Envío automático sin aprobación humana en email + WhatsApp',
        'Estimación de alcance y leads por plataforma',
      ],
      notIncluded: [
        'Aún no disponible — precio y alcance exactos por confirmar por el PO',
      ],
    },
  ],
  features: [
    {
      id: 'listings',
      name: 'Anuncios de propiedades',
      description:
        'Editor bilingüe EN/ES con título, descripción, precio, dormitorios/baños/área, dirección, atributos y hasta 30 fotos. Tres formas de importar: pegar URL de un portal competidor, dictar por voz o rellenar el formulario manualmente.',
      tierGated: 'agent',
      howToShortDescription:
        'Panel → Propiedades → Nuevo. Elige importar por URL, por voz o manual.',
      relatedDocsUrl: '/docs',
    },
    {
      id: 'photos',
      name: 'Carga de fotos + texto alternativo IA',
      description:
        'Las fotos se suben a Cloudflare R2; AHO genera variantes en Cloudflare Images. Hasta 30 por anuncio. La IA genera automáticamente el texto alternativo por foto para SEO y accesibilidad.',
      tierGated: 'agent',
      howToShortDescription:
        'Arrastra fotos a la pantalla de edición. La primera es la portada.',
    },
    {
      id: 'search_map',
      name: 'Búsqueda + vista de mapa',
      description:
        'Búsqueda con mapa y reconsulta por bbox (mueve y haz zoom y la lista se refresca a lo que se ve). Filtros: precio, dormitorios, tipo, venta/alquiler.',
      tierGated: null,
      howToShortDescription: 'Abre /buscar, mueve el mapa, aplica filtros.',
    },
    {
      id: 'saved_searches',
      name: 'Búsquedas guardadas + resúmenes por email',
      description:
        'Guarda cualquier combinación de filtros y recibe resúmenes por email cuando aparezcan nuevas coincidencias. Gratis para compradores registrados.',
      tierGated: 'free',
      howToShortDescription:
        'Haz una búsqueda, pulsa "Guardar esta búsqueda", elige frecuencia.',
    },
    {
      id: 'favorites',
      name: 'Favoritos',
      description:
        'Marca cualquier anuncio con un corazón. Los favoritos anónimos se fusionan con tu cuenta al registrarte.',
      tierGated: null,
      howToShortDescription: 'Pulsa el corazón en cualquier tarjeta de anuncio.',
    },
    {
      id: 'agent_profile',
      name: 'Perfil de agente + reseñas verificadas',
      description:
        'Página pública con biografía, especialidades, idiomas, anuncios y reseñas con doble verificación (email coincidente + enlace tokenizado).',
      tierGated: 'agent',
      howToShortDescription:
        'Panel → Perfil. Las reseñas se piden 7 días después de cerrar una operación.',
      relatedDocsUrl: '/profile-guide',
    },
    {
      id: 'lead_capture',
      name: 'Captura de leads (formulario + WhatsApp + teléfono)',
      description:
        'Cada anuncio tiene formulario de contacto, enlace WhatsApp wa.me opcional y (cuando el agente lo publica) teléfono. Cloudflare Turnstile + honeypot bloquean bots.',
      tierGated: 'agent',
      howToShortDescription:
        'Los compradores rellenan el formulario a la derecha del anuncio.',
    },
    {
      id: 'free_audit',
      name: 'Auditoría Gratis (pega URL → campaña IA)',
      description:
        'Los visitantes anónimos pegan una URL en /para-agentes → 60 segundos después tienen subtítulos IA en 3 plataformas × 3 idiomas = 9 publicaciones listas. Gancho para registrar agentes.',
      tierGated: 'free',
      howToShortDescription: 'Visita /para-agentes, pega tu URL, envía.',
      relatedDocsUrl: '/for-agents',
    },
    {
      id: 'social_facebook',
      name: 'Automatización social — publicación en Facebook Page',
      description:
        'Publica con un clic en tu Página de Facebook. La IA genera un subtítulo afinado a la plataforma; AHO formatea y publica vía la API Graph de Meta. Historial + reintentos.',
      tierGated: 'pro_automation',
      howToShortDescription:
        'Panel → Social → Conectar Facebook → publicar en cualquier anuncio.',
      relatedDocsUrl: '/share-guide',
    },
    {
      id: 'social_instagram',
      name: 'Automatización social — publicación en Instagram Business',
      description:
        'Publica en Instagram Business a través de la Página de Facebook vinculada. Imagen única o carrusel (hasta 10 fotos). Requiere cuenta IG Business vinculada a una Página de FB.',
      tierGated: 'pro_automation',
      howToShortDescription:
        'Convierte IG a Business + vincula a Página de FB, luego conecta en Panel → Social.',
      relatedDocsUrl: '/instagram-setup',
    },
    {
      id: 'social_linkedin',
      name: 'Automatización social — publicación en perfil personal de LinkedIn',
      description:
        'Publica con un clic en tu perfil personal de LinkedIn. La IA genera un subtítulo de tono profesional.',
      tierGated: 'pro_automation',
      howToShortDescription:
        'Panel → Social → Conectar LinkedIn → publicar en cualquier anuncio.',
      relatedDocsUrl: '/share-guide',
    },
    {
      id: 'ai_inbox',
      name: 'Agente IA de atención al cliente',
      description:
        'Persona IA por agente con acceso de primera mano (con RLS) a sus anuncios, FAQs, reseñas y biografía. El chat web ya está DISPONIBLE en páginas de anuncios. Email + WhatsApp + voz requieren credenciales.',
      tierGated: 'pro_automation',
      howToShortDescription:
        'Pro Automation incluye chat por defecto. Configura en Panel → Bandeja IA.',
      relatedDocsUrl: '/docs',
    },
  ],
  howTos: [
    {
      id: 'add_listing',
      title: 'Crear un anuncio',
      audience: 'agent',
      steps: [
        'Abre Panel → Propiedades → Nuevo.',
        'Elige forma de importar: pega URL de otodom / idealista / immobilienscout24 / leboncoin / una agencia; O pulsa el micro y dicta; O rellena el formulario manual.',
        'Revisa los campos pre-rellenados (URL/voz tarda ~10 segundos) y corrige lo que esté mal.',
        'Arrastra hasta 30 fotos. La primera es la portada.',
        'Escribe la descripción en EN y/o ES. Se permiten anuncios en un solo idioma.',
        'Pulsa Publicar.',
      ],
      tipsAndCaveats: [
        'Zillow / Redfin / Realtor.com bloquean scrapers — la importación por URL falla allí.',
        'La importación por voz admite hasta 10 minutos de audio.',
        'Datos reales únicamente: nada de fotos de stock, IA ni "representativas".',
      ],
      relatedDocsUrl: '/docs',
    },
    {
      id: 'upload_photos',
      title: 'Subir fotos a un anuncio',
      audience: 'agent',
      steps: [
        'Abre el anuncio en Panel → Propiedades.',
        'Arrastra las fotos. JPEG o WebP, menos de 10 MB cada una, 2400px en el lado largo recomendado.',
        'Arrastra para reordenar. La primera foto es la portada en tarjetas y publicaciones sociales.',
        'AHO genera variantes automáticamente; la barra de progreso indica cuándo están listas.',
      ],
      tipsAndCaveats: [
        'Hasta 30 fotos por anuncio.',
        'Solo fotos reales de la propiedad; los moderadores eliminan a los infractores.',
      ],
    },
    {
      id: 'connect_facebook_instagram',
      title: 'Conectar Facebook + Instagram',
      audience: 'agent',
      steps: [
        'Convierte tu Instagram a cuenta Business o Creator (gratis, en la app de IG).',
        'En Facebook, abre la Página donde quieres que AHO publique. Configuración → Cuentas vinculadas → Instagram, y vincula tu IG.',
        'Vuelve a AHO y abre Panel → Social → Conectar Facebook.',
        'Aprueba los permisos solicitados (publicar solo en tu Página — sin lista de amigos, sin acceso a anuncios).',
        'AHO detecta el Instagram vinculado automáticamente y activa la opción IG.',
      ],
      tipsAndCaveats: [
        'Las cuentas IG Personales no pueden publicar vía API — debes cambiar a Business o Creator.',
        'IG debe estar vinculado a una Página de FB, no a un perfil personal.',
      ],
      relatedDocsUrl: '/instagram-setup',
    },
    {
      id: 'connect_linkedin',
      title: 'Conectar LinkedIn',
      audience: 'agent',
      steps: [
        'Abre Panel → Social.',
        'Pulsa "Conectar LinkedIn".',
        'Inicia sesión en LinkedIn en el popup y aprueba los permisos (publicar en tu nombre solamente).',
        'AHO guarda el token (cifrado) y el id de tu perfil personal de LinkedIn.',
      ],
      tipsAndCaveats: [
        'v1 publica en tu perfil personal, no en Página de Empresa.',
        'Puedes revocar el acceso en cualquier momento desde la misma pantalla.',
      ],
    },
    {
      id: 'publish_to_social',
      title: 'Publicar un anuncio en redes',
      audience: 'agent',
      steps: [
        'Abre el anuncio en Panel → Propiedades.',
        'Pulsa "Compartir en redes" (o abre la página Social para ver la cuadrícula 21).',
        'Elige plataformas (FB / IG / LinkedIn) e idiomas.',
        'Revisa el subtítulo IA y edítalo si quieres. Elige tono (cálido / factual / hype / profesional).',
        'Pulsa Publicar. AHO publica vía las APIs de Meta y LinkedIn y muestra el progreso en tu panel.',
      ],
      tipsAndCaveats: [
        'Solo Pro Automation. Los planes menores ven texto para copiar y pegar.',
        'Las publicaciones incluyen la URL del anuncio con UTM para que el tráfico aparezca en Estadísticas.',
      ],
      relatedDocsUrl: '/share-guide',
    },
    {
      id: 'run_free_audit',
      title: 'Hacer una Auditoría Gratis',
      audience: 'agent',
      steps: [
        'Abre /para-agentes (sin registrarte).',
        'Pega cualquier URL de anuncio en el widget hero.',
        'Espera ~60 segundos mientras AHO extrae los datos y redacta subtítulos en 3 plataformas × 3 idiomas.',
        'Revisa la vista previa. Regístrate para publicarlos con un clic.',
      ],
      tipsAndCaveats: [
        'Límite anónimo: 5 auditorías por hora por IP.',
        'Funciona en otodom / idealista / immobilienscout24 / rightmove / leboncoin + sitios genéricos schema.org.',
      ],
      relatedDocsUrl: '/for-agents',
    },
    {
      id: 'view_leads',
      title: 'Ver y gestionar leads',
      audience: 'agent',
      steps: [
        'Abre Panel → Contactos.',
        'Haz clic en una fila para ver el mensaje completo, el anuncio que miraba el comprador y una respuesta con un clic.',
        'Actualiza el estado (Nuevo / Contactado / Cualificado / Ganado / Perdido) para mantener la bandeja útil.',
        'Para agencias, define reglas de enrutamiento en Panel → Contactos → Enrutamiento.',
      ],
      tipsAndCaveats: [
        'Bandeja vacía = vacía de verdad. AHO nunca crea leads de demo.',
        'Cloudflare Turnstile + honeypot bloquean bots antes de que el lead llegue a ti.',
      ],
    },
    {
      id: 'manage_billing',
      title: 'Gestionar la facturación',
      audience: 'agent',
      steps: [
        'Abre Panel → Perfil.',
        'Pulsa "Abrir portal de facturación" — te lleva al Portal de Cliente de Stripe.',
        'Actualiza tarjeta, descarga facturas, cambia plan o cancela desde ahí.',
      ],
      tipsAndCaveats: [
        'La cancelación tiene efecto al final del periodo — los anuncios siguen activos hasta entonces.',
        'IVA / impuestos los gestiona Stripe Tax según tu país de facturación.',
      ],
    },
    {
      id: 'save_favorite',
      title: 'Guardar un inmueble como favorito',
      audience: 'buyer',
      steps: [
        'Pulsa el corazón en cualquier tarjeta o página de anuncio.',
        'Si has iniciado sesión, se guarda en tu cuenta. Si no, se guarda en el navegador y se fusiona al registrarte.',
        'Ve todos tus favoritos en /inmuebles-guardados.',
      ],
      tipsAndCaveats: [
        'Los favoritos son gratis. No requiere cuenta para empezar.',
      ],
    },
    {
      id: 'save_search',
      title: 'Guardar una búsqueda y recibir resúmenes',
      audience: 'buyer',
      steps: [
        'Haz una búsqueda con los filtros que quieras.',
        'Pulsa "Guardar esta búsqueda".',
        'Pónle nombre (p. ej. "2 dorm. Santo Domingo bajo $300k"), elige frecuencia (diaria / semanal).',
        'Gestiona desde /busquedas-guardadas — renombra, edita, cambia frecuencia o elimina.',
      ],
      tipsAndCaveats: [
        'Gratis para compradores registrados. Sin upgrade.',
      ],
    },
    {
      id: 'contact_agent',
      title: 'Contactar a un agente sobre un anuncio',
      audience: 'buyer',
      steps: [
        'Abre el anuncio.',
        'Rellena el formulario a la derecha (o debajo de las fotos en móvil): nombre, email, teléfono opcional, mensaje.',
        'Envía. El agente lo recibe en su bandeja; tú recibes una copia por email.',
        'O usa los botones WhatsApp / teléfono si el agente los publicó.',
      ],
      tipsAndCaveats: [
        'AHO nunca vende ni comparte tus datos. El agente es el único destinatario.',
      ],
    },
    {
      id: 'use_ai_chat',
      title: 'Usar el chat IA',
      audience: 'buyer',
      steps: [
        'Abre cualquier anuncio de un agente con Pro Automation.',
        'Pulsa la burbuja de chat abajo a la derecha.',
        'Pregunta lo que quieras sobre el anuncio, la zona o el agente. La IA tiene acceso de primera mano a los anuncios y biografía del agente.',
        'Para visitas o negociación de precio, la IA pasa al agente humano (revisión humana en Pro Automation).',
      ],
      tipsAndCaveats: [
        'La IA habla tu idioma (EN/ES/PL/PT/DE/FR/IT).',
        'Las conversaciones quedan registradas y el agente las ve en su Bandeja IA.',
      ],
    },
  ],
  troubleshooting: [
    {
      id: 'instagram_not_detected',
      q: 'Instagram no se detecta después de conectar Facebook',
      a: 'AHO conecta Instagram a través de la Página de Facebook vinculada, no directamente. (1) Tu IG debe ser Business o Creator — Personal no puede publicar vía API. (2) Debe estar vinculado a una Página de FB en Configuración de la Página → Cuentas vinculadas → Instagram. (3) Reconecta Facebook en Panel → Social. Si sigue sin aparecer, consulta /configurar-instagram para el tutorial completo en 4 pasos.',
      tags: ['instagram', 'meta', 'social', 'oauth'],
      relatedDocsUrl: '/instagram-setup',
    },
    {
      id: 'facebook_publish_failed',
      q: 'La publicación en Facebook falló con un error',
      a: 'Causas comunes: (1) El token de la Página caducó — reconecta en Panel → Social. AHO refresca tokens a diario (caducan a 60 días) pero si revocaste el acceso, debes reconectar. (2) La imagen no superó la subida a Meta — revisa que la portada esté bajo 10 MB y sea JPEG/PNG/WebP. (3) La revisión de App de Meta está pendiente para Páginas nuevas — el flujo manual de copiar y pegar sigue funcionando. Mira el mensaje de error en Panel → Social → Historial.',
      tags: ['facebook', 'meta', 'social', 'publish'],
    },
    {
      id: 'photo_upload_error',
      q: 'Falló la subida de una foto',
      a: 'Revisa tamaño (<10 MB), formato (JPEG o WebP) y dimensiones (2400px en el lado largo recomendado). Si el archivo está bien, vuelve a intentarlo en un momento — Cloudflare R2 limita ocasionalmente subidas en paralelo. Si ves estado "en cola" persistente, refresca la página; las subidas se reanudan.',
      tags: ['photos', 'upload', 'r2'],
    },
    {
      id: 'listing_not_public',
      q: 'Mi anuncio no aparece en el sitio público',
      a: 'Revisa (1) el estado del anuncio es "Publicado" en Panel → Propiedades (los borradores son solo del panel); (2) tu suscripción está activa (las canceladas desactivan los anuncios hasta que te resuscribas); (3) la cola de moderación no lo ha marcado. Los nuevos anuncios suelen aparecer en búsqueda en ~30 segundos. Si sigue sin aparecer pasados 5 minutos, escribe a info@advertisehomes.online.',
      tags: ['listings', 'moderation', 'publish'],
    },
    {
      id: 'digest_not_arriving',
      q: 'No me llega el resumen por email de mi búsqueda guardada',
      a: 'Revisa (1) que el email en tu perfil esté actualizado; (2) que la frecuencia sea diaria o semanal (no "desactivado"); (3) que la búsqueda guardada realmente tenga coincidencias nuevas — ábrela y ejecútala; (4) tu carpeta de spam. Los resúmenes llegan desde notifications@mail.advertisehomes.online — añádelo a contactos seguros.',
      tags: ['email', 'saved-searches', 'digests'],
    },
    {
      id: 'ai_chat_not_responding',
      q: 'El chat IA no responde',
      a: 'El chat solo está activo en anuncios donde el agente tiene Pro Automation. En agentes del plan libre, el widget muestra un formulario de contacto estático en su lugar. Si el agente SÍ tiene Pro Automation y la IA aun así no responde, puede haber escalado al agente (busca "Un agente responderá en breve"). Si falla persistente: info@advertisehomes.online.',
      tags: ['ai', 'chat', 'support'],
    },
    {
      id: 'lead_email_missing',
      q: 'No recibí email cuando entró un lead',
      a: 'Revisa (1) si el lead aparece en Panel → Contactos (si sí, el formulario funcionó; solo falló el email); (2) tu email de notificación en Panel → Perfil esté actualizado; (3) la carpeta de spam para correos de notifications@mail.advertisehomes.online; (4) las reglas de enrutamiento — si una regla envió el lead a un colega, no te llegaría el email.',
      tags: ['leads', 'email', 'notifications'],
    },
    {
      id: 'reviews_not_appearing',
      q: 'Una reseña que recibí no aparece en mi perfil',
      a: 'Las reseñas tienen doble verificación antes de publicarse: el email del comprador debe coincidir con el registro de la operación Y el comprador debe pulsar el enlace tokenizado en su email. Hasta que ambos pasos se completen, la reseña queda pendiente. Mira el estado en Panel → Reseñas. Las marcadas por moderadores (sospecha de falsa, fuera de tema) también quedan pendientes.',
      tags: ['reviews', 'profile', 'moderation'],
    },
    {
      id: 'wrong_currency',
      q: 'Los precios aparecen en la moneda equivocada',
      a: 'Cambia la moneda de visualización desde el selector de la cabecera. AHO usa USD por defecto pero guarda los precios en la moneda fijada por el agente; el selector reformatea con tipos de cambio diarios. Tu elección se guarda en tu perfil (si has iniciado sesión) o en localStorage (anónimo).',
      tags: ['currency', 'fx', 'display'],
    },
    {
      id: 'billing_portal_not_opening',
      q: 'El portal de facturación de Stripe no abre',
      a: 'Causas comunes: (1) Bloqueador de pop-ups — permite ventanas emergentes para advertisehomes.online y vuelve a pulsar. (2) Estás logueado a otra cuenta de Stripe en el mismo navegador — abre una ventana privada. (3) Tu suscripción está en un estado al que Stripe no puede dar portal (p. ej. cancelada hace mucho). Escribe a info@advertisehomes.online con tu email de cuenta; podemos intervenir en el servidor.',
      tags: ['billing', 'stripe', 'portal'],
    },
    {
      id: 'translation_wrong',
      q: 'Una descripción se ve mal o está solo en un idioma',
      a: 'El texto de los anuncios lo escribe el agente — AHO no traduce automáticamente (sería irresponsable con precios inmobiliarios). Se permiten anuncios en un solo idioma; aparecen solo en el sitio de ese idioma. Si ves un literal "TODO" o un marcador, es un error del agente al publicar — el formulario de contacto permite señalarlo para moderación.',
      tags: ['i18n', 'translation', 'content'],
    },
    {
      id: 'account_locked',
      q: 'Mi cuenta está bloqueada tras varios intentos fallidos',
      a: 'AHO bloquea la cuenta 30 minutos tras 10 logins fallidos desde la misma IP. Espera, o restablece tu contraseña desde la pantalla de inicio de sesión (usa enlace mágico si no la recuerdas). Si tienes MFA activado y perdiste el dispositivo, escribe a info@advertisehomes.online con prueba de identidad; podemos resetear MFA solo tras verificación, con registro en auditoría.',
      tags: ['auth', 'lockout', 'mfa'],
    },
  ],
  pricingFaq: [
    {
      q: '¿Qué me da $99/mes (Pro Automation) que $29/mes (Agente) no?',
      a: 'Publicación con un clic en Facebook + Instagram + LinkedIn con subtítulos IA específicos por plataforma, cuadrícula social 21 (3 plataformas × 7 idiomas), historial con reintentos, tráfico con UTM, chat IA de atención al cliente en tus anuncios y hasta 30 anuncios activos vs. 5.',
    },
    {
      q: '¿Hay descuento anual?',
      a: 'Sí — alrededor del 17%. Agente $29/mes o $290/año. Plus $49/mes o $490/año. Pro Automation $99/mes o $990/año.',
    },
    {
      q: '¿Qué es la tarifa Founder?',
      a: '$19 al mes de por vida en el plan Agente, reservada para los primeros 50 agentes que se registren dentro de la ventana Founder. Solo facturación mensual; al llenarse, la tarifa se cierra.',
    },
    {
      q: '¿Hay periodo de prueba?',
      a: 'No hay periodo de prueba gratis. AHO nunca lo ha ofrecido — nunca menciones prueba de 7 días, 14 días ni de ningún otro plazo porque no existe. La compra sin riesgo tiene dos caminos: (1) el anuncio único de propietario por $5 (pago único; sin compromiso más allá de los $5), y (2) la tarifa fundador de $19/mes en Agente, congelada de por vida (primeros 50 agentes). Puedes cancelar cualquier suscripción cuando quieras desde el Portal de Cliente de Stripe; los anuncios quedan visibles hasta el final del periodo.',
    },
    {
      q: '¿Los compradores pagan a AHO?',
      a: 'No. Toda la experiencia del comprador es gratis — buscar, favoritos, búsquedas guardadas, contactar agentes. Solo los agentes pagan.',
    },
  ],
  billingFaq: [
    {
      q: '¿Cómo cancelo?',
      a: 'Panel → Perfil → Abrir portal de facturación → Cancelar suscripción. Dos clics. Tus anuncios siguen activos hasta el final del periodo de facturación.',
    },
    {
      q: '¿Qué pasa con mis anuncios si cancelo?',
      a: 'Pasan a inactivos — dejan de aparecer en la búsqueda pública pero quedan en tu panel. Si te resuscribes, vuelven al instante.',
    },
    {
      q: '¿Qué métodos de pago aceptan?',
      a: 'Todas las tarjetas principales vía Stripe Checkout, más 3-D Secure cuando lo exija el banco. Apple Pay y Google Pay están soportados en dispositivos compatibles.',
    },
    {
      q: '¿Cómo se gestiona el IVA / impuestos?',
      a: 'Stripe Tax calcula la tasa correcta según tu país de facturación y la muestra en la factura. AHO no añade margen sobre el impuesto.',
    },
    {
      q: '¿Puedo cambiar de plan?',
      a: 'Sí, desde el Portal de Cliente de Stripe. Las subidas tienen efecto inmediato y se prorratean. Las bajadas tienen efecto al final del periodo actual.',
    },
    {
      q: '¿Hacen reembolsos?',
      a: 'Puedes cancelar en cualquier momento y la facturación se detiene al final del periodo. Por defecto no reembolsamos el periodo actual, pero escribe a info@advertisehomes.online si tienes un caso especial.',
    },
  ],
  privacyAndCompliance: [
    {
      q: '¿Qué hace AHO con mis datos?',
      a: 'Guardamos lo mínimo necesario: tu info de cuenta, los anuncios que publicaste (si eres agente), favoritos y búsquedas guardadas (si eres comprador), formularios que enviaste a agentes. Nunca vendemos datos a terceros. Detalle completo en la política de privacidad.',
    },
    {
      q: '¿Dónde se guardan mis datos?',
      a: 'Supabase (Postgres) para datos estructurados, Cloudflare R2 para fotos originales, Cloudflare Images para variantes, Stripe para registros de pago. Toda transmisión en TLS; base de datos cifrada en reposo.',
    },
    {
      q: '¿Cómo borro mi cuenta?',
      a: 'Panel → Perfil → Borrar cuenta. Esto cascade a favoritos, búsquedas guardadas, formularios de contacto y reseñas. Los registros de facturación se anonimizan pero se conservan donde la ley fiscal lo exige (típicamente 7 años).',
    },
    {
      q: '¿AHO cumple con RGPD?',
      a: 'Sí. Respetamos los derechos de acceso, rectificación, supresión, portabilidad y oposición. Escribe a privacy@advertisehomes.online para ejercer cualquier derecho. Los incidentes de seguridad siguen el reloj de notificación de 72 horas.',
    },
    {
      q: '¿La IA guarda mis mensajes de chat?',
      a: 'Las conversaciones se registran para que el agente las vea en su Bandeja IA y para que la IA tenga memoria. Los registros están limitados al agente con quien hablas — nunca compartidos con otros. Elimina una conversación borrando tu cuenta o escribiendo a privacy@advertisehomes.online.',
    },
  ],
  contact: CONTACT,
  canonicalUrls: CANONICAL_URLS,
};

// ───────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────

/**
 * Return the AHO platform knowledge base in the caller's locale.
 *
 * Content-locale narrowing: EN + ES have full hand-written translations.
 * The marketing locales (PL / PT / DE / FR / IT) fall back to EN via
 * `narrowContentLocale()` — the same pattern used elsewhere in the
 * codebase for content-side surfaces. The chrome around the AI's reply
 * (greeting, channel hints) is locale-native; the platform facts are
 * EN until we have a reason to translate them more widely.
 */
export function ahoPlatformKb(locale: Locale): AhoPlatformKb {
  const content = narrowContentLocale(locale);
  return content === 'es' ? KB_ES : KB_EN;
}
