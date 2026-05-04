// ── WhiteRoom — Matrix construct-style training dojo ─────────────────
//
// Infinite white plane, soft fog, three paintable monoliths arranged as
// a triangle around spawn, and a FriedMirror portal 5u in front of
// spawn. No shadows, no directional lights — a deliberately sparse
// white void. The FriedWorld opt-in happens through the mirror.
//
// Around the monoliths sits a training dojo: obstacle course (+Z),
// training dummies (+X), target gallery (−X), gravity zones (−Z), and
// an ambient construct drone.
//
// To enable gravity zones + dummy hits against the live player body,
// call `setPlayerBodyForDojo(body)` from WorldPage's GameLogic tick —
// separate integration step handled by the WorldPage agent.

import { Paintable } from '@nouns/graffiti/r3f';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

import { TerraformsHorizon } from '../engine/TerraformsHorizon';
import { FriesPortal } from './FriesPortal';
import { GravityZones } from './dojo/GravityZones';
import { ObstacleCourse } from './dojo/ObstacleCourse';
import { TargetGallery } from './dojo/TargetGallery';
import { TrainingDummies } from './dojo/TrainingDummies';

const SCALE = 0.1;

// ── White-room paintable floor ────────────────────────────────────────
//
// 8×8 grid of paintable tiles centered on spawn — each ~3u square — so
// the entire ground around the player is sprayable. Each tile is keyed
// by a stable `surfaceId` (`wr-floor-{ix}-{iz}`) and round-trips through
// the same partykit storage layer that powers the monoliths and the
// open-world walls. Strokes live in `room.storage` and rehydrate on
// reload via `loadGraffitiTags`.
export const WHITE_ROOM_FLOOR_TILES = 8; // per axis
export const WHITE_ROOM_FLOOR_TILE_SIZE = 3; // world units

/** Stable list of all white-room floor surface ids (used for cold-load on connect). */
export function whiteRoomFloorTileIds(): string[] {
  const ids: string[] = [];
  for (let iz = 0; iz < WHITE_ROOM_FLOOR_TILES; iz++) {
    for (let ix = 0; ix < WHITE_ROOM_FLOOR_TILES; ix++) {
      ids.push(`wr-floor-${ix}-${iz}`);
    }
  }
  return ids;
}

export interface WhiteRoomProps {
  /** Tile-space player ref; used for the mirror's proximity prompt. */
  playerRef: React.RefObject<{ x: number; y: number } | null>;
  authorId: string;
  /** Spawn in tile coords (matches WorldPage SPAWN_X/SPAWN_Y). */
  spawnX: number;
  spawnY: number;
  /** Which monolith (if any) is currently active for painting. */
  activeWallId?: string | null;
  onStrokeEnd?: (wallId: string) => void;
}

// Three monoliths around spawn — positioned as an equilateral triangle
// 6u out. Each is 3.5 × 3, floating 1.8u off the ground.
export function monolithPositions(spawnXTile: number, spawnYTile: number) {
  const cx = spawnXTile * SCALE;
  const cz = spawnYTile * SCALE;
  const r = 6;
  return [
    { id: 'wr-mono-n', x: cx, z: cz - r, rot: 0 },
    { id: 'wr-mono-se', x: cx + r * 0.866, z: cz + r * 0.5, rot: -(Math.PI * 2) / 3 },
    { id: 'wr-mono-sw', x: cx - r * 0.866, z: cz + r * 0.5, rot: (Math.PI * 2) / 3 },
  ];
}

export function WhiteRoom({
  playerRef,
  authorId,
  spawnX,
  spawnY,
  activeWallId = null,
  onStrokeEnd,
}: WhiteRoomProps) {
  const monos = monolithPositions(spawnX, spawnY);
  const mirrorPos: [number, number, number] = [spawnX * SCALE, 2, spawnY * SCALE + 5];

  // Paintable floor — a grid of Paintable planes, one per tile, each backed
  // by its own surface in the partykit registry. Centered on the spawn so
  // the playable area is fully covered (8×3u = 24u square).
  const floorOriginX = spawnX * SCALE - (WHITE_ROOM_FLOOR_TILES * WHITE_ROOM_FLOOR_TILE_SIZE) / 2;
  const floorOriginZ = spawnY * SCALE - (WHITE_ROOM_FLOOR_TILES * WHITE_ROOM_FLOOR_TILE_SIZE) / 2;
  const floorTiles: { id: string; x: number; z: number }[] = [];
  for (let iz = 0; iz < WHITE_ROOM_FLOOR_TILES; iz++) {
    for (let ix = 0; ix < WHITE_ROOM_FLOOR_TILES; ix++) {
      floorTiles.push({
        id: `wr-floor-${ix}-${iz}`,
        x: floorOriginX + (ix + 0.5) * WHITE_ROOM_FLOOR_TILE_SIZE,
        z: floorOriginZ + (iz + 0.5) * WHITE_ROOM_FLOOR_TILE_SIZE,
      });
    }
  }

  // Dojo layouts are authored spawn-relative: the spec uses
  //   ObstacleCourse  [0, 0, 15]   (north, +Z)
  //   TrainingDummies [10, 0, 0]   (east, +X)
  //   TargetGallery   [-10, 0, 0]  (west, −X)
  //   GravityZones    [0, 0, -10]  (south, −Z)
  // Shift each by the spawn center so the dojo actually surrounds the
  // player's spawn point rather than world origin.
  const cx = spawnX * SCALE;
  const cz = spawnY * SCALE;
  const obstaclePos: [number, number, number] = [cx + 0, 0, cz + 15];
  const dummiesPos: [number, number, number] = [cx + 10, 0, cz + 0];
  const galleryPos: [number, number, number] = [cx - 10, 0, cz + 0];
  const gravPos: [number, number, number] = [cx + 0, 0, cz - 10];

  return (
    <group>
      {/* Background + fog — BLASTED WHITE. WorldPage also attaches these
          when !isFried; duplicating here is intentional so the scene has
          a strong write-after-swap. Pure #ffffff, no gray. */}
      <color attach="background" args={['#ffffff']} />
      <fog attach="fog" args={['#ffffff', 40, 340]} />

      {/* Lighting — blown-out ambient so the plane + monoliths read white,
          not gray. No directional, no shadows. */}
      <ambientLight intensity={1.4} />
      <hemisphereLight args={['#ffffff', '#ffffff', 1.2]} />

      {/* Infinite UNLIT pure-white plane — meshBasicMaterial ignores
          lighting so it's locked to the scene white no matter what. Sits
          BELOW the paintable floor tiles so any unsprayed area outside
          the grid (and any cracks between tiles) still reads pure white. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[spawnX * SCALE, 0, spawnY * SCALE]}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      {/* Paintable floor grid — each tile is its own persistent Surface.
          Strokes commit through `onStrokeEnd` → sendSnapshot in WorldPage
          and rehydrate on reload via loadGraffitiTags(WHITE_ROOM_FLOOR_TILE_IDS). */}
      <group>
        {floorTiles.map(tile => (
          <Paintable
            key={tile.id}
            surfaceId={tile.id}
            width={WHITE_ROOM_FLOOR_TILE_SIZE}
            height={WHITE_ROOM_FLOOR_TILE_SIZE}
            // Sit a hair above the white plane to avoid z-fighting.
            position={[tile.x, 0.012, tile.z]}
            rotation={[-Math.PI / 2, 0, 0]}
            resolutionWidth={384}
            resolutionHeight={384}
            baseFill="#ffffff"
            // Floor painting is always on in the white room — no proximity gate.
            enabled={true}
            authorId={authorId}
            onStrokeEnd={() => onStrokeEnd?.(tile.id)}
            frameColor={null}
            side={THREE.DoubleSide}
          />
        ))}
      </group>

      {/* Three paintable monoliths in a triangle around spawn */}
      {monos.map(m => {
        const enabled = activeWallId === m.id;
        return (
          <group key={m.id} position={[m.x, 1.8, m.z]} rotation={[0, m.rot, 0]}>
            <Paintable
              surfaceId={m.id}
              width={3.5}
              height={3}
              authorId={authorId}
              enabled={enabled}
              frameColor="#1a1a1a"
              framePad={0.15}
              onStrokeEnd={() => onStrokeEnd?.(m.id)}
            />
            {/* Faint shadow disc below */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.81, 0]}>
              <circleGeometry args={[1.8, 24]} />
              <meshBasicMaterial color="#d0d0d0" transparent opacity={0.3} />
            </mesh>
            {!enabled && (
              <Html
                position={[0, -1.8, 0.1]}
                center
                distanceFactor={6}
                style={{ pointerEvents: 'none' }}
              >
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '10px',
                    color: '#777',
                    textShadow: '0 0 4px rgba(255,255,255,0.8)',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    opacity: 0.75,
                    letterSpacing: '1px',
                  }}
                >
                  [G] SPRAY
                </div>
              </Html>
            )}
          </group>
        );
      })}

      {/* Giant fries-accessory portal to fried world */}
      <FriesPortal position={mirrorPos} playerRef={playerRef} worldScale={SCALE} />

      {/* ── Dojo — Matrix construct training elements ─────────────── */}
      <ObstacleCourse position={obstaclePos} />
      <TrainingDummies position={dummiesPos} />
      <TargetGallery position={galleryPos} />
      <GravityZones position={gravPos} />

      {/* ── Hypercastle horizon — Terraforms silhouettes on the skyline.
            Reads as distant castles rising out of the white void. ───── */}
      <group position={[spawnX * SCALE, 0, spawnY * SCALE]}>
        <TerraformsHorizon />
      </group>
    </group>
  );
}

export default WhiteRoom;
