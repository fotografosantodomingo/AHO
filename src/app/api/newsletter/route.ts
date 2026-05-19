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

/** Allowed `source` values that the route accepts. Adding a new
 *  source means picking a stable string here so admins can filter
 *  Brevo contacts by signup origin without hunting through ad-hoc
 *  free-form text. Stored as a Brevo contact attribute `SOURCE`. */
const KNOWN_SOURCES = ['footer', 'chat-widget', 'lead-form'] as const;

const BodySchema = z.object({
  email: z.string().trim().email().max(254),
  /** Display name. Optional for the footer form (legacy) but required
   *  by the chat-widget gate. Trimmed + clamped to 120 chars (typical
   *  full-name length cap on Brevo + most CRMs). Stored as
   *  `attributes.FIRSTNAME` on Brevo (full name in one field is the
   *  Brevo norm when only one field is captured). */
  name: z.string().trim().min(1).max(120).optional(),
  locale: z.enum(LOCALES).optional(),
  /** Where the signup came from. Stored as the `SOURCE` Brevo
   *  attribute so admins can filter campaigns by signup origin. */
  source: z.enum(KNOWN_SOURCES).optional(),
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
  const { email, locale, name, source } = parsed.data;

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

  // Build the Brevo attributes payload. FIRSTNAME is the conventional
  // single-field display name on Brevo when only one name is captured.
  // CONSENT_TS is an ISO timestamp recording when the user accepted
  // the terms — needed for GDPR audit trails (the chat-widget gate is
  // the consent surface; the footer form is more permissive but still
  // benefits from a timestamp). SOURCE differentiates chat-widget
  // signups from footer signups when admins build campaign segments.
  const attributes: Record<string, string> = {};
  if (locale) attributes.LOCALE = locale.toUpperCase();
  if (name) attributes.FIRSTNAME = name;
  if (source) attributes.SOURCE = source;
  attributes.CONSENT_TS = new Date().toISOString();

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
        attributes,
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
