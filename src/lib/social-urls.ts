/**
 * Canonical social-media profile URLs for AHO. Single source of truth
 * imported by:
 *   - src/components/footer/site-footer.tsx       (visible site footer)
 *   - src/lib/email/templates/_layout.ts          (transactional email chrome)
 *   - src/app/api/email/send/route.ts             (marketing campaign footer)
 *   - src/components/admin/email/campaign-composer.tsx (sample HTML)
 *
 * When a profile URL changes, edit it here ONCE and every surface picks
 * up the new value on next deploy. No string literals scattered across
 * the codebase.
 *
 * History:
 *   - 2026-05-14: Facebook flipped from /advertisehomesonline (non-
 *     existent vanity handle) to the real Page id 61589895684586.
 *     Instagram flipped from /advertisehomesonline to /advertisehomes.online/
 *     (the actual handle includes the dot).
 *   - 2026-05-19: PO confirmed the three real AHO profiles. Facebook
 *     swapped from /profile.php?id= form to the /people/ display URL
 *     (same Page id, prettier URL). LinkedIn flipped from the
 *     placeholder vanity to the real company page `/advertise-homes-online`.
 *
 * Note for the programmatic-SEO blog cron + /api/social/post:
 *   These URLs are DISPLAY ONLY. Posting to the Facebook Page +
 *   Instagram Business + LinkedIn Company Page requires OAuth tokens
 *   in `ad_platform_tokens`, granted by the admin via the
 *   /dashboard/social Meta-Connect + LinkedIn-Connect flows. Updating
 *   the URLs here does NOT authorize posting; the OAuth grant is the
 *   separate prerequisite step.
 */

export const FACEBOOK_URL =
  'https://www.facebook.com/people/Advertise-Homes-Online/61589895684586/';
export const INSTAGRAM_URL = 'https://www.instagram.com/advertisehomes.online/';
export const LINKEDIN_URL =
  'https://www.linkedin.com/company/advertise-homes-online/';
