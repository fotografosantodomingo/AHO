/**
 * WhatsApp click-to-chat link builder. Pure function — unit-testable.
 *
 * Per HANDOFF §17.2:
 *   - URL format: `https://wa.me/{phone-no-plus}?text=...`
 *   - Phone is normalized to digits only (E.164 without the leading `+`)
 *   - Message pre-fill is bilingual based on the viewer's locale
 *
 * Returns null if the agent's phone is missing or doesn't have enough digits
 * to be a real number — prevents rendering a broken `wa.me/` link.
 */

interface BuildArgs {
  agentPhone: string | null | undefined;
  listingTitle: string;
  city: string;
  url: string;
  locale: 'en' | 'es';
}

export function buildWhatsAppLink({
  agentPhone,
  listingTitle,
  city,
  url,
  locale,
}: BuildArgs): string | null {
  if (!agentPhone) return null;
  const digits = agentPhone.replace(/\D/g, '');
  // Need at least a country code + meaningful phone — reject anything implausibly short.
  if (digits.length < 8) return null;

  const messages = {
    en: `Hi, I'm interested in "${listingTitle}" in ${city} (${url}). Is it still available?`,
    es: `Hola, me interesa "${listingTitle}" en ${city} (${url}). ¿Sigue disponible?`,
  };
  const text = encodeURIComponent(messages[locale]);
  return `https://wa.me/${digits}?text=${text}`;
}
