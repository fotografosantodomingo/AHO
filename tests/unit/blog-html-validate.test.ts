// Unit tests for src/lib/blog/html-validate.ts — the structural
// contract enforced on every AI-generated programmatic-SEO post
// before insert into blog_posts.

import { describe, expect, it } from 'vitest';
import { validateBlogHtml } from '@/lib/blog/html-validate';

// A minimum-valid body that satisfies every rule. Tests below mutate
// this baseline to assert each rule independently.
const VALID = `
<nav aria-label="Breadcrumb">
  <ol>
    <li><a href="/en">Home</a></li>
    <li><a href="/en/blog">Blog</a></li>
    <li>Example article</li>
  </ol>
</nav>
<h1>Example article title</h1>
<p>By Author Name · ~5 min read · 2026-05-19</p>
<nav class="table-of-contents" aria-label="Table of contents">
  <ol>
    <li><a href="#intro">Intro</a></li>
    <li><a href="#section-a">Section A</a></li>
  </ol>
</nav>
<h2 id="intro">Intro</h2>
<p>Opening paragraph with enough words to count toward the body.</p>
<h2 id="section-a">Section A</h2>
<p>Another paragraph that adds words to the body.</p>
<aside class="author-bio-box">
  <h3>About the author</h3>
  <p>Bio paragraph.</p>
  <p><a href="https://example.com">LinkedIn</a></p>
</aside>
`.trim();

describe('validateBlogHtml — happy path', () => {
  it('accepts a body that satisfies every rule', () => {
    const r = validateBlogHtml(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.wordCount).toBeGreaterThan(10);
      expect(r.html).toContain('<h1>Example article title</h1>');
    }
  });
});

describe('validateBlogHtml — markdown fence stripping', () => {
  it('strips a leading ```html ... ``` wrapper and accepts inner', () => {
    const wrapped = '```html\n' + VALID + '\n```';
    const r = validateBlogHtml(wrapped);
    expect(r.ok).toBe(true);
  });

  it('rejects an empty body after stripping', () => {
    const r = validateBlogHtml('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('empty_body');
  });
});

describe('validateBlogHtml — Microdata rejection', () => {
  it('rejects itemprop attributes', () => {
    const body = VALID.replace('<h1>', '<h1 itemprop="headline">');
    const r = validateBlogHtml(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('microdata_present');
  });

  it('rejects itemscope attributes', () => {
    const body = VALID.replace(
      '<aside class="author-bio-box">',
      '<aside class="author-bio-box" itemscope>',
    );
    const r = validateBlogHtml(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('microdata_present');
  });

  it('rejects itemtype attributes', () => {
    const body = VALID.replace(
      '<aside class="author-bio-box">',
      '<aside class="author-bio-box" itemtype="https://schema.org/Person">',
    );
    const r = validateBlogHtml(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('microdata_present');
  });
});

describe('validateBlogHtml — required structural blocks', () => {
  it('rejects missing breadcrumb nav', () => {
    const body = VALID.replace(/<nav aria-label="Breadcrumb">[\s\S]*?<\/nav>/, '');
    const r = validateBlogHtml(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing_breadcrumb');
  });

  it('accepts breadcrumb nav with a localized aria-label value', () => {
    // Translated articles legitimately localize the accessibility
    // label. The validator must accept any non-empty aria-label —
    // pre-2026-05-21 it rejected any value other than literal
    // "Breadcrumb", which dropped every translated sibling row.
    for (const label of ['Brotkrumen', 'Migas de pan', 'Fil d’Ariane', 'Briciole di pane']) {
      const body = VALID.replace(/aria-label="Breadcrumb"/, `aria-label="${label}"`);
      const r = validateBlogHtml(body);
      expect(r.ok).toBe(true);
    }
  });

  it('rejects missing ToC nav', () => {
    const body = VALID.replace(/<nav class="table-of-contents"[\s\S]*?<\/nav>/, '');
    const r = validateBlogHtml(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing_toc');
  });

  it('rejects missing author bio aside', () => {
    const body = VALID.replace(/<aside class="author-bio-box">[\s\S]*?<\/aside>/, '');
    const r = validateBlogHtml(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing_author_bio');
  });
});

describe('validateBlogHtml — ToC anchor orphans', () => {
  it('rejects a ToC link pointing at a non-existent heading id', () => {
    const body = VALID.replace('<h2 id="section-a">', '<h2 id="renamed-section">');
    const r = validateBlogHtml(body);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('toc_anchor_orphan');
      expect(r.detail).toContain('section-a');
    }
  });
});
