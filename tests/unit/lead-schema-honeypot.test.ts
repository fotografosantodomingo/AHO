import { describe, it, expect } from 'vitest';
import { LeadCreateSchema } from '@/lib/leads/schemas';

const baseFormSubmission = {
  property_id: '00000000-0000-0000-0000-000000000001',
  source: 'form' as const,
  contact_name: 'Real Buyer',
  contact_email: 'buyer@example.com',
  contact_phone: '+1-555-0100',
  message: 'I would like to view this property next weekend.',
  language: 'en' as const,
};

describe('LeadCreateSchema honeypot', () => {
  it('accepts a normal submission with empty honeypot', () => {
    const r = LeadCreateSchema.safeParse({ ...baseFormSubmission, website: '' });
    expect(r.success).toBe(true);
  });

  it('accepts a normal submission with omitted honeypot (backwards compat)', () => {
    const r = LeadCreateSchema.safeParse(baseFormSubmission);
    expect(r.success).toBe(true);
  });

  it('rejects when honeypot has content (a bot filled it)', () => {
    const r = LeadCreateSchema.safeParse({
      ...baseFormSubmission,
      website: 'https://spammer.example.com',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const err = r.error.issues.find((i) => i.path.includes('website'));
      expect(err?.message).toBe('honeypot_filled');
    }
  });

  it('rejects honeypot with a single character', () => {
    const r = LeadCreateSchema.safeParse({ ...baseFormSubmission, website: 'a' });
    expect(r.success).toBe(false);
  });

  it('rejects honeypot with whitespace (most bots type `http://example.com`, not whitespace, but lock it down anyway)', () => {
    const r = LeadCreateSchema.safeParse({ ...baseFormSubmission, website: ' ' });
    expect(r.success).toBe(false);
  });

  it('still enforces required fields when honeypot is empty (does not bypass other validation)', () => {
    const r = LeadCreateSchema.safeParse({
      property_id: baseFormSubmission.property_id,
      source: 'form',
      website: '',
      // missing: contact_name, contact_email, message
    });
    expect(r.success).toBe(false);
  });

  it('whatsapp_click / phone_click flows pass without contact details (and without honeypot)', () => {
    // These flows don't render the form; they POST directly with just
    // property_id + source. Honeypot is not relevant.
    const r = LeadCreateSchema.safeParse({
      property_id: baseFormSubmission.property_id,
      source: 'whatsapp_click',
    });
    expect(r.success).toBe(true);
  });
});
