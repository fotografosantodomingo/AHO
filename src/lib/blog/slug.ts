/**
 * URL-safe slug for a blog post. Lower-cased, ASCII-only, with a
 * 6-char suffix derived from the topic key + ISO date for uniqueness.
 *
 * Why a suffix: two articles on the same topic (same `topic_key`) can
 * ship in different months; we need URL-stable slugs that don't
 * collide. The suffix preserves the human-readable title while
 * guaranteeing dedup via the unique index on `blog_posts.slug`.
 *
 * Pure function — edge-safe + unit-testable without crypto.subtle.
 */

const STRIP_ACCENTS_RE = /[̀-ͯ]/g;

function asciiKebab(input: string): string {
  return input
    .normalize('NFKD')
    .replace(STRIP_ACCENTS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Stable 6-char hex suffix from a string. Same input → same output
 * (so a back-fill re-run produces the same slug; no collisions on
 * the unique index). Uses a small DJB2 hash — fast, edge-safe.
 */
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  // Convert to unsigned + 6 hex chars.
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

export function buildBlogSlug(args: {
  title: string;
  topicKey: string;
  isoDay: string; // YYYY-MM-DD
}): string {
  const base = asciiKebab(args.title) || asciiKebab(args.topicKey) || 'untitled';
  const suffix = shortHash(`${args.topicKey}|${args.isoDay}`);
  return `${base}-${suffix}`;
}
