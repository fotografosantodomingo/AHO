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
        className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
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
