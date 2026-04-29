import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: false, // re-enable once next-intl typed routes settle
  },
  // The Cloudflare Pages adapter (@opennextjs/cloudflare) is added before
  // first deploy. Local dev uses the standard Next.js Node runtime.
};

export default withNextIntl(config);
