'use client';

import { useEffect } from 'react';

/**
 * Registers the Service Worker on mount.
 *
 * Why a client component: navigator.serviceWorker is only available in
 * the browser, and registration must happen *after* hydration so we
 * don't run it during prerender of marketing pages.
 *
 * Skipped in localhost / preview where the SW would mostly just confuse
 * dev tools. Production-only registration also avoids stale SWs surviving
 * a `pnpm dev` ↔ deploy switch on the same machine.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Match the production hostname OR any *.pages.dev deploy preview.
    // Localhost stays SW-free.
    const host = window.location.hostname;
    const isDeployed =
      host === 'advertisehomes.online' ||
      host === 'www.advertisehomes.online' ||
      host.endsWith('.pages.dev');
    if (!isDeployed) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        // Don't surface SW failures to users — the site works fine
        // without it; they just lose Add-to-Home-Screen.
        console.warn('[PWA] service worker registration failed', err);
      });
  }, []);

  return null;
}
