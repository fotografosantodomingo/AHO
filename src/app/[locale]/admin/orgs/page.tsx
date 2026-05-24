import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveEffectivePlanId, planTierLabel } from '@/lib/billing/plan-gating';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Orgs · AHO',
  robots: { index: false, follow: false },
};

interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  public_slug: string | null;
  type: string;
  headquarters_country: string | null;
  headquarters_city: string | null;
  listing_cap: number | null;
  created_at: string;
  member_count: number;
  active_listing_count: number;
  current_plan_id: string | null;
  manual_plan_id: string | null;
  manual_plan_expires_at: string | null;
}

/**
 * Admin → Orgs tab. Lists every organization across the platform with
 * member count, active+published listing count, type, and HQ.
 *
 * Uses two count queries with `head: true` to avoid pulling row data
 * unnecessarily — efficient even with many orgs/members/listings.
 *
 * Auth + tab nav inherited from `admin/layout.tsx`.
 */
export default async function AdminOrgsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  const supabase = await createServerSupabaseClient();

  const { data: rows, error } = await supabase
    .from('organizations')
    .select(
      'id, name, slug, public_slug, type, headquarters_country, headquarters_city, listing_cap, created_at, current_plan_id, manual_plan_id, manual_plan_expires_at',
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error.message}
      </p>
    );
  }

  const orgsBase = rows ?? [];

  // Single grouped RPC call (migration 0044) replaces the previous
  // 2× per-org HEAD-count fan-out (up to 1000 round-trips on a 500-org
  // page). Pre-migration fall-back: RPC absence yields zero counts —
  // visible but recoverable.
  const { data: countRows } = await supabase.rpc('admin_org_counts');
  const countMap = new Map<
    string,
    { member_count: number; active_listing_count: number }
  >();
  for (const r of (countRows ?? []) as Array<{
    org_id: string;
    member_count: number;
    active_listing_count: number;
  }>) {
    countMap.set(r.org_id, {
      member_count: Number(r.member_count),
      active_listing_count: Number(r.active_listing_count),
    });
  }
  const orgs: AdminOrg[] = orgsBase.map((o) => {
    const counts = countMap.get((o as { id: string }).id) ?? {
      member_count: 0,
      active_listing_count: 0,
    };
    return {
      ...(o as Omit<AdminOrg, 'member_count' | 'active_listing_count'>),
      ...counts,
    };
  });

  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <>
      <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
        Orgs ({orgs.length})
      </h1>

      {orgs.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          No organizations yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="text-left">
              <tr>
                {[
                  'Name',
                  'Slug',
                  'Type',
                  'HQ',
                  'Members',
                  'Active listings',
                  'Listing cap',
                  'Plan',
                  'Created',
                  '',
                ].map((label) => (
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
              {orgs.map((org) => {
                const hq =
                  [org.headquarters_city, org.headquarters_country]
                    .filter(Boolean)
                    .join(', ') || '—';
                const isFixture = org.slug.startsWith('aho-test-org-');
                return (
                  <tr
                    key={org.id}
                    className="transition hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <td className="px-3 py-2">
                      {org.active_listing_count > 0 ? (
                        <a
                          className="underline"
                          href={`/${locale}/agents/${org.public_slug ?? org.slug}`}
                        >
                          {org.name}
                        </a>
                      ) : (
                        // Public agent profile is gated on having at least
                        // one active+published listing (migration 0031).
                        // Avoid the click-to-404 (#22).
                        <span className="text-ink-muted dark:text-ink-inverse-muted">
                          {org.name}
                        </span>
                      )}
                      {isFixture && (
                        <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn dark:bg-warn-bg/30">
                          fixture
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-helper">
                      {org.slug}
                    </td>
                    <td className="px-3 py-2 capitalize">{org.type}</td>
                    <td className="px-3 py-2">{hq}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {org.member_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {org.active_listing_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {org.listing_cap ?? '∞'}
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const effective = resolveEffectivePlanId({
                          currentPlanId: org.current_plan_id,
                          manualPlanId: org.manual_plan_id,
                          manualPlanExpiresAt: org.manual_plan_expires_at,
                        });
                        const tier = planTierLabel(effective);
                        const isOverride =
                          !!org.manual_plan_id &&
                          (org.manual_plan_expires_at === null ||
                            Date.parse(org.manual_plan_expires_at) > Date.now());
                        return (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                tier === 'pro_automation'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                                  : tier === 'plus'
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                    : tier === 'agent'
                                      ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
                                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                              }`}
                            >
                              {tier.replace('_', ' ')}
                            </span>
                            {isOverride && (
                              <span
                                title="Admin override"
                                className="inline-flex items-center rounded-full bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                              >
                                🎁
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-helper">
                      {dateFormatter.format(new Date(org.created_at))}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/${locale}/admin/orgs/${org.id}/plan`}
                        className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        Manage plan →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
