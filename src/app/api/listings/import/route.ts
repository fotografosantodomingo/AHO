import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { importFromUrl } from '@/lib/listings/import-from-url';

export const runtime = 'edge';

/**
 * POST /api/listings/import
 *
 * URL-import lever (Day 5 of the Content Hub roadmap). Pass any
 * listing's URL on a competing portal (otodom, idealista, Zillow,
 * rightmove, immobilienscout24, …) or a previous-AHO listing —
 * server fetches the page, sends the condensed text to Claude, and
 * returns the property's facts as a JSON object the new-listing
 * form can use to pre-populate every field.
 *
 * Auth: signed-in user. No plan gate — this is an acquisition feature
 * (lower-tier agents migrating from another portal benefit too).
 *
 * Cost: ~$0.05-0.10 per import. Bounded by the condense-then-prompt
 * pipeline in lib/listings/import-from-url.ts (input ~25K tokens cap).
 *
 * Failure modes (each returns a structured 4xx with `errorCode`):
 *   - `invalid_url` — malformed or non-http(s)
 *   - `internal_url` — points to localhost / private IP
 *   - `source_blocks_scraping` — AWS WAF / Cloudflare / Akamai / DataDome
 *     served a bot-challenge instead of the real listing. Common on
 *     Zillow, Redfin, Realtor.com. Sprint-2 fix: residential IP proxy.
 *   - `fetch_failed` — source returned 4xx/5xx (other than challenges),
 *     timed out, or oversized
 *   - `extract_failed` — Claude returned non-JSON / unparseable
 */

const RequestSchema = z.object({
  url: z.string().trim().url().max(2000),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  try {
    const facts = await importFromUrl({ url: parsed.data.url });
    return NextResponse.json({ facts }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[listings/import]', message);
    let errorCode = 'extract_failed';
    if (/invalid url/i.test(message)) errorCode = 'invalid_url';
    else if (/internal address/i.test(message)) errorCode = 'internal_url';
    else if (/source blocks scraping/i.test(message)) errorCode = 'source_blocks_scraping';
    else if (/source page too large|HTTP 4|HTTP 5|timed out|aborted|fetch failed/i.test(message))
      errorCode = 'fetch_failed';
    return NextResponse.json(
      { error: errorCode, message },
      { status: errorCode === 'extract_failed' ? 502 : 400 },
    );
  }
}
