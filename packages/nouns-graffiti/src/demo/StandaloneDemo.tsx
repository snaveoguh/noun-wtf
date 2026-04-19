// StandaloneDemo — drop into any R3F Canvas to see the full loop work.
// Three paintable walls in a triangle, with a HUD overlay.

import { useState } from 'react';

import { Paintable } from '../adapters/r3f/Paintable.js';
import { PaintHUD } from '../ui/PaintHUD.js';

export interface StandaloneDemoProps {
  /** Toggle HUD visibility externally. Default: auto-open. */
  hudOpen?: boolean;
  /** Called when user closes HUD. */
  onHudClose?: () => void;
  /** Author id threaded into every stroke. */
  authorId?: string;
  /** Called at stroke-end for sending to server. */
  onStrokeEnd?: (surfaceId: string, strokeId: string) => void;
}

/**
 * Scene-level component. Renders three <Paintable /> walls inside your Canvas.
 * Mount <PaintHUDHost /> outside the Canvas (in DOM) for the overlay.
 */
export function StandaloneDemoScene({ authorId, onStrokeEnd }: StandaloneDemoProps) {
  const walls: {
    id: string;
    position: [number, number, number];
    rotation: [number, number, number];
  }[] = [
    { id: 'demo-wall-a', position: [-4, 2, 0], rotation: [0, Math.PI / 6, 0] },
    { id: 'demo-wall-b', position: [0, 2, -2], rotation: [0, 0, 0] },
    { id: 'demo-wall-c', position: [4, 2, 0], rotation: [0, -Math.PI / 6, 0] },
  ];
  return (
    <group>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      {walls.map(w => (
        <Paintable
          key={w.id}
          surfaceId={w.id}
          width={3.6}
          height={3}
          position={w.position}
          rotation={w.rotation}
          authorId={authorId}
          onStrokeEnd={id => onStrokeEnd?.(w.id, id)}
        />
      ))}
      {/* Simple floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#2a2823" />
      </mesh>
    </group>
  );
}

/** DOM-layer HUD host — mount outside the Canvas. */
export function StandaloneDemoHUD({ hudOpen: hudOpenProp, onHudClose }: StandaloneDemoProps) {
  const [internalOpen, setInternalOpen] = useState(true);
  const open = hudOpenProp ?? internalOpen;
  return (
    <PaintHUD
      open={open}
      onClose={() => {
        onHudClose?.();
        setInternalOpen(false);
      }}
    />
  );
}

/**
 * All-in-one: wraps scene + HUD. Expects a parent Canvas + sibling DOM node.
 * If you want to render in a single mount, render `StandaloneDemoScene` inside
 * your <Canvas/> and `StandaloneDemoHUD` as a DOM sibling.
 *
 * For convenience we also export a default that renders just the scene part.
 */
export default StandaloneDemoScene;
