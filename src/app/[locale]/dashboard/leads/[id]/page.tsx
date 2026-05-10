import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { LeadStatusSelect } from '@/components/leads/lead-status-select';
import { LeadNotesEditor } from '@/components/leads/lead-notes-editor';
import { LeadQuickStatusButton } from '@/components/leads/lead-quick-status-button';
import { buildImageUrl } from '@/lib/listings/image-url';
import { formatPrice } from '@/lib/listings/format';
import type { LeadStatus, LeadSource } from '@/db/schema';

export const runtime = 'edge';

// Auth-dependent — must run per-request, not pre-rendered.
export const dynamic = 'force-dynamic';

/**
 * Per-lead detail page (`/dashboard/leads/[id]`).
 *
 * Server Component — does the entire fetch + render in one round trip.
 * Two client islands: <LeadStatusSelect> and <LeadNotesEditor>.
 *
 * 404 strategy: the user-context Supabase client runs under the caller's
 * session, so the existing `leads_org_member_select` RLS policy filters
 * cross-org leads to nothing. We read with `.maybeSingle()` and call
 * `notFound()` if the row doesn't come back — that collapses
 * "doesn't exist" and "exists in another org you can't see" into the
 * same 404 (don't leak existence).
 *
 * Activity timeline: built from `created_at` + `updated_at` + the
 * current `status`. A dedicated `lead_events` table was deferred (see
 * `0042_lead_notes.sql` header for why).
 */
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  // Validate the id shape before hitting the DB — Postgres would 22P02
  // on a non-uuid and we'd waste a round trip.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();
  const { data: lead, error } = await supabase
    .from('leads')
    .select(
      `id, source, contact_name, contact_email, contact_phone, message, language,
       status, notes, created_at, updated_at, org_id,
       property:properties (
         id, short_id, title_en, title_es, slug_en, slug_es, city, country_code,
         price_cents, currency, status,
         property_images ( cf_image_id, r2_key, is_primary, position, upload_status )
       )`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !lead) notFound();

  type LeadRow = {
    id: string;
    source: LeadSource;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    message: string | null;
    language: string | null;
    status: LeadStatus;
    notes: string | null;
    created_at: string;
    updated_at: string;
    org_id: string;
    property: {
      id: string;
      short_id: string;
      title_en: string | null;
      title_es: string | null;
      slug_en: string | null;
      slug_es: string | null;
      city: string;
      country_code: string;
      price_cents: number;
      currency: string;
      status: string;
      property_images: Array<{
        cf_image_id: string | null;
        r2_key: string | null;
        is_primary: boolean;
        position: number | null;
        upload_status: string | null;
      }> | null;
    } | null;
  };

  const row = lead as unknown as LeadRow;

  const t = await getTranslations({ locale, namespace: 'dashboard.leads' });
  const tDetail = await getTranslations({ locale, namespace: 'dashboard.leads.detail' });
  const tStatus = await getTranslations({ locale, namespace: 'dashboard.leads.leadStatus' });

  const dateFormatter = new Intl.DateTimeFormat(locale === 'es' ? 'es-DO' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const inboxPath = `/${locale}/${locale === 'es' ? 'panel/contactos' : 'dashboard/leads'}`;

  // Property derivations — null-safe for the case where the listing was
  // deleted but the lead row was preserved (cascade-safe; leads.property_id
  // is FK on delete cascade so this branch is rare in practice, but the
  // join `to-one` returns null and the page should still render).
  const property = row.property;
  const propertyTitle = property
    ? (typedLocale === 'es' ? property.title_es : property.title_en) ??
      property.title_en ??
      property.title_es ??
      '—'
    : null;
  const propertySlug = property
    ? typedLocale === 'es'
      ? property.slug_es ?? property.slug_en
      : property.slug_en ?? property.slug_es
    : null;
  const publicPropertyHref =
    property && propertySlug && property.status === 'active'
      ? `/${locale}/${typedLocale === 'es' ? 'propiedades' : 'properties'}/${propertySlug}-${property.short_id}`
      : null;
  const editPropertyHref = property
    ? `/${locale}/${typedLocale === 'es' ? 'panel/propiedades' : 'dashboard/properties'}/${property.id}`
    : null;

  // Primary image: prefer is_primary=true, then lowest position, then first.
  const primaryImage = (() => {
    const imgs = property?.property_images ?? [];
    if (imgs.length === 0) return null;
    const ready = imgs.filter((i) => i.upload_status !== 'failed');
    const list = ready.length > 0 ? ready : imgs;
    const sorted = [...list].sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return (a.position ?? 999) - (b.position ?? 999);
    });
    return sorted[0] ?? null;
  })();
  const thumbnailUrl = primaryImage
    ? buildImageUrl({
        cfImageId: primaryImage.cf_image_id,
        r2Key: primaryImage.r2_key,
        variant: 'thumbnail',
      })
    : null;

  // Source label — the inbox uses the bare `source.{key}` namespace; the
  // detail page promotes them to longer "From X" phrasing.
  const sourceLabel = (() => {
    switch (row.source) {
      case 'form':
        return tDetail('sourceForm');
      case 'phone_click':
        return tDetail('sourcePhone');
      case 'whatsapp_click':
        return tDetail('sourceWhatsApp');
      case 'email_click':
        return tDetail('sourceEmail');
    }
  })();

  // WhatsApp deep-link to the BUYER (the lead's phone). The shared
  // `buildWhatsAppLink` helper is shaped around the buyer→agent flow on
  // the public listing page; here it's the inverse (agent→buyer with a
  // pre-filled outreach message), so we build the wa.me URL inline.
  // Only render when the buyer left a phone number long enough to be
  // plausibly real — same 8-digit floor the public-side helper uses.
  const whatsappHref = (() => {
    if (!row.contact_phone) return null;
    const digits = row.contact_phone.replace(/\D/g, '');
    if (digits.length < 8) return null;
    const prefill = row.contact_name
      ? tDetail('whatsappPrefill', { name: row.contact_name, title: propertyTitle ?? '' })
      : tDetail('whatsappPrefillNoName', { title: propertyTitle ?? '' });
    return `https://wa.me/${digits}?text=${encodeURIComponent(prefill)}`;
  })();

  const hasContact = !!(row.contact_name || row.contact_email || row.contact_phone);

  return (
    <main className="space-y-6">
      <div>
        <a
          href={inboxPath}
          className="inline-flex items-center gap-1 text-sm text-helper hover:underline"
        >
          ← {tDetail('backToInbox')}
        </a>
      </div>

      {/* Header strip */}
      <header className="space-y-3 rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="font-brand text-[12px] font-semibold uppercase tracking-[0.13em] text-helper">
              {sourceLabel}
              {property && publicPropertyHref ? (
                <>
                  {' · '}
                  <a className="underline" href={publicPropertyHref}>
                    {propertyTitle}
                  </a>
                </>
              ) : property && editPropertyHref ? (
                <>
                  {' · '}
                  <a className="underline" href={editPropertyHref}>
                    {propertyTitle}
                  </a>
                </>
              ) : null}
            </p>
            <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
              {row.contact_name ?? t('anonymous')}
            </h1>
            <p className="text-sm text-helper">
              {dateFormatter.format(new Date(row.created_at))}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <StatusBadge status={row.status} label={tStatus(row.status)} />
            <LeadStatusSelect leadId={row.id} initialStatus={row.status} />
          </div>
        </div>

        {hasContact ? (
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {row.contact_email && (
              <a className="underline" href={`mailto:${row.contact_email}`}>
                {row.contact_email}
              </a>
            )}
            {row.contact_phone && (
              <a className="underline" href={`tel:${row.contact_phone}`}>
                {row.contact_phone}
              </a>
            )}
          </div>
        ) : (
          <p className="text-sm text-helper">{tDetail('noContact')}</p>
        )}
      </header>

      {/* Two-column on md+, stacked on mobile. Left column has the
          message + property + notes; right column has quick actions +
          activity. */}
      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <div className="space-y-6 min-w-0">
          {/* Message */}
          <section className="rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep">
            <h2 className="font-brand text-sm font-semibold uppercase tracking-[0.13em] text-helper">
              {tDetail('messageHeading')}
            </h2>
            {row.message ? (
              <p className="mt-3 whitespace-pre-line text-sm">{row.message}</p>
            ) : (
              <p className="mt-3 text-sm text-helper italic">{tDetail('noMessage')}</p>
            )}
          </section>

          {/* Property context */}
          {property && (
            <section className="rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep">
              <h2 className="font-brand text-sm font-semibold uppercase tracking-[0.13em] text-helper">
                {tDetail('propertyHeading')}
              </h2>
              <div className="mt-3 flex gap-4">
                {thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnailUrl}
                    alt=""
                    className="h-20 w-28 shrink-0 rounded-lg object-cover"
                    width={112}
                    height={80}
                    loading="lazy"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="h-20 w-28 shrink-0 rounded-lg bg-border-strong/20"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium text-sm truncate">{propertyTitle}</p>
                  <p className="text-xs text-helper">
                    {property.city} · {formatPrice(Number(property.price_cents), property.currency, typedLocale)}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs pt-1">
                    {publicPropertyHref && (
                      <a className="underline" href={publicPropertyHref}>
                        {tDetail('viewListing')}
                      </a>
                    )}
                    {editPropertyHref && (
                      <a className="text-helper underline" href={editPropertyHref}>
                        {tDetail('editListing')}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Notes */}
          <section className="rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep">
            <h2 className="font-brand text-sm font-semibold uppercase tracking-[0.13em] text-helper">
              {tDetail('notesHeading')}
            </h2>
            <p className="mt-1 text-xs text-helper">{tDetail('notesHint')}</p>
            <div className="mt-3">
              <LeadNotesEditor
                leadId={row.id}
                initialNotes={row.notes ?? ''}
                labels={{
                  placeholder: tDetail('notesPlaceholder'),
                  saving: tDetail('notesSaving'),
                  saved: tDetail('notesSaved'),
                  error: tDetail('notesError'),
                  srLabel: tDetail('notesHeading'),
                }}
              />
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          {/* Quick actions */}
          <section className="rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep">
            <h2 className="font-brand text-sm font-semibold uppercase tracking-[0.13em] text-helper">
              {tDetail('actionsHeading')}
            </h2>
            <div className="mt-3 flex flex-col gap-2">
              {row.contact_phone && (
                <a
                  href={`tel:${row.contact_phone}`}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {tDetail('actionCall')}
                </a>
              )}
              {row.contact_email && (
                <a
                  href={`mailto:${row.contact_email}`}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {tDetail('actionEmail')}
                </a>
              )}
              {whatsappHref && (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {tDetail('actionWhatsApp')}
                </a>
              )}
              {/* Status quick-pick: redundant with the inbox-style select
                  in the header but agents asked for explicit "won/lost"
                  buttons (one click, no dropdown navigation). */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <LeadQuickStatusButton
                  leadId={row.id}
                  current={row.status}
                  target="won"
                  label={tDetail('actionMarkWon')}
                  tone="emerald"
                />
                <LeadQuickStatusButton
                  leadId={row.id}
                  current={row.status}
                  target="lost"
                  label={tDetail('actionMarkLost')}
                  tone="muted"
                />
              </div>
            </div>
          </section>

          {/* Activity timeline (derived from created_at + updated_at + status) */}
          <section className="rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep">
            <h2 className="font-brand text-sm font-semibold uppercase tracking-[0.13em] text-helper">
              {tDetail('timelineHeading')}
            </h2>
            <ol className="mt-3 space-y-3 text-sm">
              <li className="flex gap-2">
                <span aria-hidden="true" className="mt-1 h-2 w-2 rounded-full bg-border-strong shrink-0" />
                <div className="min-w-0">
                  <p>{tDetail('timelineCreated')}</p>
                  <p className="text-xs text-helper">
                    {dateFormatter.format(new Date(row.created_at))}
                  </p>
                </div>
              </li>
              {row.updated_at !== row.created_at && (
                <li className="flex gap-2">
                  <span aria-hidden="true" className="mt-1 h-2 w-2 rounded-full bg-action shrink-0" />
                  <div className="min-w-0">
                    <p>
                      {tDetail('timelineUpdated')} · {tStatus(row.status)}
                    </p>
                    <p className="text-xs text-helper">
                      {dateFormatter.format(new Date(row.updated_at))}
                    </p>
                  </div>
                </li>
              )}
            </ol>
          </section>
        </aside>
      </div>
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

