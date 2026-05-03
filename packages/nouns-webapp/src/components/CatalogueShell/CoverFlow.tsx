import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { CatalogueItem } from './useCatalogueItems';

import classes from './CoverFlow.module.css';

interface CoverFlowProps {
  items: CatalogueItem[];
  cardSize?: number;
  onActivate?: (item: CatalogueItem) => void;
}

const SIDE_GAP = 110;
const ROTATION = 55;
const SCALE_FALLOFF = 0.06;
const MAX_VISIBLE = 6;
const WHEEL_THRESHOLD = 24;

export default function CoverFlow({ items, cardSize = 360, onActivate }: CoverFlowProps) {
  const [active, setActive] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startActive: number; pid: number } | null>(null);
  const wheelAccumRef = useRef(0);

  useEffect(() => {
    if (active >= items.length) setActive(0);
  }, [items.length, active]);

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(items.length - 1, i)),
    [items.length],
  );

  const move = useCallback((delta: number) => setActive(a => clamp(a + delta)), [clamp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Enter' && onActivate && items[active]) {
        onActivate(items[active]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, onActivate, items, active]);

  const onWheel = (e: ReactWheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    wheelAccumRef.current += delta;
    while (wheelAccumRef.current > WHEEL_THRESHOLD) {
      wheelAccumRef.current -= WHEEL_THRESHOLD;
      move(1);
    }
    while (wheelAccumRef.current < -WHEEL_THRESHOLD) {
      wheelAccumRef.current += WHEEL_THRESHOLD;
      move(-1);
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!stageRef.current) return;
    stageRef.current.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startActive: active, pid: e.pointerId };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const step = Math.round(-dx / (cardSize * 0.6));
    setActive(clamp(dragRef.current.startActive + step));
  };

  const endDrag = () => {
    if (!dragRef.current || !stageRef.current) return;
    try {
      stageRef.current.releasePointerCapture(dragRef.current.pid);
    } catch {}
    dragRef.current = null;
  };

  const onCardClick = (i: number) => {
    if (i === active) {
      onActivate?.(items[i]);
    } else {
      setActive(i);
    }
  };

  const visible = useMemo(() => {
    const out: { item: CatalogueItem; idx: number; offset: number }[] = [];
    for (let off = -MAX_VISIBLE; off <= MAX_VISIBLE; off++) {
      const idx = active + off;
      if (idx < 0 || idx >= items.length) continue;
      out.push({ item: items[idx], idx, offset: off });
    }
    return out;
  }, [items, active]);

  if (items.length === 0) return null;

  return (
    <div
      ref={stageRef}
      className={classes.stage}
      style={{ '--card-size': `${cardSize}px` } as CSSProperties}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className={classes.track}>
        {visible.map(({ item, idx, offset }) => {
          const abs = Math.abs(offset);
          const isCenter = offset === 0;
          const translateX = offset === 0 ? 0 : Math.sign(offset) * (cardSize * 0.45 + abs * SIDE_GAP);
          const rotateY = isCenter ? 0 : -Math.sign(offset) * ROTATION;
          const translateZ = isCenter ? 50 : -abs * 80;
          const scale = isCenter ? 1 : Math.max(0.35, 1 - abs * SCALE_FALLOFF);
          const opacity = abs > 4 ? 0.0 : abs > 3 ? 0.25 : 1;
          const zIndex = 100 - abs;
          const isPixel = item.type === 'trait';

          return (
            <div
              key={item.id}
              className={classes.card}
              style={{
                transform: `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                opacity,
                zIndex,
                background: item.type === 'trait' ? (item.raw as any).bgColor : '#1a1a1a',
              }}
              onClick={() => onCardClick(idx)}
            >
              <img
                src={item.image}
                alt={item.title}
                className={`${classes.cardImg} ${isPixel ? classes.cardImgPixel : ''}`}
                draggable={false}
                loading="lazy"
                onError={e => {
                  (e.currentTarget as HTMLImageElement).style.opacity = '0.3';
                }}
              />
            </div>
          );
        })}
      </div>

      {items[active] && (
        <div className={classes.caption}>
          <h2 className={classes.captionTitle}>{items[active].title}</h2>
          <p className={classes.captionSubtitle}>{items[active].subtitle}</p>
        </div>
      )}

      <div className={classes.controls}>
        <button
          type="button"
          className={classes.arrow}
          onClick={() => move(-1)}
          disabled={active === 0}
          aria-label="Previous"
        >
          ←
        </button>
        <span className={classes.counter}>
          {active + 1} / {items.length}
        </span>
        <button
          type="button"
          className={classes.arrow}
          onClick={() => move(1)}
          disabled={active === items.length - 1}
          aria-label="Next"
        >
          →
        </button>
      </div>
    </div>
  );
}
