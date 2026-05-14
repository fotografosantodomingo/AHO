import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findSegment, resolveSegment } from '@/lib/email/segments';
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribe';
import { FACEBOOK_URL, INSTAGRAM_URL } from '@/lib/social-urls';
import { serverEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * POST /api/email/send — admin-gated campaign send.
 *
 * Body:
 *   { campaignId: uuid }
 *
 * Flow:
 *   1. Verify caller is platform admin (RLS + explicit check).
 *   2. Load campaign + flip status → 'sending'.
 *   3. Resolve segment → recipient list (service-role RPC).
 *   4. Filter out unsubscribed addresses (defense in depth; the RPC
 *      already filters but a separate check catches races).
 *   5. Insert email_messages(status='queued') rows up-front so the
 *      log surface is populated even if Brevo fails partway.
 *   6. For each recipient: POST /v3/smtp/email with personalized
 *      unsubscribe link appended to the HTML. Concurrency 5.
 *   7. Update each email_messages row with brevo_message_id +
 *      sent timestamp or error_message. Bump campaign counters.
 *   8. Flip campaign.status → 'sent' (or 'failed' if all failed).
 *
 * Returns: { ok, recipientCount, sentCount, failedCount }
 *
 * Sync send caps out around 500 recipients before the route hits
 * Edge time limits. Above that, refactor to enqueue → Cloudflare
 * Queue → batch worker (out of scope for v1).
 */

const BodySchema = z.object({
  campaignId: z.string().uuid(),
});

interface BrevoSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const CONCURRENCY = 5;

export async function POST(req: NextRequest) {
  const env = serverEnv();
  if (!env.BREVO_API_KEY) {
    return NextResponse.json({ error: 'brevo_not_configured' }, { status: 503 });
  }

  // --- Auth: must be platform admin --------------------------------
  const userClient = await createServerSupabaseClient();
  const { data: userRes } = await userClient.auth.getUser();
  const user = userRes.user;
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data: profile, error: profErr } = await userClient
    .from('profiles')
    .select('id, is_admin, email')
    .eq('id', user.id)
    .single();
  if (profErr || !profile?.is_admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // --- Body --------------------------------------------------------
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // --- Load campaign + flip to 'sending' ---------------------------
  const admin = createAdminClient();
  const { data: campaign, error: cErr } = await admin
    .from('email_campaigns')
    .select('*')
    .eq('id', body.campaignId)
    .single();
  if (cErr || !campaign) {
    return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  }
  if (campaign.status !== 'draft') {
    return NextResponse.json(
      { error: 'campaign_not_draft', currentStatus: campaign.status },
      { status: 409 },
    );
  }
  if (!findSegment(campaign.segment_key)) {
    return NextResponse.json(
      { error: 'invalid_segment_key', segmentKey: campaign.segment_key },
      { status: 400 },
    );
  }

  await admin
    .from('email_campaigns')
    .update({ status: 'sending' })
    .eq('id', campaign.id);

  // --- Resolve recipients ------------------------------------------
  let recipients: Array<{ email: string; user_id: string | null; full_name: string | null }>;
  try {
    recipients = await resolveSegment({
      supabase: admin as unknown as Parameters<typeof resolveSegment>[0]['supabase'],
      segmentKey: campaign.segment_key,
      adminId: user.id,
    });
  } catch (e) {
    await admin
      .from('email_campaigns')
      .update({ status: 'failed' })
      .eq('id', campaign.id);
    return NextResponse.json(
      { error: 'segment_resolve_failed', message: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }

  // Defense-in-depth filter against unsubscribes (the RPC filters too,
  // but a second pass guards against race conditions where someone
  // unsubscribes between RPC return and Brevo POST).
  const unsubRows = await admin.from('email_unsubscribes').select('email');
  const unsubSet = new Set(
    (unsubRows.data ?? []).map((r) => (r.email as string).toLowerCase()),
  );
  recipients = recipients.filter((r) => !unsubSet.has(r.email.toLowerCase()));

  if (recipients.length === 0) {
    await admin
      .from('email_campaigns')
      .update({ status: 'sent', recipient_count: 0, sent_at: new Date().toISOString() })
      .eq('id', campaign.id);
    return NextResponse.json({ ok: true, recipientCount: 0, sentCount: 0, failedCount: 0 });
  }

  // --- Insert email_messages rows up-front -------------------------
  const insertRows = recipients.map((r) => ({
    campaign_id: campaign.id,
    email: r.email,
    user_id: r.user_id,
    status: 'queued' as const,
  }));
  // upsert in case the same campaign was retried after a partial send.
  await admin
    .from('email_messages')
    .upsert(insertRows, { onConflict: 'campaign_id,email', ignoreDuplicates: true });

  // --- Send via Brevo, concurrency-limited -------------------------
  let sentCount = 0;
  let failedCount = 0;
  const queue = [...recipients];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const r = queue.shift();
      if (!r) break;
      const result = await sendOne({
        apiKey: env.BREVO_API_KEY!,
        fromEmail: env.BREVO_FROM_EMAIL ?? 'info@advertisehomes.online',
        fromName: env.BREVO_FROM_NAME ?? 'AHO',
        toEmail: r.email,
        toName: r.full_name ?? undefined,
        subject: campaign.subject,
        html: appendUnsubscribeFooter(campaign.html_body, r.email),
        text: campaign.text_body ?? undefined,
      });
      if (result.ok) {
        sentCount += 1;
        await admin
          .from('email_messages')
          .update({
            status: 'sent',
            brevo_message_id: result.messageId,
            sent_at: new Date().toISOString(),
          })
          .eq('campaign_id', campaign.id)
          .eq('email', r.email);
      } else {
        failedCount += 1;
        await admin
          .from('email_messages')
          .update({ status: 'failed', error_message: result.error ?? 'unknown' })
          .eq('campaign_id', campaign.id)
          .eq('email', r.email);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // --- Update campaign counters + status ---------------------------
  await admin
    .from('email_campaigns')
    .update({
      status: failedCount > 0 && sentCount === 0 ? 'failed' : 'sent',
      recipient_count: recipients.length,
      sent_at: new Date().toISOString(),
    })
    .eq('id', campaign.id);

  return NextResponse.json({
    ok: true,
    recipientCount: recipients.length,
    sentCount,
    failedCount,
  });
}

async function sendOne(args: {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<BrevoSendResult> {
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': args.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: args.fromEmail, name: args.fromName },
        to: [{ email: args.toEmail, name: args.toName }],
        subject: args.subject,
        htmlContent: args.html,
        textContent: args.text,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `brevo ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { messageId?: string };
    return { ok: true, messageId: data.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

/**
 * Append a per-recipient unsubscribe footer to the HTML body. The
 * footer matches the chrome of /src/lib/email/templates/_layout.ts
 * — small text, helper color, clickable link.
 */
function appendUnsubscribeFooter(html: string, email: string): string {
  const url = buildUnsubscribeUrl(email);
  const footer = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;color:#6b7280;text-align:center;">
  <p style="margin:0 0 12px 0;">
    <a href="${FACEBOOK_URL}" style="color:#6b7280;text-decoration:underline;margin-right:12px;">Facebook</a>
    <a href="${INSTAGRAM_URL}" style="color:#6b7280;text-decoration:underline;">Instagram</a>
  </p>
  <p style="margin:0 0 8px 0;">You're receiving this because you opted in to AHO marketing emails.</p>
  <p style="margin:0;"><a href="${url}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> · <a href="https://advertisehomes.online" style="color:#6b7280;text-decoration:underline;">advertisehomes.online</a></p>
</div>
`;
  return html.includes('</body>')
    ? html.replace('</body>', footer + '</body>')
    : html + footer;
}
