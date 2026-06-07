/**
 * Unique Value Contract — the guard that keeps the SEO knowledge-graph engine
 * on the right side of Google's scaled-content-abuse policy (March 2024).
 *
 * See docs/SEO_COLD_START_PLAN.md §5 + §9. The rule:
 *
 *   > Before a page type scales, each instance must contain real, specific,
 *   > non-templated value. If two pages differ only by find-replacing the
 *   > place name → it's a doorway page → it does NOT ship.
 *
 * This module makes that rule executable. `assessUniqueValue` answers two
 * questions about a candidate page:
 *   1. Does it have enough real content at all? (length floor)
 *   2. After neutralizing the place name(s), is it a near-duplicate of a
 *      sibling page? (templating / doorway detection)
 *
 * Why neutralize names but KEEP numbers: two city pages that say
 * "median price in {city} is $X" with different real X values are legitimately
 * distinct (real differing data = real value). A page that is pure template
 * with the place name swapped collapses to an identical string once the name
 * is removed — that's the doorway pattern we reject.
 *
 * Pure functions, no IO — so it unit-tests cleanly and runs in the push gate.
 */

/** Minimum visible-text length (chars) for a page to count as real content. */
export const MIN_CONTENT_CHARS = 250;

/** Token-set Jaccard at/above this vs a sibling ⇒ templated/doorway ⇒ reject. */
export const SIMILARITY_REJECT_THRESHOLD = 0.9;

export interface UniqueValueInput {
  /** Page body. HTML is fine — tags are stripped before analysis. */
  text: string;
  /**
   * Entity name(s) to neutralize before the templating comparison: the city,
   * country, neighborhood (+ any obvious variants). Case-insensitive.
   */
  entityNames: string[];
}

export interface UniqueValueResult {
  passes: boolean;
  reasons: string[];
  /** Visible-text length after stripping HTML. */
  contentChars: number;
  /** Highest similarity to any sibling after name-neutralization (0 if none). */
  maxSimilarity: number;
}

/** Strip HTML tags + collapse whitespace to plain visible text. */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize text for templating comparison: lowercase, replace each entity
 * name with a fixed placeholder, drop punctuation, collapse whitespace.
 * Numbers are intentionally preserved — real differing data is real value.
 */
export function normalizeForTemplating(text: string, names: string[]): string {
  let out = stripHtml(text).toLowerCase();
  // Replace longer names first so "santo domingo este" is neutralized before
  // a substring "santo domingo" would partially match.
  const sorted = [...names]
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    // Escape regex metacharacters in the name.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), ' ■ ');
  }
  return out
    .replace(/[^\p{L}\p{N}■\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set Jaccard similarity (0..1) of two normalized strings. */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) if (setB.has(tok)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Assess whether a candidate page satisfies the Unique Value Contract.
 *
 * @param page     the candidate page + its entity name(s)
 * @param siblings already-accepted (or candidate) pages of the same type to
 *                 compare against for templating; pass the others in the batch
 */
export function assessUniqueValue(
  page: UniqueValueInput,
  siblings: UniqueValueInput[] = [],
): UniqueValueResult {
  const reasons: string[] = [];
  const visible = stripHtml(page.text);
  const contentChars = visible.length;

  if (contentChars < MIN_CONTENT_CHARS) {
    reasons.push(
      `content too thin: ${contentChars} visible chars < ${MIN_CONTENT_CHARS} minimum`,
    );
  }

  const norm = normalizeForTemplating(page.text, page.entityNames);
  let maxSimilarity = 0;
  for (const sib of siblings) {
    const sibNorm = normalizeForTemplating(sib.text, sib.entityNames);
    const sim = jaccardSimilarity(norm, sibNorm);
    if (sim > maxSimilarity) maxSimilarity = sim;
  }
  if (maxSimilarity >= SIMILARITY_REJECT_THRESHOLD) {
    reasons.push(
      `templated/doorway: ${(maxSimilarity * 100).toFixed(0)}% similar to a sibling ` +
        `after name-neutralization (≥ ${(SIMILARITY_REJECT_THRESHOLD * 100).toFixed(0)}% rejects)`,
    );
  }

  return {
    passes: reasons.length === 0,
    reasons,
    contentChars,
    maxSimilarity,
  };
}
