import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';
// Per-request lookup of the listing_purchases row by ?session_id —
// needs to be dynamic. Robots-noindexed too because this is a transactional
// landing only reachable from Stripe Checkout's success redirect.
export const dynamic = 'force-dynamic';

interface PageParams {
  locale: string;
}

interface SearchParams {
  session_id?: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const t = await getTranslations({ locale, namespace: 'sellPrivate' });
  return {
    title: t('success.heading'),
    robots: { index: false, follow: false },
  };
}

export default async function SellPrivateSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'sellPrivate' });
  const { session_id: sessionId } = await searchParams;
  const newListingHref = localePath(typedLocale, '/sell/private/new');
  const privateLandingHref = localePath(typedLocale, '/sell/private');

  // Best-effort lookup of the purchase row by Stripe session id so the
  // success page can confirm the payment actually landed. If the webhook
  // hasn't fired yet (Stripe retries) the row may be missing; we still
  // show the success copy because the user is here from Stripe's
  // success redirect — they paid. The lookup is purely informational
  // (drives a "we found your payment" line + auto-deep-link to the
  // create form once the row exists).
  let purchaseConfirmed = false;
  if (sessionId) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data, error } = await supabase
        .from('listing_purchases')
        .select('id, paid_at')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();
      if (!error && data?.id) purchaseConfirmed = true;
    } catch {
      // RLS could block (user not signed in or wrong account) — fall
      // through to the soft success copy.
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 md:py-24">
      <div className="rounded-card border border-border bg-surface p-8 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:p-12">
        <p
          aria-hidden="true"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          ✓
        </p>
        <h1 className="mt-6 font-brand text-3xl font-semibold tracking-tight md:text-4xl">
          {t('success.heading')}
        </h1>
        <p className="mt-4 text-base text-ink-muted dark:text-ink-inverse-muted md:text-lg">
          {t('success.body')}
        </p>
        {sessionId && (
          <p className="mt-2 text-xs text-helper">
            {typedLocale === 'es' ? 'Sesión de pago' : 'Payment session'}:{' '}
            <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[11px] dark:bg-surface-dark">
              {sessionId.slice(0, 20)}…
            </code>
            {purchaseConfirmed && (
              <span className="ml-2 text-emerald-700 dark:text-emerald-300">
                ✓ {typedLocale === 'es' ? 'confirmado' : 'confirmed'}
              </span>
            )}
          </p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={newListingHref}
            className="btn-primary inline-flex h-12 items-center px-6 text-base font-semibold"
          >
            {t('success.cta')} →
          </Link>
          <Link
            href={privateLandingHref}
            className="inline-flex h-12 items-center rounded-lg border border-border-strong bg-surface px-5 text-sm font-medium transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
          >
            {typedLocale === 'es' ? 'Volver' : 'Back'}
          </Link>
        </div>
      </div>
    </main>
  );
}
