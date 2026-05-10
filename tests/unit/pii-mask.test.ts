import { describe, it, expect } from 'vitest';
import { maskEmail, maskPhone } from '@/lib/admin/pii-mask';

describe('maskEmail', () => {
  it('returns empty string for empty / null / whitespace input', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail(null)).toBe('');
    expect(maskEmail(undefined)).toBe('');
    expect(maskEmail('   ')).toBe('');
  });

  it('masks the local part but keeps the first char and full domain', () => {
    expect(maskEmail('foobar@example.com')).toBe('f•••••@example.com');
  });

  it('caps bullet count at 6 to avoid layout-busting strings', () => {
    expect(maskEmail('reallylongemailaddress@example.com')).toBe(
      'r••••••@example.com',
    );
  });

  it('uses minimum 2 bullets even for short local parts', () => {
    expect(maskEmail('a@example.com')).toBe('a••@example.com');
    expect(maskEmail('ab@example.com')).toBe('a••@example.com');
  });

  it('does not leak the raw string when there is no @', () => {
    expect(maskEmail('foobar')).toBe('f•••••');
    expect(maskEmail('@example.com')).toBe('@•••••••••••');
  });

  it('trims input', () => {
    expect(maskEmail('  foobar@example.com  ')).toBe('f•••••@example.com');
  });
});

describe('maskPhone', () => {
  it('returns empty string for empty / null / whitespace input', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
    expect(maskPhone(undefined)).toBe('');
    expect(maskPhone('   ')).toBe('');
  });

  it('keeps + and country code prefix + last 4 digits', () => {
    expect(maskPhone('+12025551234')).toBe('+120••••1234');
  });

  it('strips formatting characters in the digit count', () => {
    expect(maskPhone('+1 (202) 555 1234')).toBe('+120••••1234');
  });

  it('handles non-+ prefixed numbers by keeping first 2 digits', () => {
    expect(maskPhone('5551234567')).toBe('55••••4567');
  });

  it('masks the whole string when the number is too short', () => {
    expect(maskPhone('12345')).toBe('•••••');
  });
});
