import { type NextRequest } from 'next/server';
import { verifyEmailSignature } from '@/lib/email/unsubscribe';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * GET /api/email/unsubscribe?email=&sig=
 *
 * HMAC-verifies the signed email + records an entry in
 * email_unsubscribes (PK = email; idempotent). Returns a styled
 * HTML confirmation page. Account-less — anyone with the link can
 * unsubscribe themselves; no one can forge a link to unsubscribe
 * someone else because the HMAC key is server-only.
 *
 * Also pushes the address to Brevo's blocklist (best-effort; failure
 * doesn't block the local write since our own table is the source
 * of truth on every send).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const email = url.searchParams.get('email')?.trim().toLowerCase() ?? '';
  const sig = url.searchParams.get('sig')?.trim() ?? '';

  if (!email || !sig) {
    return htmlResponse(errorPage('Invalid unsubscribe link'), 400);
  }

  const ok = await verifyEmailSignature({ email, signature: sig });
  if (!ok) {
    return htmlResponse(errorPage('Invalid unsubscribe link'), 401);
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('email_unsubscribes')
    .upsert(
      { email, source: 'link' },
      { onConflict: 'email', ignoreDuplicates: true },
    );

  if (error) {
    return htmlResponse(errorPage('Something went wrong. Try again later.'), 500);
  }

  // Best-effort Brevo blocklist push. Don't await response status —
  // local write is authoritative.
  await pushBrevoBlocklist(email).catch(() => {
    /* swallow — local write is source of truth */
  });

  return htmlResponse(successPage(email), 200);
}

async function pushBrevoBlocklist(email: string): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  if (!key) return;
  await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      emailBlacklisted: true,
      smsBlacklisted: false,
      updateEnabled: true,
    }),
  }).catch(() => undefined);
}

function htmlResponse(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function successPage(email: string): string {
  return shell(
    'Unsubscribed',
    `<h1 style="font-size:28px;margin:0 0 16px 0;">You're unsubscribed</h1>
     <p style="margin:0 0 12px 0;color:#374151;">We removed <strong>${escapeHtml(email)}</strong> from AHO marketing emails.</p>
     <p style="margin:0 0 24px 0;color:#6b7280;font-size:14px;">This won't affect transactional emails (welcome messages, lead notifications, billing) — those continue to ensure the service works for you.</p>
     <p style="margin:0;"><a href="https://advertisehomes.online" style="color:#000;font-weight:600;text-decoration:none;">← Back to AHO</a></p>`,
  );
}

function errorPage(message: string): string {
  return shell(
    'Unsubscribe failed',
    `<h1 style="font-size:24px;margin:0 0 16px 0;">Unsubscribe failed</h1>
     <p style="margin:0 0 16px 0;color:#374151;">${escapeHtml(message)}</p>
     <p style="margin:0;color:#6b7280;font-size:14px;">If you need help, reply to any AHO email or contact <a href="mailto:info@advertisehomes.online" style="color:#000;">info@advertisehomes.online</a>.</p>`,
  );
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title} · AHO</title>
<meta name="robots" content="noindex" />
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafaf9;color:#111827;">
<main style="max-width:560px;margin:64px auto;padding:32px 24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;">
${body}
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
