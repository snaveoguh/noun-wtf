/**
 * /wave — preview surface for the 3D dream-wave stream.
 *
 * Standalone full-page route so we can iterate on the visual without
 * touching the homepage banner stack. Once the look feels right we can
 * lift `<DreamWaveStream>` into the Auction page (replacing or layering
 * over the existing banners) and retire this preview route.
 */
import { lazy, Suspense } from 'react';

const DreamWaveStream = lazy(() => import('@/components/DreamWaveStream'));

export default function WavePage() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        // The site shell renders a header on top — push the canvas down
        // a bit so the orb stream isn't clipped by the navbar. fixed inset
        // is intentional: this view is a full-bleed environment.
        background: '#000',
      }}
    >
      <Suspense
        fallback={
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(170, 204, 255, 0.6)',
              fontFamily: '"Courier New", monospace',
              fontSize: 12,
              letterSpacing: '0.25em',
            }}
          >
            LOADING WAVE…
          </div>
        }
      >
        <DreamWaveStream />
      </Suspense>
      {/* Tiny floating breadcrumb so the user knows what they're looking
          at and how to leave. */}
      <a
        href="/"
        style={{
          position: 'absolute',
          bottom: 14,
          left: 14,
          padding: '6px 12px',
          fontSize: 10,
          letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.6)',
          fontFamily: '"Courier New", monospace',
          textTransform: 'uppercase',
          textDecoration: 'none',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 4,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(4px)',
        }}
      >
        ← Home
      </a>
      <span
        style={{
          position: 'absolute',
          bottom: 14,
          right: 14,
          fontSize: 9,
          letterSpacing: '0.25em',
          color: 'rgba(255,255,255,0.35)',
          fontFamily: '"Courier New", monospace',
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}
      >
        wave preview · drag to look around
      </span>
    </div>
  );
}
