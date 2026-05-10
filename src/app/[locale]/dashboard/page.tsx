import { redirect } from 'next/navigation';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

export const runtime = 'edge';

export const dynamic = 'force-dynamic';

export default async function DashboardIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  // The dashboard's home for v1 is the listings list; nothing else lives at the bare /dashboard yet.
  redirect(localePath(locale as Locale, '/dashboard/properties'));
}
