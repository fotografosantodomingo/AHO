import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { LeadStatusSelect } from '@/components/leads/lead-status-select';
import type { LeadStatus, LeadSource } from '@/db/schema';

export const runtime = 'edge';

export const dynamic = 'force-dynamic';

const FILTER_GROUPS = {
  all: null,
  new: ['new'] as const,
  contacted: ['contacted', 'qualified'] as const,
  closed: ['won', 'lost'] as const,
} as const;
type FilterKey = keyof typeof FILTER_GROUPS;

interface LeadRow {
  id: string;
  source: LeadSource;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  message: string | null;
  language: string | null;
  status: LeadStatus;
  created_at: string;
  property: {
    id: string;
    short_id: string;
    title_en: string | null;
    title_es: string | null;
    slug_en: string | null;
    slug_es: string | null;
    city: string;
    status: string;
  } | null;
}

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { locale } = await params;
  const { filter: filterRaw } = await searchParams;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const filterKey: FilterKey =
    filterRaw && filterRaw in FILTER_GROUPS ? (filterRaw as FilterKey) : 'all';
  const statuses = FILTER_GROUPS[filterKey];

  const t = await getTranslations({ locale, namespace: 'dashboard.leads' });
  const tSource = await getTranslations({ locale, namespace: 'dashboard.leads.source' });
  const tStatus = await getTranslations({ locale, namespace: 'dashboard.leads.leadStatus' });

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from('leads')
    .select(
      `id, source, contact_name, contact_email, contact_phone, message, language, status, created_at,
       property:properties (id, short_id, title_en, title_es, slug_en, slug_es, city, status)`,
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (statuses) query = query.in('status', statuses as unknown as string[]);

  const { data: rawLeads, error } = await query;
  if (error) {
    return (
      <main>
        <p role="alert" className="text-red-600">
          {error.message}
        </p>
      </main>
    );
  }

  const leads = (rawLeads ?? []) as unknown as LeadRow[];
  const dateFormatter = new Intl.DateTimeFormat(locale === 'es' ? 'es-DO' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const filterPathBase = localePath(locale as Locale, '/dashboard/leads');
  const leadDetailPath = (leadId: string) => `${filterPathBase}/${leadId}`;
  const filterTab = (key: FilterKey, label: string) => {
    const isActive = filterKey === key;
    const href = key === 'all' ? filterPathBase : `${filterPathBase}?filter=${key}`;
    return (
      <a
        key={key}
        href={href}
        className={`inline-flex h-8 items-center rounded-lg px-3 text-sm transition ${
          isActive
            ? 'bg-action text-white shadow-whisper dark:bg-action-dark dark:text-surface-deep'
            : 'text-helper hover:bg-black/5 dark:hover:bg-white/5'
        }`}
      >
        {label}
      </a>
    );
  };

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
            {t('heading')}
          </h1>
          <a
            href={`${filterPathBase}/routing`}
            className="inline-flex h-7 items-center rounded-lg border border-border-strong px-2 text-xs text-helper hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('routingLink')}
          </a>
        </div>
        <nav className="flex gap-1" aria-label="Filter">
          {filterTab('all', t('filterAll'))}
          {filterTab('new', t('filterNew'))}
          {filterTab('contacted', t('filterContacted'))}
          {filterTab('closed', t('filterClosed'))}
        </nav>
      </header>

      {leads.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          <p>{t('empty')}</p>
          <p className="mt-2 text-xs text-helper">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {leads.map((lead) => {
            const propertyTitle = lead.property
              ? (typedLocale === 'es' ? lead.property.title_es : lead.property.title_en) ??
                lead.property.title_en ??
                lead.property.title_es ??
                '—'
              : t('noProperty');
            const propertySlug = lead.property
              ? typedLocale === 'es'
                ? lead.property.slug_es ?? lead.property.slug_en
                : lead.property.slug_en ?? lead.property.slug_es
              : null;
            const propertyStem = localePath(typedLocale, '/properties/[slug]').replace(
              '/[slug]',
              '',
            );
            const dashboardPropertiesStem = localePath(
              typedLocale,
              '/dashboard/properties/[id]',
            ).replace('/[id]', '');
            const propertyHref =
              lead.property && propertySlug && lead.property.status === 'active'
                ? `${propertyStem}/${propertySlug}-${lead.property.short_id}`
                : null;
            const editHref = lead.property
              ? `${dashboardPropertiesStem}/${lead.property.id}`
              : null;

            const hasContact = !!(lead.contact_name || lead.contact_email || lead.contact_phone);

            return (
              <li
                key={lead.id}
                className="group rounded-card border border-border bg-surface p-4 shadow-whisper transition hover:border-border-strong dark:bg-surface-deep"
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Whole-row link target — nested anchors / form controls
                      below override (the property link + the status select
                      sit OUTSIDE this Link to keep their click semantics
                      intact). Visible affordance: the title font-weight
                      shifts on hover so the row reads as actionable. */}
                  <Link
                    href={leadDetailPath(lead.id)}
                    className="space-y-1 min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-action/40 rounded-md"
                    aria-label={
                      hasContact && lead.contact_name
                        ? lead.contact_name
                        : t('anonymous')
                    }
                  >
                    <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                      {tSource(lead.source)} · {dateFormatter.format(new Date(lead.created_at))}
                    </p>
                    <p className="text-sm">
                      <strong className="group-hover:underline">
                        {hasContact ? lead.contact_name ?? '—' : t('anonymous')}
                      </strong>
                      {(lead.contact_email || lead.contact_phone) && (
                        <span className="ml-2 text-helper">
                          {[lead.contact_email, lead.contact_phone].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </p>
                    {lead.message && (
                      <p className="mt-2 whitespace-pre-line text-sm line-clamp-3">
                        {lead.message}
                      </p>
                    )}
                  </Link>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={lead.status} label={tStatus(lead.status)} />
                    <LeadStatusSelect leadId={lead.id} initialStatus={lead.status} />
                  </div>
                </div>
                {(propertyHref || editHref) && (
                  <p className="mt-2 text-xs">
                    {propertyHref && (
                      <a className="underline" href={propertyHref}>
                        {propertyTitle}
                      </a>
                    )}
                    {!propertyHref && editHref && (
                      <a className="underline" href={editHref}>
                        {propertyTitle}
                      </a>
                    )}
                    {propertyHref && editHref && (
                      <>
                        {' · '}
                        <a className="text-helper underline" href={editHref}>
                          edit
                        </a>
                      </>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function StatusBadge({ status, label }: { status: LeadStatus; label: string }) {
  const tone = (() => {
    switch (status) {
      case 'new':
        return 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200';
      case 'contacted':
        return 'bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200';
      case 'qualified':
        return 'bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200';
      case 'won':
        return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200';
      case 'lost':
        return 'bg-border-strong/15 text-helper';
    }
  })();
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}
