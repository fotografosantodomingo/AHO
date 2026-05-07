import { describe, it, expect } from 'vitest';
import {
  COPYWRITER_TONES,
  DEFAULT_TONE,
  __test__,
  type Tone,
} from '@/lib/ai/copywriter';

const { buildSystemPrompt } = __test__;

/**
 * Tone-of-voice selector — verifies that the system prompt the
 * copywriter sends to Anthropic is genuinely different per tone, and
 * that the per-locale voice still layers on top regardless of which
 * tone is picked.
 *
 * No network calls — we assert against the system-prompt string.
 */
describe('copywriter tone selector', () => {
  it('exposes exactly the three Sprint-2 tones, defaulting to investment', () => {
    expect(COPYWRITER_TONES).toEqual(['luxury', 'investment', 'family']);
    expect(DEFAULT_TONE).toBe('investment');
  });

  it.each<Tone>(['luxury', 'investment', 'family'])(
    'embeds the %s tone label into the system prompt',
    (tone) => {
      const prompt = buildSystemPrompt({
        locale: 'en',
        platform: 'fb_feed',
        tone,
      });
      expect(prompt).toContain(`Tone of voice: ${tone.toUpperCase()}`);
    },
  );

  it('investment tone leads with ROI / yield language; luxury and family do not', () => {
    const investment = buildSystemPrompt({
      locale: 'en',
      platform: 'fb_feed',
      tone: 'investment',
    });
    const luxury = buildSystemPrompt({
      locale: 'en',
      platform: 'fb_feed',
      tone: 'luxury',
    });
    const family = buildSystemPrompt({
      locale: 'en',
      platform: 'fb_feed',
      tone: 'family',
    });
    // Investment block must mention yield + appreciation; the other
    // tone blocks must explicitly reject ROI framing.
    expect(investment).toMatch(/rental yield/i);
    expect(investment).toMatch(/capital appreciation/i);
    expect(luxury).toMatch(/skip "ROI"/i);
    expect(family).toMatch(/avoid ROI/i);
  });

  it('luxury tone steers toward rarity / craftsmanship', () => {
    const luxury = buildSystemPrompt({
      locale: 'en',
      platform: 'linkedin',
      tone: 'luxury',
    });
    expect(luxury).toMatch(/rarity/i);
    expect(luxury).toMatch(/craftsmanship/i);
  });

  it('family tone steers toward schools / walkability / room to grow', () => {
    const family = buildSystemPrompt({
      locale: 'en',
      platform: 'fb_feed',
      tone: 'family',
    });
    expect(family).toMatch(/school/i);
    expect(family).toMatch(/walk/i);
    expect(family).toMatch(/room to grow/i);
  });

  it('per-locale voice still layers on top regardless of tone', () => {
    // PL voice has substance-first phrasing in LOCALE_VOICE; verify it
    // still lands when tone is Luxury (a tone where lifestyle leads).
    const pl = buildSystemPrompt({
      locale: 'pl',
      platform: 'fb_feed',
      tone: 'luxury',
    });
    expect(pl).toContain('Locale voice');
    // Pulled from LOCALE_VOICE.pl — substance-first cue.
    expect(pl).toMatch(/praktyczny|substance/i);
  });

  it('LinkedIn platform constraint is tone-neutral so tone selector drives the angle', () => {
    // Pre-tone-selector code hardcoded "investor-leaning, lead with ROI"
    // into the LinkedIn platform block. Now LinkedIn is tone-neutral
    // and the selectable tone owns the angle. Verify Luxury+LinkedIn
    // does NOT inject ROI framing through the platform block.
    const luxLi = buildSystemPrompt({
      locale: 'en',
      platform: 'linkedin',
      tone: 'luxury',
    });
    // The "Platform tone:" line should not contain ROI / investor
    // framing — that's owned by the Tone block now.
    const platformToneLine = luxLi
      .split('\n')
      .find((l) => l.startsWith('Platform tone:'));
    expect(platformToneLine).toBeDefined();
    expect(platformToneLine).not.toMatch(/ROI/i);
    expect(platformToneLine).not.toMatch(/investor/i);
  });

  it('output rules + 70% character ceiling survive the refactor', () => {
    const prompt = buildSystemPrompt({
      locale: 'en',
      platform: 'fb_feed',
      tone: 'investment',
    });
    // 70% rule on the FB feed = 126 chars — pinned in the platform
    // constants. Make sure the prompt still cites it.
    expect(prompt).toMatch(/126 characters MAX/);
    expect(prompt).toMatch(/70% of the platform's "Read more" cutoff/);
    expect(prompt).toMatch(/JSON array/);
  });
});
