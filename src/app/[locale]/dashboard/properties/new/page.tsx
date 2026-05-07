import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { ImportFromUrlPanel } from '@/components/listings/import-from-url-panel';

export const runtime = 'edge';

export const dynamic = 'force-dynamic';

export default async function NewListingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const successBase = `/${locale}/${
    locale === 'es' ? 'panel/propiedades' : 'dashboard/properties'
  }`;

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('createListingHeading')}</h1>
      </header>
      <ImportFromUrlPanel successRedirectBase={successBase} />
    </main>
  );
}
