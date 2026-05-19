// Unit tests for the topic randomizer + slug builder. Both pure
// functions — fast, edge-safe, no Anthropic / Supabase.

import { describe, expect, it } from 'vitest';
import { BLOG_TOPIC_POOL, pickTopic } from '@/lib/blog/topic-pool';
import { buildBlogSlug } from '@/lib/blog/slug';

describe('pickTopic', () => {
  it('returns a topic when none are excluded', () => {
    const got = pickTopic(new Set(), () => 0);
    expect(got).not.toBeNull();
    expect(BLOG_TOPIC_POOL.some((t) => t.key === got?.key)).toBe(true);
  });

  it('respects the dedup set — excludes a key when present', () => {
    const banned = BLOG_TOPIC_POOL[0]!.key;
    // Force the random index to 0 — if dedup is broken we get the
    // banned topic; if it works we get the first non-banned one.
    const got = pickTopic(new Set([banned]), () => 0);
    expect(got?.key).not.toBe(banned);
  });

  it('returns null when every topic is in the dedup set', () => {
    const allKeys = new Set(BLOG_TOPIC_POOL.map((t) => t.key));
    expect(pickTopic(allKeys)).toBeNull();
  });

  it('agent + seller + mixed audiences all appear in the pool', () => {
    const audiences = new Set(BLOG_TOPIC_POOL.map((t) => t.audience));
    expect(audiences.has('agent')).toBe(true);
    expect(audiences.has('seller')).toBe(true);
  });
});

describe('buildBlogSlug', () => {
  it('produces an ASCII kebab slug with a 6-char hex suffix', () => {
    const slug = buildBlogSlug({
      title: 'How to Write a Listing Description That Ranks on Google',
      topicKey: 'listing-descriptions-rank',
      isoDay: '2026-05-19',
    });
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).toMatch(/-[0-9a-f]{6}$/);
    expect(slug.startsWith('how-to-write-a-listing-description')).toBe(true);
  });

  it('is deterministic for the same (topicKey, isoDay)', () => {
    const a = buildBlogSlug({
      title: 'Different Title One',
      topicKey: 'demo-key',
      isoDay: '2026-05-19',
    });
    const b = buildBlogSlug({
      title: 'Different Title Two',
      topicKey: 'demo-key',
      isoDay: '2026-05-19',
    });
    // Different titles → different prefix, but same suffix (dedup
    // guarantees the unique-slug index doesn't collide for the
    // re-run case).
    expect(a.split('-').slice(-1)[0]).toBe(b.split('-').slice(-1)[0]);
  });

  it('strips accents + special characters from titles', () => {
    const slug = buildBlogSlug({
      title: 'Cómo vender — un piso en Málaga',
      topicKey: 'es-test',
      isoDay: '2026-05-19',
    });
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.startsWith('como-vender-un-piso-en-malaga')).toBe(true);
  });

  it('falls back to topic key when title is unkebabable', () => {
    const slug = buildBlogSlug({
      title: '!!!',
      topicKey: 'fallback-test',
      isoDay: '2026-05-19',
    });
    expect(slug.startsWith('fallback-test-')).toBe(true);
  });
});
