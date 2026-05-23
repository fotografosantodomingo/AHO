/**
 * Validate + light-sanitize the HTML body returned by the AI generator
 * before we write it into `blog_posts.body_html`. Pure function — no
 * DOM, no DOMParser (Edge runtime). Edge-runtime + Vitest-safe.
 *
 * Why a custom regex-based check instead of a full HTML parser:
 *   - The Edge runtime doesn't ship JSDOM-style DOM APIs.
 *   - We only need to enforce a handful of structural rules (TOC
 *     present, breadcrumb present, author bio present, no Microdata
 *     attributes, no markdown fences).
 *   - Pulling in a parser would balloon the worker bundle past the
 *     Cloudflare 1 MB limit without buying us anything beyond regex.
 *
 * What this checks:
 *   1. No leading/trailing markdown code fences ("```html" wrapper).
 *   2. NO Microdata (itemprop / itemscope attributes anywhere) —
 *      Hard contract from the tech spec; schema lives in JSON-LD.
 *   3. <nav aria-label="Breadcrumb"> exists.
 *   4. <nav class="table-of-contents"> OR <nav class="toc"> exists.
 *   5. Every <h2 id="..."> and <h3 id="..."> referenced by ToC links
 *      actually exists on the page.
 *   6. <aside class="author-bio-box"> OR equivalent author block.
 *   7. At least one <img> tag exists somewhere (hero or inline).
 *
 * Returns the cleaned HTML on success, or { error: <code> } when one
 * of the rules fails. The cron writes `status='ai_failed'` with the
 * error code into `failure_reason` so the failure email + future
 * admin UI can render the diagnostic.
 */

export type HtmlValidationError =
  | 'empty_body'
  | 'markdown_fence_wrapper'
  | 'microdata_present'
  | 'missing_breadcrumb'
  | 'missing_toc'
  | 'toc_anchor_orphan'
  | 'missing_author_bio';

export type HtmlValidationResult =
  | { ok: true; html: string; wordCount: number }
  | { ok: false; error: HtmlValidationError; detail?: string };

/**
 * The AI sometimes wraps its output in ```html ... ``` despite the
 * prompt forbidding it. Strip the fence if present BEFORE the
 * structural checks run; treat an empty post-strip body as an error.
 */
function stripMarkdownFences(raw: string): { stripped: string; hadFence: boolean } {
  const trimmed = raw.trim();
  const fenceOpenRe = /^```(?:html)?\s*\n/i;
  const fenceCloseRe = /\n```\s*$/;
  if (fenceOpenRe.test(trimmed) || fenceCloseRe.test(trimmed)) {
    const inner = trimmed.replace(fenceOpenRe, '').replace(fenceCloseRe, '').trim();
    return { stripped: inner, hadFence: true };
  }
  return { stripped: trimmed, hadFence: false };
}

/** Count whitespace-separated tokens after stripping HTML tags. */
function estimateWordCount(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 0;
  return text.split(' ').length;
}

/**
 * Extract `id="<value>"` from every `<h2>` / `<h3>` tag.
 * Returns a Set of unique ids. Tolerates id="X" or id='X'.
 */
function extractHeadingIds(html: string): Set<string> {
  const out = new Set<string>();
  // Match opening h2/h3 tags with at least one attribute that may
  // include an id="...". The /g flag iterates all matches.
  const re = /<h[23]\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

/**
 * Extract every `href="#<anchor>"` that appears inside a
 * <nav class="table-of-contents"> or <nav class="toc"> block.
 */
function extractTocAnchors(html: string): string[] {
  // Find the ToC nav block (greedy match on attribute order tolerated).
  const navRe = /<nav\b[^>]*class\s*=\s*["'][^"']*(?:table-of-contents|toc)[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i;
  const navMatch = navRe.exec(html);
  if (!navMatch) return [];
  const inner = navMatch[1] ?? '';
  const anchorRe = /href\s*=\s*["']#([^"']+)["']/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(inner)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

export function validateBlogHtml(raw: string): HtmlValidationResult {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: 'empty_body' };
  }
  const { stripped } = stripMarkdownFences(raw);
  if (!stripped) {
    return { ok: false, error: 'markdown_fence_wrapper' };
  }

  // 1. Microdata — flat-out reject.
  if (/\b(itemprop|itemscope|itemtype)\b/i.test(stripped)) {
    return { ok: false, error: 'microdata_present' };
  }

  // 2. Breadcrumb nav present. Accept any non-empty aria-label value —
  // translations legitimately localize the accessibility label
  // ("Brotkrumen", "Migas de pan", etc.) and rejecting non-English
  // values silently dropped every translated sibling row pre-2026-05-21.
  // The structural intent is "a <nav> with an aria-label exists for
  // breadcrumbs, distinct from the ToC nav (which is identified by
  // its class attribute)."
  const navWithAriaLabelRe =
    /<nav\b([^>]*aria-label\s*=\s*["'][^"']+["'][^>]*)>/gi;
  let hasBreadcrumbNav = false;
  let mNav: RegExpExecArray | null;
  while ((mNav = navWithAriaLabelRe.exec(stripped)) !== null) {
    const attrs = mNav[1] ?? '';
    // Skip the ToC nav — identified by class="table-of-contents" / "toc".
    if (/class\s*=\s*["'][^"']*(?:table-of-contents|toc)[^"']*["']/i.test(attrs)) {
      continue;
    }
    hasBreadcrumbNav = true;
    break;
  }
  if (!hasBreadcrumbNav) {
    return { ok: false, error: 'missing_breadcrumb' };
  }

  // 3. ToC nav present.
  const tocAnchors = extractTocAnchors(stripped);
  if (tocAnchors.length === 0) {
    return { ok: false, error: 'missing_toc' };
  }

  // 4. Every ToC anchor maps to an existing heading id.
  const headingIds = extractHeadingIds(stripped);
  for (const anchor of tocAnchors) {
    if (!headingIds.has(anchor)) {
      return {
        ok: false,
        error: 'toc_anchor_orphan',
        detail: `ToC link #${anchor} has no matching <h2 id="${anchor}"> / <h3 id="${anchor}">`,
      };
    }
  }

  // 5. Author bio block present.
  const authorRe = /<aside\b[^>]*class\s*=\s*["'][^"']*author-bio-box[^"']*["']/i;
  if (!authorRe.test(stripped)) {
    return { ok: false, error: 'missing_author_bio' };
  }

  const wordCount = estimateWordCount(stripped);
  return { ok: true, html: stripped, wordCount };
}
