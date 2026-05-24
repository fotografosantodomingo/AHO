import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SimplifiedListingForm } from '@/components/listings/simplified-listing-form';

export const runtime = 'edge';
// Auth + per-user purchase-row check — must be dynamic.
export const dynamic = 'force-dynamic';

interface PageParams {
  locale: string;
}

interface SearchParams {
  need_purchase?: string;
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
    title: t('form.heading'),
    robots: { index: false, follow: false },
  };
}

/**
 * /sell/private/new — the simplified create-listing form.
 *
 * Two gates:
 *
 *   1. Auth: signed-in user. Anon → redirect to /signin with ?next=<this>.
 *   2. Paid + unconsumed `listing_purchases` row for the current user
 *      (property_id IS NULL, refunded_at IS NULL, expires_at > now()).
 *      No such row → redirect to /sell/private?need_purchase=1.
 *
 * The route doesn't accept the purchase id from the client; we look it
 * up server-side. Multiple paid-but-unconsumed rows (rare; the user
 * paid twice) → use the most recent one. The other row keeps its TTL
 * and the day-55 renewal cron will email the user to publish it too.
 */
export default async function SellPrivateNewListingPage({
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

  await searchParams;

  const t = await getTranslations({ locale, namespace: 'sellPrivate' });
  const supabase = await createServerSupabaseClient();

  // Gate 1: auth.
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    const nextPath = localePath(typedLocale, '/sell/private/new');
    redirect(
      `${localePath(typedLocale, '/signin')}?next=${encodeURIComponent(nextPath)}`,
    );
  }
  const userId = userResult.user.id;

  // Gate 2: a paid + unconsumed + unrefunded + unexpired purchase.
  const nowIso = new Date().toISOString();
  const { data: purchase, error: purchaseErr } = await supabase
    .from('listing_purchases')
    .select('id, paid_at, expires_at, property_id, refunded_at')
    .eq('buyer_user_id', userId)
    .is('property_id', null)
    .is('refunded_at', null)
    .gt('expires_at', nowIso)
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (purchaseErr) {
    console.error('[/sell/private/new] purchase lookup failed', purchaseErr);
  }

  if (!purchase) {
    redirect(`${localePath(typedLocale, '/sell/private')}?need_purchase=1`);
  }

  // Both gates passed — render the form.
  const successRedirectBase = localePath(typedLocale, '/properties/[slug]')
    .replace('/[slug]', '');

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:py-16">
      <header className="mb-8">
        <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-4xl">
          {t('form.heading')}
        </h1>
        <p className="mt-3 text-sm text-ink-muted dark:text-ink-inverse-muted">
          {t('form.creditExpires', {
            date: new Date(purchase.expires_at).toLocaleDateString(typedLocale),
          })}
        </p>
      </header>

      <SimplifiedListingForm
        purchaseId={purchase.id as string}
        successRedirectBase={successRedirectBase}
      />

      {/* Hidden footer link in case the user wants to bail back to
          the landing page without losing context — the form has no
          cancel button by design. */}
      <p className="mt-12 text-center text-xs text-helper">
        <Link
          href={localePath(typedLocale, '/sell/private')}
          className="underline-offset-4 hover:underline"
        >
          {t('form.back')}
        </Link>
      </p>
    </main>
  );
}
