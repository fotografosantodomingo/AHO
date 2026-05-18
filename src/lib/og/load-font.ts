import { publicEnv } from '@/lib/env';

/**
 * Fetches the Inter Bold (700) **TTF** from /public/fonts/ at OG-render
 * time and returns it as ArrayBuffer ready to hand to Satori (the engine
 * behind `next/og`'s ImageResponse).
 *
 * **Format: must be TTF or OTF, NOT woff/woff2.** Satori uses
 * opentype.js to parse fonts and rejects woff2 with
 * `Error: Unsupported OpenType signature wOF2` because woff2 requires
 * brotli decompression that isn't bundled in the wasm. Before
 * 2026-05-17 we shipped `/fonts/inter-700.woff2` and every
 * ImageResponse route returned HTTP 200 + 0 bytes — the satori parser
 * threw, the exception bubbled out of the response stream, and the
 * worker returned an empty body. Surfaced via `wrangler pages
 * deployment tail` after two failed mitigation attempts
 * (devIndicators revert + fonts/ middleware exclusion). The TTF is
 * ~3× the file size of woff2 (~415 KB vs ~115 KB) but it's CDN-cached
 * forever after the first request and only fetched server-side, so
 * end-user payload is unaffected.
 *
 * Why fetch + same-origin instead of inline import:
 *   - `import 'inter-700.ttf'` in the Edge runtime relies on bundler
 *     binary-import support that Next 15 + Wrangler treat inconsistently.
 *     A runtime fetch from `/fonts/inter-700.ttf` always works because
 *     it goes through the same static-asset path as our images.
 *   - Cloudflare Pages caches the ttf with the same long-TTL header it
 *     uses for hashed `_next/static/*` assets, so the fetch becomes a
 *     CDN hit on the second OG render (and is essentially free thereafter).
 *
 * Why Inter Bold only (not full family):
 *   - Every OG image we render uses bold display text only. Body copy is
 *     short and renders fine in the system stack. Loading more weights
 *     would inflate the OG render budget without visible benefit.
 *
 * Failure mode:
 *   - If the fetch fails for any reason (asset missing, slow edge), the
 *     caller receives `null` and falls back to the system sans stack.
 *     Better to render an OK preview than to fail the OG-image route.
 */

let cached: ArrayBuffer | null | undefined;

export async function loadInterBold(): Promise<ArrayBuffer | null> {
  if (cached !== undefined) return cached;
  try {
    const origin = publicEnv().NEXT_PUBLIC_SITE_URL;
    const res = await fetch(`${origin.replace(/\/$/, '')}/fonts/inter-700.ttf`);
    if (!res.ok) {
      cached = null;
      return null;
    }
    const buf = await res.arrayBuffer();
    cached = buf;
    return buf;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Sugar for the common `fonts: [{ name: 'Inter', data, weight: 700 }]`
 * shape ImageResponse expects, with a graceful no-op when the font isn't
 * reachable (returns an empty array; ImageResponse falls back to system).
 */
export async function interBoldFontEntry(): Promise<
  Array<{ name: string; data: ArrayBuffer; weight: 700; style: 'normal' }>
> {
  const data = await loadInterBold();
  if (!data) return [];
  return [{ name: 'Inter', data, weight: 700, style: 'normal' }];
}
