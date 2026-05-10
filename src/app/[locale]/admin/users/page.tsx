import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { AdminToggleButton } from '@/components/admin/admin-toggle-button';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Users · AHO',
  robots: { index: false, follow: false },
};

interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  is_admin: boolean;
  admin_role: string | null;
  locale: string | null;
  created_at: string;
  org_membership_count: number;
}

interface SearchParams {
  filter?: string;
}

const FILTERS = ['all', 'admins'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Admin → Users tab. Lists every profile in the system. Each row carries
 * a promote/demote toggle (via setUserAdmin server action). The currently
 * signed-in admin's row shows "you" instead of a button — defense-in-depth
 * against accidental self-demote (the action also enforces this).
 *
 * The user-listing comes from `profiles` (RLS admin policy permits SELECT
 * for admins). Auth users without a profile row don't appear — the
 * profile is created in a trigger on auth.users insert (per migration
 * 0002), so this is the same set in practice.
 */
export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  const sp = await searchParams;
  const rawFilter = sp.filter ?? 'all';
  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter)
    ? (rawFilter as Filter)
    : 'all';

  const supabase = await createServerSupabaseClient();
  const { data: callerResult } = await supabase.auth.getUser();
  const callerId = callerResult.user?.id ?? null;

  let query = supabase
    .from('profiles')
    .select('id, email, full_name, is_admin, admin_role, locale, created_at')
    .order('is_admin', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (filter === 'admins') {
    query = query.eq('is_admin', true);
  }

  const { data: rows, error } = await query;
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error.message}
      </p>
    );
  }

  const baseRows = (rows ?? []) as Omit<AdminUser, 'org_membership_count'>[];

  // Single grouped query via RPC (migration 0044) instead of one HEAD
  // count per user. Pre-migration / pre-deploy fall-back: if the RPC
  // doesn't exist yet, every user shows membership_count = 0 — visible
  // but recoverable; a refresh after the migration runs fixes it.
  const { data: countRows } = await supabase.rpc('admin_user_membership_counts');
  const countMap = new Map<string, number>();
  for (const r of (countRows ?? []) as Array<{ user_id: string; membership_count: number }>) {
    countMap.set(r.user_id, Number(r.membership_count));
  }
  const users: AdminUser[] = baseRows.map((u) => ({
    ...u,
    org_membership_count: countMap.get(u.id) ?? 0,
  }));

  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const filterTab = (key: Filter, label: string) => {
    const isActive = filter === key;
    const href =
      key === 'all'
        ? `/${locale}/admin/users`
        : `/${locale}/admin/users?filter=${key}`;
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

  const adminCount = users.filter((u) => u.is_admin).length;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          Users ({users.length}){' '}
          <span className="ml-2 text-sm font-normal text-helper">
            · {adminCount} admin{adminCount === 1 ? '' : 's'}
          </span>
        </h1>
        <nav className="flex flex-wrap gap-1" aria-label="User filter">
          {filterTab('all', 'All')}
          {filterTab('admins', 'Admins')}
        </nav>
      </div>

      {users.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          No users match this filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="text-left">
              <tr>
                {['Email', 'Name', 'Role', 'Locale', 'Orgs', 'Joined', ''].map((label) => (
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
              {users.map((user) => {
                const isFixture = user.email?.endsWith('@aho.test') === true;
                return (
                  <tr
                    key={user.id}
                    className="transition hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {user.email ?? '(no email)'}
                      {isFixture && (
                        <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn dark:bg-warn-bg/30">
                          fixture
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{user.full_name ?? '—'}</td>
                    <td className="px-3 py-2">
                      {user.is_admin ? (
                        <span className="inline-flex items-center rounded-full bg-action/10 px-2 py-0.5 text-xs font-medium text-action dark:text-action-dark">
                          {user.admin_role ?? 'admin'}
                        </span>
                      ) : (
                        <span className="text-helper">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-helper">{user.locale ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {user.org_membership_count}
                    </td>
                    <td className="px-3 py-2 text-helper">
                      {dateFormatter.format(new Date(user.created_at))}
                    </td>
                    <td className="px-3 py-2">
                      <AdminToggleButton
                        userId={user.id}
                        isAdmin={user.is_admin}
                        email={user.email ?? user.id}
                        isSelf={callerId === user.id}
                      />
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
