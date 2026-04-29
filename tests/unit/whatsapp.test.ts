import { describe, expect, it } from 'vitest';
import { buildWhatsAppLink } from '../../src/lib/leads/whatsapp';

describe('buildWhatsAppLink', () => {
  const baseArgs = {
    listingTitle: 'Luxury Penthouse',
    city: 'Santo Domingo',
    url: 'https://advertisehomes.online/en/properties/luxury-penthouse-santo-domingo-do-3xk9wz',
    locale: 'en' as const,
  };

  it('strips non-digits from the phone (E.164 → digits)', () => {
    const link = buildWhatsAppLink({ ...baseArgs, agentPhone: '+1 (809) 555-1234' });
    expect(link).toMatch(/^https:\/\/wa\.me\/18095551234\?text=/);
  });

  it('returns null for missing phone', () => {
    expect(buildWhatsAppLink({ ...baseArgs, agentPhone: null })).toBeNull();
    expect(buildWhatsAppLink({ ...baseArgs, agentPhone: undefined })).toBeNull();
    expect(buildWhatsAppLink({ ...baseArgs, agentPhone: '' })).toBeNull();
  });

  it('returns null for phones with too few digits', () => {
    // Less than 8 digits = unusable.
    expect(buildWhatsAppLink({ ...baseArgs, agentPhone: '123' })).toBeNull();
    expect(buildWhatsAppLink({ ...baseArgs, agentPhone: '+1234567' })).toBeNull();
  });

  it('uses Spanish copy when locale is es', () => {
    const link = buildWhatsAppLink({
      ...baseArgs,
      agentPhone: '18095551234',
      locale: 'es',
    });
    expect(link).not.toBeNull();
    const url = new URL(link!);
    const text = url.searchParams.get('text')!;
    expect(text).toContain('me interesa');
    expect(text).toContain('Santo Domingo');
  });

  it('encodes the listing URL inside the message', () => {
    const link = buildWhatsAppLink({ ...baseArgs, agentPhone: '18095551234' });
    expect(link).not.toBeNull();
    const url = new URL(link!);
    const text = url.searchParams.get('text')!;
    expect(text).toContain('advertisehomes.online');
  });
});
