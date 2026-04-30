import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Orgs · AHO',
  robots: { index: false, follow: false },
};

interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  type: string;
  headquarters_country: string | null;
  headquarters_city: string | null;
  listing_cap: number | null;
  created_at: string;
  member_count: number;
  active_listing_count: number;
}

/**
 * Admin → Orgs tab. Lists every organization across the platform with
 * member count, active+published listing count, type, and HQ.
 *
 * Uses two count queries with `head: true` to avoid pulling row data
 * unnecessarily — efficient even with many orgs/members/listings.
 *
 * Auth + tab nav inherited from `admin/layout.tsx`.
 */
export default async function AdminOrgsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  const supabase = await createServerSupabaseClient();

  const { data: rows, error } = await supabase
    .from('organizations')
    .select(
      'id, name, slug, type, headquarters_country, headquarters_city, listing_cap, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error.message}
      </p>
    );
  }

  const orgsBase = rows ?? [];

  // Count members + active listings per org. Two parallel HEAD queries
  // (count='exact') keep this O(orgs*2) round-trips total — fine for an
  // admin page with bounded orgs.
  const orgs: AdminOrg[] = await Promise.all(
    orgsBase.map(async (o) => {
      const [{ count: memberCount }, { count: listingCount }] = await Promise.all([
        supabase
          .from('organization_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('org_id', o.id),
        supabase
          .from('properties')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', o.id)
          .eq('status', 'active')
          .not('published_at', 'is', null),
      ]);
      return {
        ...(o as Omit<AdminOrg, 'member_count' | 'active_listing_count'>),
        member_count: memberCount ?? 0,
        active_listing_count: listingCount ?? 0,
      };
    }),
  );

  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <>
      <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
        Orgs ({orgs.length})
      </h1>

      {orgs.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          No organizations yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="text-left">
              <tr>
                {[
                  'Name',
                  'Slug',
                  'Type',
                  'HQ',
                  'Members',
                  'Active listings',
                  'Listing cap',
                  'Created',
                ].map((label) => (
                  <th
                    key={label}
                    className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {orgs.map((org) => {
                const hq =
                  [org.headquarters_city, org.headquarters_country]
                    .filter(Boolean)
                    .join(', ') || '—';
                const isFixture = org.slug.startsWith('aho-test-org-');
                return (
                  <tr
                    key={org.id}
                    className="transition hover:bg-surface-muted dark:hover:bg-surface-dark"
                  >
                    <td className="px-3 py-2">
                      <a className="underline" href={`/${locale}/agents/${org.slug}`}>
                        {org.name}
                      </a>
                      {isFixture && (
                        <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn dark:bg-warn-bg/30">
                          fixture
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-helper">
                      {org.slug}
                    </td>
                    <td className="px-3 py-2 capitalize">{org.type}</td>
                    <td className="px-3 py-2">{hq}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {org.member_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {org.active_listing_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {org.listing_cap ?? '∞'}
                    </td>
                    <td className="px-3 py-2 text-helper">
                      {dateFormatter.format(new Date(org.created_at))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
