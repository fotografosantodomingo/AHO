import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleToggle } from '@/components/locale-toggle';
import { AuthMenu } from '@/components/auth/auth-menu';
import '../globals.css';

// Brand font — substituted for HashiCorp Sans (proprietary; we don't have
// the license). Inter preserves the dense, kerned-tight, infrastructural
// feel while staying OFL-licensed. Bound to the `--font-inter` CSS variable
// that `globals.css` consumes via the `--font-brand` token.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

// The layout renders the AuthMenu, which depends on the request's session
// cookies via the Supabase server client. Static prerendering would cache a
// "no user" layout and serve it to logged-in users until first dynamic
// navigation. Force dynamic so the layout RSC runs per-request.
//
// SEO-critical pages (property detail, list pages) still cache server-side
// via their own per-route caching strategy when we add it; this only forces
// the layout shell to be dynamic.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'site' });
  return {
    title: { default: `${t('name')} — ${t('tagline')}`, template: `%s | ${t('name')}` },
    description: t('description'),
    metadataBase: new URL('https://advertisehomes.online'),
    openGraph: {
      type: 'website',
      siteName: t('name'),
      locale: locale === 'es' ? 'es_DO' : 'en_US',
      alternateLocale: locale === 'es' ? ['en_US'] : ['es_DO'],
    },
    twitter: { card: 'summary_large_image' },
    robots: { index: true, follow: true },
  };
}

// Inline blocking script that sets the theme class on <html> before first
// paint. next-themes does this on hydration but a few ms of FOUC can leak
// without the inline script. Standard pattern; do not remove.
const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored || 'system';
    var resolved = theme === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.classList.remove('light','dark');
    document.documentElement.classList.add(resolved);
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {}
})();
`.trim();

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();
  const t = await getTranslations({ locale, namespace: 'footer' });

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <header className="border-b border-border">
              <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
                <a href={`/${locale}`} className="font-brand text-lg font-bold tracking-tight">
                  AHO
                </a>
                <div className="flex items-center gap-3">
                  <AuthMenu locale={locale as Locale} />
                  <LocaleToggle />
                  {/* Theme toggle is a 3-button group (~136px wide) — hide
                      on narrow viewports where the header gets cramped.
                      Theme is a "set once" preference so this is safe. */}
                  <span className="hidden sm:inline-flex">
                    <ThemeToggle />
                  </span>
                </div>
              </div>
            </header>
            <div>{children}</div>
            <footer className="mt-24 border-t border-border">
              <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6 text-xs text-helper">
                <p>© 2026 AHO. {t('rights')}</p>
                <nav className="flex gap-4">
                  <a className="hover:underline" href={`/${locale}/privacy`}>
                    {t('privacy')}
                  </a>
                  <a
                    className="hover:underline"
                    href={`/${locale}/${locale === 'es' ? 'terminos' : 'terms'}`}
                  >
                    {t('terms')}
                  </a>
                </nav>
              </div>
            </footer>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
