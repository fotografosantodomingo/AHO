import { describe, expect, it } from 'vitest';
import { renderLeadNotificationEmail } from '../../src/lib/email/templates/lead-notification';
import { renderWelcomeEmail } from '../../src/lib/email/templates/welcome';

describe('renderLeadNotificationEmail', () => {
  const base = {
    agentName: 'Carlos',
    propertyTitle: 'Luxury Penthouse',
    propertyCity: 'Santo Domingo',
    propertyPriceFormatted: '$200,000',
    propertyUrl: 'https://advertisehomes.online/en/properties/luxury-penthouse-santo-domingo-3xk9wz',
    inboxUrl: 'https://advertisehomes.online/en/dashboard/leads',
    source: 'form',
    contactName: 'Buyer Name',
    contactEmail: 'buyer@example.com',
    contactPhone: '+1 809 555 1234',
    message: 'Is this still available?',
    receivedAt: '2026-04-29T12:00:00Z',
    locale: 'en' as const,
  };

  it('renders a subject and HTML body', () => {
    const out = renderLeadNotificationEmail(base);
    expect(out.subject).toContain('Luxury Penthouse');
    expect(out.html).toContain('<!doctype html>');
    expect(out.html).toContain('Buyer Name');
    expect(out.html).toContain('buyer@example.com');
    expect(out.html).toContain('Is this still available?');
    expect(out.html).toContain(base.inboxUrl);
    expect(out.html).toContain(base.propertyUrl);
  });

  it('uses Spanish strings when locale is es', () => {
    const out = renderLeadNotificationEmail({ ...base, locale: 'es' });
    expect(out.subject).toContain('Nuevo contacto');
    expect(out.html).toContain('Hola Carlos');
    expect(out.html).toContain('Acabas de recibir');
  });

  it('handles anonymous leads without a name', () => {
    const out = renderLeadNotificationEmail({ ...base, contactName: null });
    expect(out.html).toContain('Anonymous lead');
  });

  it('handles leads without a message', () => {
    const out = renderLeadNotificationEmail({ ...base, message: null });
    expect(out.html).not.toContain('Is this still available?');
    // Other fields should still render.
    expect(out.html).toContain('buyer@example.com');
  });

  it('escapes HTML in user-provided fields', () => {
    const out = renderLeadNotificationEmail({
      ...base,
      contactName: 'Buyer <script>alert(1)</script>',
      message: 'Click <a href="evil">here</a>',
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).not.toContain('<a href="evil">here</a>');
    expect(out.html).toContain('&lt;a href=&quot;evil&quot;&gt;');
  });

  it('translates known sources', () => {
    const formEs = renderLeadNotificationEmail({ ...base, locale: 'es', source: 'form' });
    expect(formEs.html).toContain('Formulario de contacto');

    const wa = renderLeadNotificationEmail({ ...base, source: 'whatsapp_click' });
    expect(wa.html).toContain('WhatsApp');
  });
});

describe('renderWelcomeEmail', () => {
  const base = {
    email: 'new-user@example.com',
    locale: 'en' as const,
    homeUrl: 'https://advertisehomes.online/en',
    pricingUrl: 'https://advertisehomes.online/en/pricing',
  };

  it('renders subject and HTML', () => {
    const out = renderWelcomeEmail(base);
    expect(out.subject).toBe('Welcome to AHO');
    expect(out.html).toContain('Welcome to AHO!');
    expect(out.html).toContain('new-user@example.com');
    expect(out.html).toContain(base.homeUrl);
    expect(out.html).toContain(base.pricingUrl);
  });

  it('uses Spanish strings for es locale', () => {
    const out = renderWelcomeEmail({ ...base, locale: 'es' });
    expect(out.subject).toBe('Bienvenido a AHO');
    expect(out.html).toContain('¡Bienvenido a AHO!');
  });

  it('escapes the email in the body', () => {
    const out = renderWelcomeEmail({ ...base, email: '<script>foo</script>@example.com' });
    expect(out.html).not.toContain('<script>foo</script>@example.com');
    expect(out.html).toContain('&lt;script&gt;');
  });
});
