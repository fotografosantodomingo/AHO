import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PendingActions } from '@/components/ai-inbox/pending-actions';

export const runtime = 'edge';

// Auth-dependent + reads live conversation state — never pre-render.
export const dynamic = 'force-dynamic';

/**
 * AI Inbox — Phase 2 dashboard surface.
 *
 * Two tabs:
 *   - Pending    → assistant rows with approval_status='pending'.
 *   - All        → every conversation in the org, sorted by recency.
 *
 * Server component. RLS already filters by the caller's org (via the
 * `org_members_read_conv` + `org_members_read_msg` policies on the
 * ai_conversations / ai_conversation_messages tables — see migration
 * 0066). The dashboard layout already gates unauthenticated visitors
 * and bounces non-members to /pricing, so we just trust the session.
 */

interface PendingRow {
  id: string;
  conversation_id: string;
  body: string;
  confidence: number | null;
  intent: string | null;
  risk_flags: string[] | null;
  created_at: string;
  conversation:
    | {
        id: string;
        channel: string;
        buyer_locale: string;
        buyer_phone: string | null;
        buyer_email: string | null;
        property_id: string | null;
        status: string;
      }
    | Array<{
        id: string;
        channel: string;
        buyer_locale: string;
        buyer_phone: string | null;
        buyer_email: string | null;
        property_id: string | null;
        status: string;
      }>
    | null;
}

interface ConvRow {
  id: string;
  channel: string;
  status: string;
  buyer_locale: string;
  buyer_phone: string | null;
  buyer_email: string | null;
  last_message_at: string;
  property_id: string | null;
  agent_id: string | null;
}

type TabKey = 'pending' | 'all';

export default async function AiInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const { tab: tabRaw } = await searchParams;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const tab: TabKey = tabRaw === 'all' ? 'all' : 'pending';

  // Auth gate — the dashboard layout already runs this, but defending
  // against direct routing makes this page self-contained.
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    const signinPath = localePath(typedLocale, '/signin');
    redirect(`${signinPath}?next=${encodeURIComponent(localePath(typedLocale, '/dashboard'))}`);
  }

  const baseHref = `${localePath(typedLocale, '/dashboard')}/ai-inbox`;
  const tabHref = (k: TabKey) => (k === 'pending' ? baseHref : `${baseHref}?tab=all`);

  // ─── Pending tab: assistant rows + their parent conversation context.
  const pendingQuery = supabase
    .from('ai_conversation_messages')
    .select(
      `id, conversation_id, body, confidence, intent, risk_flags, created_at,
       conversation:ai_conversations!inner(id, channel, buyer_locale, buyer_phone, buyer_email, property_id, status)`,
    )
    .eq('approval_status', 'pending')
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(100);

  // ─── All tab: conversation list with latest user-message preview.
  const allConvQuery = supabase
    .from('ai_conversations')
    .select(
      'id, channel, status, buyer_locale, buyer_phone, buyer_email, last_message_at, property_id, agent_id',
    )
    .order('last_message_at', { ascending: false })
    .limit(100);

  let pendingRows: PendingRow[] = [];
  let allRows: ConvRow[] = [];
  const lastUserBodies: Map<string, { body: string; created_at: string }> = new Map();
  let dataError: string | null = null;

  if (tab === 'pending') {
    const { data, error } = await pendingQuery;
    if (error) {
      console.error('[ai-inbox] pending query error', error);
      dataError = error.message;
    } else {
      pendingRows = (data ?? []) as unknown as PendingRow[];

      // Fetch the preceding user turn for each pending draft to give
      // the agent a "buyer said → AI drafted" pair. One query per
      // conversation would be slow; instead we batch a single IN query
      // for all conversations and pick the most recent user row.
      const convoIds = pendingRows
        .map((r) => r.conversation_id)
        .filter((v, i, a) => a.indexOf(v) === i);
      if (convoIds.length > 0) {
        const { data: userRows, error: uErr } = await supabase
          .from('ai_conversation_messages')
          .select('conversation_id, body, created_at')
          .in('conversation_id', convoIds)
          .eq('role', 'user')
          .order('created_at', { ascending: false });
        if (uErr) {
          console.warn('[ai-inbox] user-context query warn', uErr);
        } else {
          for (const row of userRows ?? []) {
            const cid = row.conversation_id as string;
            if (!lastUserBodies.has(cid)) {
              lastUserBodies.set(cid, {
                body: row.body as string,
                created_at: row.created_at as string,
              });
            }
          }
        }
      }
    }
  } else {
    const { data, error } = await allConvQuery;
    if (error) {
      console.error('[ai-inbox] all conv query error', error);
      dataError = error.message;
    } else {
      allRows = (data ?? []) as unknown as ConvRow[];
    }
  }

  const dateFmt = new Intl.DateTimeFormat(typedLocale === 'es' ? 'es-DO' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const buyerIdentity = (row: { buyer_phone: string | null; buyer_email: string | null }) =>
    row.buyer_email || row.buyer_phone || 'Anonymous buyer';

  return (
    <main className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          AI Inbox
        </h1>
        <p className="text-sm text-helper">
          Pending AI drafts and the full conversation log across web chat, email,
          WhatsApp, and voice.
        </p>
      </header>

      <nav className="flex gap-1" aria-label="Inbox view">
        {(['pending', 'all'] as const).map((k) => {
          const active = tab === k;
          return (
            <a
              key={k}
              href={tabHref(k)}
              className={`inline-flex h-8 items-center rounded-lg px-3 text-sm transition ${
                active
                  ? 'bg-action text-white shadow-whisper dark:bg-action-dark dark:text-surface-deep'
                  : 'text-helper hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {k === 'pending' ? 'Pending' : 'All conversations'}
            </a>
          );
        })}
      </nav>

      {dataError && (
        <p role="alert" className="text-sm text-red-600">
          {dataError}
        </p>
      )}

      {tab === 'pending' ? (
        pendingRows.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
            <p>No pending drafts. The AI is caught up.</p>
            <p className="mt-2 text-xs text-helper">
              When buyers chat with the AI assistant on your listings or profile, drafts
              land here for one-tap approval.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {pendingRows.map((row) => {
              const convoRaw = Array.isArray(row.conversation)
                ? row.conversation[0]
                : row.conversation;
              const convo = convoRaw ?? null;
              const userTurn = lastUserBodies.get(row.conversation_id);
              return (
                <li
                  key={row.id}
                  className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                      {convo?.channel ?? 'web_chat'} · {dateFmt.format(new Date(row.created_at))}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.intent && (
                        <span className="inline-flex items-center rounded-full bg-action/10 px-2 py-0.5 text-[11px] font-medium text-action dark:bg-action-dark/15 dark:text-action-dark">
                          {row.intent}
                        </span>
                      )}
                      {(row.risk_flags ?? []).map((flag) => (
                        <span
                          key={flag}
                          className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                        >
                          {flag}
                        </span>
                      ))}
                      {row.confidence != null && (
                        <span className="inline-flex items-center rounded-full bg-border-strong/15 px-2 py-0.5 text-[11px] text-helper">
                          {Math.round(row.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>

                  {convo && (
                    <p className="mt-1 text-xs text-helper">{buyerIdentity(convo)}</p>
                  )}

                  {userTurn && (
                    <blockquote className="mt-3 border-l-2 border-border-strong/60 pl-3 text-sm text-ink-muted dark:text-ink-inverse-muted">
                      <p className="text-[11px] uppercase tracking-wider text-helper">
                        Buyer said
                      </p>
                      <p className="mt-1 whitespace-pre-line line-clamp-4">{userTurn.body}</p>
                    </blockquote>
                  )}

                  <div className="mt-3 rounded-md border border-border bg-surface-muted/30 p-3 dark:bg-surface-dark/30">
                    <p className="text-[11px] uppercase tracking-wider text-helper">
                      AI draft
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{row.body}</p>
                  </div>

                  <PendingActions messageId={row.id} initialBody={row.body} />
                </li>
              );
            })}
          </ul>
        )
      ) : allRows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          <p>No conversations yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {allRows.map((row) => (
            <li
              key={row.id}
              className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {row.channel} · {dateFmt.format(new Date(row.last_message_at))}
                </p>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    row.status === 'escalated'
                      ? 'bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200'
                      : row.status === 'resolved'
                        ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
                        : row.status === 'abandoned'
                          ? 'bg-border-strong/15 text-helper'
                          : 'bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200'
                  }`}
                >
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-sm">{buyerIdentity(row)}</p>
              <p className="mt-1 text-xs text-helper">
                Locale {row.buyer_locale}
                {row.property_id && (
                  <>
                    {' · '}
                    <a
                      className="underline"
                      href={`${localePath(typedLocale, '/dashboard/properties/[id]').replace('[id]', row.property_id)}`}
                    >
                      View listing
                    </a>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
