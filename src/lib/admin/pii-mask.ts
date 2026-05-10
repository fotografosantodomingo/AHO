/**
 * Pure helpers for masking lead PII on the admin surfaces (QA report
 * 2026-05-10 P1 #21). The admin/leads page renders cross-org leads, and
 * the original implementation dumped email + phone in plain text to
 * every admin. Combined with the "every admin reads everything" model,
 * that made /admin/leads a juicy target for an admin-account compromise.
 *
 * Strategy:
 *   - Mask by default at render time (these helpers).
 *   - Click-to-reveal calls /api/admin/leads/[id]/reveal which writes an
 *     audit_log row with the actor id + the field revealed, then returns
 *     the unmasked value.
 *
 * The masks are deliberately recognizable as masks (centred dots) and
 * preserve enough structure for the admin to distinguish two different
 * emails/phones at a glance without seeing the full string.
 *
 * Pure / no-deps so the same functions are usable on client + server +
 * tests.
 */

/**
 * Mask an email address: keep the first character of the local part +
 * the full domain. `foobar@example.com` → `f•••••@example.com`.
 *
 * Edge cases:
 *   - Empty / whitespace → empty string.
 *   - Missing `@` → mask the whole string with the same shape, treat
 *     it as an opaque identifier (still don't leak it raw).
 *   - Local part of length 1 → still shown but flagged with one dot
 *     so admins can distinguish "a@x.com" from "a••@x.com".
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const trimmed = email.trim();
  if (trimmed.length === 0) return '';
  const at = trimmed.indexOf('@');
  if (at <= 0) {
    // No `@`, or `@foo` with empty local. Hide all but first char.
    return trimmed[0] + '•'.repeat(Math.max(2, trimmed.length - 1));
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  // Keep first char of local; replace rest with bullet repeated to the
  // length of the original local minus 1 (capped at 6 to avoid massive
  // bullet runs that obscure layout).
  const bulletCount = Math.max(2, Math.min(6, local.length - 1));
  return local[0] + '•'.repeat(bulletCount) + domain;
}

/**
 * Mask a phone number: keep the leading `+CC` prefix (or first 2-3
 * digits if no `+`) and the trailing 4 digits. `+1 (202) 555 0123` →
 * `+1•••••0123`.
 *
 * Edge cases:
 *   - Empty / whitespace → empty string.
 *   - Fewer than 6 digits → mask the whole thing.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (trimmed.length === 0) return '';

  // Extract digits only for the tail-4 calculation, but keep the
  // original `+` to convey the country-code shape.
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6) {
    return '•'.repeat(Math.max(2, trimmed.length));
  }

  const startsWithPlus = trimmed.startsWith('+');
  // Keep the country-code prefix: `+` + first 1-3 digits if `+`,
  // or first 2 digits otherwise.
  const prefixDigits = startsWithPlus ? Math.min(3, digits.length - 4) : 2;
  const prefix = (startsWithPlus ? '+' : '') + digits.slice(0, prefixDigits);
  const tail = digits.slice(-4);
  return `${prefix}${'•'.repeat(4)}${tail}`;
}
