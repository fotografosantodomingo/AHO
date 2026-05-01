'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

/**
 * Publish button on the property edit page. Switched from a Server Action
 * call to a plain `fetch('/api/listings/{id}/publish')` for the same
 * reason as listing-form.tsx — Server Actions on next-on-pages had
 * Origin / Host detection mismatches behind the Pages CDN.
 */
export function PublishButton({ id }: { id: string }) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch(`/api/listings/${id}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        errorCode?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.errorCode ?? `http_${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setIsPending(false);
    }
  }

  const errorMessage = (() => {
    if (!error) return null;
    if (error === 'listing_cap_exceeded') {
      return locale === 'es'
        ? 'Has alcanzado el límite de tu plan — archiva uno o sube de plan.'
        : 'Plan limit reached — archive a listing or upgrade.';
    }
    if (error === 'forbidden') {
      return locale === 'es'
        ? 'No tienes permisos para publicar este anuncio.'
        : "You don't have permission to publish this listing.";
    }
    if (error === 'unauthenticated') {
      return locale === 'es' ? 'Tu sesión expiró.' : 'Your session expired.';
    }
    return locale === 'es' ? `Error: ${error}` : `Error: ${error}`;
  })();

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={isPending}
        className="btn-primary h-9 px-4 disabled:opacity-50"
      >
        {isPending ? '…' : t('publish')}
      </button>
      {errorMessage && (
        <p role="alert" className="ml-2 text-sm text-red-600">
          {errorMessage}
        </p>
      )}
    </>
  );
}
