'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { publishListing } from '@/lib/listings/actions';

export function PublishButton({ id }: { id: string }) {
  const t = useTranslations('dashboard');
  const tForm = useTranslations('listingForm');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const result = await publishListing(id);
      if (!result.ok) {
        setError(result.errorCode ?? 'publish_failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={isPending}
        className="inline-flex h-9 items-center rounded-lg bg-surface-dark px-4 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink disabled:opacity-50 dark:bg-surface dark:text-ink dark:hover:bg-surface-muted"
      >
        {isPending ? '…' : t('publish')}
      </button>
      {error && (
        <p role="alert" className="ml-2 text-sm text-red-600">
          {error === 'listing_cap_exceeded' ? tForm('errors.priceRequired') : error}
        </p>
      )}
    </>
  );
}
