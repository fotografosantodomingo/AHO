import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { FaqEditor } from '@/components/dashboard/faq-editor';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Agent dashboard → FAQs. Server-resolves the user's org and the
 * agent's existing FAQ rows, then hands them to the client editor.
 *
 * Writes go through the Supabase browser client subject to RLS
 * (migration 0032's owner/manager policy). No service role required —
 * the agent is signed in and acts on their own org.
 */
export default async function DashboardFaqsPage({ params }: PageProps) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    redirect(`/${locale}/${typedLocale === 'es' ? 'iniciar-sesion' : 'signin'}`);
  }

  // Find the org the user owns (or manages). FAQs are org-scoped, not
  // user-scoped — multiple owners/managers can edit the same set.
  const { data: membership } = await supabase
    .from('organization_members')
    .select('org_id, role, organizations!inner(name, slug)')
    .eq('user_id', userResult.user.id)
    .in('role', ['owner', 'manager'])
    .limit(1)
    .maybeSingle();

  if (!membership) {
    // No manage-rights — they can't edit FAQs. Bounce to dashboard root.
    redirect(`/${locale}/${typedLocale === 'es' ? 'panel' : 'dashboard'}`);
  }

  const orgId = membership.org_id as string;
  const orgField = membership.organizations as
    | { name: string; slug: string }
    | { name: string; slug: string }[]
    | null;
  const org = Array.isArray(orgField) ? orgField[0] ?? null : orgField;

  const { data: faqRows } = await supabase
    .from('agent_faqs')
    .select('id, question_en, question_es, answer_en, answer_es, sort_order')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  const t = await getTranslations({ locale, namespace: 'dashboardFaqs' });

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-brand text-2xl font-bold tracking-tight">
          {t('heading')}
        </h1>
        <p className="max-w-2xl text-sm text-helper">{t('subheading')}</p>
        {org && (
          <p className="text-xs text-helper">
            {t('publishedTo')}{' '}
            <a
              href={`/${locale}/${typedLocale === 'es' ? 'agentes' : 'agents'}/${org.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-action underline-offset-2 hover:underline dark:text-action-dark"
            >
              {org.name}
            </a>
          </p>
        )}
      </header>
      <FaqEditor
        orgId={orgId}
        locale={typedLocale}
        initialFaqs={(faqRows ?? []).map((r) => ({
          id: r.id as string,
          questionEn: (r.question_en as string | null) ?? '',
          questionEs: (r.question_es as string | null) ?? '',
          answerEn: (r.answer_en as string | null) ?? '',
          answerEs: (r.answer_es as string | null) ?? '',
          sortOrder: r.sort_order as number,
        }))}
      />
    </main>
  );
}
