import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { AudienceUploader } from '@/components/admin/email/audience-uploader';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Admin · Email · New audience · AHO',
  robots: { index: false, follow: false },
};

export default async function NewAudiencePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale as Locale);

  return (
    <>
      <Link
        href={`/${locale}/admin/email/audiences`}
        className="text-sm text-helper hover:underline"
      >
        ← Back to audiences
      </Link>
      <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px]">
        Upload contacts (CSV)
      </h1>
      <AudienceUploader locale={locale} />
    </>
  );
}
