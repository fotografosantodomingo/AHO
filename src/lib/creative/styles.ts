import 'server-only';
import type { Market } from '@/lib/social/market-prompts';
import { localeToMarket } from '@/lib/social/market-prompts';
import type { Locale } from '@/i18n/config';

/**
 * Per-market visual palette for the Free Audit Creative Factory —
 * Phase 2.5 of `docs/SUPER_PRO_STAGE_1_PLAN.md`.
 *
 * Why: Phase 5 (Multilingual Context Engine) made the CAPTIONS feel
 * locally-flavored. Phase 2.5 makes the GRAPHICS match — a DE agent's
 * creative reads German-clean (white, charcoal accent), an IT agent's
 * reads Tuscan-warm (beige, terracotta), etc. Same Inter font across
 * markets (we only ship Bold 700 to keep OG payload light); the
 * differentiation is entirely color.
 *
 * Backward compatible: any caller that doesn't pass a locale → market
 * defaults to 'us', which preserves the prior cream + green palette
 * the Phase 2 v1 renderer used.
 *
 * Tokens kept minimal on purpose — three colors per market (background,
 * ink, accent). Satori re-renders very cheaply per swap, so a wider
 * palette is a future polish item, not a v1 need.
 */

export interface MarketStyle {
  /** Page background — the body of the creative behind photo + text */
  bg: string;
  /** Main text color */
  ink: string;
  /** Secondary text color (city label, etc.) */
  inkMuted: string;
  /** Accent color used for the price chip + footer band */
  accent: string;
  /** Color of text on the accent band (footer "Powered by AHO") */
  accentInk: string;
  /** Soft fill behind the photo before it loads (matches the bg
   *  family so the loading state doesn't read as a different design) */
  photoBg: string;
}

const STYLES: Record<Market, MarketStyle> = {
  // US — aspirational, bright, action-green accent (the default AHO look)
  us: {
    bg: '#fbf8f1',
    ink: '#15181e',
    inkMuted: '#71717a',
    accent: '#2c4d3a',
    accentInk: '#ffffff',
    photoBg: '#e7e2d6',
  },
  // ES — Mediterranean warm: sand background, terracotta accent
  es: {
    bg: '#faf5ed',
    ink: '#2a1f12',
    inkMuted: '#8a7860',
    accent: '#b65a3c',
    accentInk: '#ffffff',
    photoBg: '#ebe1cf',
  },
  // PL — Polish corporate clean: near-white, deep navy accent
  pl: {
    bg: '#fafbfc',
    ink: '#0f1419',
    inkMuted: '#5b6573',
    accent: '#1e3a5f',
    accentInk: '#ffffff',
    photoBg: '#e6eaef',
  },
  // PT — Brazilian warm tropical: cream + sage green accent
  pt: {
    bg: '#fbf9f4',
    ink: '#1a1f1a',
    inkMuted: '#6b7569',
    accent: '#3d6b4f',
    accentInk: '#ffffff',
    photoBg: '#e2e8de',
  },
  // DE — Bauhaus minimal: pure white, charcoal accent
  de: {
    bg: '#ffffff',
    ink: '#0a0a0a',
    inkMuted: '#525252',
    accent: '#1f2937',
    accentInk: '#ffffff',
    photoBg: '#f3f4f6',
  },
  // FR — Parisian elegant: cream + deep navy
  fr: {
    bg: '#f9f6f0',
    ink: '#1a1a2e',
    inkMuted: '#6c6c87',
    accent: '#0f3057',
    accentInk: '#f9f6f0',
    photoBg: '#e8e3d7',
  },
  // IT — Tuscan villa: warm beige + terracotta accent + brownish ink
  it: {
    bg: '#f5ede0',
    ink: '#3d2c1e',
    inkMuted: '#8b7a5e',
    accent: '#c64f2a',
    accentInk: '#ffffff',
    photoBg: '#e8dcc6',
  },
};

export function getMarketStyle(market: Market): MarketStyle {
  return STYLES[market];
}

export function getStyleForLocale(locale: Locale): MarketStyle {
  return STYLES[localeToMarket(locale)];
}
