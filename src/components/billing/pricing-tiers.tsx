'use client';

import {
  useCallback,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';

type Tier = 'agent' | 'plus' | 'pro_automation';
type Period = 'monthly' | 'annual';

interface PriceCfg {
  monthly: number;
  annual: number;
}

const PRICING: Record<Tier, PriceCfg> = {
  agent: { monthly: 29, annual: 290 },
  plus: { monthly: 49, annual: 490 },
  pro_automation: { monthly: 99, annual: 990 },
};

interface Props {
  /** True if the visitor is signed in. Affects CTAs (subscribe vs sign-in). */
  isAuthed: boolean;
  /** True if the signed-in user has an existing org with a current_plan_id.
   *  When set, replace each tier's Subscribe CTA with "Manage billing" /
   *  "Current plan" badges. The Customer Portal handles the upgrade flow. */
  currentTier: Tier | null;
  /** Path to /signin?next=/pricing for anon users. */
  signInPath: string;
  /** Path to /dashboard for signed-in users with existing subscriptions. */
  dashboardPath: string;
  /**
   * When set, render only the named tier's card (used by Pro Automation
   * deep-links from the homepage hero + social dashboard locked module).
   * Null = default 3-tier comparison. The wrapping page also surfaces a
   * "compare all plans" link out when a focus is active.
   */
  focusTier?: Tier | null;
}

/**
 * Three-tier pricing card layout for `/pricing`. Shared monthly/annual
 * toggle at the top; each card displays its tier's price for the
 * selected period + tier-specific feature list + Subscribe CTA.
 *
 * Pro Automation (the highest tier with social automation unlock) is
 * visually highlighted — slightly bigger card, "Most popular" badge,
 * forest-green border.
 *
 * For signed-in users with an existing plan, the matching tier shows a
 * "Current plan" pill and the CTA flips to "Manage billing" pointing
 * at the Customer Portal. The Stripe Customer Portal handles the
 * upgrade-from-Agent-to-Pro flow with proration.
 */
export function PricingTiers({
  isAuthed,
  currentTier,
  signInPath,
  dashboardPath,
  focusTier = null,
}: Props) {
  const t = useTranslations('pricing');
  const locale = useLocale() as Locale;
  const [period, setPeriod] = useState<Period>('monthly');
  const [pendingTier, setPendingTier] = useState<Tier | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function subscribe(tier: Tier) {
    if (pendingTier) return;
    if (!isAuthed) {
      window.location.assign(signInPath);
      return;
    }
    setPendingTier(tier);
    setError(null);
    startTransition(async () => {
      try {
        // Org name needed for new subscriptions. For existing-org
        // upgrades, the portal handles it; this branch is for fresh.
        const orgName = window.prompt(t('orgNamePrompt'), '');
        if (!orgName || orgName.trim().length < 2) {
          setPendingTier(null);
          return;
        }
        const res = await fetch('/api/billing/checkout-session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tier,
            plan: period,
            orgName: orgName.trim(),
            locale,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { url?: string };
        if (data.url) {
          window.location.assign(data.url);
        } else {
          throw new Error('no url in response');
        }
      } catch {
        setError(t('subscribeError'));
        setPendingTier(null);
      }
    });
  }

  const allTiers: Array<{ id: Tier; emphasized: boolean }> = [
    { id: 'agent', emphasized: false },
    { id: 'plus', emphasized: false },
    { id: 'pro_automation', emphasized: true },
  ];
  // Focus mode renders ONLY the named tier (centered, single column).
  // Visited from /pricing?focus=pro_automation deep-links — the user
  // already knows which plan they're considering, so the comparison is
  // distracting noise.
  const tiers = focusTier
    ? allTiers.filter((tt) => tt.id === focusTier)
    : allTiers;

  return (
    <div>
      {/* Period switch — drag the thumb to slide between Monthly and
          Annual, or just tap a side. Replaces the prior tablist that
          PO reported didn't reliably fire on mobile. */}
      <div className="mb-8 flex justify-center px-2">
        <PeriodSwitch
          period={period}
          onChange={setPeriod}
          monthlyLabel={t('period.monthly')}
          annualLabel={t('period.annual')}
          annualBadge={t('annualBadge')}
          ariaLabel={t('periodToggleAria')}
        />
      </div>

      <div
        className={
          tiers.length === 1
            ? 'mx-auto max-w-lg'
            : 'grid grid-cols-1 gap-6 lg:grid-cols-3'
        }
      >
        {tiers.map(({ id: tier, emphasized }) => {
          const isCurrent = currentTier === tier;
          const price = PRICING[tier][period];

          return (
            <div
              key={tier}
              className={
                emphasized
                  ? 'relative flex flex-col rounded-card border-2 border-action bg-surface p-6 shadow-lift md:p-8'
                  : 'flex flex-col rounded-card border border-border-strong/40 bg-surface p-6 shadow-whisper md:p-8'
              }
            >
              {emphasized && (
                <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center rounded-full bg-action px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow-whisper">
                  {t('mostPopular')}
                </span>
              )}
              {isCurrent && (
                <span className="absolute -top-3 right-6 inline-flex items-center rounded-full bg-accent-tint px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
                  {t('currentPlan')}
                </span>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-helper">
                  {t(`tier.${tier}.eyebrow` as 'tier.agent.eyebrow')}
                </p>
                <h3 className="mt-1 font-brand text-2xl font-semibold tracking-tight">
                  {t(`tier.${tier}.name` as 'tier.agent.name')}
                </h3>
                <p className="mt-2 text-sm text-ink-muted">
                  {t(`tier.${tier}.tagline` as 'tier.agent.tagline')}
                </p>
              </div>

              <div className="mt-5 flex items-baseline gap-1">
                <span className="font-brand text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
                  ${price}
                </span>
                <span className="text-sm text-helper">
                  {period === 'monthly' ? t('perMonth') : t('perYear')}
                </span>
              </div>

              <ul className="mt-6 flex-1 space-y-2 text-sm">
                {(
                  ['feat1', 'feat2', 'feat3', 'feat4', 'feat5'] as const
                ).map((key) => {
                  const text = t(
                    `tier.${tier}.${key}` as 'tier.agent.feat1',
                    { defaultValue: '' },
                  );
                  if (!text) return null;
                  return (
                    <li key={key} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-action/15 text-[10px] font-semibold text-action"
                      >
                        ✓
                      </span>
                      <span className="text-ink-muted">{text}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-6">
                {isCurrent ? (
                  <Link
                    href={dashboardPath}
                    className="btn-secondary w-full"
                  >
                    {t('manageBilling')}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => subscribe(tier)}
                    disabled={pendingTier === tier}
                    className={
                      emphasized
                        ? 'btn-primary w-full disabled:opacity-60'
                        : 'btn-secondary w-full disabled:opacity-60'
                    }
                  >
                    {pendingTier === tier
                      ? t('redirecting')
                      : isAuthed
                      ? t('subscribe')
                      : t('signInToSubscribe')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-center text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Swipeable period toggle — Monthly ↔ Annual.
 *
 * Behavior:
 *   - Drag the thumb (or anywhere on the track) with finger / mouse
 *     to slide between sides. Snap to the nearest on release.
 *   - A simple tap on either side jumps the thumb there, same as the
 *     old tablist.
 *   - Keyboard: ←/→ jump to that side, Space / Enter flip.
 *
 * Accessibility: implemented as `role="switch"` because the control
 * has two states (Annual on / off). aria-checked tracks the current
 * state. The track is `tabIndex=0` so keyboard users can focus it.
 *
 * Implementation notes:
 *   - Pointer events (not touch + mouse separately) — handles iOS
 *     touch, Android touch, mouse, and Apple Pencil with one code
 *     path.
 *   - `setPointerCapture` so a drag that wanders off the track edge
 *     still tracks the finger / cursor.
 *   - `touch-action: none` is critical — without it, iOS Safari
 *     hijacks the gesture for native scroll/zoom and the drag never
 *     reaches our handler.
 *   - Thumb position is a fraction 0..1 (0 = Monthly, 1 = Annual);
 *     while dragging we override with the live pointer fraction so
 *     the thumb sticks to the finger. On release we snap to whichever
 *     side the pointer is on (>= 0.5 = Annual) and clear the override
 *     — the CSS `transition-transform` then animates the snap.
 */
interface PeriodSwitchProps {
  period: Period;
  onChange: (next: Period) => void;
  monthlyLabel: string;
  annualLabel: string;
  annualBadge: string;
  ariaLabel: string;
}

function PeriodSwitch({
  period,
  onChange,
  monthlyLabel,
  annualLabel,
  annualBadge,
  ariaLabel,
}: PeriodSwitchProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  // null when not interacting; 0..1 fraction while dragging.
  const [dragFrac, setDragFrac] = useState<number | null>(null);
  const isAnnual = period === 'annual';
  const targetFrac = isAnnual ? 1 : 0;
  const visibleFrac = dragFrac ?? targetFrac;
  // Visual color of each label is driven by *which side the thumb is
  // currently over*, not by the committed period state — so colors flip
  // live as the user drags rather than waiting for release.
  const monthlyLit = visibleFrac < 0.5;
  const annualLit = visibleFrac >= 0.5;

  const pointerToFrac = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return targetFrac;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left;
    // The thumb is 50% wide. Its CENTER traverses from x = W/4 (frac 0,
    // thumb on left) to x = 3W/4 (frac 1, thumb on right). Map pointer
    // x in [W/4, 3W/4] to [0, 1] and clamp.
    const usable = rect.width * 0.5;
    return Math.max(0, Math.min(1, (x - rect.width * 0.25) / usable));
  }, [targetFrac]);

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragFrac(pointerToFrac(e.clientX));
    },
    [pointerToFrac],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      setDragFrac(pointerToFrac(e.clientX));
    },
    [pointerToFrac],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const frac = pointerToFrac(e.clientX);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer might already be released on touchcancel-like flows.
      }
      setDragFrac(null);
      onChange(frac >= 0.5 ? 'annual' : 'monthly');
    },
    [pointerToFrac, onChange],
  );

  const handlePointerCancel = useCallback(() => {
    setDragFrac(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        onChange('annual');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onChange('monthly');
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onChange(isAnnual ? 'monthly' : 'annual');
      }
    },
    [isAnnual, onChange],
  );

  const dragging = dragFrac !== null;

  return (
    <div
      ref={trackRef}
      role="switch"
      aria-checked={isAnnual}
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      style={{ touchAction: 'none' }}
      className={`relative inline-flex h-11 w-72 max-w-full select-none rounded-full border border-border-strong bg-surface shadow-whisper outline-hidden focus-visible:ring-3 focus-visible:ring-action dark:bg-surface-deep dark:focus-visible:ring-action-dark ${
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* Sliding thumb. translateX(100%) of the thumb's own width
          equals (W - 8px)/2 thanks to w-[calc(50%-4px)], which is
          exactly the gap from the left half-track to the right
          half-track with 4px gutters preserved. */}
      <div
        aria-hidden="true"
        style={{ transform: `translateX(${visibleFrac * 100}%)` }}
        className={`pointer-events-none absolute left-1 top-1 h-9 w-[calc(50%-4px)] rounded-full bg-action shadow-whisper dark:bg-action-dark ${
          dragging ? '' : 'transition-transform duration-150 ease-out'
        }`}
      />
      {/* Labels overlay. pointer-events-none so taps pass through to
          the track. Each label flips between high-contrast white (when
          the thumb is over it) and ink-color (when bare). */}
      <div className="pointer-events-none relative grid h-full w-full grid-cols-2 items-center px-1 text-center text-sm">
        <span
          className={
            monthlyLit
              ? 'font-semibold text-white'
              : 'font-medium text-ink dark:text-ink-inverse'
          }
        >
          {monthlyLabel}
        </span>
        <span
          className={`whitespace-nowrap ${
            annualLit
              ? 'font-semibold text-white'
              : 'font-medium text-ink dark:text-ink-inverse'
          }`}
        >
          {annualLabel}
          <span
            className={`ml-1.5 text-[11px] ${
              annualLit ? 'opacity-90' : 'text-action dark:text-action-dark'
            }`}
          >
            {annualBadge}
          </span>
        </span>
      </div>
    </div>
  );
}
