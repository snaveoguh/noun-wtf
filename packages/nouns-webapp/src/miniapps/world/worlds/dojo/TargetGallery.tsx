// ── TargetGallery — 8 floating bullseye discs for aim practice ───────
//
// Each disc is a thin flat circle with concentric black rings on a
// white background (drawn via canvas texture for a single-draw disc).
// Discs bob gently, scale-fade on hit, and respawn after 3s. A hit
// triggers an `aimBurst` focus pulse.
//
// The `onClick` handler stands in for real weapon raycasts until
// combat.ts is wired up.
//
// TODO: wire to weapon raycast in combat.ts for real projectile hits

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

import { triggerFocus } from '../../engine/timeControl';

const DISC_RADIUS = 0.3; // diameter 0.6u
const DISC_THICKNESS = 0.02;
const BOB_AMPLITUDE = 0.15;
const HIT_ANIM_MS = 250;
const RESPAWN_MS = 3000;

// ── Bullseye texture ─────────────────────────────────────────────────
//
// Built once at module scope and shared across all discs. White field,
// concentric black rings (like a dartboard) + a small bullseye dot.

function makeBullseyeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 2;

  // Outer border
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.stroke();

  // Concentric rings
  const rings = [0.82, 0.64, 0.46, 0.28];
  ctx.lineWidth = 1.5;
  for (const r of rings) {
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Bullseye dot
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * 0.1, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  return tex;
}

let sharedBullseye: THREE.CanvasTexture | null = null;
function getBullseyeTexture(): THREE.CanvasTexture {
  if (!sharedBullseye) sharedBullseye = makeBullseyeTexture();
  return sharedBullseye;
}

// ── Individual target ────────────────────────────────────────────────

interface TargetProps {
  localPosition: [number, number, number];
  phase: number;
  bullseye: THREE.CanvasTexture;
}

function Target({ localPosition, phase, bullseye }: TargetProps): ReactNode {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const [hitAt, setHitAt] = useState<number | null>(null);
  const [respawnAt, setRespawnAt] = useState<number | null>(null);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    const mat = matRef.current;
    if (!group || !mat) return;
    const now = performance.now();
    const t = clock.elapsedTime;

    // Respawn handling
    if (respawnAt !== null && now >= respawnAt) {
      setRespawnAt(null);
      setHitAt(null);
    }

    // Base bob — centered at localPosition[1]
    const bobY = Math.sin(t + phase) * BOB_AMPLITUDE;
    group.position.set(localPosition[0], localPosition[1] + bobY, localPosition[2]);

    if (hitAt !== null) {
      const age = now - hitAt;
      if (age < HIT_ANIM_MS) {
        const k = 1 - age / HIT_ANIM_MS;
        group.scale.setScalar(k);
        mat.opacity = k;
        mat.transparent = true;
      } else if (respawnAt === null) {
        // Hidden during respawn wait.
        group.scale.setScalar(0);
        mat.opacity = 0;
      } else {
        // Respawn countdown running; keep hidden.
        group.scale.setScalar(0);
        mat.opacity = 0;
      }
    } else {
      group.scale.setScalar(1);
      mat.opacity = 1;
      mat.transparent = false;
    }
  });

  const handleHit = (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    if (hitAt !== null) return; // already downed
    setHitAt(performance.now());
    setRespawnAt(performance.now() + RESPAWN_MS);
    triggerFocus('aimBurst');
  };

  return (
    <group ref={groupRef} position={localPosition}>
      {/* Face the viewer-ish: rotate on Y so the bullseye faces −Z
          (toward spawn). The TargetGallery group is west of spawn, so
          bullseyes should face east (+X toward spawn center). */}
      <mesh rotation={[0, Math.PI / 2, 0]} onClick={handleHit} onPointerDown={handleHit}>
        <cylinderGeometry args={[DISC_RADIUS, DISC_RADIUS, DISC_THICKNESS, 24]} />
        {/* meshBasicMaterial — cheap, unlit; looks consistent in white scene */}
        <meshBasicMaterial ref={matRef} map={bullseye} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Main ─────────────────────────────────────────────────────────────

export interface TargetGalleryProps {
  position?: [number, number, number];
}

export function TargetGallery({ position = [-10, 0, 0] }: TargetGalleryProps): ReactNode {
  const bullseye = useMemo(() => getBullseyeTexture(), []);

  // 8 discs at varying heights (1–5u) and distances (6–14u from spawn).
  // The gallery's own origin is at `position`, so "distance from spawn"
  // translates to local X (-X = further west). We spread X ∈ [0, -4]
  // so the group sits in a clean rectangular frame around `position`.
  // Distances from spawn (assuming spawn≈0 and gallery at -10):
  //   dispersion ±4u on X → targets span [-14, -6] world X. Within spec.
  const layout: Array<{ pos: [number, number, number]; phase: number }> = [
    { pos: [0, 1.2, 0], phase: 0.0 },
    { pos: [-1, 3.0, 1.8], phase: 0.7 },
    { pos: [1, 2.0, -1.5], phase: 1.2 },
    { pos: [-2, 4.5, -0.5], phase: 2.0 },
    { pos: [2, 1.6, -2.5], phase: 2.6 },
    { pos: [-3, 3.5, 2.5], phase: 3.2 },
    { pos: [3, 4.0, 1.0], phase: 3.9 },
    { pos: [-4, 5.0, -2.0], phase: 4.7 },
  ];

  // Cleanup: dispose of the shared texture when the last gallery unmounts.
  // There's only ever one gallery, so we just dispose on unmount.
  useEffect(() => {
    return () => {
      if (sharedBullseye) {
        sharedBullseye.dispose();
        sharedBullseye = null;
      }
    };
  }, []);

  return (
    <group position={position}>
      {layout.map((entry, i) => (
        <Target
          key={`dojo-target-${i}`}
          localPosition={entry.pos}
          phase={entry.phase}
          bullseye={bullseye}
        />
      ))}
    </group>
  );
}

export default TargetGallery;
