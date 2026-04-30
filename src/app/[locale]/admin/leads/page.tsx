import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Leads · AHO',
  robots: { index: false, follow: false },
};

interface AdminLead {
  id: string;
  property_id: string;
  org_id: string;
  source: string;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  message: string | null;
  language: string | null;
  created_at: string;
  property: {
    short_id: string;
    title_en: string | null;
    title_es: string | null;
    city: string;
    country_code: string;
  } | null;
  org: {
    name: string;
    slug: string;
  } | null;
}

interface SearchParams {
  status?: string;
}

const STATUS_FILTERS = ['all', 'new', 'contacted', 'qualified', 'won', 'lost'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Admin → Leads tab. Lists every lead across all orgs. RLS policy
 * `leads_admin_all` grants this view; non-admins never reach the page
 * (layout's auth gate).
 *
 * Joins property + org so each row carries the listing context.
 */
export default async function AdminLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const sp = await searchParams;
  const rawStatus = sp.status ?? 'all';
  const statusFilter: StatusFilter = (
    STATUS_FILTERS as readonly string[]
  ).includes(rawStatus)
    ? (rawStatus as StatusFilter)
    : 'all';

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from('leads')
    .select(
      'id, property_id, org_id, source, status, contact_name, contact_email, contact_phone, message, language, created_at, properties(short_id, title_en, title_es, city, country_code), organizations(name, slug)',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data: rows, error } = await query;
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error.message}
      </p>
    );
  }

  const leads = (rows ?? []).map((r) => ({
    ...r,
    property: Array.isArray(r.properties)
      ? (r.properties[0] ?? null)
      : (r.properties ?? null),
    org: Array.isArray(r.organizations)
      ? (r.organizations[0] ?? null)
      : (r.organizations ?? null),
  })) as unknown as AdminLead[];

  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const filterTab = (key: StatusFilter, label: string) => {
    const isActive = statusFilter === key;
    const href =
      key === 'all'
        ? `/${locale}/admin/leads`
        : `/${locale}/admin/leads?status=${key}`;
    return (
      <a
        key={key}
        href={href}
        className={`inline-flex h-8 items-center rounded-lg px-3 text-sm transition ${
          isActive
            ? 'bg-surface-dark text-ink-inverse-muted shadow-whisper'
            : 'text-helper hover:bg-surface-muted dark:hover:bg-surface-dark'
        }`}
      >
        {label}
      </a>
    );
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          Leads ({leads.length})
        </h1>
        <nav className="flex flex-wrap gap-1" aria-label="Status filter">
          {filterTab('all', 'All')}
          {filterTab('new', 'New')}
          {filterTab('contacted', 'Contacted')}
          {filterTab('qualified', 'Qualified')}
          {filterTab('won', 'Won')}
          {filterTab('lost', 'Lost')}
        </nav>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          No leads match this filter.
        </div>
      ) : (
        <ul className="space-y-3">
          {leads.map((lead) => {
            const propertyTitle =
              (typedLocale === 'es' ? lead.property?.title_es : lead.property?.title_en) ??
              lead.property?.title_en ??
              lead.property?.title_es ??
              '(property removed)';
            const propertyCity = lead.property
              ? `${lead.property.city}, ${lead.property.country_code}`
              : null;
            const hasContact = !!(
              lead.contact_name ||
              lead.contact_email ||
              lead.contact_phone
            );
            return (
              <li
                key={lead.id}
                className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                      {lead.source} · {dateFormatter.format(new Date(lead.created_at))}
                      {lead.language && ` · ${lead.language}`}
                    </p>
                    <p className="text-sm">
                      <strong>
                        {hasContact ? lead.contact_name ?? '—' : '(anonymous)'}
                      </strong>
                      {(lead.contact_email || lead.contact_phone) && (
                        <span className="ml-2 text-helper">
                          {[lead.contact_email, lead.contact_phone]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </p>
                    {lead.message && (
                      <p className="mt-2 whitespace-pre-line text-sm">{lead.message}</p>
                    )}
                    <p className="mt-2 text-xs">
                      {lead.org && (
                        <a className="underline" href={`/${locale}/agents/${lead.org.slug}`}>
                          {lead.org.name}
                        </a>
                      )}
                      {lead.org && propertyCity && ' · '}
                      {propertyCity && <span>{propertyCity}</span>}
                      <span className="ml-2 text-helper">{propertyTitle}</span>
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium dark:bg-surface-dark">
                    {lead.status}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
