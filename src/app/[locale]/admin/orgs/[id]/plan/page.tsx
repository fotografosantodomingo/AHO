import { notFound } from 'next/navigation';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveEffectivePlanId, planTierLabel } from '@/lib/billing/plan-gating';
import { PlanOverrideForm } from '@/components/admin/plan-override-form';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * /[locale]/admin/orgs/[id]/plan — dedicated plan-management surface
 * for one organization. Auth gate is the same as the rest of /admin
 * (the admin layout already requires is_admin); this page is reached
 * from /admin/orgs row actions.
 *
 * Shows:
 *   - Org identity (name + slug + type)
 *   - Effective plan badge (computed via resolveEffectivePlanId)
 *   - Source attribution (Stripe vs manual override)
 *   - PlanOverrideForm with grant/extend/revoke tabs
 *   - Recent plan-comp audit_log entries for this org (history)
 */

export default async function AdminOrgPlanPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id: orgId } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  if (!/^[0-9a-f-]{36}$/i.test(orgId)) notFound();

  const admin = createAdminClient();

  const { data: org } = await admin
    .from('organizations')
    .select(
      'id, name, slug, public_slug, type, headquarters_country, headquarters_city, current_plan_id, manual_plan_id, manual_plan_expires_at, manual_plan_note, manual_plan_granted_by, manual_plan_granted_at',
    )
    .eq('id', orgId)
    .maybeSingle();

  if (!org) notFound();

  // Audit history — last 20 plan-comp events for this org.
  const { data: history } = await admin
    .from('audit_log')
    .select('id, kind, actor_id, payload, created_at')
    .eq('target_id', orgId)
    .like('kind', 'admin.org.plan_comp_%')
    .order('created_at', { ascending: false })
    .limit(20);

  // Resolve grantor email if present (purely cosmetic).
  let grantorEmail: string | null = null;
  if (org.manual_plan_granted_by) {
    const { data: grantor } = await admin
      .from('profiles')
      .select('email')
      .eq('id', org.manual_plan_granted_by)
      .maybeSingle();
    grantorEmail = (grantor?.email as string | null) ?? null;
  }

  const effectivePlanId = resolveEffectivePlanId({
    currentPlanId: org.current_plan_id as string | null,
    manualPlanId: org.manual_plan_id as string | null,
    manualPlanExpiresAt: org.manual_plan_expires_at as string | null,
  });
  const effectiveTier = planTierLabel(effectivePlanId);
  const source = org.manual_plan_id ? 'override' : org.current_plan_id ? 'stripe' : 'none';

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 md:px-6 md:py-12">
      <nav className="text-sm text-slate-500">
        <Link href={`/${locale}/admin/orgs`} className="hover:text-slate-900 dark:hover:text-slate-100">
          ← All orgs
        </Link>
      </nav>

      <h1 className="mt-4 font-brand text-3xl font-bold tracking-tight md:text-[40px] md:leading-[1.1]">
        {org.name}
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        <span className="font-mono">{org.slug}</span>
        {' · '}
        {org.type as string}
        {org.headquarters_city && (
          <>
            {' · '}
            {org.headquarters_city as string},{' '}
            {org.headquarters_country as string}
          </>
        )}
      </p>

      {/* Effective plan badge */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Effective plan:</span>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${
            effectiveTier === 'pro_automation'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
              : effectiveTier === 'plus'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                : effectiveTier === 'agent'
                  ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {effectiveTier.replace('_', ' ').toUpperCase()}
        </span>
        <span className="text-xs uppercase tracking-wide text-slate-500">
          via {source === 'override' ? '🎁 admin override' : source === 'stripe' ? 'Stripe subscription' : 'no plan'}
        </span>
      </div>

      {/* Override metadata (when present) */}
      {org.manual_plan_id && (
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Granted{' '}
          {org.manual_plan_granted_at && (
            <>by <span className="font-semibold">{grantorEmail ?? 'unknown'}</span> on{' '}
            {new Date(org.manual_plan_granted_at as string).toLocaleDateString('en-US')}</>
          )}
          {org.manual_plan_expires_at && (
            <>
              {' · expires '}
              <span className="font-semibold">
                {new Date(org.manual_plan_expires_at as string).toLocaleString('en-US')}
              </span>
            </>
          )}
          {!org.manual_plan_expires_at && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
              PERMANENT
            </span>
          )}
        </div>
      )}

      {/* Override form */}
      <div className="mt-8">
        <PlanOverrideForm
          orgId={org.id as string}
          orgName={org.name as string}
          currentPlanId={(org.current_plan_id as string | null) ?? null}
          manualPlanId={(org.manual_plan_id as string | null) ?? null}
          manualPlanExpiresAt={(org.manual_plan_expires_at as string | null) ?? null}
          manualPlanNote={(org.manual_plan_note as string | null) ?? null}
        />
      </div>

      {/* History */}
      <section className="mt-12">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">History</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Last {history?.length ?? 0} plan-comp events for this org.
        </p>
        {(history?.length ?? 0) === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
            No history yet. Grant your first override above.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {(history ?? []).map((h) => {
              const payload = (h as { payload: Record<string, unknown> }).payload ?? {};
              const action = (payload.action as string) ?? '?';
              const req = (payload.request as Record<string, unknown>) ?? {};
              return (
                <li
                  key={h.id as string}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs uppercase">
                      {action === 'grant' ? '🎁' : action === 'extend' ? '⏩' : '✗'} {action}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(h.created_at as string).toLocaleString('en-US')}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {action === 'grant' && (
                      <>
                        Tier:{' '}
                        <span className="font-mono">{(req.plan_id as string) ?? '?'}</span>
                        {' · '}
                        {req.permanent
                          ? 'permanent'
                          : req.days
                            ? `${req.days} days`
                            : (req.expires_at as string) ?? '?'}
                      </>
                    )}
                    {action === 'extend' && <>+{(req.days as number) ?? 0} days</>}
                    {action === 'revoke' && <>Cleared override</>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
