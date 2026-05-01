import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { precomputeApproxLabels } from '@/lib/currency/server';
import { getRecentViews, ANON_COOKIE_NAME } from '@/lib/listings/recent-views';
import { getUserFavoriteIds } from '@/lib/listings/favorites';
import { ListingCard } from './listing-card';
import type { Locale } from '@/i18n/config';

interface Props {
  locale: Locale;
  /** Optional property ID to exclude from the rail — used on the
   *  property detail page so the rail doesn't show the listing the
   *  user is currently looking at. */
  excludeId?: string;
  limit?: number;
}

/**
 * "Recently viewed" rail (feat/recently-viewed). Server Component.
 *
 * Reads the visitor's identity (signed-in user OR `aho_anon_id` cookie)
 * and queries `property_recent_views` via the admin client (anon
 * visitors have no auth context for RLS to gate).
 *
 * Hides itself when:
 *   - The visitor has no recent views (cookie absent + signed out, or
 *     newly-cleared list).
 *   - The only viewed property is the one currently being shown
 *     (`excludeId` filter consumed it).
 *
 * Honest emptiness — no fallback to "popular nearby" or other
 * substitutions. If the rail has nothing to show, it doesn't render.
 */
export async function RecentlyViewed({ locale, excludeId, limit = 8 }: Props) {
  const cookieStore = await cookies();
  const userClient = await createServerSupabaseClient();
  const { data: userResult } = await userClient.auth.getUser();
  const userId = userResult.user?.id ?? null;
  const anonymousId = userId
    ? null
    : cookieStore.get(ANON_COOKIE_NAME)?.value ?? null;

  if (!userId && !anonymousId) return null;

  // Use admin client for the read because anon visitors have no auth
  // context. (RLS allows the user-context owner-self read for authed,
  // but going through admin keeps the call site uniform.)
  const admin = createAdminClient();
  const listings = await getRecentViews({
    supabase: admin,
    userId,
    anonymousId,
    excludeId,
    limit,
  });
  if (listings.length === 0) return null;

  const t = await getTranslations({ locale, namespace: 'recentlyViewed' });

  // Approx labels + favorites set, for parity with every other surface
  // that renders ListingCard.
  const approxLabels = await precomputeApproxLabels(
    listings.map((l) => ({
      id: l.id,
      priceCents: l.priceCents,
      currency: l.currency,
    })),
    locale,
  );
  const favoriteIds = await getUserFavoriteIds(
    userClient,
    userId,
    listings.map((l) => l.id),
  );

  return (
    <section
      aria-labelledby="recently-viewed-heading"
      className="mt-16 space-y-4"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2
          id="recently-viewed-heading"
          className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
        >
          {t('heading')}
        </h2>
      </header>

      {/* Mobile: horizontal snap-scroll. md+: grid. Same data, two layouts. */}
      <ul className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-4">
        {listings.map((l) => (
          <li
            key={l.id}
            className="w-64 shrink-0 snap-start md:w-auto md:shrink"
          >
            <ListingCard
              listing={l}
              locale={locale}
              approxPriceLabel={approxLabels.get(l.id) ?? null}
              favorited={favoriteIds.has(l.id)}
              isAuthed={!!userId}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
