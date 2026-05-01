import { describe, expect, it } from 'vitest';
import { renderReviewVerificationEmail } from '@/lib/email/templates/review-verification';
import { renderReviewPublishedEmail } from '@/lib/email/templates/review-published';

/**
 * Email render snapshots — mostly defensive. Confirms locale switching,
 * HTML escaping of user-supplied fields, and that the verification URL
 * is in the body verbatim (so reviewers can copy-paste if their email
 * client mangles links).
 */

describe('renderReviewVerificationEmail', () => {
  it('renders the EN subject + body with the agent name', () => {
    const out = renderReviewVerificationEmail({
      reviewerName: 'Maria Lopez',
      agentName: 'Carlos Rodríguez',
      locale: 'en',
      verifyUrl: 'https://example.test/en/reviews/verify/abc',
      expiresInHours: 168,
    });
    expect(out.subject).toBe('Confirm your review on AHO');
    expect(out.html).toContain('Carlos Rodríguez');
    expect(out.html).toContain('https://example.test/en/reviews/verify/abc');
    expect(out.html).toContain('168 hours');
  });

  it('renders the ES subject + body', () => {
    const out = renderReviewVerificationEmail({
      reviewerName: 'Juan',
      agentName: 'Ana Pérez',
      locale: 'es',
      verifyUrl: 'https://example.test/es/resenas/verificar/abc',
      expiresInHours: 168,
    });
    expect(out.subject).toBe('Confirma tu reseña en AHO');
    expect(out.html).toContain('Ana Pérez');
    expect(out.html).toContain('168 horas');
  });

  it('escapes HTML in user-controlled inputs (XSS hardening)', () => {
    const out = renderReviewVerificationEmail({
      reviewerName: '<script>alert(1)</script>',
      agentName: 'Honest Agent',
      locale: 'en',
      verifyUrl: 'https://example.test/x',
      expiresInHours: 24,
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('renderReviewPublishedEmail', () => {
  it('renders the star count in the subject (visual signal in inbox)', () => {
    const out = renderReviewPublishedEmail({
      agentFirstName: 'Carlos',
      reviewerName: 'Maria',
      rating: 4,
      bodyExcerpt: 'Great help finding our home.',
      locale: 'en',
      replyUrl: 'https://example.test/en/dashboard/reviews',
      publicProfileUrl: 'https://example.test/en/agents/carlos',
    });
    expect(out.subject).toContain('★★★★☆');
    expect(out.subject).toContain('Maria');
  });

  it('renders ES correctly with full stars matching the rating', () => {
    const out = renderReviewPublishedEmail({
      agentFirstName: 'Ana',
      reviewerName: 'Pedro',
      rating: 5,
      bodyExcerpt: 'Excelente.',
      locale: 'es',
      replyUrl: 'https://example.test/es/panel/resenas',
      publicProfileUrl: 'https://example.test/es/agentes/ana',
    });
    expect(out.subject).toContain('★★★★★');
    expect(out.subject).toContain('Nueva reseña');
  });

  it('escapes HTML in body excerpt', () => {
    const out = renderReviewPublishedEmail({
      agentFirstName: 'X',
      reviewerName: 'Y',
      rating: 3,
      bodyExcerpt: '<img src=x onerror=alert(1)>',
      locale: 'en',
      replyUrl: 'https://example.test/r',
      publicProfileUrl: 'https://example.test/p',
    });
    expect(out.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
