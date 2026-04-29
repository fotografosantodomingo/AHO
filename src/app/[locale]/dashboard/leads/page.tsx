import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
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

  const filterPathBase = `/${locale}/${
    locale === 'es' ? 'panel/contactos' : 'dashboard/leads'
  }`;
  const filterTab = (key: FilterKey, label: string) => {
    const isActive = filterKey === key;
    const href = key === 'all' ? filterPathBase : `${filterPathBase}?filter=${key}`;
    return (
      <a
        key={key}
        href={href}
        className={`inline-flex h-8 items-center rounded-md px-3 text-sm ${
          isActive
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
            : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
        }`}
      >
        {label}
      </a>
    );
  };

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <nav className="flex gap-1" aria-label="Filter">
          {filterTab('all', t('filterAll'))}
          {filterTab('new', t('filterNew'))}
          {filterTab('contacted', t('filterContacted'))}
          {filterTab('closed', t('filterClosed'))}
        </nav>
      </header>

      {leads.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          <p>{t('empty')}</p>
          <p className="mt-2 text-xs text-zinc-500">{t('emptyHint')}</p>
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
            const propertyHref =
              lead.property && propertySlug && lead.property.status === 'active'
                ? `/${locale}/${
                    typedLocale === 'es' ? 'propiedades' : 'properties'
                  }/${propertySlug}-${lead.property.short_id}`
                : null;
            const editHref =
              lead.property
                ? `/${locale}/${
                    typedLocale === 'es' ? 'panel/propiedades' : 'dashboard/properties'
                  }/${lead.property.id}`
                : null;

            const hasContact = !!(lead.contact_name || lead.contact_email || lead.contact_phone);

            return (
              <li
                key={lead.id}
                className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      {tSource(lead.source)} · {dateFormatter.format(new Date(lead.created_at))}
                    </p>
                    <p className="text-sm">
                      <strong>
                        {hasContact ? lead.contact_name ?? '—' : t('anonymous')}
                      </strong>
                      {(lead.contact_email || lead.contact_phone) && (
                        <span className="ml-2 text-zinc-600 dark:text-zinc-400">
                          {[lead.contact_email, lead.contact_phone].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </p>
                    {lead.message && (
                      <p className="mt-2 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
                        {lead.message}
                      </p>
                    )}
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
                            <a className="text-zinc-500 underline" href={editHref}>
                              edit
                            </a>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={lead.status} label={tStatus(lead.status)} />
                    <LeadStatusSelect leadId={lead.id} initialStatus={lead.status} />
                  </div>
                </div>
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
        return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400';
    }
  })();
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}
