/* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
/**
 * PanZoomImage — Full-container image with drag-to-pan.
 * Zoom controlled via keyboard (+/-) or forwardRef.
 * Double-click to reset. Fills parent absolutely.
 */
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface PanZoomHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

interface PanZoomImageProps {
  src: string;
  alt?: string;
  pixelated?: boolean;
  interactive?: boolean;
  /** 'contain' (default) leaves a margin; 'fill' lets the image use the whole frame. */
  fit?: 'contain' | 'fill';
}

const PanZoomImage = ({
  ref,
  src,
  alt = '',
  pixelated = false,
  interactive = true,
  fit = 'contain',
}: PanZoomImageProps & { ref?: React.RefObject<PanZoomHandle | null> }) => {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const zoomIn = useCallback(() => setScale(s => Math.min(6, s * 1.3)), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(0.3, s / 1.3)), []);
  const reset = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    reset();
  }, [reset, src]);

  useImperativeHandle(ref, () => ({ zoomIn, zoomOut, reset }), [zoomIn, zoomOut, reset]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTranslate(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: interactive ? (dragging.current ? 'grabbing' : 'grab') : 'default',
        touchAction: interactive ? 'none' : 'pan-y',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
      onDoubleClick={interactive ? reset : undefined}
      onWheel={
        interactive
          ? e => {
              e.preventDefault();
              setScale(s => Math.min(6, Math.max(0.3, s * (e.deltaY < 0 ? 1.15 : 0.87))));
            }
          : undefined
      }
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          maxWidth: fit === 'fill' ? '100%' : '85%',
          maxHeight: fit === 'fill' ? '100%' : '85%',
          objectFit: 'contain',
          imageRendering: pixelated ? 'pixelated' : 'auto',
          transform: `translate(-50%, -50%) translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

PanZoomImage.displayName = 'PanZoomImage';

export default PanZoomImage;
