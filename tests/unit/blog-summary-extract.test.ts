import { describe, it, expect } from 'vitest';
import { extractBlogSummary } from '@/lib/blog/generate-post';

/**
 * Regression coverage for the 2026-05-28 bug where post.summary
 * contained literal "{N}" / "{today}" placeholders because the
 * extractor picked up the byline paragraph instead of the article's
 * lead. The byline reads "By <author> · ~{N} min read · {today}"
 * (placeholders stamped into the BODY only). If the extractor ever
 * regresses, the meta description / OG description / blog-index
 * card preview / Google SERP snippet all break — these tests catch
 * any future regression on the same shape.
 */
describe('extractBlogSummary', () => {
  // A representative full body shape that mirrors what the AI emits:
  // breadcrumb-nav → h1 → byline-p → ToC-nav → hero img → real lead p.
  const realisticBody = `
    <nav aria-label="Breadcrumb"><ol>
      <li><a href="/">Home</a></li>
      <li><a href="/blog">Blog</a></li>
      <li>Building a Personal Brand</li>
    </ol></nav>

    <h1>Building a Personal Brand as a Solo Real Estate Agent</h1>

    <p>By Michał Babula · ~{N} min read · {today}</p>

    <nav class="table-of-contents" aria-label="Table of contents">
      <ol>
        <li><a href="#section-1">Why Personal Brand Matters</a></li>
        <li><a href="#section-2">The Three Pillars</a></li>
      </ol>
    </nav>

    <img src="https://example.com/hero.png" width="1200" height="630" alt="hero">

    <p>You don't need a designer. You need three decisions, made once, applied everywhere.</p>

    <p>I want to be honest about this because most brand-building content isn't.</p>
  `;

  it('skips the byline paragraph and picks the actual lead', () => {
    const out = extractBlogSummary(realisticBody);
    expect(out).toBe(
      "You don't need a designer. You need three decisions, made once, applied everywhere.",
    );
    expect(out).not.toMatch(/min read/i);
    expect(out).not.toMatch(/Michał Babula/);
  });

  it('never returns a summary containing {N} or {today} placeholders', () => {
    const out = extractBlogSummary(realisticBody);
    expect(out).not.toMatch(/\{N\}/);
    expect(out).not.toMatch(/\{today\}/);
  });

  it('strips any placeholder syntax from the picked paragraph as defense-in-depth', () => {
    const body = `
      <p>By <author> · ~{N} min read · {today}</p>
      <p>Sales tip: never set {percent} discount without a {reason} attached.</p>
    `;
    const out = extractBlogSummary(body);
    // Both {percent} and {reason} should be stripped; whitespace collapsed.
    expect(out).toBe('Sales tip: never set discount without a attached.');
  });

  it('skips a "Reviewed by ..." paragraph when present', () => {
    const body = `
      <p>By <author> · ~{N} min read · {today}</p>
      <p>Reviewed by Jane Doe on 2026-05-28</p>
      <p>The first real paragraph the reader sees.</p>
    `;
    expect(extractBlogSummary(body)).toBe(
      'The first real paragraph the reader sees.',
    );
  });

  it('truncates to 180 chars with an ellipsis suffix', () => {
    const long = 'x'.repeat(250);
    const body = `<p>By <author> · ~{N} min read · {today}</p><p>${long}</p>`;
    const out = extractBlogSummary(body);
    expect(out.length).toBe(178);
    expect(out.endsWith('…')).toBe(true);
  });

  it('strips inline HTML tags inside the lead paragraph', () => {
    const body = `
      <p>By <author> · ~{N} min read · {today}</p>
      <p>A <strong>bold</strong> claim followed by a <em>nuanced</em> one.</p>
    `;
    expect(extractBlogSummary(body)).toBe(
      'A bold claim followed by a nuanced one.',
    );
  });

  it('returns empty string when the body has no non-byline paragraph', () => {
    const body = `
      <p>By <author> · ~{N} min read · {today}</p>
      <p>Reviewed by editor on 2026-05-28</p>
    `;
    expect(extractBlogSummary(body)).toBe('');
  });

  it('skips empty <p></p> tags before finding the lead', () => {
    const body = `
      <p>By <author> · ~{N} min read · {today}</p>
      <p></p>
      <p>The real lead.</p>
    `;
    expect(extractBlogSummary(body)).toBe('The real lead.');
  });
});
