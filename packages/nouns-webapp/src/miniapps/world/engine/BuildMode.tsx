// ── BuildMode — Fortnite-style realtime building ─────────────────────
//
// Hold `B` to enter build mode. Number keys (1-7) pick a piece. A ghost
// preview follows the player, snapped to a 1u grid, facing away from the
// camera. Space places the piece. Clicking a placed prop while `B` is
// held grabs it — drag to move, wheel to rotate, Del to delete, Esc or
// another click to release.
//
// Every placement goes through PlacedPropsStore and broadcasts via
// PartyKit so other players see the builds live.
//
// Ramps register as 5 stepped AABBs under a smooth angled plane, so
// newly-placed ramps are immediately walkable by the locomotion system.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type MutableRefObject,
} from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { InputState } from './input';
import {
  BuildWall,
  BuildFloor,
  BuildRamp,
  BuildLamp,
  BuildCar,
  BuildDumpster,
  BuildBodega,
} from './buildPieces';
import {
  type BuildPieceKind,
  type PlacedProp,
  type PlacedPropsStore,
  makePropId,
  sendPlaced,
} from './placedProps';

const WORLD_SCALE = 0.1; // tile-world × WORLD_SCALE = three.js

const PIECE_BY_KEY: Record<string, BuildPieceKind> = {
  '1': 'wall',
  '2': 'floor',
  '3': 'ramp',
  '4': 'lamp',
  '5': 'car',
  '6': 'dumpster',
  '7': 'bodega',
};

const PIECE_NAMES: Record<BuildPieceKind, string> = {
  wall: 'Wall',
  floor: 'Floor',
  ramp: 'Ramp',
  lamp: 'Lamp',
  car: 'Car',
  dumpster: 'Dumpster',
  bodega: 'Bodega',
};

// Distance from player where the ghost cursor sits (three.js units).
const GHOST_DIST = 2;
// Grid cell for snapping placements (three.js units).
const GRID = 1;

// ── Public props ─────────────────────────────────────────────────────

export interface BuildModeProps {
  inputRef: MutableRefObject<InputState>;
  /** Player position in tile-world coords (same units as Player.x / Player.y). */
  playerRef: MutableRefObject<{ x: number; y: number } | null>;
  authorId: string;
  wsRef: MutableRefObject<WebSocket | null>;
  store: PlacedPropsStore;
  /**
   * Optional: called when build mode activation changes so the outer HUD
   * can show a build overlay (piece name, toolbar, etc).
   */
  onActiveChange?: (active: boolean, kind: BuildPieceKind) => void;
}

// ── Dispatch: render a PlacedProp with its matching piece component ──

interface PlacedPieceProps {
  prop: PlacedProp;
  onGrab: (id: string) => void;
  isGrabbed: boolean;
}

function PlacedPiece({ prop, onGrab, isGrabbed }: PlacedPieceProps): ReactNode {
  const common = {
    id: prop.id,
    position: [prop.x, prop.y ?? 0, prop.z] as [number, number, number],
    rotationY: prop.rotationY,
    scale: prop.scale,
  };
  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    // Only act on primary button clicks in build mode — the caller checks input.
    if (e.button !== 0) return;
    e.stopPropagation();
    onGrab(prop.id);
  };
  const glow = isGrabbed ? (
    // A subtle glow ring so you can see which prop is grabbed.
    <mesh position={[0, 0.01, 0]}>
      <ringGeometry args={[1.2, 1.45, 24]} />
      <meshBasicMaterial color="#4cf0ff" transparent opacity={0.45} side={THREE.DoubleSide} />
    </mesh>
  ) : null;
  return (
    <group
      position={common.position}
      rotation={[0, common.rotationY, 0]}
      onPointerDown={handleDown}
    >
      {glow}
      {/* The piece itself — place at local origin since the outer group carries position/rotation. */}
      <group
        position={[-common.position[0], -common.position[1], -common.position[2]]}
        rotation={[0, -common.rotationY, 0]}
      >
        {dispatchPiece(prop.kind, common)}
      </group>
    </group>
  );
}

function dispatchPiece(
  kind: BuildPieceKind,
  common: { id: string; position: [number, number, number]; rotationY: number; scale?: number },
): ReactNode {
  switch (kind) {
    case 'wall':
      return <BuildWall {...common} />;
    case 'floor':
      return <BuildFloor {...common} />;
    case 'ramp':
      return <BuildRamp {...common} />;
    case 'lamp':
      return <BuildLamp {...common} />;
    case 'car':
      return <BuildCar {...common} />;
    case 'dumpster':
      return <BuildDumpster {...common} />;
    case 'bodega':
      return <BuildBodega {...common} />;
  }
}

// ── Ghost preview (semi-transparent, follows the player) ─────────────
//
// Render the same geometry at low opacity by piggy-backing on the full
// piece components. We wrap them in a group with a material-override
// pass implemented via post-render alpha trick: because r3f material
// state is per-mesh, the simplest cheap approach is to just render
// bounding boxes of the right size for each kind. That keeps the ghost
// lightweight (no StructureRegistry registrations) while communicating
// what's about to land.

function GhostBounds({ kind }: { kind: BuildPieceKind }): ReactNode {
  const [w, h, d, yOffset] = useMemo<[number, number, number, number]>(() => {
    switch (kind) {
      case 'wall':
        return [2, 3, 0.2, 1.5];
      case 'floor':
        return [3, 0.2, 3, 0.1];
      case 'ramp':
        return [3, 3, 3, 1.5];
      case 'lamp':
        return [0.3, 3.5, 0.3, 1.75];
      case 'car':
        return [3.8, 1.2, 1.6, 0.6];
      case 'dumpster':
        return [2.6, 1.3, 1.3, 0.65];
      case 'bodega':
        return [6, 4, 2.5, 2];
    }
  }, [kind]);
  return (
    <group>
      <mesh position={[0, yOffset, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color="#4cf0ff" transparent opacity={0.2} />
      </mesh>
      {/* Edge frame for a clearer outline */}
      <mesh position={[0, yOffset, 0]}>
        <boxGeometry args={[w + 0.06, h + 0.06, d + 0.06]} />
        <meshBasicMaterial color="#4cf0ff" transparent opacity={0.12} wireframe />
      </mesh>
    </group>
  );
}

// ── Main component ──────────────────────────────────────────────────

export function BuildMode(props: BuildModeProps): ReactNode {
  const { inputRef, playerRef, authorId, wsRef, store, onActiveChange } = props;
  const { camera, scene, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  // Subscribe to placed-props store.
  const placed = useSyncExternalStore(store.subscribe, store.list, store.list);

  // Mutable state we prefer over React state for frame-driven updates.
  const activeRef = useRef(false);
  const [active, setActive] = useState(false);
  const [selectedKind, setSelectedKind] = useState<BuildPieceKind>('wall');
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const grabbedIdRef = useRef<string | null>(null);
  useEffect(() => {
    grabbedIdRef.current = grabbedId;
  }, [grabbedId]);

  const ghostGroupRef = useRef<THREE.Group>(null);

  // Notify outer layer on activation changes (used for HUD).
  useEffect(() => {
    onActiveChange?.(active, selectedKind);
  }, [active, selectedKind, onActiveChange]);

  // Keyboard / mouse handlers for grab state — attached to window so
  // they work even when the pointer isn't over the canvas.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const id = grabbedIdRef.current;
      if (!id) return;
      e.preventDefault();
      const list = store.list();
      const current = list.find(p => p.id === id);
      if (!current) return;
      const step = e.shiftKey ? 1 : 0.1;
      const newRot = current.rotationY + Math.sign(e.deltaY) * step;
      store.update(id, { rotationY: newRot });
      sendPlaced(wsRef.current, {
        type: 'world:build:update',
        id,
        patch: { rotationY: newRot },
      });
    };
    const onKey = (e: KeyboardEvent) => {
      const id = grabbedIdRef.current;
      if (!id) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.remove(id);
        sendPlaced(wsRef.current, { type: 'world:build:remove', id });
        setGrabbedId(null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setGrabbedId(null);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [store, wsRef]);

  // Grab a placed piece on click (only when build mode is active).
  const handleGrab = useCallback((id: string) => {
    if (!activeRef.current) return;
    setGrabbedId(prev => (prev === id ? null : id));
  }, []);

  // Per-frame: activation check, piece select, ghost cursor position,
  // grab-drag, place/remove.
  useFrame(() => {
    const input = inputRef.current;
    const player = playerRef.current;
    if (!input) return;

    // Activation via held `b` key.
    const now = input.keys.has('b');
    if (now !== activeRef.current) {
      activeRef.current = now;
      setActive(now);
      if (!now) {
        // Leaving build mode — drop any grab.
        if (grabbedIdRef.current != null) setGrabbedId(null);
      }
    }
    if (!now) return;

    // Piece select (1-7) — skip when grabbed so number keys don't yank
    // the current drag.
    if (!grabbedIdRef.current) {
      for (const [key, kind] of Object.entries(PIECE_BY_KEY)) {
        if (input.justPressed.has(key)) {
          setSelectedKind(kind);
          input.justPressed.delete(key);
          break;
        }
      }
    }

    // Ghost cursor follow — 2u in front of the player, snapped to 1u grid.
    if (player && ghostGroupRef.current && !grabbedIdRef.current) {
      const angle = input.cameraAngle;
      const tjPx = player.x * WORLD_SCALE;
      const tjPz = player.y * WORLD_SCALE;
      // Forward vector: camera orbits around player; looking toward player from
      // (sin*cos*d, y, cos*cos*d) direction. Forward "out of screen" =
      // -(sin, cos) in XZ.
      const fwdX = -Math.sin(angle) * GHOST_DIST;
      const fwdZ = -Math.cos(angle) * GHOST_DIST;
      const gx = Math.round((tjPx + fwdX) / GRID) * GRID;
      const gz = Math.round((tjPz + fwdZ) / GRID) * GRID;
      ghostGroupRef.current.position.set(gx, 0, gz);
      ghostGroupRef.current.rotation.y = -angle;
    }

    // Drag: if grabbed, raycast from pointer to ground plane each frame and
    // update the placed prop's position. Not network-synced until release
    // (reduces traffic); on final release we emit a move.
    const grabId = grabbedIdRef.current;
    if (grabId) {
      // drei's r3f exposes current pointer NDC via useThree().pointer but we
      // have to read it via gl.domElement listeners — use the scene's
      // intersection with the ground plane.
      const ndc = _readPointerNDC(gl.domElement);
      if (ndc) {
        raycaster.setFromCamera(ndc, camera);
        const hit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(groundPlane, hit)) {
          // Snap to grid for clean alignment.
          const gx = Math.round(hit.x / GRID) * GRID;
          const gz = Math.round(hit.z / GRID) * GRID;
          store.update(grabId, { x: gx, z: gz });
        }
      }
      // Release on Space while dragging.
      if (input.justPressed.has(' ')) {
        input.justPressed.delete(' ');
        input.keys.delete(' '); // prevent jump/backflip resolve downstream
        const cur = store.list().find(p => p.id === grabId);
        if (cur) {
          sendPlaced(wsRef.current, {
            type: 'world:build:update',
            id: grabId,
            patch: { x: cur.x, z: cur.z, rotationY: cur.rotationY },
          });
        }
        setGrabbedId(null);
      }
      return;
    }

    // Place on Space.
    if (input.justPressed.has(' ') && player) {
      input.justPressed.delete(' ');
      input.keys.delete(' '); // prevent jump/backflip downstream
      const angle = input.cameraAngle;
      const tjPx = player.x * WORLD_SCALE;
      const tjPz = player.y * WORLD_SCALE;
      const fwdX = -Math.sin(angle) * GHOST_DIST;
      const fwdZ = -Math.cos(angle) * GHOST_DIST;
      const gx = Math.round((tjPx + fwdX) / GRID) * GRID;
      const gz = Math.round((tjPz + fwdZ) / GRID) * GRID;
      const prop: PlacedProp = {
        id: makePropId(authorId),
        kind: selectedKind,
        x: gx,
        z: gz,
        rotationY: -angle,
        authorId,
        placedAt: Date.now(),
      };
      store.add(prop);
      sendPlaced(wsRef.current, { type: 'world:build:place', prop });
    }
  });

  // Silence unused-warning for `scene` — kept for future needs
  void scene;

  return (
    <group>
      {/* All currently placed pieces */}
      {placed.map(p => (
        <PlacedPiece key={p.id} prop={p} onGrab={handleGrab} isGrabbed={p.id === grabbedId} />
      ))}
      {/* Ghost cursor (only when build mode is active and not dragging) */}
      {active && !grabbedId && (
        <group ref={ghostGroupRef}>
          <GhostBounds kind={selectedKind} />
        </group>
      )}
    </group>
  );
}

// ── Private helpers ──────────────────────────────────────────────────

/**
 * Read the canvas pointer in normalized device coords. Returns null if
 * the pointer isn't over the canvas.
 */
let _ndcCache: THREE.Vector2 | null = null;
let _lastPointerEvent: PointerEvent | MouseEvent | null = null;
function _readPointerNDC(canvas: HTMLCanvasElement): THREE.Vector2 | null {
  // Lazily attach one shared pointermove listener to the canvas.
  if (!_ndcCache) {
    _ndcCache = new THREE.Vector2();
    const onPointer = (e: PointerEvent | MouseEvent) => {
      _lastPointerEvent = e;
    };
    canvas.addEventListener('pointermove', onPointer as EventListener);
    canvas.addEventListener('mousemove', onPointer as EventListener);
  }
  const ev = _lastPointerEvent;
  if (!ev) return null;
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  _ndcCache.set(x, y);
  return _ndcCache;
}

// ── Build HUD — small overlay that shows current kind + controls ─────
//
// Render OUTSIDE the Canvas tree. Rebinds via the same onActiveChange
// callback BuildMode fires.

export interface BuildHudProps {
  active: boolean;
  kind: BuildPieceKind;
}

export function BuildHud({ active, kind }: BuildHudProps): ReactNode {
  if (!active) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 18,
        background: 'rgba(12,12,14,0.88)',
        border: '1px solid rgba(76,240,255,0.5)',
        borderRadius: 10,
        padding: '10px 16px',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        letterSpacing: 1,
        pointerEvents: 'none',
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ color: '#4cf0ff', fontSize: 11, marginBottom: 4 }}>BUILD MODE</div>
      <div style={{ fontSize: 15, marginBottom: 6 }}>{PIECE_NAMES[kind]}</div>
      <div style={{ fontSize: 10, color: '#aaa' }}>
        1wall · 2floor · 3ramp · 4lamp · 5car · 6dump · 7bodega · SPACE place · Click+drag edit ·
        Wheel rotate · Del remove
      </div>
    </div>
  );
}
