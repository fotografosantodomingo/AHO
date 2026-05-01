import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { formatPrice } from '@/lib/listings/format';
import type { PriceHistoryEvent } from '@/lib/listings/price-history';

interface Props {
  events: PriceHistoryEvent[];
  locale: Locale;
}

/**
 * Property-detail page price-history block. Hidden when only the synthetic
 * "listed" event exists (no audit history yet) — a single line restating
 * the current price isn't a "history". Shows the chronological timeline
 * once at least one real event (price change, sold, rented) has fired.
 */
export async function PriceHistory({ events, locale }: Props) {
  if (events.length < 2) return null;

  const t = await getTranslations({ locale, namespace: 'property' });
  const dateFormatter = new Intl.DateTimeFormat(
    locale === 'es' ? 'es-DO' : 'en-US',
    { year: 'numeric', month: 'short', day: 'numeric' },
  );

  return (
    <section className="mt-12 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep">
      <h2 className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
        {t('priceHistoryHeading')}
      </h2>
      <ol className="mt-4 space-y-3">
        {events.map((event, idx) => (
          <li
            key={`${event.kind}-${event.at}-${idx}`}
            className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4 border-b border-border/50 pb-3 last:border-b-0 last:pb-0"
          >
            <time
              dateTime={event.at}
              className="font-mono text-xs text-helper tabular-nums"
            >
              {dateFormatter.format(new Date(event.at))}
            </time>
            <span className="text-sm">{labelFor(event, t)}</span>
            <span className="text-sm font-semibold tabular-nums">
              {priceLabelFor(event, locale, t)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function labelFor(
  event: PriceHistoryEvent,
  t: Awaited<ReturnType<typeof getTranslations<'property'>>>,
): string {
  switch (event.kind) {
    case 'listed':
      return t('priceHistoryListed');
    case 'price_changed':
      return t('priceHistoryReduced');
    case 'sold':
      return t('priceHistorySold');
    case 'rented':
      return t('priceHistoryRented');
  }
}

function priceLabelFor(
  event: PriceHistoryEvent,
  locale: Locale,
  t: Awaited<ReturnType<typeof getTranslations<'property'>>>,
): string {
  switch (event.kind) {
    case 'listed':
      return formatPrice(event.priceCents, event.currency, locale);
    case 'price_changed': {
      const to = formatPrice(event.toCents, event.currency, locale);
      if (event.fromCents == null) return to;
      return `${formatPrice(event.fromCents, event.currency, locale)} → ${to}`;
    }
    case 'sold':
    case 'rented':
      if (event.priceCents == null) return t('priceHistoryConfidential');
      return formatPrice(event.priceCents, event.currency, locale);
  }
}
