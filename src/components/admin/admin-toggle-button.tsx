'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface AdminToggleButtonProps {
  userId: string;
  isAdmin: boolean;
  /** Email of the target user — used in the confirm() copy. */
  email: string;
  /** True when the row IS the calling admin. We render disabled + a tooltip. */
  isSelf: boolean;
}

/**
 * Promote / demote toggle for the admin users table.
 *
 * The two-state button shows "Promote to admin" for non-admins and
 * "Demote from admin" for current admins. Self-row is disabled with
 * a tooltip; the server action also rejects self-demote as a
 * belt-and-suspenders.
 */
export function AdminToggleButton({
  userId,
  isAdmin,
  email,
  isSelf,
}: AdminToggleButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isSelf) {
    return (
      <span
        className="inline-flex h-7 cursor-not-allowed items-center rounded-lg border border-border-strong/40 bg-border-strong/15 px-2 text-xs text-helper"
        title="You can't change your own admin status"
      >
        you
      </span>
    );
  }

  const verb = isAdmin ? 'Demote' : 'Promote';
  const tone = isAdmin
    ? 'border-warn/40 bg-warn-bg/40 text-warn hover:bg-warn-bg'
    : 'border-border-strong hover:bg-black/5 dark:hover:bg-white/5';

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const action = isAdmin ? 'demote' : 'promote';
        const confirmMsg = isAdmin
          ? `Demote ${email} from admin? They will lose access to /admin and admin-only RLS scopes.`
          : `Promote ${email} to admin? They will gain access to /admin and admin-only RLS scopes (read all listings, leads, orgs, users).`;
        if (!confirm(confirmMsg)) return;
        startTransition(async () => {
          setError(null);
          try {
            const res = await fetch(`/api/admin/users/${userId}/toggle-admin`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ makeAdmin: !isAdmin }),
            });
            const data = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              errorCode?: string;
            };
            if (!res.ok || !data.ok) {
              setError(data.errorCode ?? `${action}_failed`);
              return;
            }
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : `${action}_failed`);
          }
        });
      }}
      className={`inline-flex h-7 items-center rounded-lg border px-2 text-xs transition disabled:opacity-50 ${tone}`}
      title={error ?? `${verb} this user`}
    >
      {pending ? '…' : verb}
    </button>
  );
}
