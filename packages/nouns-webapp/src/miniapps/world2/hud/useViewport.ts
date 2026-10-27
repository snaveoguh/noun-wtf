import { useEffect, useState } from 'react';

/** The window's size, kept current through resizes and rotations. */
export function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const r = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', r);
    window.addEventListener('orientationchange', r);
    return () => {
      window.removeEventListener('resize', r);
      window.removeEventListener('orientationchange', r);
    };
  }, []);
  return vp;
}
