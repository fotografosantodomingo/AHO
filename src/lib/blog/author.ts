/**
 * Editorial identity for the programmatic SEO blog.
 *
 * Per PO 2026-05-19: real byline (not fictional). E-E-A-T signal
 * Google has been increasingly strict on since the 2024 spam updates
 * — a fake author name + fake bio is one of the easier patterns for
 * Google's quality classifier to flag, and once classified low the
 * whole domain takes a hit.
 *
 * This file is the single source of truth for who the article is
 * attributed to, who reviewed it, and what JSON-LD Person + Article
 * objects render. Change here, propagates to the blog page + JSON-LD
 * + email templates uniformly.
 */

export interface BlogAuthor {
  name: string;
  role: string;
  /** Personal URL — Google's E-E-A-T page recommends linking to a
   *  same-domain author profile, an external authoritative profile,
   *  or both. We use the founder's LinkedIn as the external auth signal. */
  url: string;
  /** Optional photo URL. Stays NULL until we have a real headshot to
   *  put in production — per Hard rule #8, no stock photos. */
  photoUrl: string | null;
  /** Same-domain author profile page. Built from the founder's user
   *  profile slug; can return to a fuller bio page later. */
  sameDomainProfileUrl: string | null;
  bioParagraph: string;
}

/**
 * Founder + de-facto editorial owner. The byline on every
 * programmatic SEO post until we hire a dedicated content lead.
 */
export const PRIMARY_AUTHOR: BlogAuthor = {
  name: 'Michał Babula',
  role: 'Founder, AHO (Advertise Homes Online)',
  url: 'https://www.linkedin.com/in/michal-babula-8aba7241/',
  photoUrl: null,
  sameDomainProfileUrl: null,
  bioParagraph:
    'Michał is the founder of AHO (Advertise Homes Online), the real-estate platform built on the bet that a single listing should reach every channel a buyer might be on — Facebook Page, Instagram Feed + Reels, LinkedIn, WhatsApp, and the agent\'s own website — without the agent posting any of it manually. He writes about the engineering + marketing problems real-estate agents face when they try to compete with portals at the multi-channel game.',
};

/**
 * Reviewer line at the bottom of each article — "Reviewed by …".
 * For v1 the same person who authors also reviews (which we disclose
 * by NOT setting a reviewer different from the author). Future:
 * separate editorial reviewer once a second voice ships.
 */
export const ARTICLE_REVIEWER: { name: string } | null = null;
