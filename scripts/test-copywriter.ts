/**
 * One-shot smoke test for `lib/ai/copywriter.ts`. Generates 3 captions
 * across a few (locale, platform) combos for a fixed listing fact set
 * so we can eyeball the prompt's voice tuning before wiring the route.
 *
 * Usage:
 *   set -a && source .env.local && set +a && pnpm tsx scripts/test-copywriter.ts
 */
import { generateCaptions } from '../src/lib/ai/copywriter';
import type { Locale } from '../src/i18n/config';

const FACTS = {
  title: 'Modern 3-bedroom apartment with rooftop terrace',
  transactionType: 'sale' as const,
  propertyType: 'apartment',
  bedrooms: 3,
  bathrooms: 2,
  areaSqm: 95,
  city: 'Madrid',
  countryDisplay: 'Spain',
  priceLabel: '€485,000',
  amenities: ['rooftop terrace', 'parking', 'elevator', 'air conditioning'],
  description:
    'Bright south-facing apartment in the Salamanca district, fully renovated 2024. Two balconies plus a private rooftop terrace with city views. Walking distance to Retiro Park and Serrano shopping.',
  positioningHint: 'Family + investor appeal; rental yield ~4.5% in this zone',
};

const COMBOS: Array<{ locale: Locale; platform: 'fb_feed' | 'ig_feed' | 'ig_reel' | 'linkedin' }> = [
  { locale: 'en', platform: 'fb_feed' },
  { locale: 'es', platform: 'ig_feed' },
  { locale: 'pl', platform: 'fb_feed' },
];

async function main(): Promise<void> {
  for (const c of COMBOS) {
    console.log(`\n========== ${c.locale.toUpperCase()} / ${c.platform} ==========`);
    const start = Date.now();
    const result = await generateCaptions({
      facts: FACTS,
      locale: c.locale,
      platform: c.platform,
      count: 3,
    });
    const ms = Date.now() - start;
    console.log(
      `(${ms}ms · model=${result.model} · in=${result.inputTokens}t · out=${result.outputTokens}t)`,
    );
    result.captions.forEach((cap, i) => {
      console.log(`\n  Variant ${i + 1} (${cap.characterCount} chars):`);
      console.log(`    ${cap.text}`);
      if (cap.hashtags.length > 0) console.log(`    ${cap.hashtags.join(' ')}`);
    });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
