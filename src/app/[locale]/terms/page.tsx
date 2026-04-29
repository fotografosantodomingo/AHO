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
    title: locale === 'es' ? 'Términos' : 'Terms of Service',
    description:
      locale === 'es'
        ? 'Términos de servicio de AHO.'
        : 'AHO terms of service governing use of the platform.',
    alternates: {
      canonical: `/${locale}/${locale === 'es' ? 'terminos' : 'terms'}`,
      languages: {
        en: '/en/terms',
        es: '/es/terminos',
      },
    },
  };
}

export default async function TermsPage({
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
            {locale === 'es' ? 'Términos de Servicio' : 'Terms of Service'}
          </h1>
          <p className="text-sm text-zinc-500">
            {locale === 'es' ? 'Última actualización' : 'Last updated'}: April 29, 2026
          </p>
        </header>

        <section className="space-y-3">
          <p>
            {locale === 'es'
              ? 'Estos son los Términos de Servicio provisionales de AHO. Los términos definitivos redactados por abogados reemplazarán este contenido antes del lanzamiento público.'
              : 'This is the placeholder Terms of Service for AHO. Lawyer-drafted terms replace this content before public launch.'}
          </p>
          <p>
            {locale === 'es' ? 'Para preguntas, contacta ' : 'For questions, contact '}
            <a className="underline" href="mailto:legal@advertisehomes.online">
              legal@advertisehomes.online
            </a>
            .
          </p>
        </section>
      </article>
    </main>
  );
}
