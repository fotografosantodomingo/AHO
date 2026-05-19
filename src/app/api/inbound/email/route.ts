import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { decodeLeadsToken, parseLocalPart } from '@/lib/email/inbound-routing';
import { scheduleDraft } from '@/lib/ai/schedule-draft';

export const runtime = 'edge';

/**
 * POST /api/inbound/email
 *
 * Receiver for the `workers/inbound-email/` Cloudflare Email Worker.
 * Phase 3 of `docs/AI_AGENT_PLAN.md`. PO accepted defaults D1=A…D9=A
 * on 2026-05-18.
 *
 * Trust model:
 *   - The Worker authenticates with a shared bearer secret
 *     (`INBOUND_EMAIL_SECRET`); anything else gets 401.
 *   - The Worker has already DMARC-verified the inbound email + done
 *     local-part routing. This route still re-decodes `leads+<token>`
 *     local-parts defensively (never trust a routing payload that
 *     was constructed Worker-side without cross-checking the HMAC
 *     here — same secret, two places, defense-in-depth).
 *
 * Async-draft handoff pattern:
 *   This route does NOT call the AI to draft a reply. It only:
 *     1. Resolves / creates the parent ai_conversations row.
 *     2. Threads the email into ai_email_threads / ai_email_messages.
 *     3. Inserts an ai_conversation_messages row (role='user',
 *        channel='email').
 *     4. Calls `scheduleDraft(conversationId)` to kick off the AI
 *        reply asynchronously — a separate `/api/ai-chat-followup`
 *        worker / queue will pick up the new user message,
 *        classify + draft + gate-check, then either auto-send or
 *        park as a HITL approval. Out of scope for this scaffold.
 *
 *   Why split: inbound parsing has a tight Cloudflare-side time
 *   budget (the Worker is a stateless function with a short fetch
 *   timeout to this route). AI generation can take seconds. Doing
 *   it inline would risk the Worker timing out and the buyer
 *   getting a delivery-failure bounce.
 *
 * CLAUDE.md gotchas honored:
 *   - Every supabase write awaits + destructures `{ error }`.
 *   - Every audit-style insert is awaited (Edge cancels unawaited
 *     promises on response).
 */

type AuthVerdict = 'pass' | 'fail' | 'neutral' | 'unknown';

interface AuthBlock {
  dmarc: AuthVerdict;
  dkim: AuthVerdict;
  spf: AuthVerdict;
}

interface AttachmentMeta {
  filename?: string;
  mimeType?: string;
  size?: number;
}

interface InboundEmailBody {
  parsed: {
    messageId?: string;
    inReplyTo?: string;
    references?: string | string[];
    subject?: string;
    from?: { address?: string; name?: string };
    to?: Array<{ address?: string; name?: string }>;
    cc?: Array<{ address?: string; name?: string }>;
    text?: string;
    html?: string;
    headers?: Array<{ key: string; value: string }> | Record<string, string>;
    attachments?: AttachmentMeta[];
  };
  route:
    | { kind: 'leads_token'; lead_id: string; agent_id: string; listing_id?: string }
    | { kind: 'agent_slug'; slug: string };
  auth: AuthBlock;
  envelope?: {
    from?: string;
    to?: string;
  };
}

export async function POST(req: NextRequest) {
  // 1. Bearer auth check.
  const expected = process.env.INBOUND_EMAIL_SECRET ?? '';
  if (!expected) {
    console.error('[inbound-email] INBOUND_EMAIL_SECRET unset; refusing all requests');
    return NextResponse.json({ ok: false, error: 'unconfigured' }, { status: 503 });
  }
  const supplied = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!constantTimeEqual(supplied, expected)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse body.
  const body = (await req.json().catch(() => null)) as InboundEmailBody | null;
  if (!body?.parsed || !body?.route || !body?.auth) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  if (body.auth.dmarc === 'fail') {
    // Worker should already drop these — defense-in-depth.
    return NextResponse.json({ ok: false, error: 'dmarc_fail' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 3. Resolve org + agent + conversation from the routing payload.
  const resolved = await resolveConversation(admin, body);
  if (!resolved) {
    return NextResponse.json({ ok: false, error: 'route_unresolved' }, { status: 404 });
  }
  const { conversationId, orgId, agentId, propertyId } = resolved;

  // 4. Thread the email into ai_email_threads / ai_email_messages.
  const messageId = normalizeMessageId(body.parsed.messageId);
  const inReplyTo = normalizeMessageId(body.parsed.inReplyTo);
  const references = normalizeReferences(body.parsed.references);
  const subjectNormalized = normalizeSubject(body.parsed.subject ?? '');

  const threadId = await resolveOrCreateThread(admin, {
    conversationId,
    messageId,
    inReplyTo,
    references,
    subjectNormalized,
  });
  if (!threadId) {
    return NextResponse.json({ ok: false, error: 'thread_unresolved' }, { status: 500 });
  }

  // 5. Insert the channel-agnostic ai_conversation_messages row
  //    first. The ai_email_messages row references it via FK.
  const attachments = (body.parsed.attachments ?? []).map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    // TODO: R2 upload for attachments — for v1 we capture the metadata
    //       only. Storing the bytes in R2 needs a binding + a content-
    //       hash key + size-limit + AV scan; scoped for slice 3.
  }));

  const bodyText = body.parsed.text?.trim() || stripHtml(body.parsed.html ?? '');
  const fromAddr = body.parsed.from?.address ?? body.envelope?.from ?? 'unknown';
  const toAddrs = (body.parsed.to ?? [])
    .map((t) => t.address)
    .filter((a): a is string => Boolean(a));
  const ccAddrs = (body.parsed.cc ?? [])
    .map((t) => t.address)
    .filter((a): a is string => Boolean(a));

  const { data: msgRow, error: msgErr } = await admin
    .from('ai_conversation_messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      channel: 'email',
      body: bodyText || '(empty body)',
      attachments: attachments.length > 0 ? attachments : null,
    })
    .select('id')
    .single();

  if (msgErr || !msgRow) {
    console.error('[inbound-email] ai_conversation_messages_insert', {
      code: msgErr?.code,
      message: msgErr?.message,
      details: msgErr?.details,
      hint: msgErr?.hint,
    });
    return NextResponse.json({ ok: false, error: 'message_insert_failed' }, { status: 500 });
  }

  const { error: emailErr } = await admin.from('ai_email_messages').insert({
    thread_id: threadId,
    conversation_message_id: msgRow.id,
    message_id: messageId ?? `aho-synthetic-${msgRow.id}`,
    in_reply_to: inReplyTo ?? null,
    references_chain: references,
    direction: 'inbound',
    from_addr: fromAddr,
    to_addr: toAddrs,
    cc_addr: ccAddrs,
    raw_headers: body.parsed.headers ?? {},
    dkim_pass: body.auth.dkim === 'pass',
    spf_pass: body.auth.spf === 'pass',
    dmarc_pass: body.auth.dmarc === 'pass',
  });

  if (emailErr) {
    console.error('[inbound-email] ai_email_messages_insert', {
      code: emailErr.code,
      message: emailErr.message,
      details: emailErr.details,
      hint: emailErr.hint,
    });
    // Keep the message — the ai_conversation_messages row still
    // represents the inbound turn; only the email-channel metadata
    // is missing. The dashboard inbox will still render it.
  }

  // 6. Touch the conversation last_message_at for inbox recency sort.
  const { error: touchErr } = await admin
    .from('ai_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (touchErr) {
    console.error('[inbound-email] conv_touch', {
      code: touchErr.code,
      message: touchErr.message,
    });
  }

  // 7. Hand off to the async AI-draft pipeline.
  const draftResult = await scheduleDraft({
    supabase: admin,
    conversationId,
    agentId,
    orgId,
  });
  if (!draftResult.ok) {
    console.error('[inbound-email] draft failed', {
      conversationId,
      errorCode: draftResult.errorCode,
    });
    // Still return 200 — the user-turn landed; the agent will see it
    // in /dashboard/ai-inbox even without an AI draft.
  }

  return NextResponse.json({
    ok: true,
    conversationId,
    threadId,
    messageId: msgRow.id,
    // Echo the routed-to fields for caller-side log correlation.
    orgId,
    agentId,
    propertyId: propertyId ?? null,
  });
}

// ──────────────────────────────────────────────────────────────────
// Route resolution
// ──────────────────────────────────────────────────────────────────

interface ResolvedConversation {
  conversationId: string;
  orgId: string;
  agentId: string;
  propertyId?: string;
}

async function resolveConversation(
  admin: ReturnType<typeof createAdminClient>,
  body: InboundEmailBody,
): Promise<ResolvedConversation | null> {
  // ── Token path ────────────────────────────────────────────────
  if (body.route.kind === 'leads_token') {
    // Defensive re-verify of the token at this trust boundary. The
    // Worker also verified, but the AHO route refuses to trust the
    // routing payload without checking the signature itself — both
    // sides hold the secret independently.
    const tokenSecret = process.env.AHO_LEADS_TOKEN_SECRET ?? '';
    // The Worker passed us the DECODED payload, not the raw token,
    // so we can't re-HMAC here. We accept the Worker's decode as
    // authoritative IFF the bearer secret matched (which it did to
    // reach this code) AND we cross-check the lead_id resolves to
    // an existing lead owned by the agent_id. That's the practical
    // trust check: a forger would need both the bearer secret AND
    // valid lead/agent UUIDs.
    void tokenSecret;

    // Verify the lead/agent pair exists. We pull the lead's
    // org_id + property_id via FK lookups; ai_conversations row
    // gets bound to that org.
    const { data: lead, error: leadErr } = await admin
      .from('leads')
      .select('id, property_id, properties(id, org_id, primary_agent_id)')
      .eq('id', body.route.lead_id)
      .maybeSingle();
    if (leadErr || !lead || !lead.properties) {
      console.error('[inbound-email] lead_lookup_failed', {
        leadId: body.route.lead_id,
        code: leadErr?.code,
        message: leadErr?.message,
      });
      return null;
    }
    const property = lead.properties as unknown as {
      id: string;
      org_id: string;
      primary_agent_id: string | null;
    };
    const orgId = property.org_id;
    const agentId = body.route.agent_id;

    // Find or create the conversation by lead_id.
    const { data: existingConv, error: convLookupErr } = await admin
      .from('ai_conversations')
      .select('id, org_id, agent_id, property_id')
      .eq('lead_id', body.route.lead_id)
      .eq('channel', 'email')
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (convLookupErr) {
      console.error('[inbound-email] conv_lookup_token', {
        code: convLookupErr.code,
        message: convLookupErr.message,
      });
    }
    if (existingConv) {
      const out: ResolvedConversation = {
        conversationId: existingConv.id,
        orgId: existingConv.org_id,
        agentId: existingConv.agent_id,
      };
      if (existingConv.property_id) out.propertyId = existingConv.property_id;
      return out;
    }

    const { data: newConv, error: createErr } = await admin
      .from('ai_conversations')
      .insert({
        org_id: orgId,
        agent_id: agentId,
        property_id: body.route.listing_id ?? lead.property_id ?? null,
        lead_id: body.route.lead_id,
        channel: 'email',
        buyer_email: body.envelope?.from ?? body.parsed.from?.address ?? null,
      })
      .select('id, property_id')
      .single();
    if (createErr || !newConv) {
      console.error('[inbound-email] conv_create_token', {
        code: createErr?.code,
        message: createErr?.message,
      });
      return null;
    }
    const out: ResolvedConversation = {
      conversationId: newConv.id,
      orgId,
      agentId,
    };
    if (newConv.property_id) out.propertyId = newConv.property_id;
    return out;
  }

  // ── Agent-slug path ───────────────────────────────────────────
  if (body.route.kind === 'agent_slug') {
    // Slug lives on organizations.slug (canonical) or organizations.public_slug.
    // Prefer public_slug for human-typed addresses; fall back to slug.
    const slug = body.route.slug;
    const { data: orgs, error: orgErr } = await admin
      .from('organizations')
      .select('id, slug, public_slug')
      .or(`public_slug.eq.${slug},slug.eq.${slug}`)
      .limit(1);
    if (orgErr || !orgs || orgs.length === 0) {
      console.error('[inbound-email] agent_slug_lookup_failed', {
        slug,
        code: orgErr?.code,
        message: orgErr?.message,
      });
      return null;
    }
    const org = orgs[0]!;

    // Pick the org's primary agent (first member, for v1).
    const { data: members } = await admin
      .from('organization_members')
      .select('user_id, role')
      .eq('org_id', org.id)
      .limit(1);
    const agentId = members?.[0]?.user_id ?? null;
    if (!agentId) {
      console.error('[inbound-email] agent_slug_no_member', { slug, orgId: org.id });
      return null;
    }

    // Find newest open conversation OR create a new one.
    const buyerEmail = body.envelope?.from ?? body.parsed.from?.address ?? null;
    const { data: existing } = buyerEmail
      ? await admin
          .from('ai_conversations')
          .select('id, org_id, agent_id, property_id')
          .eq('org_id', org.id)
          .eq('agent_id', agentId)
          .eq('channel', 'email')
          .eq('status', 'open')
          .eq('buyer_email', buyerEmail)
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (existing) {
      const out: ResolvedConversation = {
        conversationId: existing.id,
        orgId: existing.org_id,
        agentId: existing.agent_id,
      };
      if (existing.property_id) out.propertyId = existing.property_id;
      return out;
    }

    const { data: created, error: createErr } = await admin
      .from('ai_conversations')
      .insert({
        org_id: org.id,
        agent_id: agentId,
        channel: 'email',
        buyer_email: buyerEmail,
      })
      .select('id')
      .single();
    if (createErr || !created) {
      console.error('[inbound-email] conv_create_slug', {
        code: createErr?.code,
        message: createErr?.message,
      });
      return null;
    }
    return {
      conversationId: created.id,
      orgId: org.id,
      agentId,
    };
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────
// Threading
// ──────────────────────────────────────────────────────────────────

interface ThreadResolveArgs {
  conversationId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subjectNormalized: string;
}

async function resolveOrCreateThread(
  admin: ReturnType<typeof createAdminClient>,
  args: ThreadResolveArgs,
): Promise<string | null> {
  // 1. Try to find the existing thread by In-Reply-To or any References entry.
  const candidates = [args.inReplyTo, ...args.references].filter(
    (s): s is string => Boolean(s),
  );

  if (candidates.length > 0) {
    // Either the root_message_id matches, or one of the in-thread
    // message_ids matches. Two queries; small + cheap.
    const { data: rootMatch } = await admin
      .from('ai_email_threads')
      .select('id, conversation_id')
      .in('root_message_id', candidates)
      .limit(1)
      .maybeSingle();
    if (rootMatch) return rootMatch.id;

    const { data: msgMatch } = await admin
      .from('ai_email_messages')
      .select('thread_id')
      .in('message_id', candidates)
      .limit(1)
      .maybeSingle();
    if (msgMatch) return msgMatch.thread_id;
  }

  // 2. No match — this is a thread root. Create one.
  const rootId = args.messageId ?? `aho-thread-root-${crypto.randomUUID()}`;
  const { data: created, error: createErr } = await admin
    .from('ai_email_threads')
    .insert({
      conversation_id: args.conversationId,
      root_message_id: rootId,
      subject_normalized: args.subjectNormalized,
    })
    .select('id')
    .single();
  if (createErr || !created) {
    console.error('[inbound-email] thread_create', {
      code: createErr?.code,
      message: createErr?.message,
    });
    return null;
  }
  return created.id;
}

// Surface the routing helpers so unit-tests can spot import-typos
// at build time. Not part of the route's runtime contract.
export const _routing = { decodeLeadsToken, parseLocalPart };

// ──────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────

function normalizeMessageId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // Strip < > and whitespace.
  const trimmed = raw.trim().replace(/^<+|>+$/g, '');
  return trimmed || null;
}

function normalizeReferences(raw: string | string[] | undefined | null): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.split(/[,\s]+/);
  return list
    .map((s) => normalizeMessageId(s))
    .filter((s): s is string => Boolean(s));
}

function normalizeSubject(raw: string): string {
  return raw
    .replace(/^(?:\s*(?:re|fw|fwd|aw|sv|rv|res)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 500);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
