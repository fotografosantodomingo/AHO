'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  propertyId: string;
  /** Title shown in the confirm prompt so an admin doesn't nuke the wrong row. */
  title: string;
}

/**
 * Hard-delete a property row from the admin Listings table. Distinct from
 * `<ArchiveButton>` (reversible status flip): this calls
 * `DELETE /api/listings/:id`, which RLS-gates to platform admins via
 * `properties_admin_delete` (per migration 0004) and cascades the
 * `property_images` rows on FK on-delete.
 *
 * UX:
 *   - Two-step confirm: window.confirm with the listing title spelled out
 *     so the admin can't muscle-memory their way through a wrong row.
 *   - Inline error reporting next to the button.
 *   - Refreshes the page on success so the deleted row vanishes from the
 *     table.
 *
 * Why a separate component (vs. extending ArchiveButton): archive is
 * reversible and non-destructive; delete is forever and cascades.
 * Different shape of risk, different UI affordance (red text + clear
 * "this is forever" prompt).
 */
export function DeleteListingButton({ propertyId, title }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    const ok = window.confirm(
      `Delete "${title}" forever?\n\n` +
        'This cascades all images, leads, favorites, recent views, ' +
        'price history, and analytics events for the listing. ' +
        'This cannot be undone.\n\n' +
        'Type Cancel to keep the listing, OK to delete.',
    );
    if (!ok) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/listings/${propertyId}`, {
        method: 'DELETE',
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        errorCode?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.errorCode ?? `http_${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="inline-flex h-9 items-center rounded-lg border border-red-300 bg-red-50 px-3 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/60"
      >
        {pending ? '…' : 'Delete'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
