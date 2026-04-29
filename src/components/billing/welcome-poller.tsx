'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Polls the current Server Component by calling `router.refresh()` on a
 * fixed interval. Used on `/onboarding/welcome` while we're waiting for
 * Stripe's `checkout.session.completed` webhook to materialize the user's
 * org + subscription rows.
 *
 * This is intentionally dumb: it doesn't try to detect "we're done" — the
 * parent server component decides what to render on each refresh, and
 * stops mounting this poller as soon as the membership row exists.
 *
 * Interval is 2.5s. Webhook delivery + handler runtime is typically well
 * under that, so most users will see the success state on their first
 * paint or the first refresh after.
 */
export function WelcomePoller() {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      router.refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [router]);
  return null;
}
