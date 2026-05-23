import React from 'react';
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
  Composition,
} from 'remotion';
import type { VideoScript } from './types';

/**
 * Root Remotion entry. The container's HTTP server registers this
 * default-exported `<RemotionRoot>` with Remotion's renderMedia()
 * call; the composition id `reel-real-estate-v1` matches what
 * buildVideoScript() emits in the main app.
 *
 * Composition structure:
 *   Seconds 0-2     : TitleCard (listing title + city, market-styled)
 *   Seconds 2-X     : PhotoBurst sequence (Ken Burns on each photo)
 *   Seconds X-X+2.5 : PriceCard (price + CTA + AHO brand footer)
 *
 * Per DECISIONS.md 2026-05-17: every creative carries a bold
 * "Powered by AHO" footer band. Implemented as a permanent overlay
 * on top of every scene, not a separate end card — so even a viewer
 * who watches only the first 3 seconds sees the brand attribution.
 *
 * 9:16 vertical (1080x1920) at 24fps. Total duration is variable —
 * the script's `durationFrames` is set in buildVideoScript and clamped
 * to 15-30s.
 */

const TITLE_SECONDS = 2;
const PRICE_SECONDS = 2.5;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="reel-real-estate-v1"
      component={RealEstateReel}
      durationInFrames={720} // 30s @ 24fps — overridden per render via script
      fps={24}
      width={1080}
      height={1920}
      defaultProps={{
        composition: 'reel-real-estate-v1' as const,
        width: 1080 as const,
        height: 1920 as const,
        fps: 24 as const,
        durationFrames: 720,
        title: { text: 'Sample Listing', city: 'Santo Domingo' },
        photos: [],
        price: { label: null, cta: 'Schedule a tour' },
        style: {
          bg: '#fbf8f1',
          ink: '#15181e',
          inkMuted: '#71717a',
          accent: '#2c4d3a',
          accentInk: '#ffffff',
          photoBg: '#e7e2d6',
        },
        market: 'us' as const,
        sourceUrl: 'https://advertisehomes.online',
        musicUrl: null,
      }}
    />
  );
};

export const RealEstateReel: React.FC<VideoScript> = (props) => {
  const { fps } = useVideoConfig();
  const titleFrames = TITLE_SECONDS * fps;
  const priceFrames = PRICE_SECONDS * fps;
  const photoFrames = Math.max(
    fps, // never 0; collapse to 1s if no photos
    Math.floor((props.durationFrames - titleFrames - priceFrames) / Math.max(1, props.photos.length)),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: props.style.bg }}>
      {/* Title card */}
      <Sequence from={0} durationInFrames={titleFrames}>
        <TitleCard {...props} />
      </Sequence>

      {/* Photo bursts */}
      {props.photos.map((photo, i) => (
        <Sequence
          key={`${photo.url}-${i}`}
          from={titleFrames + i * photoFrames}
          durationInFrames={photoFrames}
        >
          <PhotoBurst photo={photo} style={props.style} index={i} total={props.photos.length} />
        </Sequence>
      ))}

      {/* Price + CTA card */}
      <Sequence
        from={titleFrames + props.photos.length * photoFrames}
        durationInFrames={priceFrames}
      >
        <PriceCard {...props} />
      </Sequence>

      {/* Persistent AHO brand footer over EVERY frame (DECISIONS.md 2026-05-17) */}
      <BrandFooter style={props.style} />
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<VideoScript> = ({ title, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps * 0.4], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const translateY = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: style.bg,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
        display: 'flex',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          opacity,
          transform: `translateY(${(1 - translateY) * 30}px)`,
        }}
      >
        <div
          style={{
            color: style.accent,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 6,
            textTransform: 'uppercase',
            marginBottom: 32,
          }}
        >
          {title.city ?? 'Featured listing'}
        </div>
        <div
          style={{
            color: style.ink,
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.1,
            maxWidth: 900,
            display: 'flex',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          {title.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PhotoBurst: React.FC<{
  photo: VideoScript['photos'][number];
  style: VideoScript['style'];
  index: number;
  total: number;
}> = ({ photo, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Ken-Burns effect: slow zoom + drift. Alternate direction per photo
  // index so consecutive photos don't feel uniform. Implemented purely
  // with CSS transforms for performance — Remotion supports both
  // imperative and CSS-based animation.
  const scale = interpolate(frame, [0, durationInFrames], [1.05, 1.18], {
    extrapolateRight: 'clamp',
  });
  const driftX = interpolate(frame, [0, durationInFrames], [0, 40], {
    extrapolateRight: 'clamp',
  });
  const driftY = interpolate(frame, [0, durationInFrames], [0, -20], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: style.photoBg,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      <Img
        src={photo.url}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${driftX}px, ${driftY}px)`,
        }}
      />
      {photo.caption && (
        <div
          style={{
            position: 'absolute',
            bottom: 240,
            left: 60,
            right: 60,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            color: '#ffffff',
            padding: '20px 28px',
            borderRadius: 12,
            fontSize: 36,
            fontWeight: 600,
            lineHeight: 1.25,
            backdropFilter: 'blur(8px)',
            display: 'flex',
          }}
        >
          {photo.caption}
        </div>
      )}
    </AbsoluteFill>
  );
};

const PriceCard: React.FC<VideoScript> = ({ price, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 100 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: style.bg,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
        display: 'flex',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          transform: `scale(${0.7 + scale * 0.3})`,
        }}
      >
        {price.label && (
          <div
            style={{
              backgroundColor: style.accent,
              color: style.accentInk,
              padding: '32px 64px',
              borderRadius: 24,
              fontSize: 88,
              fontWeight: 700,
              marginBottom: 48,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            {price.label}
          </div>
        )}
        <div
          style={{
            color: style.ink,
            fontSize: 56,
            fontWeight: 700,
            letterSpacing: -1,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {price.cta}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const BrandFooter: React.FC<{ style: VideoScript['style'] }> = ({ style }) => (
  <div
    style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 140,
      backgroundColor: style.accent,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        color: style.accentInk,
        fontSize: 30,
        fontWeight: 700,
        letterSpacing: 3,
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
    >
      Powered by AHO
      <span style={{ opacity: 0.6, fontSize: 24, fontWeight: 500, letterSpacing: 2 }}>
        advertisehomes.online
      </span>
    </div>
  </div>
);
