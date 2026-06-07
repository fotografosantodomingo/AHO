'use client';

import dynamic from 'next/dynamic';

/**
 * Client wrapper that lazy-loads PwaRegister with `ssr: false`.
 *
 * Why this file exists: `next/dynamic` with `{ ssr: false }` is NOT allowed
 * inside a Server Component in Next.js 15 (it's a build error). The root
 * locale layout is a Server Component, so the ssr:false dynamic import has to
 * live in a Client Component — this one. Keeps the service-worker registration
 * JS out of the initial/SSR path (the Lighthouse goal) while staying buildable.
 *
 * PwaRegister itself is mount-only (registers the SW in a useEffect) and
 * renders nothing, so there's no visible loading state.
 */
const PwaRegister = dynamic(
  () => import('@/components/pwa-register').then((m) => ({ default: m.PwaRegister })),
  { ssr: false, loading: () => null },
);

export function PwaRegisterLazy() {
  return <PwaRegister />;
}
