'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect } from 'react';

interface Props {
  /** Optional — when a user is signed in, pass their info so the
   *  Tawk agent sees who they're talking to. */
  userName?: string | null;
  userEmail?: string | null;
}

declare global {
  interface Window {
    Tawk_API?: {
      setAttributes?: (attrs: Record<string, string>, cb?: (err?: unknown) => void) => void;
      hideWidget?: () => void;
      showWidget?: () => void;
      onLoad?: () => void;
    };
    Tawk_LoadStart?: Date;
  }
}

/**
 * Tawk.to live-chat widget for advertisehomes.online.
 *
 * Property ID: 6a061a5ce2adbe1c2e4d9070
 * Widget ID:   1jojtdugl
 *
 * Skipped on:
 *   - /dashboard/*  — agent dashboard chrome doesn't need buyer chat
 *   - /admin/*      — same
 *   - /signin / /signup / /reset-password / /forgot-password —
 *                     auth focus surfaces; chat is distracting
 *
 * When the user is signed in, we call Tawk_API.setAttributes onLoad
 * so the agent sees name + email. Otherwise the visitor stays
 * anonymous and Tawk uses its own session id.
 *
 * CSP additions land in next.config.ts:
 *   script-src   += https://embed.tawk.to https://*.tawk.to
 *   connect-src  += https://*.tawk.to wss://*.tawk.to
 *   img-src      += https://*.tawk.to https://*.tawkcdn.com
 *   frame-src    += https://*.tawk.to
 */
export function TawkWidget({ userName, userEmail }: Props) {
  const pathname = usePathname() ?? '';

  // Same-origin path-based skip list. Locale prefix already stripped
  // by the time pathname renders (e.g. /en/dashboard/*).
  //
  // /properties/* (listing detail) added 2026-05-16 — Tawk shipped
  // ~331 KiB of JS on every property page render and pushed LCP +
  // TBT over budget per Lighthouse audit. Listing detail is the
  // highest-conversion surface; the chat widget can wait for the
  // user to navigate to /agents/* or the homepage to engage.
  const skipPrefixes = ['/dashboard', '/admin', '/signin', '/signup', '/reset-password', '/forgot-password', '/setup-mfa', '/properties'];
  const shouldSkip = skipPrefixes.some((p) =>
    pathname.split('/').slice(2).join('/').startsWith(p.slice(1)),
  );

  useEffect(() => {
    if (shouldSkip) return;
    if (!userEmail) return;
    const tryIdentify = () => {
      if (typeof window === 'undefined' || !window.Tawk_API?.setAttributes) {
        return;
      }
      window.Tawk_API.setAttributes(
        {
          name: userName ?? '',
          email: userEmail,
        },
        () => undefined,
      );
    };
    // Tawk's script loads async; set on next tick + on onLoad.
    if (window.Tawk_API) {
      window.Tawk_API.onLoad = tryIdentify;
    }
    const t = setTimeout(tryIdentify, 1500);
    return () => clearTimeout(t);
  }, [userEmail, userName, shouldSkip]);

  if (shouldSkip) return null;

  return (
    <Script
      id="tawk-widget"
      strategy="lazyOnload"
      // Inline init script + embed loader, matches Tawk's official snippet.
      dangerouslySetInnerHTML={{
        __html: `
var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
(function(){
  var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
  s1.async=true;
  s1.src='https://embed.tawk.to/6a061a5ce2adbe1c2e4d9070/1jojtdugl';
  s1.charset='UTF-8';
  s1.setAttribute('crossorigin','*');
  s0.parentNode.insertBefore(s1,s0);
})();
        `.trim(),
      }}
    />
  );
}
