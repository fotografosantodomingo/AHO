import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { ThemeProvider } from '@/components/theme-provider';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/footer/site-footer';
import { PwaRegister } from '@/components/pwa-register';
import { TawkWidget } from '@/components/chat/tawk-widget';
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
    // PWA manifest. Static file in /public; not locale-aware (the manifest
    // describes the installed app, not the page locale — Chrome / iOS pin
    // a single manifest per scope). Lang field inside the manifest stays
    // EN for now; localizing requires per-locale manifests with separate
    // start_urls and is a future polish item.
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'AHO',
    },
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
// Default = dark per ThemeProvider config. The init script must match;
// otherwise first-paint flashes light then resolves to dark (FOUC).
const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var resolved = (stored === 'light' || stored === 'dark') ? stored : 'dark';
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

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Theme color — drives Safari iOS / Chrome address-bar tint
            so the chrome matches the AHO surface band. Light + dark
            variants picked up by the browser via prefers-color-scheme. */}
        <meta name="theme-color" content="#fbf8f1" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#15181e" media="(prefers-color-scheme: dark)" />
        {/* Preconnects — opens TLS to the image CDN early so below-the-
            fold listing thumbnails (Cloudflare Images) and the Stripe
            checkout iframe pre-arrange their TCP/TLS handshake before
            their resources are actually needed. Bumps LCP a hair on
            real-world mobile networks where TLS setup is the long pole. */}
        <link rel="preconnect" href="https://imagedelivery.net" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://imagedelivery.net" />
        <link rel="preconnect" href="https://js.stripe.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://js.stripe.com" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        {/* Skip-to-main-content — visible only on keyboard focus.
            Lighthouse "bypass blocks" already passes via <main> /
            <nav> / <footer> landmarks; the skip link is the WCAG
            ergonomic bonus for keyboard + screen-reader users. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-action focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-hidden"
        >
          Skip to main content
        </a>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <SiteHeader locale={locale as Locale} />
            <div id="main-content">{children}</div>
            <SiteFooter locale={locale as Locale} />
          </ThemeProvider>
        </NextIntlClientProvider>
        <PwaRegister />
        <TawkWidget />
      </body>
    </html>
  );
}
