import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Email · Audiences · AHO',
  robots: { index: false, follow: false },
};

interface AudienceRow {
  id: string;
  name: string;
  description: string | null;
  contact_count: number;
  created_at: string;
}

/**
 * /admin/email/audiences — list of uploaded contact lists.
 *
 * Each audience becomes a segment option in the campaign composer
 * (segment_key = `audience:<id>`). Click an audience to see its
 * contacts (TODO: detail view).
 */
export default async function AudiencesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('email_audiences')
    .select('id, name, description, contact_count, created_at')
    .order('created_at', { ascending: false });
  const audiences = (data ?? []) as AudienceRow[];

  const fmt = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px]">
          Audiences ({audiences.length})
        </h1>
        <div className="flex gap-2">
          <Link
            href={`/${locale}/admin/email`}
            className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
          >
            ← Back to Email
          </Link>
          <Link
            href={`/${locale}/admin/email/audiences/new`}
            className="inline-flex h-9 items-center rounded-lg bg-action px-4 text-sm font-semibold text-white shadow-whisper transition hover:opacity-90 dark:bg-action-dark dark:text-surface-deep"
          >
            + Upload CSV
          </Link>
        </div>
      </div>

      <p className="text-sm text-helper">
        Uploaded contact lists. Each shows up as a segment option in the
        campaign composer. The CSV must have headers <code>name</code>,{' '}
        <code>country</code>, <code>email</code>.
      </p>

      {audiences.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          No audiences yet. Click <em>Upload CSV</em> to import your first list.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="text-left">
              <tr>
                {['Name', 'Description', 'Contacts', 'Created', 'Segment key'].map((l) => (
                  <th
                    key={l}
                    className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
                  >
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {audiences.map((a) => (
                <tr
                  key={a.id}
                  className="transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2 text-helper">{a.description ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.contact_count}
                  </td>
                  <td className="px-3 py-2 text-helper">
                    {fmt.format(new Date(a.created_at))}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-helper">
                    audience:{a.id.slice(0, 8)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
