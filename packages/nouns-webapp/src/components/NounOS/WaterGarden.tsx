// The pond at the bottom of the desk — a three.js scene (see Pond.ts),
// loaded lazily so the shell paints before three + the nature generators.

import type { Pond } from './Pond';

import { useEffect, useImperativeHandle, useRef } from 'react';

export interface WaterHandle {
  ripple(x: number, y: number, strength?: number): void;
  /** Screen-space y of the waterline */
  horizon(): number;
}

const FRACTION = 0.26;
export const waterHeight = () => Math.max(150, Math.round(window.innerHeight * FRACTION));

const WaterGarden = function WaterGarden({
  ref,
  active,
}: { active: boolean } & { ref?: React.RefObject<WaterHandle | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pondRef = useRef<Pond | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useImperativeHandle(ref, () => ({
    ripple(x, y, s = 1) {
      pondRef.current?.ripple(x, y, s);
    },
    horizon: () => window.innerHeight - waterHeight(),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    void import('./Pond')
      .then(({ Pond }) => {
        if (disposed) return;
        try {
          pondRef.current = new Pond(canvas);
          pondRef.current.active = activeRef.current;
        } catch (err) {
          console.warn('[NounOS] pond unavailable', err);
        }
      })
      .catch(err => console.warn('[NounOS] pond failed to load', err));
    return () => {
      disposed = true;
      pondRef.current?.dispose();
      pondRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (pondRef.current) pondRef.current.active = active;
  }, [active]);

  return <canvas ref={canvasRef} className="nos-water" aria-hidden />;
};

export default WaterGarden;
