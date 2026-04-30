import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/listings/seo';
import { PublishButton } from '@/components/listings/publish-button';

export const runtime = 'edge';

export const dynamic = 'force-dynamic';

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const supabase = await createServerSupabaseClient();
  const { data: listing, error } = await supabase
    .from('properties')
    .select(
      'id, short_id, status, title_en, title_es, slug_en, slug_es, city, country_code, price_cents, currency, image_count, published_at, updated_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !listing) notFound();

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const tStatus = await getTranslations({ locale, namespace: 'dashboard.status' });

  const title =
    (typedLocale === 'es' ? listing.title_es : listing.title_en) ??
    listing.title_en ??
    listing.title_es ??
    '—';

  // Path to the public listing (only useful when status='active' AND a slug exists for this locale).
  const slugForLocale = typedLocale === 'es' ? listing.slug_es : listing.slug_en;
  const publicPath =
    listing.status === 'active' && slugForLocale
      ? `/${typedLocale}/${typedLocale === 'es' ? 'propiedades' : 'properties'}/${slugForLocale}-${listing.short_id}`
      : null;

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
            {title}
          </h1>
          <p className="mt-1 text-sm text-helper">
            <code className="font-mono">{listing.short_id}</code> ·{' '}
            {tStatus(listing.status)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {publicPath && (
            <a
              href={publicPath}
              className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
              target="_blank"
              rel="noreferrer"
            >
              View public page
            </a>
          )}
          {listing.status === 'draft' && <PublishButton id={listing.id} />}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-4 rounded-card border border-border bg-surface p-4 text-sm shadow-whisper dark:bg-surface-deep sm:grid-cols-3">
        <Stat label={t('table.city')} value={listing.city} />
        <Stat
          label={t('table.price')}
          value={formatPrice(Number(listing.price_cents), listing.currency, typedLocale)}
        />
        <Stat label={t('table.images')} value={String(listing.image_count)} />
      </dl>

      <section className="rounded-card border border-dashed border-border-strong/60 p-6 text-sm text-helper">
        Image upload UI lands once Cloudflare R2 is configured. The API
        endpoints exist (<code>POST /api/properties/{listing.id}/images</code>{' '}
        + confirm), and the data layer enforces the 30-image cap and
        upload_status lifecycle.
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
        {label}
      </dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}
