/**
 * FloatingAccessories — All Nouns accessory trait sprites floating around,
 * slowly drifting, and draggable by the user.
 *
 * Renders every accessory from @nouns/assets as a tiny transparent SVG,
 * scattered randomly across the container with gentle floating motion.
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData } from '@nouns/assets';
import { buildSVG } from '@nouns/sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Sprite {
  id: number;
  svgDataUrl: string;
  x: number; // percent of container width
  y: number; // percent of container height
  size: number; // px
  driftX: number; // drift speed x (px per frame)
  driftY: number; // drift speed y
  phase: number; // animation phase offset
  opacity: number;
  rotation: number;
}

// ─── Build accessory SVGs ─────────────────────────────────────────────────────

function buildAccessorySvgs(): string[] {
  const { accessories } = ImageData.images;
  const { palette } = ImageData;
  return accessories.map(acc => {
    try {
      const svg = buildSVG([acc], palette); // no bg color → transparent
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
      return '';
    }
  });
}

// ─── Seeded random for deterministic initial placement ───────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ─── Distribute sprites in a grid with jitter to avoid overlap ───────────────

function distributeSprites(svgs: string[], containerW: number, containerH: number): Sprite[] {
  const rand = seededRandom(42);
  const count = svgs.length;

  // Compute grid layout — approximate square grid
  const cols = Math.ceil(Math.sqrt(count * (containerW / containerH)));
  const rows = Math.ceil(count / cols);
  const cellW = 100 / cols;
  const cellH = 100 / rows;

  const sprites: Sprite[] = [];
  let idx = 0;

  for (let row = 0; row < rows && idx < count; row++) {
    for (let col = 0; col < cols && idx < count; col++) {
      if (!svgs[idx]) { idx++; continue; }

      // Base position = center of grid cell + random jitter
      const jitterX = (rand() - 0.5) * cellW * 0.7;
      const jitterY = (rand() - 0.5) * cellH * 0.7;
      const x = col * cellW + cellW / 2 + jitterX;
      const y = row * cellH + cellH / 2 + jitterY;

      // Random size between 22 and 38px
      const size = 22 + rand() * 16;

      // Drift: very slow movement
      const angle = rand() * Math.PI * 2;
      const speed = 0.08 + rand() * 0.12;
      const driftX = Math.cos(angle) * speed;
      const driftY = Math.sin(angle) * speed;

      sprites.push({
        id: idx,
        svgDataUrl: svgs[idx],
        x: Math.max(2, Math.min(98, x)),
        y: Math.max(2, Math.min(98, y)),
        size,
        driftX,
        driftY,
        phase: rand() * Math.PI * 2,
        opacity: 1,
        rotation: rand() * 360,
      });

      idx++;
    }
  }

  return sprites;
}

// ─── Component ────────────────────────────────────────────────────────────────

const FloatingAccessories: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const spritesRef = useRef<Sprite[]>([]);
  const positionsRef = useRef<{ x: number; y: number }[]>([]);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const [, forceRender] = useState(0);

  // Dragging state
  const dragRef = useRef<{
    spriteIdx: number;
    startMouseX: number;
    startMouseY: number;
    startSpriteX: number;
    startSpriteY: number;
  } | null>(null);

  // Build all accessory SVGs once
  const svgs = useMemo(() => buildAccessorySvgs(), []);

  // Initialize sprites
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const sprites = distributeSprites(svgs, rect.width, rect.height);
    spritesRef.current = sprites;
    positionsRef.current = sprites.map(s => ({ x: s.x, y: s.y }));
    forceRender(n => n + 1);
  }, [svgs]);

  // Animation loop — gentle floating
  useEffect(() => {
    const tick = () => {
      timeRef.current += 1;
      const t = timeRef.current;
      const sprites = spritesRef.current;
      const positions = positionsRef.current;

      for (let i = 0; i < sprites.length; i++) {
        // Skip if being dragged
        if (dragRef.current?.spriteIdx === i) continue;

        const s = sprites[i];
        // Gentle sinusoidal drift
        const dx = s.driftX + Math.sin(t * 0.008 + s.phase) * 0.06;
        const dy = s.driftY + Math.cos(t * 0.006 + s.phase * 1.3) * 0.06;

        let nx = positions[i].x + dx * 0.15;
        let ny = positions[i].y + dy * 0.15;

        // Bounce at edges
        if (nx < 1 || nx > 99) { sprites[i].driftX *= -1; nx = Math.max(1, Math.min(99, nx)); }
        if (ny < 1 || ny > 99) { sprites[i].driftY *= -1; ny = Math.max(1, Math.min(99, ny)); }

        positions[i].x = nx;
        positions[i].y = ny;
      }

      // Update DOM directly for performance (skip React re-render)
      const el = containerRef.current;
      if (el) {
        const children = el.children;
        for (let i = 0; i < Math.min(children.length, positions.length); i++) {
          const child = children[i] as HTMLElement;
          child.style.left = `${positions[i].x}%`;
          child.style.top = `${positions[i].y}%`;
        }
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    el.style.zIndex = '10';
    el.style.opacity = '1';
    el.style.transform = `translate(-50%, -50%) scale(1.5) rotate(${spritesRef.current[idx]?.rotation ?? 0}deg)`;

    dragRef.current = {
      spriteIdx: idx,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startSpriteX: positionsRef.current[idx]?.x ?? 0,
      startSpriteY: positionsRef.current[idx]?.y ?? 0,
    };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = e.clientX - dragRef.current.startMouseX;
    const dy = e.clientY - dragRef.current.startMouseY;

    const newX = dragRef.current.startSpriteX + (dx / rect.width) * 100;
    const newY = dragRef.current.startSpriteY + (dy / rect.height) * 100;

    const idx = dragRef.current.spriteIdx;
    positionsRef.current[idx] = {
      x: Math.max(1, Math.min(99, newX)),
      y: Math.max(1, Math.min(99, newY)),
    };
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent, idx: number) => {
    const el = e.currentTarget as HTMLElement;
    el.style.cursor = 'grab';
    el.style.zIndex = '';
    const s = spritesRef.current[idx];
    if (s) {
      el.style.opacity = '1';
      el.style.transform = `translate(-50%, -50%) scale(1) rotate(${s.rotation}deg)`;
    }
    dragRef.current = null;
  }, []);

  const sprites = spritesRef.current;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {sprites.map((s, i) => (
        <div
          key={s.id}
          onPointerDown={e => handlePointerDown(e, i)}
          onPointerMove={handlePointerMove}
          onPointerUp={e => handlePointerUp(e, i)}
          style={{
            position: 'absolute',
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            transform: `translate(-50%, -50%) rotate(${s.rotation}deg)`,
            opacity: s.opacity,
            cursor: 'grab',
            pointerEvents: 'auto',
            imageRendering: 'pixelated',
            transition: 'transform 0.2s ease, opacity 0.2s ease',
            willChange: 'left, top',
          }}
        >
          <img
            src={s.svgDataUrl}
            alt=""
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              imageRendering: 'pixelated',
              pointerEvents: 'none',
            }}
          />
        </div>
      ))}
    </div>
  );
};

export default FloatingAccessories;
