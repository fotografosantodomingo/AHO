import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { getPathname, localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { RoutingRuleForm } from '@/components/leads/routing-rule-form';
import { RoutingRuleRowActions } from '@/components/leads/routing-rule-row-actions';
import type {
  LeadRoutingAction,
  LeadRoutingConditions,
} from '@/db/schema';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'leadRouting' });
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
  };
}

/**
 * /[locale]/dashboard/leads/routing — agency owners + managers manage
 * the per-org rule set that decides which agent fields a new inbound
 * lead.
 *
 * Audience choice (admin vs org-owner): we put this under the dashboard
 * (not /admin/orgs/[id]/routing) for two reasons:
 *
 *   1. Routing is org-internal config, not platform moderation. The
 *      agency owner is the one who needs to react when an agent goes
 *      on vacation; making them ping a platform admin to edit a rule
 *      defeats the point of the feature.
 *   2. RLS already constrains writes to owner+manager (CLAUDE.md hard
 *      rule #4). Putting the UI in the dashboard aligns the audience
 *      that can SEE the page with the audience that can USE it.
 *
 * Members below `agent` role (analyst, viewer) can't field leads, so
 * they're excluded from the assignee dropdowns. Agents themselves CAN
 * read this page (RLS allows SELECT for any org member) — useful for
 * "why did I get this lead?" debugging — but the form actions will
 * be RLS-rejected for them.
 */

interface MemberRow {
  user_id: string;
  role: string;
  profiles: { full_name: string | null; email: string } | null;
}

interface RuleRow {
  id: string;
  name: string;
  priority: number;
  is_active: boolean;
  conditions: LeadRoutingConditions;
  action: LeadRoutingAction;
  created_at: string;
  updated_at: string;
}

function describeConditions(
  c: LeadRoutingConditions,
  matchesAny: string,
): string {
  const parts: string[] = [];
  if (c.city) parts.push(`city=${c.city}`);
  if (c.country_code) parts.push(`country=${c.country_code}`);
  if (c.language) parts.push(`lang=${c.language}`);
  if (c.property_type) parts.push(`type=${c.property_type}`);
  return parts.length === 0 ? matchesAny : parts.join(' · ');
}

function describeAction(
  a: LeadRoutingAction,
  memberById: Map<string, { fullName: string | null; email: string }>,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (a.type === 'assign') {
    const m = memberById.get(a.assign_to_user_id);
    const name = m?.fullName ?? m?.email ?? a.assign_to_user_id;
    return t('actionAssign', { name });
  }
  if (a.round_robin_user_ids.length === 0) return t('actionRoundRobinUnknown');
  return t('actionRoundRobin', { count: a.round_robin_user_ids.length });
}

export default async function LeadRoutingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);
  const t = await getTranslations({ locale, namespace: 'leadRouting' });

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    // Build the post-signin `next` and the signin path itself via
    // `getPathname()` so they always match the registered PATHNAMES.
    // Bug history: this page was hard-coding `panel/contactos/routing`
    // for ES, but the registered ES path is
    // `panel/contactos/enrutamiento` (PATHNAMES, src/i18n/config.ts) —
    // so post-signin redirect landed users on a 404. Going through
    // getPathname removes the duplicated mapping.
    const typedLocale = locale as Locale;
    const next = getPathname({
      href: '/dashboard/leads/routing',
      locale: typedLocale,
    });
    const signinPath = getPathname({
      href: '/signin',
      locale: typedLocale,
    });
    redirect(`/${locale}${signinPath}?next=${encodeURIComponent(`/${locale}${next}`)}`);
  }

  // Resolve the caller's owning org. The dashboard layout has already
  // gated on "has at least one membership"; we additionally require a
  // role that can MANAGE leads (owner / manager / agent — agents can
  // view, the form's RLS rejects writes from non-managers).
  // v1: a user belongs to at most one org (no multi-tenant agents
  // yet); pick the first qualifying membership.
  const { data: membershipRow, error: memErr } = await supabase
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', userResult.user.id)
    .in('role', ['owner', 'manager', 'agent'])
    .limit(1)
    .maybeSingle();
  if (memErr) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {memErr.message}
      </p>
    );
  }
  if (!membershipRow) {
    redirect(localePath(locale as Locale, '/pricing'));
  }

  const orgId = membershipRow.org_id as string;
  const myRole = membershipRow.role as string;
  const canManage = myRole === 'owner' || myRole === 'manager';

  // Load org members (only the roles that can field leads — analysts
  // and viewers can't be lead targets).
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id, role, profiles!inner(full_name, email)')
    .eq('org_id', orgId)
    .in('role', ['owner', 'manager', 'agent']);

  const members = ((memberRows ?? []) as unknown as MemberRow[])
    .map((r) => ({
      userId: r.user_id,
      fullName: r.profiles?.full_name ?? null,
      email: r.profiles?.email ?? '',
    }))
    .filter((m) => m.userId)
    .sort((a, b) =>
      (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email),
    );
  const memberById = new Map(
    members.map((m) => [m.userId, { fullName: m.fullName, email: m.email }]),
  );

  // Load rules — RLS allows SELECT for any org member.
  const { data: ruleRows, error: rulesErr } = await supabase
    .from('lead_routing_rules')
    .select(
      'id, name, priority, is_active, conditions, action, created_at, updated_at',
    )
    .eq('org_id', orgId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  if (rulesErr) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {rulesErr.message}
      </p>
    );
  }

  const rules = (ruleRows ?? []) as unknown as RuleRow[];

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          {t('heading')}
        </h1>
        <p className="max-w-2xl text-sm text-helper">{t('sub')}</p>
        {!canManage && (
          <p
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {t('notManaged')}
          </p>
        )}
      </header>

      {canManage && (
        <details className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep">
          <summary className="cursor-pointer text-sm font-medium">
            {t('add')}
          </summary>
          <div className="mt-3">
            <RoutingRuleForm
              orgId={orgId}
              members={members}
              locale={locale}
            />
          </div>
        </details>
      )}

      <section aria-labelledby="rules-heading" className="space-y-3">
        <h2 id="rules-heading" className="sr-only">
          {t('listHeading')}
        </h2>
        {rules.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
            {t('empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="text-left">
                <tr>
                  {(
                    [
                      t('columns.priority'),
                      t('columns.name'),
                      t('columns.conditions'),
                      t('columns.action'),
                      t('columns.status'),
                      t('columns.actions'),
                    ] as const
                  ).map((label) => (
                    <th
                      key={label}
                      className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rules.map((r) => (
                  <tr
                    key={r.id}
                    className="align-top transition hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <td className="px-3 py-2 tabular-nums">{r.priority}</td>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-xs">
                      {describeConditions(r.conditions, t('matchesAny'))}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {describeAction(r.action, memberById, t)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.is_active ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
                          {t('statusActive')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-border-strong/15 px-2 py-0.5 text-helper">
                          {t('statusInactive')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <RoutingRuleRowActions
                          orgId={orgId}
                          rule={r}
                          members={members}
                          locale={locale}
                        />
                      ) : (
                        <span className="text-xs text-helper">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
