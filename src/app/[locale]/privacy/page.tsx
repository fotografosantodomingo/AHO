import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';

export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'es' ? 'Privacidad' : 'Privacy Policy',
    description:
      locale === 'es'
        ? 'Política de privacidad de AHO.'
        : 'AHO privacy policy describing how we collect and use information.',
    alternates: {
      canonical: `/${locale}/privacy`,
      languages: {
        en: '/en/privacy',
        es: '/es/privacidad',
      },
    },
  };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <article className="space-y-4">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold">
            {locale === 'es' ? 'Política de Privacidad' : 'Privacy Policy'}
          </h1>
          <p className="text-sm text-helper">
            {locale === 'es' ? 'Última actualización' : 'Last updated'}: April 29, 2026
          </p>
        </header>

        <section className="space-y-3">
          <p>
            {locale === 'es'
              ? 'Esta es la Política de Privacidad provisional de AHO (Advertise Homes Online), operada en advertisehomes.online. El texto definitivo redactado por abogados reemplazará este contenido antes del lanzamiento público.'
              : 'This is the placeholder Privacy Policy for AHO (Advertise Homes Online), operated at advertisehomes.online. The lawyer-drafted policy text replaces this content before public launch.'}
          </p>
          <p>
            {locale === 'es' ? 'Para preguntas, contacta ' : 'For questions, contact '}
            <a className="underline" href="mailto:privacy@advertisehomes.online">
              privacy@advertisehomes.online
            </a>
            .
          </p>
        </section>
      </article>
    </main>
  );
}
