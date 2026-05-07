/**
 * One-shot: ensure every Cloudflare Images variant the AHO codebase
 * references actually exists on the account. Run once after activating
 * Cloudflare Images on the account, plus any time you add a new
 * variant name to the codebase.
 *
 * Idempotent: GETs the variant first, only POSTs the create when
 * missing. Re-running is safe.
 *
 * Variants:
 *   - `public`    — primary listing-page hero (1366×768, scale-down).
 *   - `card`      — listing card thumbnail (600×400 cover).
 *   - `thumbnail` — small avatar / chip (200×200 cover).
 *   - `og`        — Open Graph social card (1200×630 cover).
 *   - `full`      — JSON-LD `image` URLs (1920×1920, scale-down — no upscale).
 *   - `fb_feed`   — Facebook ad feed (1200×630 cover).
 *   - `ig_square` — Instagram feed square (1080×1080 cover).
 *   - `ig_reel`   — Instagram Reels / Stories (1080×1920 cover).
 *
 * `AHO` (1366×768 scale-down) was created manually by the PO via the
 * dashboard; this script doesn't touch it. The codebase doesn't
 * reference it directly — `public` covers the same use case with the
 * canonical name.
 *
 * Usage:
 *   set -a && source .env.local && set +a && pnpm tsx scripts/setup-cf-images-variants.ts
 *
 * Env required:
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - CLOUDFLARE_API_TOKEN — must include `Cloudflare Images: Edit` scope.
 */
export {}; // Mark as a module so the top-level `main` doesn't collide with other scripts.

interface VariantConfig {
  id: string;
  width: number;
  height: number;
  fit: 'scale-down' | 'cover' | 'contain' | 'crop' | 'pad';
  metadata: 'keep' | 'copyright' | 'none';
  /** When true, public access is always allowed regardless of image-level
   *  signed-URL setting. We use this for every AHO variant — we don't
   *  serve private images. */
  neverRequireSignedURLs: boolean;
}

const VARIANTS: VariantConfig[] = [
  { id: 'public', width: 1366, height: 768, fit: 'scale-down', metadata: 'none', neverRequireSignedURLs: true },
  { id: 'card', width: 600, height: 400, fit: 'cover', metadata: 'none', neverRequireSignedURLs: true },
  { id: 'thumbnail', width: 200, height: 200, fit: 'cover', metadata: 'none', neverRequireSignedURLs: true },
  { id: 'og', width: 1200, height: 630, fit: 'cover', metadata: 'none', neverRequireSignedURLs: true },
  { id: 'full', width: 1920, height: 1920, fit: 'scale-down', metadata: 'none', neverRequireSignedURLs: true },
  // CF Images rejects both `_` and `-` in variant ids — only alphanumeric.
  { id: 'fbfeed', width: 1200, height: 630, fit: 'cover', metadata: 'none', neverRequireSignedURLs: true },
  { id: 'igsquare', width: 1080, height: 1080, fit: 'cover', metadata: 'none', neverRequireSignedURLs: true },
  { id: 'igreel', width: 1080, height: 1920, fit: 'cover', metadata: 'none', neverRequireSignedURLs: true },
];

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set.');
  process.exit(1);
}

const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1/variants`;

async function variantExists(id: string): Promise<boolean> {
  const res = await fetch(`${BASE}/${id}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET variant ${id} failed: ${res.status} ${text}`);
  }
  return true;
}

async function createVariant(v: VariantConfig): Promise<void> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: v.id,
      options: {
        width: v.width,
        height: v.height,
        fit: v.fit,
        metadata: v.metadata,
      },
      neverRequireSignedURLs: v.neverRequireSignedURLs,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST variant ${v.id} failed: ${res.status} ${text}`);
  }
}

async function main(): Promise<void> {
  let created = 0;
  let skipped = 0;
  for (const v of VARIANTS) {
    const exists = await variantExists(v.id);
    if (exists) {
      console.log(`✓ ${v.id} (${v.width}x${v.height} ${v.fit}) — exists, skipping`);
      skipped++;
      continue;
    }
    await createVariant(v);
    console.log(`+ ${v.id} (${v.width}x${v.height} ${v.fit}) — created`);
    created++;
  }
  console.log(`\nDone. ${created} created, ${skipped} already existed.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
