// ── CityBlock — Street furniture, parked cars, storefronts ───────────
//
// Gives the MegaRamp / Apartment / Office cluster a lived-in block feel.
// Every solid prop registers with StructureRegistry for real collision,
// and key surfaces are wrapped in <Paintable /> so they're taggable.
//
// Coordinate system: Three.js units (tile-world × 0.1 = WORLD_SCALE).
// Registered AABBs use tile-world (divide three.js by WORLD_SCALE).

import { useEffect, type ReactNode } from 'react';
import { Paintable } from '@nouns/graffiti/r3f';
import { registerStructure, unregisterStructure } from './structures';
import { GlbModel, useGlbProbe } from './glbProps';
import { getProp, pickCarVariant } from './propCatalog';

const WORLD_SCALE = 0.1;
const TJ_TO_TILE = 1 / WORLD_SCALE; // multiply three.js → tile-world

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Register a rectangular solid at (x,z) in Three.js coords with footprint (w,d)
 * and height h. Handles cleanup on unmount.
 */
function useStructure(
  id: string,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  opts?: {
    topMaterial?: 'stone' | 'wood' | 'metal' | 'grass' | 'sand' | 'path' | 'water';
    solid?: boolean;
  },
) {
  useEffect(() => {
    registerStructure(
      id,
      { x: x * TJ_TO_TILE, y: z * TJ_TO_TILE, w: w * TJ_TO_TILE, h: d * TJ_TO_TILE },
      {
        topHeight: h * TJ_TO_TILE,
        topMaterial: opts?.topMaterial,
        solid: opts?.solid,
      },
    );
    return () => unregisterStructure(id);
  }, [id, x, z, w, d, h, opts?.topMaterial, opts?.solid]);
}

// ── Lamppost ─────────────────────────────────────────────────────────

function Lamppost({ position, id }: { position: [number, number, number]; id: string }) {
  useStructure(id, position[0], position[2], 0.3, 0.3, 3.5, { topMaterial: 'metal' });
  const entry = getProp('lamp-post');
  const { hasModel } = useGlbProbe(entry.glbUrl);
  return (
    <group position={position}>
      {hasModel && entry.glbUrl ? (
        <GlbModel url={entry.glbUrl} scale={entry.defaultScale ?? 1} />
      ) : (
        <>
          {/* Base */}
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.25, 0.3, 0.3, 8]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.7} />
          </mesh>
          {/* Pole */}
          <mesh position={[0, 1.75, 0]}>
            <cylinderGeometry args={[0.08, 0.1, 3.2, 8]} />
            <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.4} />
          </mesh>
          {/* Arm */}
          <mesh position={[0.4, 3.4, 0]} rotation={[0, 0, -Math.PI / 2.3]}>
            <cylinderGeometry args={[0.06, 0.06, 0.8, 6]} />
            <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.4} />
          </mesh>
          {/* Housing */}
          <mesh position={[0.7, 3.45, 0]}>
            <boxGeometry args={[0.35, 0.2, 0.35]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
          {/* Bulb */}
          <mesh position={[0.7, 3.3, 0]}>
            <sphereGeometry args={[0.15, 8, 8]} />
            <meshStandardMaterial
              color="#ffeecc"
              emissive="#ffddaa"
              emissiveIntensity={1.8}
              roughness={0.3}
            />
          </mesh>
        </>
      )}
      {/* Pool of light on ground — keep the light regardless of GLB vs proc */}
      <pointLight position={[0.7, 3.3, 0]} color="#ffddaa" intensity={2} distance={8} decay={2} />
    </group>
  );
}

// ── Mailbox (USPS blue) ──────────────────────────────────────────────

function Mailbox({ position, id }: { position: [number, number, number]; id: string }) {
  useStructure(id, position[0], position[2], 0.7, 0.5, 1.3, { topMaterial: 'metal' });
  const entry = getProp('mailbox');
  const { hasModel } = useGlbProbe(entry.glbUrl);
  return (
    <group position={position}>
      {hasModel && entry.glbUrl ? (
        <GlbModel url={entry.glbUrl} scale={entry.defaultScale ?? 1} />
      ) : (
        <>
          {/* Legs */}
          <mesh position={[-0.25, 0.3, 0]}>
            <boxGeometry args={[0.08, 0.6, 0.08]} />
            <meshStandardMaterial color="#1a237e" />
          </mesh>
          <mesh position={[0.25, 0.3, 0]}>
            <boxGeometry args={[0.08, 0.6, 0.08]} />
            <meshStandardMaterial color="#1a237e" />
          </mesh>
          {/* Body — rounded top */}
          <mesh position={[0, 0.85, 0]}>
            <boxGeometry args={[0.7, 0.5, 0.45]} />
            <meshStandardMaterial color="#1a237e" roughness={0.6} />
          </mesh>
          {/* Rounded dome */}
          <mesh position={[0, 1.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.225, 0.225, 0.7, 8, 1, false, 0, Math.PI]} />
            <meshStandardMaterial color="#1a237e" roughness={0.6} />
          </mesh>
          {/* Slot */}
          <mesh position={[0, 1.0, 0.23]}>
            <boxGeometry args={[0.4, 0.04, 0.02]} />
            <meshStandardMaterial color="#000" />
          </mesh>
          {/* USPS eagle patch (yellow) */}
          <mesh position={[0, 0.88, 0.23]}>
            <circleGeometry args={[0.08, 12]} />
            <meshStandardMaterial color="#f6c545" />
          </mesh>
        </>
      )}
    </group>
  );
}

// ── Trash can ────────────────────────────────────────────────────────

function TrashCan({
  position,
  id,
  color = '#3a3a3a',
}: {
  position: [number, number, number];
  id: string;
  color?: string;
}) {
  useStructure(id, position[0], position[2], 0.6, 0.6, 1.1, { topMaterial: 'metal' });
  const entry = getProp('trash-bin');
  const { hasModel } = useGlbProbe(entry.glbUrl);
  return (
    <group position={position}>
      {hasModel && entry.glbUrl ? (
        <GlbModel url={entry.glbUrl} scale={entry.defaultScale ?? 1} />
      ) : (
        <>
          {/* Can */}
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.3, 0.28, 1.0, 12]} />
            <meshStandardMaterial color={color} roughness={0.85} metalness={0.2} />
          </mesh>
          {/* Lid */}
          <mesh position={[0, 1.05, 0]}>
            <cylinderGeometry args={[0.32, 0.3, 0.12, 12]} />
            <meshStandardMaterial color="#222" roughness={0.6} metalness={0.3} />
          </mesh>
          {/* Horizontal bands (ribs) */}
          <mesh position={[0, 0.3, 0]}>
            <torusGeometry args={[0.29, 0.02, 6, 16]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[0, 0.7, 0]}>
            <torusGeometry args={[0.3, 0.02, 6, 16]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </>
      )}
    </group>
  );
}

// ── Fire hydrant ─────────────────────────────────────────────────────

function FireHydrant({ position, id }: { position: [number, number, number]; id: string }) {
  useStructure(id, position[0], position[2], 0.4, 0.4, 0.95, { topMaterial: 'metal' });
  const entry = getProp('fire-hydrant');
  const { hasModel } = useGlbProbe(entry.glbUrl);
  return (
    <group position={position}>
      {hasModel && entry.glbUrl ? (
        <GlbModel url={entry.glbUrl} scale={entry.defaultScale ?? 1} />
      ) : (
        <>
          {/* Base flange */}
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.22, 0.22, 0.16, 8]} />
            <meshStandardMaterial color="#b71c1c" roughness={0.5} />
          </mesh>
          {/* Body */}
          <mesh position={[0, 0.45, 0]}>
            <cylinderGeometry args={[0.16, 0.2, 0.6, 12]} />
            <meshStandardMaterial color="#d32f2f" roughness={0.5} />
          </mesh>
          {/* Side nozzles */}
          <mesh position={[0.18, 0.45, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.08, 0.08, 0.12, 8]} />
            <meshStandardMaterial color="#f9a825" roughness={0.4} metalness={0.3} />
          </mesh>
          <mesh position={[-0.18, 0.45, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.08, 0.08, 0.12, 8]} />
            <meshStandardMaterial color="#f9a825" roughness={0.4} metalness={0.3} />
          </mesh>
          {/* Top cap (hex nut look) */}
          <mesh position={[0, 0.82, 0]}>
            <cylinderGeometry args={[0.14, 0.16, 0.12, 6]} />
            <meshStandardMaterial color="#f9a825" roughness={0.4} metalness={0.3} />
          </mesh>
          {/* Dome */}
          <mesh position={[0, 0.92, 0]}>
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshStandardMaterial color="#d32f2f" roughness={0.4} />
          </mesh>
        </>
      )}
    </group>
  );
}

// ── Dumpster (with paintable long sides) ─────────────────────────────

function Dumpster({
  position,
  rotation = 0,
  id,
}: {
  position: [number, number, number];
  rotation?: number;
  id: string;
}) {
  const W = 2.6;
  const D = 1.3;
  const H = 1.3;
  useStructure(id, position[0], position[2], W, D, H, { topMaterial: 'metal' });
  const entry = getProp('dumpster');
  const { hasModel } = useGlbProbe(entry.glbUrl);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {hasModel && entry.glbUrl ? (
        <GlbModel url={entry.glbUrl} scale={entry.defaultScale ?? 1} />
      ) : (
        <>
          {/* Body shell — keep the material dark so paintable overlay reads */}
          <mesh position={[0, H / 2, 0]}>
            <boxGeometry args={[W, H, D]} />
            <meshStandardMaterial color="#2e5a3e" roughness={0.85} />
          </mesh>
          {/* Lid (closed) */}
          <mesh position={[0, H + 0.04, 0]}>
            <boxGeometry args={[W + 0.05, 0.08, D + 0.05]} />
            <meshStandardMaterial color="#1f3d2b" roughness={0.9} />
          </mesh>
          {/* Lid seam */}
          <mesh position={[0, H + 0.09, 0]}>
            <boxGeometry args={[W * 0.94, 0.015, D + 0.06]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          {/* Lid handles */}
          {[-W / 4, W / 4].map(x => (
            <mesh key={x} position={[x, H + 0.14, 0]}>
              <boxGeometry args={[0.3, 0.04, 0.08]} />
              <meshStandardMaterial color="#0a0a0a" metalness={0.4} />
            </mesh>
          ))}
          {/* Rust / weathering streaks */}
          {[-0.7, 0.1, 0.9].map(x => (
            <mesh key={x} position={[x, H * 0.55, D / 2 + 0.003]}>
              <boxGeometry args={[0.04, H * 0.8, 0.001]} />
              <meshStandardMaterial color="#5a3a1a" transparent opacity={0.4} />
            </mesh>
          ))}
          {/* Garbage bags spilling over the lid */}
          {[
            { x: -0.7, z: 0.2, s: 0.35, c: '#1a1a1a' },
            { x: -0.2, z: -0.1, s: 0.4, c: '#222' },
            { x: 0.4, z: 0.15, s: 0.32, c: '#181818' },
            { x: 0.8, z: -0.05, s: 0.28, c: '#2a2a2a' },
          ].map((b, i) => (
            <mesh key={i} position={[b.x, H + 0.15 + b.s / 2, b.z]}>
              <sphereGeometry args={[b.s, 8, 6]} />
              <meshStandardMaterial color={b.c} roughness={0.95} />
            </mesh>
          ))}
          {/* Crumpled paper / cup on top */}
          <mesh position={[0.3, H + 0.08, 0.3]} rotation={[0.4, 0.3, 0]}>
            <boxGeometry args={[0.12, 0.08, 0.1]} />
            <meshStandardMaterial color="#e8d4a0" roughness={1} />
          </mesh>
          {/* Wheels */}
          {[-W / 2 + 0.3, W / 2 - 0.3].map(x => (
            <mesh key={x} position={[x, 0.1, D / 2 + 0.02]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.15, 0.15, 0.08, 10]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          ))}
        </>
      )}
      {/* Paintable long sides — stay overlaid regardless of GLB vs proc */}
      <Paintable
        surfaceId={`${id}-front`}
        width={W * 0.92}
        height={H * 0.85}
        position={[0, H / 2 + 0.02, D / 2 + 0.002]}
        frameColor={null}
      />
      <Paintable
        surfaceId={`${id}-back`}
        width={W * 0.92}
        height={H * 0.85}
        position={[0, H / 2 + 0.02, -(D / 2 + 0.002)]}
        rotation={[0, Math.PI, 0]}
        frameColor={null}
      />
    </group>
  );
}

// ── Park bench ───────────────────────────────────────────────────────

function Bench({
  position,
  rotation = 0,
  id,
}: {
  position: [number, number, number];
  rotation?: number;
  id: string;
}) {
  const W = 1.8;
  useStructure(id, position[0], position[2], W, 0.5, 0.85, { topMaterial: 'wood' });
  const entry = getProp('bench');
  const { hasModel } = useGlbProbe(entry.glbUrl);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {hasModel && entry.glbUrl ? (
        <GlbModel url={entry.glbUrl} scale={entry.defaultScale ?? 1} />
      ) : (
        <>
          {/* Legs (cast-iron style) */}
          {[-W / 2 + 0.15, W / 2 - 0.15].map(x => (
            <group key={x} position={[x, 0, 0]}>
              <mesh position={[0, 0.4, 0.12]}>
                <boxGeometry args={[0.08, 0.8, 0.08]} />
                <meshStandardMaterial color="#1a1a1a" />
              </mesh>
              <mesh position={[0, 0.4, -0.12]}>
                <boxGeometry args={[0.08, 0.8, 0.08]} />
                <meshStandardMaterial color="#1a1a1a" />
              </mesh>
              <mesh position={[0, 0.45, 0]}>
                <boxGeometry args={[0.08, 0.05, 0.32]} />
                <meshStandardMaterial color="#1a1a1a" />
              </mesh>
            </group>
          ))}
          {/* Seat slats */}
          {[0, 1, 2].map(i => (
            <mesh key={i} position={[0, 0.48, -0.12 + i * 0.12]}>
              <boxGeometry args={[W - 0.08, 0.06, 0.08]} />
              <meshStandardMaterial color="#5d4037" roughness={0.9} />
            </mesh>
          ))}
          {/* Back slats */}
          {[0, 1, 2].map(i => (
            <mesh key={i} position={[0, 0.6 + i * 0.12, -0.2]}>
              <boxGeometry args={[W - 0.08, 0.08, 0.06]} />
              <meshStandardMaterial color="#5d4037" roughness={0.9} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

// ── Newspaper box (paintable front) ──────────────────────────────────

function NewspaperBox({
  position,
  rotation = 0,
  id,
  color = '#1565c0',
}: {
  position: [number, number, number];
  rotation?: number;
  id: string;
  color?: string;
}) {
  useStructure(id, position[0], position[2], 0.5, 0.4, 1.1, { topMaterial: 'metal' });
  const entry = getProp('newspaper-stand');
  const { hasModel } = useGlbProbe(entry.glbUrl);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {hasModel && entry.glbUrl ? (
        <GlbModel url={entry.glbUrl} scale={entry.defaultScale ?? 1} />
      ) : (
        <>
          {/* Pedestal */}
          <mesh position={[0, 0.05, 0]}>
            <boxGeometry args={[0.55, 0.1, 0.45]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
          {/* Body */}
          <mesh position={[0, 0.6, 0]}>
            <boxGeometry args={[0.5, 1.0, 0.4]} />
            <meshStandardMaterial color={color} roughness={0.55} metalness={0.2} />
          </mesh>
          {/* Slanted top (news display window) */}
          <mesh position={[0, 1.12, 0.02]} rotation={[-0.3, 0, 0]}>
            <boxGeometry args={[0.48, 0.04, 0.38]} />
            <meshStandardMaterial color="#0a0a0a" />
          </mesh>
          {/* Display glass */}
          <mesh position={[0, 1.08, 0.16]} rotation={[-0.3, 0, 0]}>
            <boxGeometry args={[0.42, 0.01, 0.32]} />
            <meshStandardMaterial color="#e8d6a0" emissive="#f5e2b3" emissiveIntensity={0.3} />
          </mesh>
          {/* Coin slot */}
          <mesh position={[0.18, 0.9, 0.21]}>
            <boxGeometry args={[0.08, 0.02, 0.02]} />
            <meshStandardMaterial color="#000" />
          </mesh>
        </>
      )}
      {/* Paintable front panel — stays overlaid regardless of GLB vs proc */}
      <Paintable
        surfaceId={`${id}-front`}
        width={0.4}
        height={0.55}
        position={[0, 0.45, 0.202]}
        frameColor={null}
      />
    </group>
  );
}

// ── Manhole cover (flat ground decoration) ──────────────────────────

function ManholeCover({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Cover */}
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.02, 18]} />
        <meshStandardMaterial color="#2a2a28" roughness={0.8} metalness={0.5} />
      </mesh>
      {/* Raised pattern rings */}
      <mesh position={[0, 0.021, 0]}>
        <torusGeometry args={[0.38, 0.015, 6, 24]} />
        <meshStandardMaterial color="#3a3a38" metalness={0.5} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.021, 0]}>
        <torusGeometry args={[0.25, 0.012, 6, 20]} />
        <meshStandardMaterial color="#3a3a38" metalness={0.5} roughness={0.7} />
      </mesh>
      {/* Pry-slots */}
      {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map(r => (
        <mesh key={r} position={[Math.cos(r) * 0.42, 0.022, Math.sin(r) * 0.42]}>
          <boxGeometry args={[0.06, 0.005, 0.02]} />
          <meshStandardMaterial color="#000" />
        </mesh>
      ))}
    </group>
  );
}

// ── Sewer grate (flat rectangular grate in curb) ────────────────────

function SewerGrate({
  position,
  rotation = 0,
}: {
  position: [number, number, number];
  rotation?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Frame */}
      <mesh position={[0, 0.01, 0]}>
        <boxGeometry args={[0.7, 0.02, 0.5]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
      {/* Grate bars */}
      {[0, 1, 2, 3, 4].map(i => (
        <mesh key={i} position={[0, 0.02, -0.2 + i * 0.1]}>
          <boxGeometry args={[0.65, 0.015, 0.03]} />
          <meshStandardMaterial color="#2a2a2a" metalness={0.5} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

// ── Traffic cone ─────────────────────────────────────────────────────

function TrafficCone({ position, id }: { position: [number, number, number]; id: string }) {
  useStructure(id, position[0], position[2], 0.3, 0.3, 0.5, { topMaterial: 'path', solid: false });
  const entry = getProp('traffic-cone');
  const { hasModel } = useGlbProbe(entry.glbUrl);
  return (
    <group position={position}>
      {hasModel && entry.glbUrl ? (
        <GlbModel url={entry.glbUrl} scale={entry.defaultScale ?? 1} />
      ) : (
        <>
          <mesh position={[0, 0.03, 0]}>
            <boxGeometry args={[0.3, 0.06, 0.3]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <coneGeometry args={[0.15, 0.5, 8]} />
            <meshStandardMaterial color="#ff6f00" roughness={0.7} />
          </mesh>
          {/* Reflective stripe */}
          <mesh position={[0, 0.25, 0]}>
            <cylinderGeometry args={[0.13, 0.16, 0.06, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} />
          </mesh>
        </>
      )}
    </group>
  );
}

// ── Parked car (low-poly sedan w/ chrome trim, rims, mirrors) ─────────

function ParkedCar({
  position,
  rotation = 0,
  id,
  color = '#b71c1c',
}: {
  position: [number, number, number];
  rotation?: number;
  id: string;
  color?: string;
}) {
  const L = 3.8;
  const W = 1.6;
  const H = 1.2;
  useStructure(id, position[0], position[2], L, W, H, { topMaterial: 'metal' });
  // Pick a car variant deterministically from the instance id so car-1 != car-2.
  const variant = pickCarVariant(id);
  const { hasModel } = useGlbProbe(variant.glbUrl);
  const glossy = { color, roughness: 0.28, metalness: 0.45 } as const;
  const chrome = { color: '#d8d8d8', roughness: 0.15, metalness: 0.9 } as const;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {hasModel && variant.glbUrl ? (
        <GlbModel url={variant.glbUrl} scale={variant.defaultScale ?? 1} />
      ) : (
        <>
          {/* Body (lower) */}
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[L, 0.5, W]} />
            <meshStandardMaterial {...glossy} />
          </mesh>
          {/* Rocker panel (darker strip along the bottom) */}
          <mesh position={[0, 0.25, 0]}>
            <boxGeometry args={[L - 0.1, 0.1, W + 0.02]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
          {/* Hood wedge (front) */}
          <mesh position={[L / 2 - 0.6, 0.55, 0]}>
            <boxGeometry args={[1.2, 0.3, W - 0.1]} />
            <meshStandardMaterial {...glossy} />
          </mesh>
          {/* Trunk wedge (rear) */}
          <mesh position={[-L / 2 + 0.6, 0.55, 0]}>
            <boxGeometry args={[1.2, 0.3, W - 0.1]} />
            <meshStandardMaterial {...glossy} />
          </mesh>
          {/* Cabin */}
          <mesh position={[0, 0.95, 0]}>
            <boxGeometry args={[1.8, 0.55, W - 0.15]} />
            <meshStandardMaterial {...glossy} />
          </mesh>
          {/* Roof (slightly narrower, matte) */}
          <mesh position={[0, 1.23, 0]}>
            <boxGeometry args={[1.7, 0.05, W - 0.25]} />
            <meshStandardMaterial color={color} roughness={0.55} metalness={0.2} />
          </mesh>
          {/* Windshield */}
          <mesh position={[0.95, 0.95, 0]} rotation={[0, 0, Math.PI / 3.5]}>
            <boxGeometry args={[0.12, 0.55, W - 0.2]} />
            <meshStandardMaterial color="#0a1a2a" roughness={0.1} metalness={0.6} />
          </mesh>
          {/* Rear windshield */}
          <mesh position={[-0.95, 0.95, 0]} rotation={[0, 0, -Math.PI / 3.5]}>
            <boxGeometry args={[0.12, 0.55, W - 0.2]} />
            <meshStandardMaterial color="#0a1a2a" roughness={0.1} metalness={0.6} />
          </mesh>
          {/* Side windows (left + right) */}
          {[W / 2 - 0.005, -(W / 2 - 0.005)].map(z => (
            <mesh key={z} position={[0, 1.05, z]}>
              <boxGeometry args={[1.5, 0.38, 0.02]} />
              <meshStandardMaterial color="#0a1a2a" roughness={0.1} metalness={0.6} />
            </mesh>
          ))}
          {/* Side mirrors */}
          {[W / 2 + 0.08, -(W / 2 + 0.08)].map(z => (
            <mesh key={z} position={[0.82, 1.0, z]}>
              <boxGeometry args={[0.18, 0.1, 0.1]} />
              <meshStandardMaterial {...glossy} />
            </mesh>
          ))}
          {/* Chrome belt line (waist) */}
          {[W / 2 + 0.005, -(W / 2 + 0.005)].map(z => (
            <mesh key={z} position={[0, 0.74, z]}>
              <boxGeometry args={[L - 0.2, 0.03, 0.015]} />
              <meshStandardMaterial {...chrome} />
            </mesh>
          ))}
          {/* Chrome front bumper */}
          <mesh position={[L / 2 - 0.02, 0.3, 0]}>
            <boxGeometry args={[0.08, 0.18, W - 0.1]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          {/* Chrome rear bumper */}
          <mesh position={[-L / 2 + 0.02, 0.3, 0]}>
            <boxGeometry args={[0.08, 0.18, W - 0.1]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          {/* Grille (front) */}
          <mesh position={[L / 2 - 0.01, 0.5, 0]}>
            <boxGeometry args={[0.02, 0.18, W - 0.4]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.5} metalness={0.6} />
          </mesh>
          {/* License plate rear */}
          <mesh position={[-L / 2 - 0.01, 0.42, 0]}>
            <boxGeometry args={[0.01, 0.14, 0.38]} />
            <meshStandardMaterial color="#f5f5f0" emissive="#aaa" emissiveIntensity={0.15} />
          </mesh>
          {/* Antenna */}
          <mesh position={[-0.9, 1.4, W / 2 - 0.2]}>
            <cylinderGeometry args={[0.008, 0.008, 0.3, 6]} />
            <meshStandardMaterial color="#111" metalness={0.6} />
          </mesh>
          {/* Wheel wells (dark arches behind the wheels) */}
          {[L / 2 - 0.7, -L / 2 + 0.7].map(x =>
            [W / 2 - 0.02, -(W / 2 - 0.02)].map(z => (
              <mesh key={`${x}-${z}`} position={[x, 0.28, z]}>
                <boxGeometry args={[0.75, 0.28, 0.04]} />
                <meshStandardMaterial color="#050505" roughness={1} />
              </mesh>
            )),
          )}
          {/* Wheels w/ rims */}
          {[
            [L / 2 - 0.7, 0.25, W / 2 - 0.02],
            [L / 2 - 0.7, 0.25, -W / 2 + 0.02],
            [-L / 2 + 0.7, 0.25, W / 2 - 0.02],
            [-L / 2 + 0.7, 0.25, -W / 2 + 0.02],
          ].map(([x, y, z], i) => (
            <group key={i} position={[x, y, z]}>
              {/* Tire */}
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.28, 0.28, 0.18, 18]} />
                <meshStandardMaterial color="#0a0a0a" roughness={0.95} />
              </mesh>
              {/* Rim (chrome 5-spoke look) */}
              <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, z > 0 ? 0.01 : -0.01]}>
                <cylinderGeometry args={[0.18, 0.18, 0.02, 12]} />
                <meshStandardMaterial {...chrome} />
              </mesh>
              {/* Hub cap */}
              <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, z > 0 ? 0.02 : -0.02]}>
                <cylinderGeometry args={[0.08, 0.08, 0.01, 10]} />
                <meshStandardMaterial color="#111" metalness={0.5} />
              </mesh>
            </group>
          ))}
          {/* Headlights (bigger, dual) */}
          {[0.3, -0.05].map(dz =>
            [W / 2 - 0.25, -(W / 2 - 0.25)].map(z => (
              <mesh key={`${dz}-${z}`} position={[L / 2 + 0.005, 0.55 + dz * 0, z + dz * 0]}>
                <boxGeometry args={[0.04, 0.14, 0.18]} />
                <meshStandardMaterial color="#fffbe3" emissive="#fff5cc" emissiveIntensity={0.8} />
              </mesh>
            )),
          )}
          {/* Tail lights (red) */}
          {[W / 2 - 0.2, -(W / 2 - 0.2)].map(z => (
            <mesh key={z} position={[-L / 2 + 0.005, 0.52, z]}>
              <boxGeometry args={[0.04, 0.12, 0.3]} />
              <meshStandardMaterial color="#e53935" emissive="#b71c1c" emissiveIntensity={0.5} />
            </mesh>
          ))}
        </>
      )}
      {/* Paintable door panels — both sides, stay overlaid regardless of GLB vs proc */}
      <Paintable
        surfaceId={`${id}-door-l`}
        width={L * 0.55}
        height={0.5}
        position={[0, 0.45, W / 2 + 0.002]}
        frameColor={null}
      />
      <Paintable
        surfaceId={`${id}-door-r`}
        width={L * 0.55}
        height={0.5}
        position={[0, 0.45, -(W / 2 + 0.002)]}
        rotation={[0, Math.PI, 0]}
        frameColor={null}
      />
    </group>
  );
}

// ── Storefront (bodega: 3D sign, neon OPEN, window display, paintable shutter)

// Block-letter glyph shapes built from tiny box meshes.
// Coordinate: positive X = right, positive Y = up. Origin at baseline-left.
const LETTER_GLYPHS: Record<string, [number, number, number, number][]> = {
  B: [
    [0, 0, 0.2, 1],
    [0.2, 0, 0.6, 0.2],
    [0.2, 0.4, 0.6, 0.2],
    [0.2, 0.8, 0.6, 0.2],
    [0.6, 0.1, 0.2, 0.3],
    [0.6, 0.5, 0.2, 0.3],
  ],
  O: [
    [0, 0, 0.2, 1],
    [0.6, 0, 0.2, 1],
    [0.2, 0, 0.4, 0.2],
    [0.2, 0.8, 0.4, 0.2],
  ],
  D: [
    [0, 0, 0.2, 1],
    [0.2, 0, 0.5, 0.2],
    [0.2, 0.8, 0.5, 0.2],
    [0.6, 0.1, 0.2, 0.8],
  ],
  E: [
    [0, 0, 0.2, 1],
    [0.2, 0, 0.6, 0.2],
    [0.2, 0.4, 0.5, 0.2],
    [0.2, 0.8, 0.6, 0.2],
  ],
  G: [
    [0, 0, 0.2, 1],
    [0.2, 0, 0.6, 0.2],
    [0.2, 0.8, 0.6, 0.2],
    [0.6, 0.0, 0.2, 0.5],
    [0.4, 0.4, 0.4, 0.2],
  ],
  A: [
    [0, 0, 0.2, 1],
    [0.6, 0, 0.2, 1],
    [0.2, 0.8, 0.4, 0.2],
    [0.2, 0.4, 0.4, 0.2],
  ],
};

function SignText({
  text,
  position,
  rotation = 0,
  glyphH = 0.45,
  depth = 0.06,
  color = '#1a1a1a',
  emissive,
}: {
  text: string;
  position: [number, number, number];
  rotation?: number;
  glyphH?: number;
  depth?: number;
  color?: string;
  emissive?: string;
}) {
  const glyphW = glyphH * 0.8;
  const spacing = glyphH * 0.25;
  const letters = text.split('');
  const totalW = letters.length * glyphW + (letters.length - 1) * spacing;
  let cursor = -totalW / 2;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {letters.map((ch, i) => {
        const glyph = LETTER_GLYPHS[ch];
        const x0 = cursor;
        cursor += glyphW + spacing;
        if (!glyph) return null;
        return (
          <group key={`${ch}-${i}`} position={[x0, 0, 0]}>
            {glyph.map(([gx, gy, gw, gh], j) => (
              <mesh
                key={j}
                position={[gx * glyphW + (gw * glyphW) / 2, gy * glyphH + (gh * glyphH) / 2, 0]}
              >
                <boxGeometry args={[gw * glyphW, gh * glyphH, depth]} />
                <meshStandardMaterial
                  color={color}
                  emissive={emissive ?? '#000'}
                  emissiveIntensity={emissive ? 1.3 : 0}
                  roughness={0.5}
                />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function Bodega({
  position,
  rotation = 0,
  id,
}: {
  position: [number, number, number];
  rotation?: number;
  id: string;
}) {
  const W = 6;
  const D = 2.5;
  const H = 4;
  useStructure(id, position[0], position[2], W, D, H, { topMaterial: 'stone' });
  // Only swap in the Kenney shop if its GLB exists — the proc bodega w/ BODEGA+OPEN
  // signs is the signature storefront and we keep it by default.
  const entry = getProp('shop-small');
  const { hasModel } = useGlbProbe(entry.glbUrl);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {hasModel && entry.glbUrl ? (
        <GlbModel url={entry.glbUrl} scale={entry.defaultScale ?? 1} />
      ) : (
        <>
          {/* Body — stucco beige */}
          <mesh position={[0, H / 2, 0]}>
            <boxGeometry args={[W, H, D]} />
            <meshStandardMaterial color="#5a4634" roughness={0.95} />
          </mesh>
          {/* Trim strip along top */}
          <mesh position={[0, H - 0.1, D / 2 + 0.01]}>
            <boxGeometry args={[W, 0.2, 0.04]} />
            <meshStandardMaterial color="#3e2723" />
          </mesh>
          {/* Awning (red/white striped — scalloped front) */}
          {[0, 1, 2, 3].map(i => (
            <mesh key={i} position={[-W / 2 + 0.75 + i * 1.5, H * 0.65, D / 2 + 0.35]}>
              <boxGeometry args={[1.45, 0.15, 0.7]} />
              <meshStandardMaterial color={i % 2 === 0 ? '#c62828' : '#fafafa'} roughness={0.75} />
            </mesh>
          ))}
          {/* Awning front edge (triangular valance scallops) */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
            const x = -W / 2 + 0.4 + i * 0.75;
            return (
              <mesh key={i} position={[x, H * 0.55, D / 2 + 0.7]} rotation={[0, 0, Math.PI / 4]}>
                <boxGeometry args={[0.15, 0.15, 0.02]} />
                <meshStandardMaterial
                  color={i % 2 === 0 ? '#c62828' : '#fafafa'}
                  roughness={0.75}
                />
              </mesh>
            );
          })}
          {/* Sign backdrop above awning */}
          <mesh position={[0, H * 0.85, D / 2 + 0.04]}>
            <boxGeometry args={[W - 0.4, 0.6, 0.05]} />
            <meshStandardMaterial color="#fff8dc" emissive="#fff3c4" emissiveIntensity={0.5} />
          </mesh>
          {/* 3D BODEGA letters */}
          <SignText
            text="BODEGA"
            position={[0, H * 0.78, D / 2 + 0.1]}
            glyphH={0.4}
            color="#b71c1c"
          />
          {/* Window display: lit interior band behind the shutter frame */}
          <mesh position={[0, H * 0.32, D / 2 - 0.2]}>
            <boxGeometry args={[W - 0.9, H * 0.5, 0.1]} />
            <meshStandardMaterial color="#2a2410" emissive="#f8a537" emissiveIntensity={0.9} />
          </mesh>
          {/* Product boxes on display shelves */}
          {[0, 1, 2, 3, 4].map(i => (
            <mesh key={i} position={[-W / 2 + 0.7 + i * 0.95, H * 0.22, D / 2 - 0.18]}>
              <boxGeometry args={[0.2, 0.25, 0.1]} />
              <meshStandardMaterial
                color={['#c62828', '#1565c0', '#f9a825', '#2e7d32', '#6a1b9a'][i] ?? '#fff'}
                roughness={0.6}
              />
            </mesh>
          ))}
          {/* Neon OPEN sign in upper window */}
          <mesh position={[W / 2 - 0.8, H * 0.48, D / 2 + 0.05]}>
            <boxGeometry args={[0.5, 0.22, 0.02]} />
            <meshStandardMaterial color="#0a0a0a" />
          </mesh>
          <SignText
            text="OPEN"
            position={[W / 2 - 0.8, H * 0.455, D / 2 + 0.075]}
            glyphH={0.16}
            depth={0.01}
            color="#ff2e7e"
            emissive="#ff2e7e"
          />
          {/* Shutter frame (dark recess at street level) */}
          <mesh position={[0, H * 0.32, D / 2 + 0.04]}>
            <boxGeometry args={[W - 0.5, H * 0.55, 0.05]} />
            <meshStandardMaterial color="#0a0a0a" />
          </mesh>
        </>
      )}
      {/* Paintable rolling shutter — overlaid regardless of GLB vs proc */}
      <Paintable
        surfaceId={`${id}-shutter`}
        width={W - 0.7}
        height={H * 0.5}
        position={[0, H * 0.3, D / 2 + 0.08]}
        baseFill="#3e4a5a"
        frameColor={null}
      />
      {/* Paintable side wall (alley side) */}
      <Paintable
        surfaceId={`${id}-side`}
        width={D * 0.9}
        height={H * 0.7}
        position={[W / 2 + 0.002, H * 0.38, 0]}
        rotation={[0, Math.PI / 2, 0]}
        baseFill="#4a3a2a"
        frameColor={null}
      />
    </group>
  );
}

// ── Sidewalk slab ────────────────────────────────────────────────────

function SidewalkSlab({
  position,
  rotation = 0,
  size,
}: {
  position: [number, number, number];
  rotation?: number;
  size: [number, number];
}) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, rotation]} receiveShadow>
      <planeGeometry args={size} />
      <meshStandardMaterial color="#7a7a70" roughness={0.98} />
    </mesh>
  );
}

// ── Curb ─────────────────────────────────────────────────────────────

function Curb({
  position,
  rotation = 0,
  length,
}: {
  position: [number, number, number];
  rotation?: number;
  length: number;
}) {
  return (
    <mesh position={position} rotation={[0, rotation, 0]}>
      <boxGeometry args={[length, 0.15, 0.25]} />
      <meshStandardMaterial color="#9a9a90" roughness={0.95} />
    </mesh>
  );
}

// ── Main CityBlock composer ──────────────────────────────────────────
//
// The block centers around the Apartment/MegaRamp cluster. Layout:
//
//   N (up)
//   │
//   │   [Apartment] ── [MegaRamp]     — east edge
//   │        │                         (x≈86, z≈51)
//   │    [Alley]
//   │   dumpsters
//   │        │
//   │   [Bodega]────────              — storefront on S side of alley
//   │        │                         (x≈74, z≈58)
//   │   [sidewalk west-east]
//   │   lamps/mail/hydrant
//   │        │
//   │   [Parked cars]                  — curbside
//   │        │
//   │   [Office] (x=62, z=62)
//   │
// Cars, lamps, mailboxes etc. line the main north-south corridor.

export default function CityBlock(): ReactNode {
  return (
    <group>
      {/* ── Sidewalk slabs along the N-S corridor from spawn → office/bodega ── */}
      <SidewalkSlab position={[68, 0.02, 56]} size={[16, 4]} />
      <SidewalkSlab position={[68, 0.02, 62]} size={[16, 4]} />
      {/* Alley slab between apartment and bodega */}
      <SidewalkSlab position={[80, 0.02, 56]} size={[8, 3]} />

      {/* ── Curbs (just the street-facing edges) ── */}
      <Curb position={[68, 0.08, 54]} length={16} />
      <Curb position={[68, 0.08, 64]} length={16} />

      {/* ── Lampposts spaced 6u along the sidewalk ── */}
      <Lamppost position={[62, 0, 54.3]} id="lamp-1" />
      <Lamppost position={[68, 0, 54.3]} id="lamp-2" />
      <Lamppost position={[74, 0, 54.3]} id="lamp-3" />
      <Lamppost position={[80, 0, 54.3]} id="lamp-4" />
      <Lamppost position={[62, 0, 63.7]} id="lamp-5" />
      <Lamppost position={[68, 0, 63.7]} id="lamp-6" />
      <Lamppost position={[74, 0, 63.7]} id="lamp-7" />

      {/* ── Mail + hydrant + trash grouping near bodega ── */}
      <Mailbox position={[73, 0, 55.2]} id="mail-1" />
      <FireHydrant position={[71, 0, 55.2]} id="hydrant-1" />
      <TrashCan position={[70, 0, 55.2]} id="trash-1" />
      <TrashCan position={[70.7, 0, 55.2]} id="trash-2" color="#1e3a1e" />

      {/* ── Bench near the ramp (spectators) ── */}
      <Bench position={[76, 0, 55.5]} rotation={Math.PI} id="bench-1" />
      <Bench position={[65, 0, 63.3]} rotation={0} id="bench-2" />

      {/* ── Dumpsters in the alley (prime tagging real estate) ── */}
      <Dumpster position={[82, 0, 55.8]} rotation={Math.PI / 2} id="dump-1" />
      <Dumpster position={[82, 0, 58]} rotation={Math.PI / 2} id="dump-2" />

      {/* ── Parked cars curbside ── */}
      <ParkedCar position={[66, 0, 65.5]} rotation={Math.PI / 2} id="car-1" color="#b71c1c" />
      <ParkedCar position={[72, 0, 65.5]} rotation={Math.PI / 2} id="car-2" color="#1565c0" />
      <ParkedCar position={[78, 0, 65.5]} rotation={Math.PI / 2} id="car-3" color="#2e7d32" />

      {/* ── Bodega storefront, facing the sidewalk ── */}
      <Bodega position={[74, 0, 60]} rotation={Math.PI} id="bodega-1" />

      {/* ── Traffic cones scattered ── */}
      <TrafficCone position={[63, 0, 55.6]} id="cone-1" />
      <TrafficCone position={[81.5, 0, 57]} id="cone-2" />
      <TrafficCone position={[69, 0, 64.5]} id="cone-3" />

      {/* ── Newspaper boxes near bodega ── */}
      <NewspaperBox position={[72.3, 0, 55.3]} id="news-1" color="#1565c0" />
      <NewspaperBox position={[72.9, 0, 55.3]} id="news-2" color="#c62828" />
      <NewspaperBox position={[64, 0, 63.4]} rotation={Math.PI} id="news-3" color="#6a1b9a" />

      {/* ── Manhole covers in the street ── */}
      <ManholeCover position={[70, 0.02, 59]} />
      <ManholeCover position={[78, 0.02, 59]} />

      {/* ── Sewer grates along the curb ── */}
      <SewerGrate position={[65, 0.02, 54.3]} />
      <SewerGrate position={[73, 0.02, 54.3]} />
      <SewerGrate position={[66, 0.02, 63.7]} />
    </group>
  );
}
