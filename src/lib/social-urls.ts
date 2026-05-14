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
 * History — 2026-05-14 update:
 *   - Facebook flipped from /advertisehomesonline (non-existent vanity
 *     handle) to the real Page URL with id 61589895684586.
 *   - Instagram flipped from /advertisehomesonline to /advertisehomes.online/
 *     (the actual handle includes the dot).
 *   - LinkedIn kept as the placeholder vanity URL. Not yet provisioned;
 *     leave the constant defined so footer renders the icon even though
 *     the link doesn't resolve. Update once a real company page exists.
 */

export const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61589895684586';
export const INSTAGRAM_URL = 'https://www.instagram.com/advertisehomes.online/';
export const LINKEDIN_URL = 'https://linkedin.com/company/advertisehomesonline';
