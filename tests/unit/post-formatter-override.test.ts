/**
 * Unit tests for the override-aware picker helpers in
 * `src/lib/social/post-formatter.ts` — Phase J part 2 of
 * docs/SOCIAL_AUTOMATION_PLAN.md.
 *
 * These pickers are what the publish route calls instead of the bare
 * formatters when the agent has used the AI drafter and edited the
 * suggested caption. The picker substitutes the agent's prose for the
 * deterministic prose but keeps the plumbing (UTM link, image, LI title +
 * description) formatter-controlled.
 */

import { describe, expect, it } from 'vitest';
import {
  MissingImageError,
  pickFacebookPost,
  pickInstagramPost,
  pickLinkedInPost,
  type PostInput,
} from '@/lib/social/post-formatter';

const BASE: PostInput = {
  title: 'Modern 2BR loft near Zona Colonial',
  city: 'Santo Domingo',
  countryDisplay: 'Dominican Republic',
  priceCents: 22_500_000,
  currency: 'USD',
  bedrooms: 2,
  bathrooms: 2,
  areaSqm: 95,
  url: 'https://advertisehomes.online/en/properties/modern-2br-loft-cQF9BN',
  imageUrls: ['https://imagedelivery.net/abc/img-id/og'],
  locale: 'en',
};

describe('post-formatter · pickFacebookPost', () => {
  it('no override → returns the deterministic formatter output', () => {
    const out = pickFacebookPost(BASE);
    expect(out.message).toContain('Modern 2BR loft near Zona Colonial');
    expect(out.message).toContain('💰 $225,000');
    expect(out.message).toContain('#realestate');
    expect(out.link).toMatch(/utm_source=facebook/);
  });

  it('override → agent message replaces formatter; link stays UTM-tagged; imageUrl preserved', () => {
    const out = pickFacebookPost(BASE, {
      message: "Custom agent caption written by the human.",
    });
    expect(out.message).toBe("Custom agent caption written by the human.");
    // Critically: link is still formatter-derived (UTM-tagged), NOT
    // whatever the agent might have pasted. The system controls how the
    // listing is identified.
    expect(out.link).toBe(
      'https://advertisehomes.online/en/properties/modern-2br-loft-cQF9BN?utm_source=facebook&utm_medium=social&utm_campaign=agent_share',
    );
    // FB still uses a single hero imageUrl (no FB carousel via Graph API).
    expect(out.imageUrl).toBe(BASE.imageUrls?.[0]);
  });

  it('override + no imageUrl → output omits imageUrl', () => {
    const out = pickFacebookPost(
      { ...BASE, imageUrls: undefined },
      { message: 'text only' },
    );
    expect(out.message).toBe('text only');
    expect(out.imageUrl).toBeUndefined();
  });
});

describe('post-formatter · pickInstagramPost', () => {
  it('no override → returns the deterministic formatter output', () => {
    const out = pickInstagramPost(BASE);
    expect(out.caption).toContain('Modern 2BR loft near Zona Colonial');
    expect(out.caption).toContain('Link in bio');
    expect(out.imageUrls).toEqual(BASE.imageUrls);
  });

  it('override → agent caption replaces formatter; imageUrl preserved', () => {
    const out = pickInstagramPost(BASE, {
      caption: "Custom IG caption ✨\nLink in bio",
    });
    expect(out.caption).toBe("Custom IG caption ✨\nLink in bio");
    expect(out.imageUrls).toEqual(BASE.imageUrls);
  });

  it('override CANNOT bypass IG image requirement — throws MissingImageError', () => {
    expect(() =>
      pickInstagramPost(
        { ...BASE, imageUrls: undefined },
        { caption: 'agent text' },
      ),
    ).toThrow(MissingImageError);
  });

  it('no override + no imageUrl → throws MissingImageError', () => {
    expect(() => pickInstagramPost({ ...BASE, imageUrls: undefined })).toThrow(
      MissingImageError,
    );
  });
});

describe('post-formatter · pickLinkedInPost', () => {
  it('no override → returns the deterministic formatter output', () => {
    const out = pickLinkedInPost(BASE);
    expect(out.commentary).toContain('New on the market');
    expect(out.contentTitle).toBeTruthy();
    expect(out.contentDescription).toContain('Santo Domingo');
  });

  it('override → only commentary is replaced; title + description stay deterministic', () => {
    const out = pickLinkedInPost(BASE, {
      commentary: 'Custom LI commentary by the agent.',
    });
    expect(out.commentary).toBe('Custom LI commentary by the agent.');
    // These are platform-identity, not voice — formatter-controlled.
    expect(out.contentTitle).toBe(BASE.title);
    expect(out.contentDescription).toContain('Santo Domingo');
    expect(out.contentUrl).toMatch(/utm_source=linkedin/);
    expect(out.contentThumbnailUrl).toBe(BASE.imageUrls?.[0]);
  });

  it('override commentary too long is clamped to LinkedIn cap', () => {
    const out = pickLinkedInPost(BASE, {
      commentary: 'X'.repeat(5000),
    });
    expect(out.commentary.length).toBeLessThanOrEqual(2800);
    expect(out.commentary.endsWith('…')).toBe(true);
  });
});
