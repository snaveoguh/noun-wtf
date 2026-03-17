import { FC, useCallback, useEffect, useRef, useState } from 'react';

/**
 * "Dungeon mode" overlay — a full-screen black layer with a circular
 * transparent spotlight that follows the cursor. The edges of the
 * spotlight are pixelated (stepped) to give a retro pixel-art feel.
 *
 * The cursor itself is hidden and replaced with a tiny pixel-art torch.
 */

const TORCH_RADIUS = 90; // px — visible radius
const PIXEL_SIZE = 4; // size of each "pixel block" in the gradient
const GRADIENT_STEPS = 14; // number of rings from clear → black

interface TorchOverlayProps {
  active: boolean;
}

const TorchOverlay: FC<TorchOverlayProps> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -999, y: -999 });
  const rafRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const { x: mx, y: my } = mouseRef.current;

    // Fill entire canvas black
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Carve out the spotlight using pixelated concentric rings
    // We draw from inside out; inner is fully transparent, outer fades to black
    const totalRadius = TORCH_RADIUS + GRADIENT_STEPS * PIXEL_SIZE;

    // Clear the inner circle entirely
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';

    // Pixelated circle: iterate grid-snapped blocks within bounding box
    const bx0 = Math.floor((mx - totalRadius) / PIXEL_SIZE) * PIXEL_SIZE;
    const by0 = Math.floor((my - totalRadius) / PIXEL_SIZE) * PIXEL_SIZE;
    const bx1 = Math.ceil((mx + totalRadius) / PIXEL_SIZE) * PIXEL_SIZE;
    const by1 = Math.ceil((my + totalRadius) / PIXEL_SIZE) * PIXEL_SIZE;

    for (let px = bx0; px <= bx1; px += PIXEL_SIZE) {
      for (let py = by0; py <= by1; py += PIXEL_SIZE) {
        // Distance from block center to mouse
        const cx = px + PIXEL_SIZE / 2;
        const cy = py + PIXEL_SIZE / 2;
        const dist = Math.sqrt((cx - mx) ** 2 + (cy - my) ** 2);

        if (dist < TORCH_RADIUS) {
          // Fully clear
          ctx.fillStyle = 'rgba(0,0,0,1)';
          ctx.fillRect(px, py, PIXEL_SIZE, PIXEL_SIZE);
        } else if (dist < totalRadius) {
          // Stepped gradient: which ring are we in?
          const ring = Math.floor((dist - TORCH_RADIUS) / PIXEL_SIZE);
          const alpha = 1 - ring / GRADIENT_STEPS;
          if (alpha > 0.02) {
            ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(2)})`;
            ctx.fillRect(px, py, PIXEL_SIZE, PIXEL_SIZE);
          }
        }
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    // Draw a tiny pixel-art torch/flame at cursor
    const torchX = Math.round(mx);
    const torchY = Math.round(my);
    const p = 2; // pixel size for torch art

    // Torch handle (brown)
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(torchX - p, torchY + p * 2, p * 2, p * 5);

    // Flame core (yellow)
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(torchX - p, torchY - p * 2, p * 2, p * 4);

    // Flame tip (orange)
    ctx.fillStyle = '#FF6600';
    ctx.fillRect(torchX - p * 0.5, torchY - p * 3, p, p * 2);

    // Flame glow
    ctx.fillStyle = '#FF4400';
    ctx.fillRect(torchX, torchY - p * 4, p * 0.5, p);

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    if (!active) return;

    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) mouseRef.current = { x: t.clientX, y: t.clientY };
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onTouch, { passive: true });

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onTouch);
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, draw]);

  // Resize canvas on window resize
  useEffect(() => {
    if (!active) return;
    const onResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);

  // Stable mobile check — read once on mount, not on every render
  const [isMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  // Disable on mobile — torch overlay doesn't work well on touch devices
  if (!active || isMobile) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        pointerEvents: 'none',
        cursor: 'none',
        width: '100vw',
        height: '100vh',
      }}
    />
  );
};

export default TorchOverlay;
