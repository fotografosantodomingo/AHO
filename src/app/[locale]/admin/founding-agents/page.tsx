import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCountryName } from '@/lib/i18n/countries';
import { FoundingAgentStatusForm } from '@/components/admin/founding-agent-status-form';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * /admin/founding-agents — operator dashboard for the Founding 50
 * pipeline. Admin-only (RLS gates the SELECT to is_admin() = true).
 *
 * Surfaces:
 *   - Top-line counts (applied / contacted / onboarding / converted)
 *   - X of 50 cap progress
 *   - Full application list with: name + city + country + WhatsApp
 *     deep link + portfolio link + their message + applied-at
 *   - Per-row inline status update form (FoundingAgentStatusForm
 *     posts to /api/admin/founding-agents/[id]/status — see below).
 */

const PROGRAM_CAP = 50;

export default async function AdminFoundingAgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ id?: string; status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from('founding_agent_applications')
    .select(
      'id, full_name, email, whatsapp, city, country_code, portfolio_url, message, status, operator_notes, applied_at, contacted_at, converted_at, utm_source, utm_campaign',
    )
    .order('applied_at', { ascending: false })
    .limit(500);

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-2xl font-bold">Founding 50 — pipeline</h1>
        <p className="mt-4 text-red-700">
          Error loading applications: {error.message}
        </p>
      </main>
    );
  }

  interface Row {
    id: string;
    full_name: string;
    email: string;
    whatsapp: string | null;
    city: string;
    country_code: string;
    portfolio_url: string | null;
    message: string | null;
    status: 'applied' | 'contacted' | 'onboarding' | 'converted' | 'declined';
    operator_notes: string | null;
    applied_at: string;
    contacted_at: string | null;
    converted_at: string | null;
    utm_source: string | null;
    utm_campaign: string | null;
  }

  const apps = (rows ?? []) as Row[];

  // Status filter via query param.
  const statusFilter = sp.status ?? null;
  const visibleApps = statusFilter
    ? apps.filter((a) => a.status === statusFilter)
    : apps;

  // Top-line counts.
  const counts = {
    applied: apps.filter((a) => a.status === 'applied').length,
    contacted: apps.filter((a) => a.status === 'contacted').length,
    onboarding: apps.filter((a) => a.status === 'onboarding').length,
    converted: apps.filter((a) => a.status === 'converted').length,
    declined: apps.filter((a) => a.status === 'declined').length,
  };
  const totalEligibleForCap = counts.applied + counts.contacted + counts.onboarding + counts.converted;
  const remaining = Math.max(0, PROGRAM_CAP - totalEligibleForCap);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-brand text-3xl font-bold tracking-tight md:text-[40px] md:leading-[1.1]">
            Founding 50 — pipeline
          </h1>
          <p className="mt-2 text-base text-slate-600 dark:text-slate-400">
            {totalEligibleForCap} of {PROGRAM_CAP} spots claimed · {remaining} remaining ·
            {' '}{apps.length} total applications (incl. declined)
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${Math.min(100, (totalEligibleForCap / PROGRAM_CAP) * 100)}%` }}
        />
      </div>

      {/* Status counts + filter chips */}
      <div className="mt-6 flex flex-wrap gap-2">
        {[
          { key: null, label: 'All', count: apps.length },
          { key: 'applied', label: 'Applied', count: counts.applied },
          { key: 'contacted', label: 'Contacted', count: counts.contacted },
          { key: 'onboarding', label: 'Onboarding', count: counts.onboarding },
          { key: 'converted', label: 'Converted', count: counts.converted },
          { key: 'declined', label: 'Declined', count: counts.declined },
        ].map((chip) => {
          const isActive = (chip.key ?? null) === statusFilter;
          const href = chip.key
            ? `?status=${chip.key}`
            : '?';
          return (
            <a
              key={chip.label}
              href={href}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                isActive
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {chip.label}
              <span className={`tabular-nums ${isActive ? 'text-emerald-700' : 'text-slate-500 dark:text-slate-400'}`}>
                {chip.count}
              </span>
            </a>
          );
        })}
      </div>

      {/* Applications list */}
      <div className="mt-8 space-y-4">
        {visibleApps.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            No applications {statusFilter ? `with status "${statusFilter}"` : 'yet'}.
          </p>
        ) : (
          visibleApps.map((app) => {
            const isHighlighted = sp.id === app.id;
            const whatsappLink = app.whatsapp
              ? `https://wa.me/${app.whatsapp.replace(/[^0-9+]/g, '')}`
              : null;
            return (
              <article
                key={app.id}
                id={app.id}
                className={`rounded-xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${
                  isHighlighted
                    ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {app.full_name}
                      <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                        · {app.city}, {getCountryName(app.country_code, 'en') || app.country_code}
                      </span>
                    </h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      <a
                        href={`mailto:${app.email}`}
                        className="text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        {app.email}
                      </a>
                      {whatsappLink && (
                        <>
                          {' · '}
                          <a
                            href={whatsappLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 hover:underline dark:text-emerald-400"
                          >
                            WhatsApp {app.whatsapp}
                          </a>
                        </>
                      )}
                      {app.portfolio_url && (
                        <>
                          {' · '}
                          <a
                            href={app.portfolio_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 hover:underline dark:text-emerald-400"
                          >
                            Portfolio
                          </a>
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                      Applied {new Date(app.applied_at).toLocaleString('en-US')}
                      {app.utm_source && ` · via ${app.utm_source}/${app.utm_campaign ?? '?'}`}
                    </p>
                    {app.message && (
                      <blockquote className="mt-3 rounded-lg border-l-2 border-emerald-400 bg-emerald-50/30 px-4 py-2 text-sm text-slate-700 dark:bg-emerald-950/10 dark:text-slate-300">
                        {app.message}
                      </blockquote>
                    )}
                  </div>
                  <div className="shrink-0">
                    <FoundingAgentStatusForm
                      id={app.id}
                      status={app.status}
                      notes={app.operator_notes ?? ''}
                    />
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </main>
  );
}
