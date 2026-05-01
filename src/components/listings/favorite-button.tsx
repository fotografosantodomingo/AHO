'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';

interface Props {
  propertyId: string;
  initialFavorited: boolean;
  /** When true, the user is authenticated. False → click bounces to signin. */
  isAuthed: boolean;
  locale: Locale;
  /** Visual size:
   *  - 'card' (default): small overlay heart for listing cards. White-on-
   *    image background; 36×36 touch target.
   *  - 'detail': larger inline heart for the property detail page. */
  size?: 'card' | 'detail';
  /** Optional path to land on after sign-in, defaults to current URL.
   *  Server-side path resolution is awkward from a client component, so
   *  we rely on `window.location` at click time. */
}

/**
 * Heart toggle for buyer-side favorites (feat/favorites). Optimistic UX —
 * we flip the visual state immediately and roll back if the API errors,
 * so the click feels instant.
 *
 * Auth model:
 *   - Signed-in user: POST /api/properties/:id/favorite. Server flips
 *     state via insert-or-delete, returns the new boolean. Optimistic
 *     state matches; if it doesn't, snap to server truth.
 *   - Anonymous user: a click redirects to /signin?next=<current path>
 *     so they can come back to the same listing after auth.
 *
 * Accessibility:
 *   - aria-pressed reflects favorited state.
 *   - aria-label switches "Save to favorites" / "Remove from favorites".
 *   - Keyboard-accessible by virtue of being a real button.
 */
export function FavoriteButton({
  propertyId,
  initialFavorited,
  isAuthed,
  locale,
  size = 'card',
}: Props) {
  const t = useTranslations('favorite');
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    if (!isAuthed) {
      const here = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
      const signinPath = `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}`;
      router.push(`${signinPath}?next=${encodeURIComponent(here)}`);
      return;
    }

    // Optimistic flip.
    const next = !favorited;
    setFavorited(next);
    setError(false);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/properties/${propertyId}/favorite`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('toggle failed');
        const j = (await res.json()) as { favorited?: boolean };
        if (typeof j.favorited === 'boolean' && j.favorited !== next) {
          // Server disagrees — snap to its truth.
          setFavorited(j.favorited);
        }
      } catch {
        // Roll back the optimistic flip.
        setFavorited(!next);
        setError(true);
      }
    });
  }

  const label = favorited ? t('remove') : t('add');

  if (size === 'detail') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={favorited}
        aria-label={label}
        title={error ? t('error') : label}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-border-strong bg-surface px-4 text-sm font-medium transition hover:border-action active:scale-95 disabled:opacity-60"
      >
        <Heart
          aria-hidden="true"
          className={`h-4 w-4 transition-colors ${
            favorited ? 'fill-action stroke-action dark:fill-action-dark dark:stroke-action-dark' : 'stroke-helper'
          }`}
          strokeWidth={2}
        />
        <span>{favorited ? t('savedLabel') : t('saveLabel')}</span>
      </button>
    );
  }

  // 'card' variant — small floating heart in the top-right corner of an image.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={favorited}
      aria-label={label}
      title={error ? t('error') : label}
      className="absolute top-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface/95 shadow-whisper backdrop-blur-sm transition hover:bg-surface active:scale-95"
    >
      <Heart
        aria-hidden="true"
        className={`h-4 w-4 transition-colors ${
          favorited ? 'fill-action stroke-action dark:fill-action-dark dark:stroke-action-dark' : 'stroke-ink-muted'
        }`}
        strokeWidth={2}
      />
    </button>
  );
}
