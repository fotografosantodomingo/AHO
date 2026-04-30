/**
 * Reusable dot-grid background pattern used by hero bands across:
 * homepage, pricing, city landing, agent profile, all auth surfaces.
 *
 * Renders an absolutely-positioned aria-hidden layer with a radial-
 * gradient dot pattern + a radial-mask that fades the dots toward the
 * edges so the band has a soft visual boundary.
 *
 * Tuned per-mode: light needs more dot opacity since the body is now
 * surface-muted (#f1f2f3) and the same alpha reads fainter on muted
 * than it did on white. Dark stays low — dots over near-black should
 * be a whisper.
 */
export function DotGrid({ ellipse = '70% 50%' }: { ellipse?: string } = {}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-[0.55] dark:opacity-[0.18]"
      style={{
        backgroundImage:
          'radial-gradient(rgb(97 104 117 / 0.45) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        maskImage: `radial-gradient(ellipse ${ellipse} at 50% 30%, #000 30%, transparent 75%)`,
        WebkitMaskImage: `radial-gradient(ellipse ${ellipse} at 50% 30%, #000 30%, transparent 75%)`,
      }}
    />
  );
}

/**
 * Soft action-color glow used in hero corners. Same warmth move as
 * `<DotGrid>` but a single blurred orb. Optional position overrides.
 */
export function HeroGlow({
  position = 'right',
}: {
  position?: 'right' | 'center';
} = {}) {
  const positionClass =
    position === 'center'
      ? 'left-1/2 -translate-x-1/2 -top-32'
      : '-right-24 -top-32';
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute h-96 w-96 rounded-full bg-action/15 blur-3xl dark:bg-action-dark/20 ${positionClass}`}
    />
  );
}
