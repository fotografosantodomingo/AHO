import 'server-only';
import type { ImportedFacts } from '@/lib/listings/import-from-url';
import type { Market } from '@/lib/social/market-prompts';
import { getMarketStyle, type MarketStyle } from '@/lib/creative/styles';
import { formatPrice } from '@/lib/listings/format';
import type { Locale } from '@/i18n/config';

/**
 * Pure function: turn an audit's `ImportedFacts` + a target market
 * into a Remotion composition spec the video-render container
 * consumes. Server-only because it imports the styles map; pure JS
 * otherwise so it could be reused in any worker runtime.
 *
 * Composition shape (slice 4a v1):
 *   [0-2s]   Title card — listing title + city, market-style colors
 *   [2-Xs]   Photo sequence — each photo gets ~3-4s of Ken Burns
 *            (slow zoom + pan), captioned with bedrooms/area/etc.
 *   [X-Y]    Price card — large price tag + "Powered by AHO"
 *   total    15-30s, clamped per the plan's SLO
 *
 * No music in v1 — that's a separate music-license decision per
 * `docs/PO_DECISIONS.md` #4. Container picks up music_url from the
 * spec when present (Phase 4.1).
 *
 * Aspect: 9:16 vertical (1080×1920) — Reels / TikTok native.
 * Frame rate: 24fps for Remotion's default — fine for the slow-pan
 * style; 60fps would balloon render time without quality gain on
 * this content.
 */

export interface VideoScript {
  /** Composition id the container's Remotion entry registers. */
  composition: 'reel-real-estate-v1';
  width: 1080;
  height: 1920;
  fps: 24;
  /** Total frame count = duration_s * fps. Clamped to 15-30s. */
  durationFrames: number;

  /** Top-of-video title card props. */
  title: {
    text: string;
    city: string | null;
  };
  /** Mid-video photo sequence; each photo gets a Ken-Burns burst. */
  photos: Array<{
    url: string;
    /** Caption rendered over the photo. Empty string = no caption. */
    caption: string;
  }>;
  /** End-of-video price card. */
  price: {
    label: string | null;
    cta: string;
  };
  /** Per-market color palette to drive cards + text. */
  style: MarketStyle;
  /** Market id — container logs + analytics. */
  market: Market;
  /** Listing source URL — burned into the final frame as a small
   *  bottom-corner watermark so a viewer who screenshots the video
   *  still sees where it came from. */
  sourceUrl: string;
  /** Optional music bed URL. NULL in v1; future Phase 4.1 fills in
   *  when the music-library decision is made. */
  musicUrl: string | null;
}

const PHOTO_SECONDS = 3.5;
const TITLE_SECONDS = 2;
const PRICE_SECONDS = 2.5;
const MIN_DURATION = 15;
const MAX_DURATION = 30;

export function buildVideoScript(args: {
  facts: ImportedFacts;
  market: Market;
  locale: Locale;
  /** Override price text (e.g. localized via Intl.NumberFormat).
   *  If omitted, derived from facts.priceCents + facts.currency. */
  priceOverride?: string | null;
}): VideoScript {
  const { facts, market, locale } = args;
  const style = getMarketStyle(market);

  // Photo subset: filter to HTTPS-only (same rule as the static
  // Creative Factory) + cap at 7 so a 30-photo otodom listing
  // doesn't produce a 2-minute video. With PHOTO_SECONDS=3.5 we
  // hit 24.5s of photo content at max — comfortably inside the
  // 30s ceiling once title + price cards are added.
  const allPhotos = (facts.photoUrls ?? []).filter((u) =>
    u.startsWith('https://'),
  );
  const photos = allPhotos.slice(0, 7);

  // Total duration: photo content + title + price, clamped 15-30s.
  // When the listing has too few photos to hit 15s, we extend each
  // photo's display time inside the container; for the script we
  // just emit the minimum target.
  const rawDuration = photos.length * PHOTO_SECONDS + TITLE_SECONDS + PRICE_SECONDS;
  const clamped = Math.max(MIN_DURATION, Math.min(MAX_DURATION, rawDuration));
  const fps: VideoScript['fps'] = 24;
  const durationFrames = Math.round(clamped * fps);

  const title =
    (locale === 'es' ? facts.titleEs : facts.titleEn) ??
    facts.titleEn ??
    facts.titleEs ??
    'Listing';

  const priceLabel =
    args.priceOverride !== undefined
      ? args.priceOverride
      : facts.priceCents && facts.priceCents > 0 && facts.currency
        ? formatPrice(facts.priceCents, facts.currency, locale)
        : null;

  // Per-market end-card CTA. Mirrors the per-market closing CTA in
  // the caption drafter — keeps the video's voice consistent with
  // the text post that lands alongside.
  const ctaByMarket: Record<Market, string> = {
    us: 'Schedule a tour',
    es: 'Reservar visita',
    pl: 'Umów oglądanie',
    pt: 'Marcar visita',
    de: 'Besichtigung vereinbaren',
    fr: 'Réserver une visite',
    it: 'Prenota visita',
  };

  return {
    composition: 'reel-real-estate-v1',
    width: 1080,
    height: 1920,
    fps,
    durationFrames,
    title: {
      text: truncate(title, 80),
      city: facts.city ?? null,
    },
    photos: photos.map((url) => ({
      url,
      caption: '',
    })),
    price: {
      label: priceLabel,
      cta: ctaByMarket[market],
    },
    style,
    market,
    sourceUrl: facts.sourceUrl,
    musicUrl: null,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
