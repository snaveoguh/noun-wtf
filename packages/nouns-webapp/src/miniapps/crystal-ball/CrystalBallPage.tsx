/**
 * CrystalBallPage — Full-page interactive crystal ball with trait display.
 *
 * Enlarges the existing CrystalBall component, enables drag-to-rotate 360,
 * zoom, and shows predicted trait names for the next Noun.
 */
import { lazy, Suspense, useCallback, useRef, useState } from 'react';

import { traitName } from '@/lib/traitName';

import type { PredictResponse } from '@/components/CrystalBall';

const CrystalBall = lazy(() => import('@/components/CrystalBall'));

const TRAIT_KEYS = ['head', 'glasses', 'body', 'accessory', 'background'] as const;

const TRAIT_LABELS: Record<string, string> = {
  head: 'HEAD',
  glasses: 'NOGGLES',
  body: 'BODY',
  accessory: 'ACCESSORY',
  background: 'BG',
};

export default function CrystalBallPage() {
  const [prediction, setPrediction] = useState<PredictResponse | null>(null);
  const [ballSize, setBallSize] = useState(400);
  const resizeRef = useRef<{ startY: number; startSize: number } | null>(null);

  const handlePredict = useCallback((data: PredictResponse) => {
    setPrediction(data);
  }, []);

  // Resize drag handlers
  const onResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      resizeRef.current = { startY: clientY, startSize: ballSize };

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!resizeRef.current) return;
        const y = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
        const delta = y - resizeRef.current.startY;
        setBallSize(Math.max(200, Math.min(800, resizeRef.current.startSize + delta)));
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove);
      window.addEventListener('touchend', onUp);
    },
    [ballSize],
  );

  const traits =
    prediction?.seed
      ? TRAIT_KEYS.map(key => ({
          key,
          label: TRAIT_LABELS[key],
          value: traitName(key, prediction.seed![key]),
        }))
      : null;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        padding: '40px 20px',
        background: 'radial-gradient(ellipse at 50% 30%, rgba(20,20,40,1), rgba(5,5,10,1))',
        fontFamily: '"Courier New", monospace',
        color: '#888',
      }}
    >
      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.25em',
            color: '#555',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          CRYSTAL BALL
        </h1>
        <p
          style={{
            fontSize: 10,
            color: '#444',
            letterSpacing: '0.1em',
            marginTop: 4,
          }}
        >
          DRAG TO ROTATE / SCROLL TO ZOOM / DRAG HANDLE TO RESIZE
        </p>
      </div>

      {/* Ball container */}
      <div style={{ position: 'relative' }}>
        <Suspense
          fallback={
            <div
              style={{
                width: ballSize,
                height: ballSize + 52,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(100,200,255,0.3)',
                fontSize: 12,
                letterSpacing: '0.15em',
              }}
            >
              SCRYING...
            </div>
          }
        >
          <CrystalBall size={ballSize} interactive onPredict={handlePredict} />
        </Suspense>

        {/* Resize handle */}
        <div
          onMouseDown={onResizeStart}
          onTouchStart={onResizeStart}
          style={{
            position: 'absolute',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 40,
            height: 6,
            borderRadius: 3,
            background: 'rgba(100,200,255,0.2)',
            cursor: 'ns-resize',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => {
            (e.target as HTMLDivElement).style.background = 'rgba(100,200,255,0.5)';
          }}
          onMouseLeave={e => {
            (e.target as HTMLDivElement).style.background = 'rgba(100,200,255,0.2)';
          }}
          title="Drag to resize"
        />
      </div>

      {/* Trait display */}
      {traits && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '12px 24px',
            maxWidth: 600,
          }}
        >
          {traits.map(t => (
            <div
              key={t.key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  color: '#555',
                  letterSpacing: '0.15em',
                  fontWeight: 700,
                }}
              >
                {t.label}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: '#aaccff',
                  letterSpacing: '0.05em',
                }}
              >
                {t.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Block info */}
      {prediction && (
        <div
          style={{
            fontSize: 10,
            color: '#444',
            letterSpacing: '0.08em',
            textAlign: 'center',
          }}
        >
          NOUN #{prediction.nextNounId} &middot; BLK {prediction.block}
        </div>
      )}
    </div>
  );
}
