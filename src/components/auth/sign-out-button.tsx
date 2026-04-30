'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.refresh();
      router.push('/');
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="inline-flex h-9 items-center rounded-lg border border-border-strong/40 px-3 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
    >
      {t('signOut')}
    </button>
  );
}
