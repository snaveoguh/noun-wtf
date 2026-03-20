/**
 * CrystalBallPage — Full-page 3D voxel Noun prediction.
 *
 * Shows the predicted next Noun as a 3D extruded voxel model.
 * Drag to rotate, scroll to zoom. Trait names displayed below.
 */
import type { PredictResponse } from '@/components/NounVoxel3D';

import { lazy, Suspense, useCallback, useState } from 'react';

import { traitName } from '@/lib/traitName';

const NounVoxel3D = lazy(() => import('@/components/NounVoxel3D'));

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

  const handlePredict = useCallback((data: PredictResponse) => {
    setPrediction(data);
  }, []);

  const traits = prediction?.seed
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
        background: 'radial-gradient(ellipse at 50% 40%, rgba(15,15,25,1), rgba(5,5,8,1))',
        fontFamily: '"Courier New", monospace',
        color: '#888',
      }}
    >
      {/* 3D viewport — takes most of the screen */}
      <div style={{ flex: 1, minHeight: '60vh', position: 'relative' }}>
        <Suspense
          fallback={
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(100,200,255,0.3)',
                fontSize: 14,
                letterSpacing: '0.15em',
              }}
            >
              SCRYING...
            </div>
          }
        >
          <NounVoxel3D onPredict={handlePredict} />
        </Suspense>
      </div>

      {/* Trait display — bottom panel */}
      <div
        style={{
          padding: '20px 20px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {traits && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '12px 32px',
            }}
          >
            {traits.map(t => (
              <div
                key={t.key}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
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
                    fontSize: 13,
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

        <div
          style={{
            fontSize: 9,
            color: '#333',
            letterSpacing: '0.1em',
          }}
        >
          DRAG TO ROTATE &middot; SCROLL TO ZOOM
        </div>
      </div>
    </div>
  );
}
