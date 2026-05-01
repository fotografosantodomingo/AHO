import { describe, it, expect } from 'vitest';
import {
  buildAllCaptions,
  captionFacebook,
  captionInstagram,
  captionLinkedIn,
  captionWhatsApp,
  whatsappShareLink,
  type ShareInput,
} from '@/lib/social/share-templates';

const baseInput: ShareInput = {
  title: 'Modern villa with pool',
  city: 'Santo Domingo',
  countryDisplay: 'Dominican Republic',
  priceCents: 25_000_000, // $250,000
  currency: 'USD',
  bedrooms: 3,
  bathrooms: 2.5,
  areaSqm: 220,
  baseUrl: 'https://advertisehomes.online/en/properties/modern-villa-abc123',
  locale: 'en',
};

describe('share-templates', () => {
  describe('UTM tagging', () => {
    it('appends utm_source per platform on all four caption builders', () => {
      const fb = captionFacebook(baseInput);
      const ig = captionInstagram(baseInput);
      const li = captionLinkedIn(baseInput);
      const wa = captionWhatsApp(baseInput);

      expect(fb).toContain('utm_source=facebook');
      expect(ig).toContain('utm_source=instagram');
      expect(li).toContain('utm_source=linkedin');
      expect(wa).toContain('utm_source=whatsapp');
    });

    it('always sets utm_medium=social and utm_campaign=agent_share', () => {
      const fb = captionFacebook(baseInput);
      expect(fb).toContain('utm_medium=social');
      expect(fb).toContain('utm_campaign=agent_share');
    });

    it('uses & separator when baseUrl already has a query string', () => {
      const fb = captionFacebook({
        ...baseInput,
        baseUrl: 'https://advertisehomes.online/en/properties/modern-villa-abc123?ref=foo',
      });
      expect(fb).toContain('?ref=foo&utm_source=facebook');
    });

    it('defaults the campaign to agent_share when omitted', () => {
      const fb = captionFacebook(baseInput);
      expect(fb).toContain('utm_campaign=agent_share');
    });

    it('overrides the campaign tag when provided', () => {
      const fb = captionFacebook({ ...baseInput, campaign: 'visitor_share' });
      const ig = captionInstagram({ ...baseInput, campaign: 'visitor_share' });
      const li = captionLinkedIn({ ...baseInput, campaign: 'visitor_share' });
      const wa = captionWhatsApp({ ...baseInput, campaign: 'visitor_share' });
      expect(fb).toContain('utm_campaign=visitor_share');
      expect(ig).toContain('utm_campaign=visitor_share');
      expect(li).toContain('utm_campaign=visitor_share');
      expect(wa).toContain('utm_campaign=visitor_share');
      expect(fb).not.toContain('utm_campaign=agent_share');
    });
  });

  describe('locale switching', () => {
    it('Facebook caption uses Spanish hashtag #inmuebles in es', () => {
      const es = captionFacebook({ ...baseInput, locale: 'es' });
      expect(es).toContain('#inmuebles');
      expect(es).not.toContain('#realestate');
    });

    it('Facebook caption uses English hashtag #realestate in en', () => {
      const en = captionFacebook(baseInput);
      expect(en).toContain('#realestate');
      expect(en).not.toContain('#inmuebles');
    });

    it('LinkedIn caption is professional tone in both locales (no emoji on label rows)', () => {
      const en = captionLinkedIn(baseInput);
      const es = captionLinkedIn({ ...baseInput, locale: 'es' });
      expect(en).toContain('New on the market');
      expect(es).toContain('Nuevo en el mercado');
      // Labels should be plain words, not emoji
      expect(en).toMatch(/Location:/);
      expect(es).toMatch(/Ubicación:/);
    });

    it('Instagram caption mentions link-in-bio per locale', () => {
      const en = captionInstagram(baseInput);
      const es = captionInstagram({ ...baseInput, locale: 'es' });
      expect(en).toMatch(/Link in bio/i);
      expect(es).toMatch(/Enlace en bio/i);
    });
  });

  describe('city hashtag', () => {
    it('slugifies the city for use as a hashtag (lowercase, no spaces, no diacritics)', () => {
      const fb = captionFacebook({ ...baseInput, city: 'Santo Domingo' });
      expect(fb).toContain('#santodomingo');
    });

    it('strips diacritics from city hashtag', () => {
      const fb = captionFacebook({ ...baseInput, city: 'Cádiz' });
      expect(fb).toContain('#cadiz');
    });
  });

  describe('specs line', () => {
    it('includes bedrooms / bathrooms / area when present', () => {
      const fb = captionFacebook(baseInput);
      expect(fb).toContain('🛏 3');
      expect(fb).toContain('🛁 2.5');
      expect(fb).toContain('📐 220 m²');
    });

    it('omits the specs line entirely when all three fields are null', () => {
      const fb = captionFacebook({
        ...baseInput,
        bedrooms: null,
        bathrooms: null,
        areaSqm: null,
      });
      expect(fb).not.toContain('🛏');
      expect(fb).not.toContain('🛁');
      expect(fb).not.toContain('📐');
    });

    it('omits zero-value specs (treats 0 as missing)', () => {
      const fb = captionFacebook({
        ...baseInput,
        bedrooms: 0,
        bathrooms: 0,
        areaSqm: 0,
      });
      expect(fb).not.toContain('🛏');
      expect(fb).not.toContain('🛁');
    });
  });

  describe('whatsappShareLink', () => {
    it('produces a wa.me URL with the body URI-encoded', () => {
      const link = whatsappShareLink('hello world');
      expect(link).toBe('https://wa.me/?text=hello%20world');
    });

    it('encodes newlines and special chars correctly', () => {
      const link = whatsappShareLink('a\nb&c');
      expect(link).toContain('%0A'); // newline
      expect(link).toContain('%26'); // ampersand
    });
  });

  describe('buildAllCaptions', () => {
    it('returns all four captions plus the WhatsApp deep-link', () => {
      const all = buildAllCaptions(baseInput);
      expect(all.facebook).toContain('utm_source=facebook');
      expect(all.instagram).toContain('utm_source=instagram');
      expect(all.linkedin).toContain('utm_source=linkedin');
      expect(all.whatsapp).toContain('utm_source=whatsapp');
      expect(all.whatsappShareUrl.startsWith('https://wa.me/?text=')).toBe(true);
    });

    it('WhatsApp deep-link encodes the same body that captionWhatsApp returns', () => {
      const all = buildAllCaptions(baseInput);
      const expectedFromBody = whatsappShareLink(all.whatsapp);
      expect(all.whatsappShareUrl).toBe(expectedFromBody);
    });
  });

  describe('price formatting', () => {
    it('uses USD formatting with the active locale', () => {
      const en = captionFacebook(baseInput);
      const es = captionFacebook({ ...baseInput, locale: 'es' });
      expect(en).toContain('$250,000');
      // es-DO formatting uses different separators but always includes the currency
      expect(es).toMatch(/250[,.]000/);
    });
  });
});
