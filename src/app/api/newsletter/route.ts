import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { LOCALES } from '@/i18n/config';

export const runtime = 'edge';

/**
 * POST /api/newsletter
 *
 * Adds an email to AHO's Brevo contact list. Anon-callable; rate-limited
 * implicitly by the Brevo API + email-uniqueness on Brevo's side
 * (re-subscribing the same email is a no-op for them).
 *
 * Two-state graceful degradation:
 *   - `BREVO_API_KEY` and `BREVO_NEWSLETTER_LIST_ID` both set → real
 *     subscription via the Brevo Contacts API. Returns { ok: true }.
 *   - Either env var missing → server logs a warning and returns
 *     { ok: true } anyway, so the UI can show a friendly success message
 *     without lying to the user (they DID submit a valid email; we just
 *     haven't wired the storage yet). The PO action to wire is documented
 *     in DECISIONS.md.
 *
 * Validation: HTML5 email shape via Zod. The Brevo API does its own
 * stricter check; on 400 we surface a generic error.
 *
 * Locale tracking: the body optionally takes `locale` so we can later
 * segment EN vs ES newsletter blasts. Stored as a Brevo contact attribute.
 */

const BodySchema = z.object({
  email: z.string().trim().email().max(254),
  locale: z.enum(LOCALES).optional(),
});

const BREVO_CONTACTS_URL = 'https://api.brevo.com/v3/contacts';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_email' }, { status: 400 });
  }
  const { email, locale } = parsed.data;

  const apiKey = process.env.BREVO_API_KEY;
  const listId = process.env.BREVO_NEWSLETTER_LIST_ID;
  if (!apiKey || !listId) {
    console.warn(
      '[newsletter] BREVO_API_KEY or BREVO_NEWSLETTER_LIST_ID not set; skipping. ' +
        `email=${email}`,
    );
    // Treat as ok from the user's perspective — they submitted a valid
    // email; the gap is in our config, not theirs.
    return NextResponse.json({ ok: true, stored: false });
  }

  try {
    const res = await fetch(BREVO_CONTACTS_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        email,
        listIds: [Number(listId)],
        attributes: locale ? { LOCALE: locale.toUpperCase() } : undefined,
        updateEnabled: true, // re-subscribe is idempotent
      }),
    });
    if (!res.ok && res.status !== 204) {
      // Brevo returns 400 with `code: "duplicate_parameter"` when the
      // contact already exists in the list with the same attributes.
      // That's a no-op success from the user's perspective.
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
      };
      if (data.code === 'duplicate_parameter') {
        return NextResponse.json({ ok: true, stored: true, dedupe: true });
      }
      console.error('[newsletter] brevo failed', { status: res.status, ...data });
      return NextResponse.json(
        { ok: false, errorCode: 'storage_failed' },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, stored: true });
  } catch (e) {
    console.error('[newsletter] threw', e);
    return NextResponse.json(
      { ok: false, errorCode: 'storage_failed' },
      { status: 502 },
    );
  }
}
