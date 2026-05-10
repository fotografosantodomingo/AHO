import { describe, expect, it, beforeAll } from 'vitest';
import { LOCALES } from '@/i18n/config';

/**
 * Regression test for QA-2026-05-10 P0 #5.
 *
 * `src/app/robots.ts` previously hardcoded only `/en/search`, `/es/buscar`,
 * `/en/admin/`, and `/es/admin/`. The other five marketing locales
 * (PL/PT/DE/FR/IT) were left crawlable, opening an infinite-crawl loop on
 * `/{pl,pt,de,fr,it}/search` (per HANDOFF.md §16.7) and exposing the
 * `/admin/` URLs in SERPs.
 *
 * This test loads the metadata-route helper and asserts every locale gets
 * a Disallow rule for both the search and admin subtrees.
 */

beforeAll(() => {
  // robots.ts depends on `publicEnv()` to resolve `NEXT_PUBLIC_SITE_URL`.
  // Use the same env-var the deployed Worker uses; the value just has to
  // be a valid URL — robots.ts only interpolates it into the sitemap line.
  process.env.NEXT_PUBLIC_SITE_URL = 'https://aho-web.pages.dev';
});

function collectDisallow(out: { rules: unknown }): string[] {
  const rule = out.rules as
    | { disallow?: string | string[] }
    | Array<{ disallow?: string | string[] }>;
  const rules = Array.isArray(rule) ? rule : [rule];
  return rules.flatMap((r) =>
    Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
  );
}

describe('robots.ts — locale coverage', () => {
  it('emits Disallow for /{locale}/{search-segment} for every locale', async () => {
    const { default: robots } = await import('@/app/robots');
    const disallow = collectDisallow(robots());

    // ES alone uses /buscar; every other locale uses /search. Confirm
    // both translation variants made it in.
    expect(disallow).toContain('/es/buscar');
    for (const locale of LOCALES) {
      if (locale === 'es') continue;
      expect(disallow).toContain(`/${locale}/search`);
    }
  });

  it('emits Disallow for /{locale}/admin/ for every locale', async () => {
    const { default: robots } = await import('@/app/robots');
    const disallow = collectDisallow(robots());

    for (const locale of LOCALES) {
      expect(disallow).toContain(`/${locale}/admin/`);
    }
  });
});
