// ── Nouns World — Immersive 3D PvP Fighting Arena ────────────────────
//
// Three.js R3F scene with third-person RPG camera, animated Noun
// sprites on billboarded quads, 3D island terrain, day/night cycle,
// and the full combat + multiplayer system from the engine.

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import LolLogo from '@/components/LolLogo';

import { useAppSelector } from '@/hooks';
import { GameHUD } from './engine/GameHUD';

import {
  SEND_INTERVAL,
  TILE_SIZE,
  PLAYER_MAX_HP,
  DIRECTION_ROTATION,
  DIRECTION_FACING_ANGLE,
  CORE_SIZE,
  TILE_UNITS,
} from './engine/types';
import type { Player } from './engine/types';
import {
  createInputState,
  attachInputListeners,
  resolveIntendedMove,
  clearFrameFlags,
  pollGamepad,
  type InputState,
} from './engine/input';
import { SPAWN_X, SPAWN_Y, ISLAND_MAP, sampleTerrainY, COAST_POINTS } from './engine/tilemap';
import { TerrainChunks } from './engine/scenery/TerrainChunks';
import { Flora } from './engine/scenery/Flora';
import { FallingLeaves } from './engine/scenery/FallingLeaves';
import { StaticBatch } from './engine/scenery/StaticBatch';
import { seedToKey, randomSeed } from './engine/sprites';
import { isInDeepWater } from './engine/physics';
import {
  createPlayer,
  createCombatState,
  executeMove,
  tickPlayer,
  getPlayerBody,
} from './engine/combat';
import { setPlayerBodyForDojo } from './worlds/dojo/dojoState';
import {
  updateParticles,
  updateFloatingTexts,
  updateForcePushes,
  updateScreenShake,
} from './engine/particles';
import { CameraRig, setCameraZoomIndex } from './engine/camera/CameraRig';
import { CameraTouchZone } from './engine/camera/CameraTouchZone';
import { SlomoPostFX } from './engine/SlomoPostFX';
import { setCombatRef, updateSlomo, updateFocusMeter } from './engine/timeControl';
import { applySlomoAudio } from './engine/audioFx';
import { useFocusTrigger } from './engine/useFocusTrigger';
import { registerDirTap } from './engine/dash';
import { createMovementBody } from './engine/movementBody';
import { MovementTuningPanel } from './engine/MovementTuningPanel';
import {
  createOceanDeathState,
  tickOceanDeath,
  getOceanOverlayAlpha,
  getGranMajaTextAlpha,
} from './engine/ocean';
import { getDayNightOverlay } from './engine/daynight';
import {
  createMultiplayerState,
  connectMultiplayer,
  setupMessageHandler,
  sendPlayerUpdate,
  sendAttack,
  sendHit,
  sendForcePush,
  tickRemotePlayers,
  disconnectMultiplayer,
} from './multiplayer/client';
import { seedToAsciiVoxels, CharacterGroup } from '@/components/AsciiNoun';
import type { AsciiVoxel } from '@/components/AsciiNoun';
import { Html } from '@react-three/drei';
// Spritesheet compositor available for future use
// import { composeSpritesheet, getFrame, extractFrameCanvas } from './engine/spritesheet';
import { type NPC } from './engine/npcs';
import {
  createArenaRun,
  startRun,
  endRun,
  tickArena,
  resolveNpcHits,
  type ArenaRun,
} from './engine/arena';
import { Character3D, type CharacterState } from './engine/Character3D';
import { TreasureChest3D, DroppedItem3D } from './engine/TreasureChest3D';
import { DepositModal } from './wager/DepositModal';
import { useClaimDrop } from './wager/treasureChest';
import { getActiveDrops, getNearbyDrop, markClaimed, type DroppedItem } from './engine/drops';
import { getAuctionState } from './engine/settlement';
import {
  playPunchSound,
  playKickSound,
  playHeadbuttSound,
  playGunshot,
  playShotgunSound,
  playDeathSound,
  playPickupSound,
  playComboSound,
  playJumpSound,
} from './engine/sounds';
import {
  createWeaponState,
  checkWeaponPickup,
  fireWeapon,
  tickReload,
  tickMuzzleFlash,
  spawnWeaponPickup,
  getActivePickups,
  clearPickups,
  switchWeapon,
  cycleWeapon,
  WEAPON_DEFS,
  type WeaponState,
  type WeaponPickup,
  type WeaponType,
} from './engine/weapons';
import { WeaponPickup3D } from './engine/WeaponPickup3D';
import { AnimatedOcean, Dolphins } from './engine/Atmosphere';
import {
  DystopianSky,
  SmogClouds,
  Vultures,
  RainParticles,
  NeonBillboards,
  DystopianFog,
} from './engine/DystopianAtmosphere';
import {
  createPaintState,
  spawnPaintCan,
  checkPaintPickup,
  getActivePaintCans,
  loadGraffitiTags,
  type PaintCanState,
  type PaintCan,
} from './engine/graffiti';
import { Paintable } from '@nouns/graffiti/r3f';
import { PaintHUD } from '@nouns/graffiti/ui';
import { handleIncoming, sendSnapshot, type WsLike } from '@nouns/graffiti';
import { Billboard, WinnieVan, MechanicSign } from './engine/WorldObjects';
import { MegaRamp3D, HoverboardPickup3D, MEGA_RAMP_BOUNDS } from './engine/MegaRamp3D';
import {
  NYCApartmentBlock,
  APARTMENT_GRAFFITI_WALL,
  BurjKhalifa,
} from './engine/NYCApartmentBlock';
import CaribbeanOffice, { OFFICE_WHITEBOARD_WALL } from './engine/CaribbeanOffice';
import CityBlock from './engine/CityBlock';
import { computeAim, createAimHudSlot } from './engine/aim';
import { Crosshair } from './engine/Crosshair';
import { TerraformsHorizon } from './engine/TerraformsHorizon';
import { preloadCatalog } from './engine/propCatalog';
import { BuildMode, BuildHud } from './engine/BuildMode';
import {
  createPlacedPropsStore,
  parseBuildMessage,
  type BuildPieceKind,
} from './engine/placedProps';

// Preload is now gated behind `current === 'fried'` via useEffect in the
// main component so the white-room default doesn't eagerly fetch props.
import MobileControls, { isTouchDevice } from './engine/MobileControls';
import {
  createSkatingState,
  mountBoard,
  dismountBoard,
  tickSkating,
  testRampCollision,
  ollie,
  airTrick,
  spin180,
  kickflip,
  boardGrab,
  type SkatingState,
} from './engine/skating';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import {
  createVoipState,
  initVoipListenOnly,
  initVoip,
  getVoipDebugInfo,
  checkVoiceActivity,
  updateCrowdSettle,
  toggleMute,
  callPeer,
  addTracksToExistingPeers,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  destroyVoip,
  updateListenerPosition,
  updateSpatialPosition,
  type VoipState,
  startSpeechToText,
  stopSpeechToText,
  getCurrentTranscript,
} from './engine/voip';
import { useNounSeed, type INounSeed } from '@/wrappers/nounToken';
import { useWorldStore } from './shared/useWorldStore';
import { GlitchEntry } from './shared/GlitchEntry';
import { TransitionOverlay } from './shared/TransitionOverlay';
import { WhiteRoom, monolithPositions, whiteRoomFloorTileIds } from './worlds/WhiteRoom';

// ── Constants ─────────────────────────────────────────────────────────

const WORLD_SCALE = 0.1; // Scale world coords to Three.js units
/** Legacy 64-tile core in Three.js units (102.4) — paint grid, old water plane. */
const CORE_WORLD_SIZE = CORE_SIZE * TILE_SIZE * WORLD_SCALE;
/** Fixed simulation step. The whole engine is authored in per-frame-at-60Hz
 * units, so we run it at exactly 60Hz regardless of display refresh and
 * interpolate the rendered positions between ticks. */
const SIM_STEP = 1 / 60;
const MAX_SIM_STEPS = 4;
const RAID_PREF_KEY = 'nouns-world-raids';

// ── Terrain height sampling ───────────────────────────────────────────

/** Get terrain height in Three.js Y at a given world X/Z position */
function getTerrainHeight(worldX: number, worldZ: number): number {
  // Check if on the mega ramp or its surrounding structures
  const rb = MEGA_RAMP_BOUNDS;
  const relX = worldX - rb.x;
  const relZ = worldZ - rb.z;
  // Wide bounds to catch ramp + side walls + stairs + top platform
  if (Math.abs(relX) < rb.width / 2 + 6 && relZ > -rb.length / 2 - 8 && relZ < rb.length / 2 + 12) {
    // Island-side stairs (right side, behind platform)
    if (relX > rb.width / 2 && relX < rb.width / 2 + 3 && relZ > rb.length / 2) {
      const stairProgress = Math.max(0, Math.min(1, (relZ - rb.length / 2) / (rb.height * 1.25)));
      return stairProgress * rb.height;
    }
    // Top platform (back of ramp, high end) — flat at RAMP_HEIGHT
    if (relZ > rb.length / 2 - 2 && relZ < rb.length / 2 + 6) {
      return rb.height;
    }
    // On the curved ramp surface itself (within ramp width)
    // Must match createMegaRampGeometry: curveT = 1 - pow(1-t, 1.8), y = H * sin(curveT * PI/2)
    if (Math.abs(relX) < rb.width / 2 + 0.5) {
      const t = Math.max(0, Math.min(1, (relZ + rb.length / 2) / rb.length));
      const curveT = 1 - Math.pow(1 - t, 1.8);
      const rampY = rb.height * Math.sin((curveT * Math.PI) / 2);
      return Math.max(rampY, 0.35);
    }
    // Side area (stairs, apartment building side) — ramp up linearly with Z
    const stairT = Math.max(0, Math.min(1, (relZ + rb.length / 2) / rb.length));
    const stairY = stairT * rb.height;
    return Math.max(stairY, 0.35);
  }

  // Continuous heightfield (bilinear over the tile grid, same field the
  // terrain chunks are built from) — no per-tile steps, no pops.
  return sampleTerrainY(worldX, worldZ);
}

// ── Paintable floor tiles ──────────────────────────────────────────────
//
// Overlays the Terrain mesh with a grid of Paintable tiles so every
// stroke on the ground persists via partykit (room: nouns-world).
// Each tile's surfaceId is stable + coordinate-keyed so reloads rehydrate
// from the snapshot/stroke log.
//
// We keep the existing terrain mesh underneath (for shadows, water, etc.)
// and stack tiles just above it — each tile sampled at the *max* terrain
// height of its 4 corners to avoid z-fighting / clipping into hills.

interface PaintableFloorProps {
  worldId: string;
  /** Number of tiles per axis. */
  tilesX: number;
  tilesZ: number;
  /** Size of each tile in world units. */
  tileSize: number;
  /** World-space origin (min corner) of the tiled area. */
  origin: [number, number, number];
  /** Optional: gate painting on or off globally (e.g. graffiti HUD open). */
  enabled?: boolean;
  /** Author id threaded into strokes. */
  authorId?: string;
  /** Fires once a stroke is committed so caller can broadcast a snapshot. */
  onStrokeEnd?: (surfaceId: string) => void;
  /** Texture pixels per tile side. */
  resolution?: number;
}

function PaintableFloor({
  worldId,
  tilesX,
  tilesZ,
  tileSize,
  origin,
  enabled = true,
  authorId,
  onStrokeEnd,
  resolution = 512,
  baseFill = '#5a8f3c',
}: PaintableFloorProps & { baseFill?: string }) {
  const tiles = useMemo(() => {
    const out: {
      key: string;
      ix: number;
      iz: number;
      x: number;
      y: number;
      z: number;
    }[] = [];
    for (let iz = 0; iz < tilesZ; iz++) {
      for (let ix = 0; ix < tilesX; ix++) {
        const cx = origin[0] + (ix + 0.5) * tileSize;
        const cz = origin[2] + (iz + 0.5) * tileSize;
        // Sample terrain at 4 tile corners + center, take max so tile
        // sits above the highest vertex of the underlying heightmap.
        const half = tileSize * 0.5;
        const h00 = getTerrainHeight(cx - half, cz - half);
        const h10 = getTerrainHeight(cx + half, cz - half);
        const h01 = getTerrainHeight(cx - half, cz + half);
        const h11 = getTerrainHeight(cx + half, cz + half);
        const hc = getTerrainHeight(cx, cz);
        const maxH = Math.max(h00, h10, h01, h11, hc);
        // Skip tiles sitting on deep/ocean water — painting below waterline
        // gets hidden by the animated ocean plane anyway.
        if (maxH < -0.1) continue;
        out.push({
          key: `floor-${worldId}-${ix}-${iz}`,
          ix,
          iz,
          x: cx,
          y: origin[1] + maxH + 0.015, // tiny offset to avoid z-fighting
          z: cz,
        });
      }
    }
    return out;
  }, [worldId, tilesX, tilesZ, tileSize, origin]);

  return (
    <group>
      {tiles.map(tile => (
        <Paintable
          key={tile.key}
          surfaceId={tile.key}
          width={tileSize}
          height={tileSize}
          position={[tile.x, tile.y, tile.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          resolutionWidth={resolution}
          resolutionHeight={resolution}
          baseFill={baseFill}
          enabled={enabled}
          authorId={authorId}
          onStrokeEnd={onStrokeEnd ? () => onStrokeEnd(tile.key) : undefined}
          frameColor={null}
          side={THREE.DoubleSide}
        />
      ))}
    </group>
  );
}

// ── Graffiti wall positions (3D world coords) ───────────────────────────

const GRAFFITI_WALLS = [
  {
    id: 'wall-north',
    worldX: 50 * WORLD_SCALE,
    worldZ: 30 * WORLD_SCALE,
    rotation: 0,
    label: 'YOUR TAG HERE',
  },
  {
    id: 'wall-east',
    worldX: 62 * WORLD_SCALE,
    worldZ: 48 * WORLD_SCALE,
    rotation: Math.PI / 2,
    label: 'SEND TO SEWERPIPE.ETH',
  },
  {
    id: 'wall-south',
    worldX: 46 * WORLD_SCALE,
    worldZ: 60 * WORLD_SCALE,
    rotation: Math.PI,
    label: 'YOUR TAG HERE',
  },
  {
    id: 'wall-west',
    worldX: 28 * WORLD_SCALE,
    worldZ: 44 * WORLD_SCALE,
    rotation: -Math.PI / 2,
    label: 'SEND TO SEWERPIPE.ETH',
  },
  {
    id: 'wall-northeast',
    worldX: 58 * WORLD_SCALE,
    worldZ: 34 * WORLD_SCALE,
    rotation: Math.PI / 4,
    label: 'YOUR TAG HERE',
  },
  {
    id: 'wall-southwest',
    worldX: 34 * WORLD_SCALE,
    worldZ: 56 * WORLD_SCALE,
    rotation: -Math.PI / 3,
    label: 'SEND TO SEWERPIPE.ETH',
  },
  {
    id: 'wall-arena-l',
    worldX: 42 * WORLD_SCALE,
    worldZ: 40 * WORLD_SCALE,
    rotation: 0.2,
    label: 'YOUR TAG HERE',
  },
  {
    id: 'wall-arena-r',
    worldX: 54 * WORLD_SCALE,
    worldZ: 52 * WORLD_SCALE,
    rotation: -0.4,
    label: 'SEND TO SEWERPIPE.ETH',
  },
  APARTMENT_GRAFFITI_WALL,
  // Walls near spawn — positioned to NOT block gravestones
  {
    id: 'wall-spawn-2',
    worldX: SPAWN_X * 0.1 + 6,
    worldZ: SPAWN_Y * 0.1 + 2,
    rotation: -0.3,
    label: 'TAG ME',
  },
  {
    id: 'wall-spawn-3',
    worldX: SPAWN_X * 0.1 - 5,
    worldZ: SPAWN_Y * 0.1 + 5,
    rotation: Math.PI / 2 + 0.1,
    label: 'WRITE SOMETHING',
  },
  {
    id: 'wall-spawn-4',
    worldX: SPAWN_X * 0.1 + 3,
    worldZ: SPAWN_Y * 0.1 - 6,
    rotation: -Math.PI / 4,
    label: 'NOUNS WUZ HERE',
  },
  // Office whiteboard
  OFFICE_WHITEBOARD_WALL,
  // Joystick billboard (near water, southeast)
  {
    id: 'wall-spawn-billboard',
    worldX: 25 * TILE_SIZE * WORLD_SCALE, // near southeast coast
    worldZ: 45 * TILE_SIZE * WORLD_SCALE,
    rotation: 0,
    label: '🕹️',
  },
] as const;

const WALL_NEAR_DISTANCE = 4;

// Imperative scene.background setter — bypasses R3F attach= race conditions
// when sibling <color attach="background"> components mount/unmount.
function SceneBackground({ color }: { color: string }) {
  const { scene } = useThree();
  const colorRef = useRef(new THREE.Color(color));
  useEffect(() => {
    colorRef.current.set(color);
    scene.background = colorRef.current;
    return () => {
      // Leave whatever the next SceneBackground sets; don't null it.
    };
  }, [color, scene]);
  return null;
}

function GraffitiWalls({
  activeWallId,
  authorId,
  onStrokeEnd,
}: {
  activeWallId: string | null;
  authorId: string;
  onStrokeEnd: (wallId: string) => void;
}) {
  return (
    <group>
      {GRAFFITI_WALLS.map(wall => {
        const y = getTerrainHeight(wall.worldX, wall.worldZ);
        const enabled = activeWallId === wall.id;
        return (
          <group
            key={wall.id}
            position={[wall.worldX, y + 1.8, wall.worldZ]}
            rotation={[0, wall.rotation, 0]}
          >
            <Paintable
              surfaceId={wall.id}
              width={3.5}
              height={3}
              authorId={authorId}
              enabled={enabled}
              frameColor="#9a9488"
              framePad={0.2}
              onStrokeEnd={() => onStrokeEnd(wall.id)}
            />
            <Html position={[0, 2, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: '#ff4444',
                  textShadow: '0 0 6px rgba(255,68,68,0.6)',
                  whiteSpace: 'nowrap',
                  letterSpacing: '2px',
                  textAlign: 'center',
                  userSelect: 'none',
                }}
              >
                {wall.label}
              </div>
            </Html>
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
                    fontSize: '11px',
                    color: '#aaa',
                    textShadow: '0 0 4px rgba(0,0,0,0.8)',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    opacity: 0.7,
                  }}
                >
                  [G] SPRAY PAINT
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ── Paint can pickup spawn positions ────────────────────────────────────

const PAINT_CAN_SPAWNS: [number, number][] = [
  // Close to spawn — reachable from white-room construct.
  [SPAWN_X + 8, SPAWN_Y + 8],
  [SPAWN_X - 8, SPAWN_Y + 8],
  [SPAWN_X + 14, SPAWN_Y - 6],
  // Out in fried world.
  [SPAWN_X + 60, SPAWN_Y - 40],
  [SPAWN_X - 70, SPAWN_Y + 30],
  [SPAWN_X + 30, SPAWN_Y + 70],
  [SPAWN_X - 50, SPAWN_Y - 50],
  [SPAWN_X + 90, SPAWN_Y + 10],
  [SPAWN_X - 20, SPAWN_Y - 80],
  [SPAWN_X + 10, SPAWN_Y + 100],
  [SPAWN_X - 90, SPAWN_Y + 60],
  [SPAWN_X + 70, SPAWN_Y - 70],
  [SPAWN_X - 40, SPAWN_Y + 90],
];

function PaintCanPickup3D({
  position,
  color,
}: {
  position: [number, number, number];
  color: string;
}) {
  const ref = useRef<THREE.Group>(null);
  // Derive a darker shade for the nozzle cap
  const darkerColor = useMemo(() => {
    const c = new THREE.Color(color);
    c.multiplyScalar(0.55);
    return '#' + c.getHexString();
  }, [color]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 2.5;
    ref.current.position.y = position[1] + Math.sin(clock.elapsedTime * 3) * 0.1;
  });

  return (
    <group ref={ref} position={position}>
      {/* Can body — cylinder */}
      <mesh>
        <cylinderGeometry args={[0.08, 0.08, 0.3, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      {/* Nozzle cap — smaller cylinder on top */}
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.06, 10]} />
        <meshStandardMaterial color={darkerColor} emissive={darkerColor} emissiveIntensity={0.15} />
      </mesh>
      {/* Spray tip — tiny white sphere on very top */}
      <mesh position={[0, 0.23, 0]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.4} />
      </mesh>
      {/* Emissive glow light */}
      <pointLight color={color} intensity={0.6} distance={1.5} position={[0, 0, 0]} />
    </group>
  );
}

// ── Crystal Ball Mountain ─────────────────────────────────────────────
// A rocky peak in the deep ocean with a giant glass sphere containing
// a slowly rotating voxel Noun.

const CRYSTAL_BALL_X = 2 * TILE_SIZE * WORLD_SCALE; // far northwest in ocean
const CRYSTAL_BALL_Z = 2 * TILE_SIZE * WORLD_SCALE;
const MOUNTAIN_HEIGHT = 6;
const BALL_RADIUS = 1.5;

function SmokeParticles({
  count,
  radius,
  height,
  baseY,
}: {
  count: number;
  radius: number;
  height: number;
  baseY: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      angle: (i / count) * Math.PI * 2 + Math.random() * 0.5,
      speed: 0.2 + Math.random() * 0.3,
      radiusOffset: (Math.random() - 0.5) * 0.8,
      yOffset: Math.random() * height,
      size: 0.08 + Math.random() * 0.12,
      spiralSpeed: 0.3 + Math.random() * 0.4,
    }));
  }, [count, height]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    particles.forEach((p, i) => {
      const y = (p.yOffset + t * p.speed) % height;
      const r = radius + p.radiusOffset + y * 0.15; // widens as it rises
      const angle = p.angle + t * p.spiralSpeed;
      dummy.position.set(Math.cos(angle) * r, baseY + y, Math.sin(angle) * r);
      const fade = 1 - y / height;
      const s = p.size * (0.5 + fade * 0.5);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial color="#666" transparent opacity={0.35} depthWrite={false} />
    </instancedMesh>
  );
}

function LavaCracks({
  baseRadius,
  height,
  segments,
}: {
  baseRadius: number;
  height: number;
  segments: number;
}) {
  const lineObjects = useMemo(() => {
    const objs: THREE.Line[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const pts: THREE.Vector3[] = [];
      const steps = 4 + Math.floor(Math.random() * 4);
      for (let j = 0; j < steps; j++) {
        const t = j / (steps - 1);
        const y = t * height * 0.85;
        const r = baseRadius * (1 - t * 0.7) + (Math.random() - 0.5) * 0.2;
        const a = angle + (Math.random() - 0.5) * 0.4;
        pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: '#ff4400' });
      objs.push(new THREE.Line(geo, mat));
    }
    return objs;
  }, [baseRadius, height, segments]);

  return (
    <group>
      {lineObjects.map((obj, i) => (
        <primitive key={i} object={obj} />
      ))}
    </group>
  );
}

function CrystalBallMountain({ nounSeed }: { nounSeed: INounSeed }) {
  const asciiGroupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.PointLight>(null);

  // Build the ASCII voxels from the noun seed
  const asciiVoxels = useMemo(() => {
    try {
      return seedToAsciiVoxels(nounSeed);
    } catch {
      return [] as AsciiVoxel[];
    }
  }, [nounSeed]);

  // Group voxels by character type for CharacterGroup rendering
  const charGroups = useMemo(() => {
    const groups = new Map<number, AsciiVoxel[]>();
    for (const v of asciiVoxels) {
      if (!groups.has(v.charIndex)) groups.set(v.charIndex, []);
      groups.get(v.charIndex)!.push(v);
    }
    return Array.from(groups.entries());
  }, [asciiVoxels]);

  const eyeY = MOUNTAIN_HEIGHT + BALL_RADIUS + 0.5;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (asciiGroupRef.current) {
      asciiGroupRef.current.rotation.y = t * 0.4;
      asciiGroupRef.current.position.y = eyeY + 15 + Math.sin(t * 0.8) * 0.3;
    }
    if (ringRef.current) {
      ringRef.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.6) * 0.05;
      ringRef.current.rotation.z = t * 0.2;
    }
    if (pulseRef.current) {
      pulseRef.current.intensity = 3 + Math.sin(t * 2) * 1.5 + Math.sin(t * 3.7) * 0.5;
    }
  });

  return (
    <group position={[CRYSTAL_BALL_X, 0, CRYSTAL_BALL_Z]}>
      {/* Dark volcanic base — wide foundation */}
      <mesh position={[0, 0, 0]}>
        <coneGeometry args={[4, MOUNTAIN_HEIGHT * 0.5, 10]} />
        <meshStandardMaterial color="#222" roughness={1} />
      </mesh>
      {/* Mid volcano */}
      <mesh position={[0, MOUNTAIN_HEIGHT * 0.25, 0]}>
        <coneGeometry args={[2.8, MOUNTAIN_HEIGHT * 0.5, 9]} />
        <meshStandardMaterial color="#333" roughness={0.95} />
      </mesh>
      {/* Upper peak — jagged */}
      <mesh position={[0, MOUNTAIN_HEIGHT * 0.5, 0]}>
        <coneGeometry args={[1.8, MOUNTAIN_HEIGHT * 0.45, 7]} />
        <meshStandardMaterial color="#444" roughness={0.9} />
      </mesh>
      {/* Narrow spire */}
      <mesh position={[0, MOUNTAIN_HEIGHT * 0.72, 0]}>
        <coneGeometry args={[0.9, MOUNTAIN_HEIGHT * 0.35, 6]} />
        <meshStandardMaterial color="#333" roughness={0.85} />
      </mesh>
      {/* Twin prongs flanking the eye */}
      <mesh position={[-0.6, MOUNTAIN_HEIGHT * 0.9, 0]} rotation={[0, 0, 0.15]}>
        <coneGeometry args={[0.3, MOUNTAIN_HEIGHT * 0.25, 5]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.9} />
      </mesh>
      <mesh position={[0.6, MOUNTAIN_HEIGHT * 0.9, 0]} rotation={[0, 0, -0.15]}>
        <coneGeometry args={[0.3, MOUNTAIN_HEIGHT * 0.25, 5]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.9} />
      </mesh>

      {/* Lava cracks running up the mountain */}
      <LavaCracks baseRadius={2.5} height={MOUNTAIN_HEIGHT * 0.8} segments={12} />

      {/* Lava glow from the base */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 4, 16]} />
        <meshBasicMaterial color="#ff3300" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>

      {/* The Eye — fiery ring (torus) */}
      <mesh ref={ringRef} position={[0, eyeY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[BALL_RADIUS, 0.2, 16, 48]} />
        <meshStandardMaterial
          color="#ff4400"
          emissive="#ff2200"
          emissiveIntensity={2.5}
          roughness={0.3}
          metalness={0.6}
          toneMapped={false}
        />
      </mesh>
      {/* Inner fire ring — slightly smaller, brighter */}
      <mesh position={[0, eyeY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[BALL_RADIUS * 0.75, 0.1, 12, 36]} />
        <meshStandardMaterial
          color="#ff6600"
          emissive="#ff4400"
          emissiveIntensity={3}
          roughness={0.2}
          metalness={0.4}
          toneMapped={false}
        />
      </mesh>
      {/* Outer halo — faint wide ring */}
      <mesh position={[0, eyeY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[BALL_RADIUS * 1.3, 0.05, 8, 48]} />
        <meshBasicMaterial color="#ff6600" transparent opacity={0.3} toneMapped={false} />
      </mesh>

      {/* Pulsing ominous light */}
      <pointLight
        ref={pulseRef}
        position={[0, eyeY, 0]}
        color="#ff3300"
        intensity={3}
        distance={15}
      />
      {/* Secondary ambient glow — red/orange uplighting */}
      <pointLight
        position={[0, MOUNTAIN_HEIGHT * 0.3, 0]}
        color="#ff2200"
        intensity={1.5}
        distance={8}
      />

      {/* Swirling smoke particles */}
      <SmokeParticles
        count={60}
        radius={1.8}
        height={MOUNTAIN_HEIGHT * 1.2}
        baseY={MOUNTAIN_HEIGHT * 0.3}
      />

      {/* Floating ASCII Noun — MASSIVE in the sky above the Eye */}
      <group ref={asciiGroupRef} position={[0, eyeY + 15, 0]} scale={[3, 3, 3]}>
        {charGroups.map(([charIndex, group]) => (
          <CharacterGroup key={charIndex} charIndex={charIndex} voxels={group} splitAmount={0} />
        ))}
      </group>
    </group>
  );
}

// ── Venetian Boats — old weathered boats bobbing at the shoreline ─────

// Boats moored just off the real coastline (x, z, bob-phase, rotation).
const BOAT_POSITIONS: [number, number, number, number][] = [0.3, 1.5, 2.6, 3.9, 5.1].map(
  (bearing, i) => {
    const n = COAST_POINTS.length;
    const cp = n ? COAST_POINTS[Math.floor((bearing / (Math.PI * 2)) * n) % n] : null;
    const out = 7 * TILE_UNITS;
    const x = cp ? (cp.tx + 0.5) * TILE_UNITS + Math.cos(cp.angle) * out : SPAWN_X * WORLD_SCALE;
    const z = cp ? (cp.ty + 0.5) * TILE_UNITS + Math.sin(cp.angle) * out : SPAWN_Y * WORLD_SCALE;
    return [x, z, [0.3, -0.8, 2.1, 1.4, -1.5][i], i * 1.25] as [number, number, number, number];
  },
);

function VenetianBoat({
  position,
  rotationY = 0,
  phase = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
  phase?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime + phase;
    groupRef.current.position.y = position[1] + Math.sin(t * 0.7) * 0.06;
    groupRef.current.rotation.z = Math.sin(t * 0.5) * 0.04;
    groupRef.current.rotation.x = Math.sin(t * 0.3 + 1) * 0.02;
  });

  return (
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.3, 0.15, 1.2]} />
        <meshStandardMaterial color="#6b3a1f" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.02, 0.55]} scale={[0.6, 0.8, 0.4]}>
        <boxGeometry args={[0.3, 0.12, 0.4]} />
        <meshStandardMaterial color="#5a3018" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.02, -0.55]} scale={[0.7, 0.8, 0.3]}>
        <boxGeometry args={[0.3, 0.12, 0.4]} />
        <meshStandardMaterial color="#5a3018" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[0.32, 0.02, 1.1]} />
        <meshStandardMaterial color="#4a2a12" roughness={1} />
      </mesh>
      <mesh position={[0, 0.55, 0.1]}>
        <cylinderGeometry args={[0.015, 0.02, 1.0, 6]} />
        <meshStandardMaterial color="#4a2a12" roughness={0.9} />
      </mesh>
      <mesh position={[0.05, 0.6, 0.1]} rotation={[0, 0.15, 0.08]}>
        <planeGeometry args={[0.35, 0.55]} />
        <meshStandardMaterial
          color="#e8dcc8"
          roughness={0.85}
          side={THREE.DoubleSide}
          transparent
          opacity={0.85}
        />
      </mesh>
      <mesh position={[-0.02, 0.38, 0.1]} rotation={[0, -0.1, -0.05]}>
        <planeGeometry args={[0.2, 0.25]} />
        <meshStandardMaterial
          color="#d4c9b0"
          roughness={0.9}
          side={THREE.DoubleSide}
          transparent
          opacity={0.7}
        />
      </mesh>
    </group>
  );
}

// ── Gravestones near spawn ───────────────────────────────────────────

const GRAVESTONES = [
  {
    x: SPAWN_X * 0.1 - 2.5,
    z: SPAWN_Y * 0.1 - 3.5,
    rot: 0.08,
    name: 'playnouns.wtf',
    years: '2024 - ?',
  },
  {
    x: SPAWN_X * 0.1 - 1.2,
    z: SPAWN_Y * 0.1 - 3.8,
    rot: -0.12,
    name: 'Nounish Punk',
    years: '2023 - ?',
  },
  { x: SPAWN_X * 0.1 + 0.2, z: SPAWN_Y * 0.1 - 3.3, rot: 0.05, name: 'Pipe', years: '1992 - ?' },
] as const;

function Gravestone({
  x,
  z,
  rot,
  name,
  years,
}: {
  x: number;
  z: number;
  rot: number;
  name: string;
  years: string;
}) {
  return (
    <group position={[x, 0.35, z]} rotation={[0, rot, 0]}>
      {/* Headstone — curved top */}
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.55, 0.7, 0.08]} />
        <meshStandardMaterial color="#8a8a8a" roughness={0.95} />
      </mesh>
      {/* Curved top arch */}
      <mesh position={[0, 0.72, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.275, 0.275, 0.08, 16, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#8a8a8a" roughness={0.95} />
      </mesh>
      {/* Slight bevel/edge on headstone */}
      <mesh position={[0, 0.35, 0.005]}>
        <boxGeometry args={[0.5, 0.64, 0.005]} />
        <meshStandardMaterial color="#7a7a7a" roughness={0.9} />
      </mesh>
      {/* Base plinth */}
      <mesh position={[0, -0.03, 0]}>
        <boxGeometry args={[0.7, 0.08, 0.18]} />
        <meshStandardMaterial color="#6a6a6a" roughness={0.9} />
      </mesh>
      {/* Dirt mound */}
      <mesh position={[0, -0.05, 0.3]} rotation={[-0.25, 0, 0]} scale={[1, 0.3, 1]}>
        <sphereGeometry args={[0.3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#5a4a3a" />
      </mesh>
      {/* Carved text — large, indented look */}
      <Html position={[0, 0.48, 0.05]} center>
        <div
          style={{
            fontFamily: "'Times New Roman', Georgia, serif",
            textAlign: 'center',
            lineHeight: 1.4,
            userSelect: 'none',
            pointerEvents: 'none',
            color: '#4a4a4a',
            textShadow: '1px 1px 0 rgba(255,255,255,0.15), -1px -1px 0 rgba(0,0,0,0.3)',
          }}
        >
          <div
            style={{
              fontSize: '14px',
              fontWeight: 'bold',
              letterSpacing: 3,
              fontVariant: 'small-caps',
            }}
          >
            RIP
          </div>
          <div
            style={{
              fontSize: '11px',
              marginTop: 4,
              fontStyle: 'italic',
              maxWidth: 80,
              wordWrap: 'break-word',
            }}
          >
            {name}
          </div>
          <div style={{ fontSize: '9px', color: '#666', marginTop: 3 }}>{years}</div>
        </div>
      </Html>
    </group>
  );
}

function Gravestones() {
  return (
    <>
      {GRAVESTONES.map((g, i) => (
        <Gravestone key={i} {...g} />
      ))}
    </>
  );
}

function VenetianBoats() {
  return (
    <group>
      {BOAT_POSITIONS.map(([x, z, rot, phase], i) => (
        <VenetianBoat key={i} position={[x, -0.05, z]} rotationY={rot} phase={phase} />
      ))}
    </group>
  );
}

// ── Gas Station — run-down abandoned structure ───────────────────────

function GasStation({
  position,
  rotationY = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[1.0, 0.6, 0.8]} />
        <meshStandardMaterial color="#b8b0a0" roughness={0.95} />
      </mesh>
      <mesh position={[0.25, 0.35, 0.401]}>
        <boxGeometry args={[0.3, 0.2, 0.01]} />
        <meshStandardMaterial color="#7a4422" roughness={1} />
      </mesh>
      <mesh position={[-0.2, 0.2, 0.401]}>
        <boxGeometry args={[0.2, 0.15, 0.01]} />
        <meshStandardMaterial color="#6b3a1a" roughness={1} />
      </mesh>
      <mesh position={[0.1, 0.45, -0.401]}>
        <boxGeometry args={[0.35, 0.1, 0.01]} />
        <meshStandardMaterial color="#7a4422" roughness={1} />
      </mesh>
      <mesh position={[0, 0.72, 0.7]} rotation={[0.03, 0, -0.04]}>
        <boxGeometry args={[1.4, 0.04, 1.0]} />
        <meshStandardMaterial color="#8a8278" roughness={0.9} />
      </mesh>
      <mesh position={[-0.55, 0.4, 1.0]} rotation={[0, 0, 0.06]}>
        <cylinderGeometry args={[0.025, 0.03, 0.7, 6]} />
        <meshStandardMaterial color="#777" roughness={0.9} />
      </mesh>
      <mesh position={[0.55, 0.38, 1.0]}>
        <cylinderGeometry args={[0.025, 0.03, 0.7, 6]} />
        <meshStandardMaterial color="#777" roughness={0.9} />
      </mesh>
      <group position={[-0.2, 0, 0.9]}>
        <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[0.12, 0.35, 0.1]} />
          <meshStandardMaterial color="#cc3333" roughness={0.8} />
        </mesh>
        <mesh position={[0.08, 0.35, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.15, 4]} />
          <meshStandardMaterial color="#222" roughness={0.7} />
        </mesh>
      </group>
      <group position={[0.2, 0, 0.9]}>
        <mesh position={[0, 0.18, 0]}>
          <boxGeometry args={[0.12, 0.32, 0.1]} />
          <meshStandardMaterial color="#bb4444" roughness={0.85} />
        </mesh>
        <mesh position={[-0.07, 0.32, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.12, 4]} />
          <meshStandardMaterial color="#222" roughness={0.7} />
        </mesh>
      </group>
      <group position={[0, 0.95, 0.7]} rotation={[0, 0, 0.12]}>
        <mesh>
          <boxGeometry args={[0.5, 0.18, 0.02]} />
          <meshStandardMaterial color="#d4c455" roughness={0.85} />
        </mesh>
        <Html position={[0, 0, 0.015]} transform occlude style={{ pointerEvents: 'none' }}>
          <div
            style={{
              fontFamily: '"Courier New", monospace',
              fontSize: '14px',
              fontWeight: 900,
              color: '#2a2a2a',
              letterSpacing: '0.15em',
              textShadow: '1px 1px 0 rgba(0,0,0,0.2)',
              userSelect: 'none',
            }}
          >
            GAS
          </div>
        </Html>
      </group>
      <mesh position={[0, 0.6, 0.7]}>
        <cylinderGeometry args={[0.015, 0.02, 0.6, 5]} />
        <meshStandardMaterial color="#666" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ── Water plane (animated) ────────────────────────────────────────────

// @ts-ignore
export function _Water() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      (meshRef.current.material as THREE.MeshStandardMaterial).opacity =
        0.75 + Math.sin(clock.elapsedTime * 0.5) * 0.05;
    }
  });

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[CORE_WORLD_SIZE / 2, -0.15, CORE_WORLD_SIZE / 2]}
    >
      <planeGeometry args={[CORE_WORLD_SIZE * 1.5, CORE_WORLD_SIZE * 1.5]} />
      <meshStandardMaterial color="#3377cc" transparent opacity={0.8} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Day/Night Lighting ────────────────────────────────────────────────

function Lighting() {
  const dirLightRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);

  useFrame(() => {
    const dn = getDayNightOverlay();
    if (ambientRef.current) {
      ambientRef.current.intensity = Math.max(0.3, 1 - dn.alpha * 2);
    }
    if (dirLightRef.current) {
      dirLightRef.current.intensity = Math.max(0.2, 1 - dn.alpha * 1.5);
    }
  });

  return (
    <>
      {/* Twilight ambient — warm pink haze, brighter than dystopian-dark */}
      <ambientLight ref={ambientRef} intensity={0.55} color="#e8a8c5" />
      {/* Low-angle warm sun, 45min-past-sunset feel */}
      <directionalLight
        ref={dirLightRef}
        position={[-14, 10, -18]}
        intensity={1.05}
        color="#ffb585"
      />
      {/* Twilight hemisphere: peach sky / cool violet ground */}
      <hemisphereLight args={['#f5a67a', '#3a2f5a', 0.55]} />
    </>
  );
}

// ── HUD Overlay (HTML on top of canvas) ───────────────────────────────

// HUDLive — reads from ref, updates itself independently, never causes parent re-render
function HUDLive({ hudRef }: { hudRef: React.RefObject<any> }) {
  const [s, setS] = useState(() => ({ ...hudRef.current }));
  useEffect(() => {
    const id = setInterval(() => setS({ ...hudRef.current }), 250);
    return () => clearInterval(id);
  }, [hudRef]);
  return <GameHUD {...s} />;
}

// Old HUD replaced by GameHUD — keeping for reference
// @ts-ignore
export function _HUD_OLD({
  hp,
  maxHp,
  playerCount,
  comboHits,
  controlsVisible: _controlsVisible, // eslint-disable-line @typescript-eslint/no-unused-vars
  oceanPhase: _oceanPhase, // eslint-disable-line @typescript-eslint/no-unused-vars
  oceanAlpha,
  majaAlpha,
  respawnTimer,
  isDead,
  micEnabled = false,
  isMuted = false,
  isSpeaking = false,
  activeSpeakers = 0,
  crowdMeter = 0,
  settlementWindow = false,
  settleTriggered = false,
  transcript = '',
  weaponEquipped = null,
  weaponAmmo = 0,
}: {
  hp: number;
  maxHp: number;
  playerCount: number;
  comboHits: number;
  controlsVisible: boolean;
  oceanPhase: string;
  oceanAlpha: number;
  majaAlpha: number;
  respawnTimer: number;
  isDead: boolean;
  micEnabled?: boolean;
  isMuted?: boolean;
  isSpeaking?: boolean;
  activeSpeakers?: number;
  crowdMeter?: number;
  settlementWindow?: boolean;
  settleTriggered?: boolean;
  transcript?: string;
  weaponEquipped?: string | null;
  weaponAmmo?: number;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      {/* HP bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 30,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 200,
          height: 14,
          background: 'rgba(0,0,0,0.5)',
          borderRadius: 4,
        }}
      >
        <div
          style={{
            width: `${(hp / maxHp) * 100}%`,
            height: '100%',
            borderRadius: 4,
            background: hp / maxHp > 0.5 ? '#4a4' : hp / maxHp > 0.25 ? '#ca4' : '#c44',
            transition: 'width 0.1s',
          }}
        />
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 10,
            fontFamily: 'monospace',
          }}
        >
          {hp} / {maxHp}
        </span>
      </div>

      {/* Fries logo + f·r·i·e·d */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'none',
          zIndex: 20,
        }}
      >
        <img
          src="/sprites/accessory/accessory-fries.png"
          alt=""
          style={{ width: 28, height: 28, imageRendering: 'pixelated' }}
        />
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 'bold',
            color: '#fff',
            letterSpacing: 4,
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}
        >
          f · r · i · e · d
        </span>
      </div>

      {/* Player count + mic — under the minimap on the right */}
      <div
        style={{
          position: 'absolute',
          top: 200,
          right: 16,
          color: '#aaa',
          fontFamily: 'monospace',
          fontSize: 10,
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          textAlign: 'right',
          lineHeight: 1.6,
        }}
      >
        <div>● {playerCount} ONLINE</div>
        <div>● M MIC</div>
      </div>

      {/* Combo */}
      {comboHits >= 2 && (
        <div
          style={{
            position: 'absolute',
            right: 20,
            top: '40%',
            color: '#ffdd00',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            textAlign: 'right',
            fontSize: 20 + Math.min(comboHits, 10) * 3,
            textShadow: '0 2px 6px rgba(0,0,0,0.8)',
          }}
        >
          {comboHits}x<br />
          <span style={{ fontSize: 14, color: '#ffaa00' }}>COMBO</span>
        </div>
      )}

      {/* Controls — always visible */}
      <div
        style={{
          position: 'absolute',
          bottom: 55,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 4,
          fontFamily: 'monospace',
          fontSize: 10,
          flexWrap: 'wrap',
          justifyContent: 'center',
          maxWidth: 600,
        }}
      >
        {[
          { key: 'J', label: 'Punch', color: '#ff8844' },
          { key: 'K', label: 'Kick', color: '#ff4444' },
          { key: 'H', label: 'Headbutt', color: '#ff2222' },
          { key: 'U', label: 'Uppercut', color: '#ffaa00' },
          { key: 'Q', label: 'Force', color: '#4488ff' },
          { key: 'R', label: 'Spin', color: '#44ddff' },
          { key: 'Space', label: 'Backflip', color: '#44ff88' },
          { key: 'Spc+Dir', label: 'Dash', color: '#88ff44' },
          { key: 'Shift', label: 'Block', color: '#8888ff' },
        ].map(({ key, label, color }) => (
          <div
            key={key}
            style={{
              background: 'rgba(0,0,0,0.6)',
              borderRadius: 4,
              padding: '2px 5px',
              border: `1px solid ${color}40`,
              textAlign: 'center',
              minWidth: 44,
            }}
          >
            <div style={{ color, fontWeight: 'bold', fontSize: 11 }}>{key}</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 8 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Movement hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          color: 'rgba(255,255,255,0.4)',
          fontFamily: 'monospace',
          fontSize: 10,
          textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          textAlign: 'center',
        }}
      >
        WASD move &middot; F fire &middot; E interact &middot; M mic &middot; ESC exit
      </div>

      {/* Ocean death overlay */}
      {oceanAlpha > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `rgba(0,0,0,${oceanAlpha})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
          }}
        >
          {majaAlpha > 0 && (
            <>
              <div
                style={{
                  color: '#fff',
                  fontSize: 64,
                  fontFamily: 'serif',
                  fontWeight: 'bold',
                  opacity: majaAlpha,
                }}
              >
                Gran Maja
              </div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 24,
                  fontFamily: 'serif',
                  opacity: majaAlpha,
                  marginTop: 8,
                }}
              >
                swallowed you whole
              </div>
            </>
          )}
        </div>
      )}

      {/* Respawn */}
      {isDead && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              color: '#fff',
              fontSize: 48,
              fontFamily: 'monospace',
              fontWeight: 'bold',
              textShadow: '0 2px 8px rgba(0,0,0,0.8)',
            }}
          >
            {Math.ceil(respawnTimer / 60)}
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.7)',
              fontSize: 18,
              fontFamily: 'monospace',
            }}
          >
            RESPAWNING
          </div>
        </div>
      )}

      {/* Weapon ammo (bottom right) */}
      {(weaponEquipped as any) && (
        <div
          style={{
            position: 'absolute',
            bottom: 35,
            right: 16,
            background: 'rgba(0,0,0,0.6)',
            borderRadius: 8,
            padding: '6px 12px',
            fontFamily: 'monospace',
            color: '#fff',
            fontSize: 13,
            border: '1px solid rgba(255,255,255,0.2)',
          }}
        >
          <span style={{ color: '#ff8844', fontWeight: 'bold' }}>
            {String(weaponEquipped).toUpperCase()}
          </span>
          <span style={{ color: '#888', margin: '0 6px' }}>|</span>
          <span style={{ color: (weaponAmmo as number) > 0 ? '#4ecdc4' : '#ff4444' }}>
            {weaponAmmo} ammo
          </span>
          <span style={{ color: '#666', fontSize: 10, marginLeft: 8 }}>F shoot</span>
        </div>
      )}

      {/* Speech bubble above player */}
      {transcript && (
        <div
          style={{
            position: 'absolute',
            top: '25%',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.9)',
            color: '#111',
            borderRadius: 12,
            padding: '6px 14px',
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 'bold',
            maxWidth: 280,
            textAlign: 'center',
            wordBreak: 'break-word',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          {transcript}
          {/* Speech bubble tail */}
          <div
            style={{
              position: 'absolute',
              bottom: -8,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: '8px solid rgba(255,255,255,0.9)',
            }}
          />
        </div>
      )}

      {/* ── VOIP UI ─────────────────────────────────────────── */}

      {/* Mic indicator (top left) */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: !micEnabled
              ? 'rgba(100,100,100,0.5)'
              : isMuted
                ? 'rgba(255,50,50,0.6)'
                : isSpeaking
                  ? 'rgba(50,255,50,0.7)'
                  : 'rgba(50,150,50,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            border: '2px solid rgba(255,255,255,0.3)',
            transition: 'background 0.2s',
          }}
        >
          {!micEnabled ? '🔇' : isMuted ? '🔴' : '🎤'}
        </div>
        <span
          style={{
            color: 'rgba(255,255,255,0.6)',
            fontFamily: 'monospace',
            fontSize: 10,
          }}
        >
          {!micEnabled ? 'M to enable mic' : isMuted ? 'MUTED' : isSpeaking ? 'SPEAKING' : 'MIC ON'}
        </span>
      </div>

      {/* Settlement window banner */}
      {settlementWindow && (
        <div
          style={{
            position: 'absolute',
            top: 50,
            left: '50%',
            transform: 'translateX(-50%)',
            background: settleTriggered ? 'rgba(50,255,50,0.3)' : 'rgba(255,50,50,0.3)',
            border: `2px solid ${settleTriggered ? '#4f4' : '#f44'}`,
            borderRadius: 8,
            padding: '8px 24px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            fontSize: 14,
            color: '#fff',
            textAlign: 'center',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}
        >
          {settleTriggered
            ? '⌐◧-◧ SETTLED! DROP PARTY!'
            : '⌐◧-◧ SETTLEMENT WINDOW — SHOUT TO SETTLE!'}
        </div>
      )}

      {/* Crowd settle meter */}
      {settlementWindow && micEnabled && !settleTriggered && (
        <div
          style={{
            position: 'absolute',
            top: 90,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 200,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              height: 8,
              background: 'rgba(0,0,0,0.5)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${crowdMeter * 100}%`,
                height: '100%',
                background: `linear-gradient(90deg, #ff4444, #ffaa00, #44ff44)`,
                transition: 'width 0.1s',
                borderRadius: 4,
              }}
            />
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.6)',
              fontFamily: 'monospace',
              fontSize: 10,
              marginTop: 4,
            }}
          >
            {activeSpeakers} / 3 speakers
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hoverboard Constants ─────────────────────────────────────────────

const PIPE_ADDRESS = '0xae4705dC0816ee6d8a13F1C72780Ec5021915Fed' as const; // sewerpipe.eth
const HOVERBOARD_PRICE_ETH = '0.01';

// ── Billboard Ad System ──────────────────────────────────────────────

interface BillboardAd {
  imageUrl: string;
  expiresAt: number; // Unix timestamp in ms
  tier: string;
  paidBy: string;
}

const BILLBOARD_AD_TIERS = [
  { label: '1 HOUR', price: '0.01', durationMs: 60 * 60 * 1000 },
  { label: '1 DAY', price: '0.05', durationMs: 24 * 60 * 60 * 1000 },
  { label: '1 WEEK', price: '0.1', durationMs: 7 * 24 * 60 * 60 * 1000 },
] as const;

// Billboard positions that can display ads (matches the Billboard components in the scene)
const AD_BILLBOARDS = [
  { id: 'ad-board-1', worldX: 45, worldZ: 38, rotation: 0 },
  { id: 'ad-board-2', worldX: 55, worldZ: 42, rotation: 0.5 },
  { id: 'ad-board-3', worldX: 35, worldZ: 55, rotation: -0.3 },
] as const;

const AD_BOARD_NEAR_DISTANCE = 4;
const BILLBOARD_AD_STORAGE_KEY = 'nouns-world-billboard-ads';

function loadBillboardAds(): Record<string, BillboardAd> {
  try {
    const raw = localStorage.getItem(BILLBOARD_AD_STORAGE_KEY);
    if (!raw) return {};
    const ads = JSON.parse(raw) as Record<string, BillboardAd>;
    const now = Date.now();
    const active: Record<string, BillboardAd> = {};
    for (const [id, ad] of Object.entries(ads)) {
      if (ad.expiresAt > now) active[id] = ad;
    }
    return active;
  } catch {
    return {};
  }
}

function saveBillboardAd(boardId: string, ad: BillboardAd) {
  const ads = loadBillboardAds();
  ads[boardId] = ad;
  localStorage.setItem(BILLBOARD_AD_STORAGE_KEY, JSON.stringify(ads));
}

// Hoverboard pickup position — right next to spawn so you see it immediately
const HOVERBOARD_PICKUP_X = SPAWN_X * 0.1 + 2; // 2 units right of spawn
const HOVERBOARD_PICKUP_Z = SPAWN_Y * 0.1 + 1; // 1 unit south of spawn

// ── Hoverboard Purchase Modal ───────────────────────────────────────

function HoverboardPurchaseModal({
  open,
  onClose,
  onPurchased,
  isFree,
}: {
  open: boolean;
  onClose: () => void;
  onPurchased: () => void;
  isFree: boolean;
}) {
  const { sendTransaction, data: txHash, isPending } = useSendTransaction();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (txConfirmed) {
      onPurchased();
    }
  }, [txConfirmed, onPurchased]);

  useEffect(() => {
    if (isFree && open) {
      // Auto-grant for connected wallet owner
      onPurchased();
    }
  }, [isFree, open, onPurchased]);

  if (!open) return null;

  const handleBuy = () => {
    sendTransaction({
      to: PIPE_ADDRESS,
      value: parseEther(HOVERBOARD_PRICE_ETH),
    });
  };

  const modalStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.75)',
    pointerEvents: 'auto',
  };

  const boxStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, #0a1628 0%, #1a2a4a 100%)',
    borderRadius: 16,
    padding: 32,
    width: 400,
    maxWidth: '90vw',
    color: '#fff',
    fontFamily: 'monospace',
    border: '1px solid rgba(0,255,204,0.4)',
    boxShadow: '0 0 40px rgba(0,255,204,0.15)',
    textAlign: 'center' as const,
  };

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={boxStyle} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: '#00ffcc', marginBottom: 8 }}>
          PRE-ORDER
        </div>
        <div style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 8, letterSpacing: 2 }}>
          HOVERBOARD
        </div>
        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 20 }}>
          Deposit {HOVERBOARD_PRICE_ETH} ETH to sewerpipe.eth
        </div>

        {isFree ? (
          <div
            style={{
              padding: '12px 24px',
              borderRadius: 10,
              background: 'rgba(0,255,204,0.15)',
              border: '1px solid rgba(0,255,204,0.3)',
              color: '#00ffcc',
              fontSize: 14,
              fontWeight: 'bold',
              marginBottom: 12,
            }}
          >
            FREE FOR YOU
          </div>
        ) : (
          <button
            onClick={handleBuy}
            disabled={isPending}
            style={{
              width: '100%',
              padding: '14px 24px',
              borderRadius: 10,
              border: 'none',
              cursor: isPending ? 'wait' : 'pointer',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              fontSize: 16,
              letterSpacing: 2,
              background: isPending
                ? 'rgba(0,255,204,0.3)'
                : 'linear-gradient(90deg, #00ffcc 0%, #00ddaa 100%)',
              color: '#0a1628',
              marginBottom: 12,
              transition: 'all 0.2s',
            }}
          >
            {isPending ? 'CONFIRMING...' : txHash ? 'WAITING...' : 'BUY'}
          </button>
        )}

        {txConfirmed && (
          <div style={{ color: '#00ffcc', fontSize: 13, marginTop: 8 }}>
            HOVERBOARD ACQUIRED! Press V to mount.
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            marginTop: 8,
            background: 'none',
            border: '1px solid #444',
            borderRadius: 6,
            padding: '6px 16px',
            color: '#888',
            fontFamily: 'monospace',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

// ── Billboard Ad Purchase Modal ──────────────────────────────────────

function BillboardAdModal({
  open,
  boardId,
  onClose,
  onPurchased,
}: {
  open: boolean;
  boardId: string;
  onClose: () => void;
  onPurchased: (boardId: string, ad: BillboardAd) => void;
}) {
  const { sendTransaction, data: txHash, isPending } = useSendTransaction();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const { address: wallet } = useAccount();
  const [imageUrl, setImageUrl] = useState('');
  const [selectedTier, setSelectedTier] = useState(0);

  useEffect(() => {
    if (txConfirmed && imageUrl) {
      const tier = BILLBOARD_AD_TIERS[selectedTier];
      const ad: BillboardAd = {
        imageUrl,
        expiresAt: Date.now() + tier.durationMs,
        tier: tier.label,
        paidBy: wallet ?? 'unknown',
      };
      saveBillboardAd(boardId, ad);
      onPurchased(boardId, ad);
    }
  }, [txConfirmed]);

  if (!open) return null;

  const handleBuy = () => {
    if (!imageUrl.trim()) {
      alert('Please enter an image URL for your ad.');
      return;
    }
    const tier = BILLBOARD_AD_TIERS[selectedTier];
    sendTransaction({
      to: PIPE_ADDRESS,
      value: parseEther(tier.price),
    });
  };

  const modalStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.8)',
    pointerEvents: 'auto',
  };

  const boxStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, #1a0a28 0%, #2a1a4a 100%)',
    borderRadius: 16,
    padding: 32,
    width: 440,
    maxWidth: '90vw',
    color: '#fff',
    fontFamily: 'monospace',
    border: '1px solid rgba(255,170,0,0.4)',
    boxShadow: '0 0 40px rgba(255,170,0,0.15)',
    textAlign: 'center' as const,
  };

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={boxStyle} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: '#ffaa00', marginBottom: 8 }}>
          BILLBOARD
        </div>
        <div style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8, letterSpacing: 2 }}>
          ADVERTISE HERE
        </div>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>
          Payment goes to sewerpipe.eth (small grants treasury)
        </div>

        {/* Tier selector */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
          {BILLBOARD_AD_TIERS.map((tier, i) => (
            <button
              key={tier.label}
              onClick={() => setSelectedTier(i)}
              style={{
                flex: 1,
                padding: '10px 8px',
                borderRadius: 8,
                border: selectedTier === i ? '2px solid #ffaa00' : '1px solid #555',
                background: selectedTier === i ? 'rgba(255,170,0,0.15)' : 'rgba(255,255,255,0.05)',
                color: selectedTier === i ? '#ffaa00' : '#aaa',
                fontFamily: 'monospace',
                fontSize: 12,
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div>{tier.label}</div>
              <div style={{ fontSize: 14, marginTop: 4 }}>{tier.price} ETH</div>
            </button>
          ))}
        </div>

        {/* Image URL input */}
        <div style={{ marginBottom: 16, textAlign: 'left' }}>
          <label style={{ fontSize: 11, color: '#888', letterSpacing: 1 }}>AD IMAGE URL</label>
          <input
            type="text"
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            placeholder="https://example.com/your-ad.png"
            style={{
              width: '100%',
              padding: '10px 12px',
              marginTop: 4,
              borderRadius: 6,
              border: '1px solid #555',
              background: 'rgba(0,0,0,0.4)',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Preview */}
        {imageUrl && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>PREVIEW</div>
            <img
              src={imageUrl}
              alt="Ad preview"
              style={{
                maxWidth: '100%',
                maxHeight: 120,
                borderRadius: 4,
                border: '1px solid #444',
              }}
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}

        <button
          onClick={handleBuy}
          disabled={isPending || !imageUrl.trim()}
          style={{
            width: '100%',
            padding: '14px 24px',
            borderRadius: 10,
            border: 'none',
            cursor: isPending ? 'wait' : 'pointer',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            fontSize: 16,
            letterSpacing: 2,
            background: isPending
              ? 'rgba(255,170,0,0.3)'
              : !imageUrl.trim()
                ? '#333'
                : 'linear-gradient(90deg, #ffaa00 0%, #ff8800 100%)',
            color: isPending || !imageUrl.trim() ? '#666' : '#1a0a28',
            marginBottom: 12,
            transition: 'all 0.2s',
          }}
        >
          {isPending
            ? 'CONFIRMING...'
            : txHash
              ? 'WAITING...'
              : `PAY ${BILLBOARD_AD_TIERS[selectedTier].price} ETH`}
        </button>

        {txConfirmed && (
          <div style={{ color: '#ffaa00', fontSize: 13, marginTop: 8 }}>
            AD PURCHASED! Your ad is now live.
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            marginTop: 8,
            background: 'none',
            border: '1px solid #444',
            borderRadius: 6,
            padding: '6px 16px',
            color: '#888',
            fontFamily: 'monospace',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

// ── Main WorldPage Component ──────────────────────────────────────────

export default function WorldPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ── White/fried gating ──
  // Default landing is the white room for everyone. Fried world is opt-in
  // via the FriedMirror portal in front of spawn.
  const worldCurrent = useWorldStore(s => s.current);

  // Preload the prop catalog only when the user opts into fried world.
  // Moved off module-load so the white-room default stays cheap.
  useEffect(() => {
    if (worldCurrent === 'fried') {
      preloadCatalog();
    }
  }, [worldCurrent]);
  const currentNounSeed = useAppSelector(state => (state as any).onDisplayAuction?.seed);
  const lastAuctionNounId = useAppSelector(
    state => (state as any).onDisplayAuction?.lastAuctionNounId,
  );

  // Fetch the auction Noun's seed for the crystal ball
  const auctionNounSeed = useNounSeed(BigInt(lastAuctionNounId ?? 0));

  // Poll /api/agent/predict for the NEXT noun that would be settled right now
  const [predictedSeed, setPredictedSeed] = useState<INounSeed | null>(null);
  useEffect(() => {
    const apiUrl =
      (import.meta.env.VITE_API_URL as string | undefined) ??
      'https://spirited-flexibility-production-3c30.up.railway.app';
    const fetchPrediction = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/agent/predict`);
        if (res.ok) {
          const data = await res.json();
          // The watcher can be pointed at either DAO (NOUNIRL_WATCH_DAO); the
          // mountain decodes with V1 art, so only accept V1-labeled seeds and
          // fall back to the auction noun otherwise.
          if (data.seed && data.dao !== 'v2') setPredictedSeed(data.seed);
        }
      } catch {
        /* silent */
      }
    };
    fetchPrediction();
    const interval = setInterval(fetchPrediction, 12_000);
    return () => clearInterval(interval);
  }, []);

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // ── FEATURE 1: "NOUNS WORLD" cloud text intro ──
  const [introPhase, setIntroPhase] = useState<'fadein' | 'hold' | 'fadeout' | 'done'>('fadein');
  const [introOpacity, setIntroOpacity] = useState(0);

  useEffect(() => {
    if (introPhase === 'done') return;
    let raf: number;
    const start = performance.now();

    const animate = (now: number) => {
      const elapsed = (now - start) / 1000;
      if (introPhase === 'fadein') {
        const t = Math.min(elapsed / 1, 1);
        setIntroOpacity(t);
        if (t >= 1) {
          setIntroPhase('hold');
          return;
        }
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [introPhase === 'fadein']);

  useEffect(() => {
    if (introPhase !== 'hold') return;
    const timer = setTimeout(() => setIntroPhase('fadeout'), 3000);
    return () => clearTimeout(timer);
  }, [introPhase]);

  useEffect(() => {
    if (introPhase !== 'fadeout') return;
    let raf: number;
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = (now - start) / 1000;
      const t = Math.max(1 - elapsed / 1, 0);
      setIntroOpacity(t);
      if (t <= 0) {
        setIntroPhase('done');
        return;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [introPhase === 'fadeout']);

  // ── FEATURE 3: Wanted level (mic volume → stars) ──
  const [wantedLevel, setWantedLevel] = useState(0);
  const wantedRef = useRef(0); // smooth float 0-5, decays each frame

  // Play intro music on first load
  useEffect(() => {
    const audio = new Audio('/sounds/noun-world-intro.mp3');
    audio.volume = 0.12;
    audio.play().catch(() => {
      // Browser blocks autoplay — play on first click
      const playOnClick = () => {
        audio.play().catch(() => {});
        document.removeEventListener('click', playOnClick);
        document.removeEventListener('keydown', playOnClick);
      };
      document.addEventListener('click', playOnClick);
      document.addEventListener('keydown', playOnClick);
    });
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Game state refs (mutable, no re-renders)
  const playerRef = useRef<Player | null>(null);
  const inputRef = useRef<InputState>(createInputState());
  const combatRef = useRef(createCombatState());
  const oceanRef = useRef(createOceanDeathState());
  const mpRef = useRef(createMultiplayerState());
  const npcsRef = useRef<NPC[]>([]);
  const arenaRef = useRef<ArenaRun>(createArenaRun());
  // Bumped whenever the monster roster changes (spawn/death) so the
  // declarative <SeaMonsters/> list re-renders. HUD reads arenaHud.
  const [npcRosterVersion, setNpcRosterVersion] = useState(0);
  const [arenaHud, setArenaHud] = useState({
    active: false,
    over: false,
    wave: 0,
    score: 0,
    kills: 0,
  });
  const playerCharState = useRef<CharacterState>({
    x: SPAWN_X * WORLD_SCALE,
    z: SPAWN_Y * WORLD_SCALE,
    y: 0,
    direction: 'up',
    state: 'idle',
    attackType: null,
    hitFlash: 0,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    weaponEquipped: null,
    muzzleFlash: 0,
    isSkating: false,
    trickName: null,
    trickTimer: 0,
    airborneVy: 0,
    vx: 0,
    vy: 0,
    paintColor: null,
    swordEquipped: false,
  });
  // Raid opt-in/out. 'ask' = first visit (show the card once); 'on' = a
  // small START RAID pill; 'off' = raids hidden behind a muted pill.
  // Persisted so the choice sticks across visits.
  const [raidPref, setRaidPref] = useState<'ask' | 'on' | 'off'>(() => {
    try {
      const v = localStorage.getItem(RAID_PREF_KEY);
      return v === 'on' || v === 'off' ? v : 'ask';
    } catch {
      return 'ask';
    }
  });
  const setRaids = (v: 'on' | 'off') => {
    setRaidPref(v);
    try {
      localStorage.setItem(RAID_PREF_KEY, v);
    } catch {
      /* private mode */
    }
  };
  // Parallel to npcsRef — arena.ts keeps these index-aligned as monsters
  // surface and die. Starts empty; startRun() populates it.
  const npcCharStates = useRef<CharacterState[]>([]);
  const frameRef = useRef(0);
  const voipRef = useRef<VoipState>(createVoipState());
  const remoteTranscriptsRef = useRef<Map<string, { text: string; expires: number }>>(new Map());
  const weaponRef = useRef<WeaponState>(createWeaponState());
  const aimSlotRef = useRef(createAimHudSlot());
  // BuildMode — realtime placeable props
  const buildStoreRef = useRef(createPlacedPropsStore());
  const buildPlayerRef = useRef<{ x: number; y: number } | null>(null);
  const buildWsRef = useRef<WebSocket | null>(null);
  const [buildHudActive, setBuildHudActive] = useState(false);
  const [buildHudKind, setBuildHudKind] = useState<BuildPieceKind>('wall');
  const [weaponPickups, setWeaponPickups] = useState<WeaponPickup[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const playerTargetRef = useRef(
    new THREE.Vector3(SPAWN_X * WORLD_SCALE, 0, SPAWN_Y * WORLD_SCALE),
  );

  // ── Camera integration refs ────────────────────────────────────────
  // CameraRig expects an Object3D ref; we keep a dummy <object3D> in the
  // Canvas scene graph and sync its position from playerTargetRef each
  // tick. This lets the rig read `.position` without us leaking a
  // Vector3-only ref across the module boundary.
  const cameraTargetObjRef = useRef<THREE.Object3D | null>(null);
  // Scene root used for camera-collision raycasts. Wraps the fried-world
  // static geometry so we don't raycast the entire scene (which includes
  // HUD planes, helpers, etc).
  const sceneRootRef = useRef<THREE.Group>(null);
  // Local MovementBody used purely for double-tap dir-tap detection
  // (registerDirTap writes lastDirTapTime/lastDirTapVec onto it). The
  // authoritative locomotion body lives inside combat.ts, so this local
  // tracker only drives triggerFocus('dash') visuals until the body is
  // exposed across the module boundary.
  const dashTapBodyRef = useRef(createMovementBody(SPAWN_X, SPAWN_Y));

  // Register combatRef with the timeControl module so triggerFocus()
  // can mutate combat.slowMo from anywhere (dash.ts, locomotion.ts, etc).
  // Intentional [] deps — combatRef identity is stable.

  useEffect(() => {
    setCombatRef(combatRef);
  }, []);

  // Manual (Q-held) focus/bullet-time trigger — reads inputRef.keys.
  useFocusTrigger(inputRef);

  // ── Skating / Hoverboard state ──
  const skateRef = useRef<SkatingState>(createSkatingState());
  // Skateboard (née hoverboard) is free by default — let players ollie
  // anywhere from the moment they spawn, not only after finding a pickup.
  const [hasHoverboard, setHasHoverboard] = useState(true);
  const [hoverboardModalOpen, setHoverboardModalOpen] = useState(false);
  const { address: connectedWallet } = useAccount();
  // Owner wallet gets hoverboard free
  const isOwnerWallet = connectedWallet?.toLowerCase() === PIPE_ADDRESS.toLowerCase();

  // ── Debug overlay ──
  const [showVoipDebug, setShowVoipDebug] = useState(false);
  const [voipDebugLines, setVoipDebugLines] = useState<string[]>([]);

  // ── K/D ratio (persisted via PartyKit storage, keyed by wallet) ──
  const [kdStats, setKdStats] = useState({ kills: 0, deaths: 0 });
  const kdLoadedRef = useRef(false);

  // ── Graffiti state ──
  const paintRef = useRef<PaintCanState>(createPaintState());
  const [paintCans, setPaintCans] = useState<PaintCan[]>([]);
  const [graffitiOpen, setGraffitiOpen] = useState(false);
  const [graffitiWallId, setGraffitiWallId] = useState<string | null>(null);

  // ── Billboard ad state ──
  const [billboardAdOpen, setBillboardAdOpen] = useState(false);
  const [billboardAdBoardId, setBillboardAdBoardId] = useState<string>('');
  const [billboardAds, setBillboardAds] = useState<Record<string, BillboardAd>>(loadBillboardAds);

  // HUD state — ref only, HUD component reads via DOM manipulation (no React re-renders)
  const hudRef = useRef({
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    playerTx: SPAWN_X / TILE_SIZE,
    playerTy: SPAWN_Y / TILE_SIZE,
    playerCount: 0,
    comboHits: 0,
    controlsVisible: true,
    oceanPhase: 'normal' as string,
    oceanAlpha: 0,
    majaAlpha: 0,
    respawnTimer: 0,
    isDead: false,
    // VOIP
    micEnabled: false,
    isMuted: false,
    isSpeaking: false,
    activeSpeakers: 0,
    crowdMeter: 0,
    settlementWindow: false,
    settleTriggered: false,
    transcript: '',
    weaponEquipped: null as string | null,
    weaponAmmo: 0,
    wantedLevel: 0,
    // Skating
    isSkating: false,
    trickName: null,
    trickTimer: 0,
    airborneVy: 0,
    vx: 0,
    vy: 0,
    paintColor: null,
    swordEquipped: false,
    skateSpeed: 0,
    trickScore: 0,
    currentTrick: null as string | null,
    comboMultiplier: 0,
    comboScore: 0,
    balanceMeter: 0,
    grindActive: false,
    manualActive: false,
  });

  // Seed priority: URL param > Redux auction state > random
  const seed = useMemo(() => {
    const seedParam = searchParams.get('seed');
    if (seedParam) {
      const parts = seedParam.split('-').map(Number);
      if (parts.length === 5 && parts.every(n => !isNaN(n))) {
        return {
          background: parts[0],
          body: parts[1],
          accessory: parts[2],
          head: parts[3],
          glasses: parts[4],
        };
      }
    }
    return currentNounSeed || randomSeed();
  }, [searchParams, currentNounSeed]);
  const seedKey = useMemo(() => seedToKey(seed), [seed]);

  // Initialize player + multiplayer
  useEffect(() => {
    const player = createPlayer(SPAWN_X, SPAWN_Y, 0, seedKey);
    playerRef.current = player;
    // Mirror for BuildMode (tile-world coords) — ws assigned later once mp is initialized
    buildPlayerRef.current = { x: player.x, y: player.y };

    // Spawn weapon pickups around the island (clear first to avoid duplicates on re-mount)
    clearPickups();
    // Close to white-room spawn — reachable without leaving the construct.
    spawnWeaponPickup('pistol', SPAWN_X + 12, SPAWN_Y - 18);
    spawnWeaponPickup('shotgun', SPAWN_X - 18, SPAWN_Y + 12);
    spawnWeaponPickup('uzi', SPAWN_X + 22, SPAWN_Y + 22);
    // Fried-world specific — further out for exploration.
    spawnWeaponPickup('pistol', SPAWN_X + 80, SPAWN_Y - 60);
    spawnWeaponPickup('shotgun', SPAWN_X - 100, SPAWN_Y + 40);
    spawnWeaponPickup('uzi', SPAWN_X + 50, SPAWN_Y + 90);
    setWeaponPickups([...getActivePickups()]);
    console.log(
      '[Weapons] Spawned pickups at:',
      getActivePickups()
        .map(p => `${p.type}(${p.worldX},${p.worldY})`)
        .join(', '),
    );

    // Spawn paint cans around the island
    for (const [px, py] of PAINT_CAN_SPAWNS) {
      spawnPaintCan(px, py);
    }
    setPaintCans([...getActivePaintCans()]);

    // Multiplayer
    const mp = mpRef.current;
    connectMultiplayer(mp);
    setupMessageHandler(mp, { current: player }, combatRef);
    buildWsRef.current = (mp.ws as unknown as WebSocket) ?? null;

    // Auto-init listen-only VOIP so everyone can hear speakers
    initVoipListenOnly(voipRef.current);

    // VOIP signaling + graffiti message handler
    if (mp.ws) {
      mp.ws.addEventListener('message', (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data);
          const voip = voipRef.current;
          if (data.type === 'world:voip:offer' && mp.ws) {
            handleOffer(voip, data.from, data.sdp, mp.ws, mp.myId);
          } else if (data.type === 'world:voip:answer') {
            handleAnswer(voip, data.from, data.sdp);
          } else if (data.type === 'world:voip:ice') {
            handleIceCandidate(voip, data.from, data.candidate);
          } else if (data.type === 'world:voip:speaking') {
            if (data.speaking) voip.activeSpeakers.add(data.id);
            else voip.activeSpeakers.delete(data.id);
          } else if (data.type === 'world:kd:stats') {
            setKdStats({ kills: data.kills ?? 0, deaths: data.deaths ?? 0 });
          } else if (data.type === 'world:voip:transcript') {
            // Store remote player transcript for rendering above their head
            remoteTranscriptsRef.current.set(data.id, {
              text: data.text,
              expires: Date.now() + 4000,
            });
          }
          // Graffiti: @nouns/graffiti handles strokes + snapshots + legacy tag msgs.
          void handleIncoming(evt.data);
          // Build mode: apply remote placed-prop messages
          const bMsg = parseBuildMessage(evt.data);
          if (bMsg) {
            const st = buildStoreRef.current;
            if (bMsg.type === 'world:build:place') st.applyRemote(bMsg.prop);
            else if (bMsg.type === 'world:build:update') {
              const cur = st.list().find(p => p.id === bMsg.id);
              if (cur) st.applyRemote({ ...cur, ...bMsg.patch });
            } else if (bMsg.type === 'world:build:remove') st.applyRemoteRemove(bMsg.id);
            else if (bMsg.type === 'world:build:snapshot') {
              for (const p of bMsg.props) st.applyRemote(p);
            }
          }
        } catch {}
      });

      // Request existing graffiti for all walls + white-room surfaces once
      // connected. White-room monoliths AND the paintable floor grid both
      // round-trip through the same `world:graffiti:load` channel — server
      // returns a `world:graffiti:tags` payload per surface which the
      // @nouns/graffiti `handleIncoming` promotes into a snapshot baseline.
      // PartySocket satisfies the `{ readyState; send }` shape that
      // loadGraffitiTags uses, but isn't structurally a `WebSocket` to ts.
      // The existing call sites pass PartySocket directly, so we mirror that.
      const loadAllPersistentSurfaces = (ws: NonNullable<typeof mp.ws>) => {
        for (const wall of GRAFFITI_WALLS) {
          loadGraffitiTags(ws, wall.id);
        }
        for (const m of monolithPositions(SPAWN_X, SPAWN_Y)) {
          loadGraffitiTags(ws, m.id);
        }
        for (const tileId of whiteRoomFloorTileIds()) {
          loadGraffitiTags(ws, tileId);
        }
      };
      mp.ws.addEventListener('open', () => {
        loadAllPersistentSurfaces(mp.ws!);
        // Load K/D stats for connected wallet
        if (connectedWallet && !kdLoadedRef.current) {
          mp.ws!.send(JSON.stringify({ type: 'world:kd:load', wallet: connectedWallet }));
          kdLoadedRef.current = true;
        }
      });
      // If already open, request immediately
      if (mp.ws.readyState === WebSocket.OPEN) {
        loadAllPersistentSurfaces(mp.ws);
      }
    }

    return () => {
      destroyVoip(voipRef.current);
      disconnectMultiplayer(mp);
    };
  }, [seedKey]);

  // Input listeners
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    // We attach to the container div since R3F canvas intercepts events
    const canvas = container.querySelector('canvas');
    if (!canvas) return;

    const cleanup = attachInputListeners(canvas, inputRef.current);
    canvas.focus();

    return cleanup;
  }, []);

  // Deposit modal + drop items state
  const [depositOpen, setDepositOpen] = useState(false);
  const [droppedItems, setDroppedItems] = useState<DroppedItem[]>([]);
  const claimDrop = useClaimDrop();

  // Chest position (southwest of spawn)
  const chestWorldX = (SPAWN_X - 4 * TILE_SIZE) * WORLD_SCALE;
  const chestWorldZ = (SPAWN_Y + 4 * TILE_SIZE) * WORLD_SCALE;

  // Mic toggle handler
  const handleMicToggle = async () => {
    const voip = voipRef.current;
    if (!micEnabled) {
      console.log('[VOIP] Requesting mic access...');
      const ok = await initVoip(voip);
      console.log('[VOIP] Mic access:', ok ? 'granted' : 'denied');
      if (ok) {
        setMicEnabled(true);
        startSpeechToText(voip);
        const mp = mpRef.current;
        if (mp.ws) {
          // Add tracks to any existing connections (peer joined before we had mic)
          addTracksToExistingPeers(voip, mp.ws, mp.myId);
          // Call any peers we don't have connections to yet
          for (const [id] of mp.remotePlayers) {
            callPeer(voip, id, mp.ws, mp.myId);
          }
        }
      } else {
        alert('Mic access denied. Please allow microphone in browser settings.');
      }
    } else {
      toggleMute(voip);
      if (voip.isMuted) stopSpeechToText();
      else startSpeechToText(voip);
    }
  };

  // ── Open graffiti UI for the nearest wall (if any within range). ──
  // Shared between the G key and the F/fire path when spray_can is equipped.
  const openGraffitiForNearestWall = useCallback(() => {
    const p = playerRef.current;
    if (!p) return false;
    const px = p.x * WORLD_SCALE;
    const pz = p.y * WORLD_SCALE;
    // White room = free paint (construct world, not a pickup-gated world).
    const inWhiteRoom = useWorldStore.getState().current === 'white';
    if (inWhiteRoom) paintRef.current.hasPaint = true;
    // Equipped spray_can = the rainbow can IS the paint source.
    if (weaponRef.current.equipped === 'spray_can') {
      paintRef.current.hasPaint = true;
    }
    if (!paintRef.current.hasPaint) {
      console.log('[Graffiti] No paint — pick up a can or equip spray_can!');
      return false;
    }
    type WallCand = { id: string; worldX: number; worldZ: number };
    const candidates: WallCand[] = [];
    if (!inWhiteRoom) {
      for (const w of GRAFFITI_WALLS) {
        candidates.push({ id: w.id, worldX: w.worldX, worldZ: w.worldZ });
      }
    } else {
      for (const m of monolithPositions(SPAWN_X, SPAWN_Y)) {
        candidates.push({ id: m.id, worldX: m.x, worldZ: m.z });
      }
    }
    let nearestWall: WallCand | null = null;
    let nearestDist = Infinity;
    for (const wall of candidates) {
      const dist = Math.sqrt((px - wall.worldX) ** 2 + (pz - wall.worldZ) ** 2);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestWall = wall;
      }
    }
    if (nearestWall && nearestDist < WALL_NEAR_DISTANCE) {
      setGraffitiWallId(nearestWall.id);
      setGraffitiOpen(true);
      return true;
    }
    console.log('[Graffiti] No wall nearby — get closer to a wall!');
    return false;
  }, []);

  // ESC + E + M key handler
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (graffitiOpen) {
          setGraffitiOpen(false);
          setGraffitiWallId(null);
        } else if (billboardAdOpen) {
          setBillboardAdOpen(false);
        } else if (depositOpen) {
          setDepositOpen(false);
        } else {
          destroyVoip(voipRef.current);
          disconnectMultiplayer(mpRef.current);
          navigate('/');
        }
      }
      // M = toggle mic
      if (e.key === 'm' || e.key === 'M') {
        handleMicToggle();
      }
      // G = open graffiti spray UI when near a wall and have paint
      if ((e.key === 'g' || e.key === 'G') && !graffitiOpen) {
        openGraffitiForNearestWall();
        return;
      }
      // V = toggle skate mode on/off (mount/dismount hoverboard)
      if (e.key === 'v' || e.key === 'V') {
        const p = playerRef.current;
        if (!p) return;
        const sk = skateRef.current;
        if (sk.isSkating) {
          dismountBoard(sk);
          return;
        }
        if (hasHoverboard) {
          // Already own hoverboard — mount anywhere
          mountBoard(sk);
          return;
        }
        // Check if near hoverboard pickup
        const px = p.x * WORLD_SCALE;
        const pz = p.y * WORLD_SCALE;
        const boardDist = Math.sqrt(
          (px - HOVERBOARD_PICKUP_X) ** 2 + (pz - HOVERBOARD_PICKUP_Z) ** 2,
        );
        if (boardDist < 3) {
          mountBoard(sk);
          setHasHoverboard(true);
          return;
        }
      }
      // ── Skating tricks ──
      if (skateRef.current.isSkating) {
        if (e.key === ' ') {
          e.preventDefault();
          const skTrick = skateRef.current;
          const inp = inputRef.current;
          if (skTrick.airborne) {
            const holdLeft = inp?.keys.has('a');
            const holdRight = inp?.keys.has('d');
            const holdUp = inp?.keys.has('w');
            const holdDown = inp?.keys.has('s');
            if (holdLeft) airTrick(skTrick, 'left');
            else if (holdRight) airTrick(skTrick, 'right');
            else if (holdUp) airTrick(skTrick, 'up');
            else if (holdDown) airTrick(skTrick, 'down');
            else spin180(skTrick);
          } else {
            const wx = (playerRef.current?.x ?? 0) * WORLD_SCALE;
            const wz = (playerRef.current?.y ?? 0) * WORLD_SCALE;
            const terrainY = getTerrainHeight(wx, wz);
            const rampData = testRampCollision(wx, wz, terrainY, MEGA_RAMP_BOUNDS);
            ollie(skTrick, rampData);
          }
          return;
        }
        if (e.key === 'j' || e.key === 'J') {
          spin180(skateRef.current);
          return;
        }
        if (e.key === 'k' || e.key === 'K') {
          kickflip(skateRef.current);
          return;
        }
        // Board grabs: hold direction + L while airborne
        if ((e.key === 'l' || e.key === 'L') && skateRef.current.airborne) {
          const inp = inputRef.current;
          if (inp?.keys.has('a')) boardGrab(skateRef.current, 'melon');
          else if (inp?.keys.has('d')) boardGrab(skateRef.current, 'indy');
          else if (inp?.keys.has('w')) boardGrab(skateRef.current, 'nose');
          else if (inp?.keys.has('s')) boardGrab(skateRef.current, 'tail');
          else boardGrab(skateRef.current, 'method');
          return;
        }
      }
      // ── VOIP debug overlay (backtick key) ──
      if (e.key === '`') {
        setShowVoipDebug(prev => !prev);
        return;
      }
      // ── Weapon slots 1-4 (desktop) ──
      // 1=spray_can, 2=pistol, 3=shotgun, 4=uzi. Only switch if the
      // player already owns the weapon. Falls through to camera zoom
      // when the digit doesn't correspond to an owned weapon.
      const slotMap: Record<string, WeaponType> = {
        '1': 'spray_can',
        '2': 'pistol',
        '3': 'shotgun',
        '4': 'uzi',
      };
      const slotType = slotMap[e.key];
      if (slotType && weaponRef.current.owned.has(slotType)) {
        switchWeapon(weaponRef.current, slotType);
        return;
      }
      // ── Camera zoom levels (1-5) ──
      // CameraRig owns the zoom state (setCameraZoomIndex); keep this
      // handler so non-focused canvas bubbles still cycle zoom, but
      // route it through the rig's API.
      if (e.key >= '1' && e.key <= '5') {
        setCameraZoomIndex(parseInt(e.key, 10) - 1);
        return;
      }
      // ── Teleport to ramp top (press 0) ──
      if (e.key === '0') {
        const p = playerRef.current;
        if (p) {
          const rb = MEGA_RAMP_BOUNDS;
          p.x = rb.x / WORLD_SCALE;
          p.y = (rb.z + rb.length / 2 + 2) / WORLD_SCALE;
          // Reset board state — totally still
          const skReset = skateRef.current;
          skReset.speed = 0;
          skReset.momentum = [0, 0];
          skReset.airborne = false;
          skReset.airborneVy = 0;
          skReset.airborneY = 0;
          skReset.airborneTime = 0;
          skReset.currentTrick = null;
          skReset.trickTimer = 0;
          skReset.spinAngle = 0;
          skReset.bailed = false;
        }
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        const p = playerRef.current;
        if (!p) return;
        const px = p.x * WORLD_SCALE;
        const pz = p.y * WORLD_SCALE;

        // Return-portal check (fried → white). The portal sits at fried
        // world spawn; pressing E within 3u swaps back. FriedMirror
        // handles the white → fried direction itself.
        {
          const s = useWorldStore.getState();
          if (s.current === 'fried' && s.transition === 'idle') {
            const portalX = SPAWN_X * WORLD_SCALE;
            const portalZ = SPAWN_Y * WORLD_SCALE;
            const d = Math.hypot(px - portalX, pz - portalZ);
            if (d < 3) {
              s.enterWorld('white');
              return;
            }
          }
          // In white world, the mirror is the only E target. FriedMirror
          // handles its own keydown, so bail out of the fried-only checks
          // below to avoid phantom hoverboard/chest/ad/drop interactions.
          if (s.current === 'white') return;
        }

        // Check distance to hoverboard pickup — open purchase modal
        const boardDist = Math.sqrt(
          (px - HOVERBOARD_PICKUP_X) ** 2 + (pz - HOVERBOARD_PICKUP_Z) ** 2,
        );
        if (boardDist < 3 && !hasHoverboard) {
          setHoverboardModalOpen(true);
          return;
        }

        // Check distance to chest
        const chestDist = Math.sqrt((px - chestWorldX) ** 2 + (pz - chestWorldZ) ** 2);
        if (chestDist < 3) {
          setDepositOpen(true);
          return;
        }

        // Check for nearby billboard ad boards
        for (const board of AD_BILLBOARDS) {
          const bx = board.worldX * WORLD_SCALE;
          const bz = board.worldZ * WORLD_SCALE;
          const adDist = Math.sqrt((px - bx) ** 2 + (pz - bz) ** 2);
          if (adDist < AD_BOARD_NEAR_DISTANCE) {
            setBillboardAdBoardId(board.id);
            setBillboardAdOpen(true);
            return;
          }
        }

        // Check for nearby drop item
        const nearbyDrop = getNearbyDrop(p.x, p.y);
        if (nearbyDrop) {
          claimDrop.claim(BigInt(nearbyDrop.dropId));
          markClaimed(nearbyDrop.dropId, 'you');
          setDroppedItems([...getActiveDrops()]);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    navigate,
    depositOpen,
    graffitiOpen,
    billboardAdOpen,
    claimDrop,
    chestWorldX,
    chestWorldZ,
    hasHoverboard,
    openGraffitiForNearestWall,
  ]);

  // ── Dev hooks (Vite dev only) ────────────────────────────────────────
  // Exposes the R3F root + player on window.__world so a headless / hidden
  // automation tab can step frames with `advance()` and read the sim.
  function DevHooks() {
    const three = useThree();
    useEffect(() => {
      if (!import.meta.env.DEV) return;
      const w = window as unknown as { __world?: unknown };
      w.__world = { three, playerRef, playerTargetRef, arenaRef, npcsRef, getPlayerBody };
      return () => {
        delete w.__world;
      };
    }, [three]);
    return null;
  }

  // ── Game Logic Component (runs inside R3F) ──────────────────────────

  function GameLogic() {
    // Fixed-timestep accumulator + previous-tick snapshot for interpolation.
    const simAcc = useRef(0);
    const prevPlayer = useRef({ x: SPAWN_X, y: SPAWN_Y, valid: false });

    // ── One 60Hz simulation tick — everything authored "per frame" runs here ──
    const simTick = () => {
      const player = playerRef.current;
      const input = inputRef.current;
      const combat = combatRef.current;
      const ocean = oceanRef.current;
      const mp = mpRef.current;
      if (!player) return;

      // Snapshot last-tick positions so the renderer can lerp between ticks.
      const pp = prevPlayer.current;
      pp.x = player.x;
      pp.y = player.y;
      pp.valid = true;
      for (const npc of npcsRef.current) {
        npc.prevX = npc.x;
        npc.prevY = npc.y;
      }

      // Publish the authoritative body to dojoState so GravityZones /
      // TrainingDummies can read it for proximity + impulse effects.
      const playerBody = getPlayerBody(player);
      setPlayerBodyForDojo(playerBody);

      // Double-tap dash detection (edge-triggered on WASD just-pressed).
      // Writes into the authoritative body so locomotion.ts picks up
      // lastDirTapTime/Vec and triggers the actual dash state.
      {
        const jp = input.justPressed;
        const body = playerBody ?? dashTapBodyRef.current;
        const nowMs = performance.now();
        // Camera-relative: W = forward, S = back, A = left, D = right.
        const ca = input.cameraAngle ?? 0;
        const forwardX = -Math.sin(ca);
        const forwardY = -Math.cos(ca);
        const rightX = Math.cos(ca);
        const rightY = -Math.sin(ca);
        const tryTap = (dx: number, dy: number) => {
          // Consume the tap. When a double-tap closes, registerDirTap
          // returns true — locomotion owns the actual dash + focus
          // trigger inside combat.ts via its authoritative body, so we
          // just record the edge here for the shared double-tap window.
          registerDirTap(body, dx, dy, nowMs);
        };
        if (jp.has('w')) tryTap(forwardX, forwardY);
        if (jp.has('s')) tryTap(-forwardX, -forwardY);
        if (jp.has('a')) tryTap(-rightX, -rightY);
        if (jp.has('d')) tryTap(rightX, rightY);
      }

      // ── FEATURE 2: Poll gamepad each frame ──
      pollGamepad(input);

      frameRef.current++;
      const frame = frameRef.current;

      // Ocean death — only if actually at water level (not on ramp/buildings above water tiles)
      const inWater = isInDeepWater(player.x, player.y, ISLAND_MAP);
      const sk = skateRef.current;
      const terrainAtPlayer = getTerrainHeight(player.x * WORLD_SCALE, player.y * WORLD_SCALE);
      const actuallySubmerged = inWater && terrainAtPlayer < 0.3;
      tickOceanDeath(ocean, actuallySubmerged && !sk.isSkating);
      if (ocean.phase === 'respawning' && ocean.timer === 59) {
        player.x = SPAWN_X;
        player.y = SPAWN_Y;
        player.vx = 0;
        player.vy = 0;
        player.hp = player.maxHp;
      }

      // ── Passive aim lock-on check (every 3 frames is enough for HUD) ──
      // Only for real guns — spray can is a paint tool, no crosshair lock.
      const wEq = weaponRef.current.equipped;
      const isGun = !!wEq && !WEAPON_DEFS[wEq].isPaintTool;
      if (isGun && frame % 3 === 0) {
        const passiveAim = computeAim(player, input.cameraAngle, mp.remotePlayers.values(), {
          lockRange: 140,
          lockCone: Math.PI / 10,
          enableLockOn: true,
        });
        aimSlotRef.current.lockedId = passiveAim.lockedId;
        aimSlotRef.current.lockDistance = passiveAim.lockDistance ?? null;
      } else if (!isGun) {
        aimSlotRef.current.lockedId = null;
        aimSlotRef.current.lockDistance = null;
      }

      // ── Weapon pickup check (GTA style — auto on walk-over) ──
      const weapon = weaponRef.current;
      if (frame % 120 === 0) {
        const pickups = getActivePickups();
        if (pickups.length > 0) {
          const nearest = pickups.reduce(
            (best, p) => {
              const d = Math.hypot(player.x - p.worldX, player.y - p.worldY);
              return d < best.d ? { d, p } : best;
            },
            { d: Infinity, p: pickups[0] },
          );
          console.log(
            `[Weapons] Player(${player.x.toFixed(0)},${player.y.toFixed(0)}) nearest=${nearest.p.type} dist=${nearest.d.toFixed(0)} pickups=${pickups.length}`,
          );
        }
      }
      const pickedUp = checkWeaponPickup(player.x, player.y, weapon);
      if (pickedUp) {
        playPickupSound();
        setWeaponPickups([...getActivePickups()]);
      }
      tickReload(weapon);
      tickMuzzleFlash(weapon);

      // ── Hoverboard physics ──
      if (sk.isSkating) {
        const wx = player.x * WORLD_SCALE;
        const wz = player.y * WORLD_SCALE;
        const terrainY = getTerrainHeight(wx, wz);
        const rampData = testRampCollision(wx, wz, terrainY, MEGA_RAMP_BOUNDS);
        const dir: [number, number] = [
          input.keys.has('w') ? 1 : input.keys.has('s') ? -1 : 0,
          input.keys.has('d') ? 1 : input.keys.has('a') ? -1 : 0,
        ];
        const move = tickSkating(sk, dir, 1 / 60, terrainY, rampData);
        player.x += move.dx / WORLD_SCALE;
        player.y += move.dz / WORLD_SCALE;
      }

      // ── Paint can pickup check (auto on walk-over) ──
      const paintPickedUp = checkPaintPickup(player.x, player.y, paintRef.current);
      if (paintPickedUp) {
        playPickupSound();
        setPaintCans([...getActivePaintCans()]);
        console.log(`[Graffiti] Picked up ${paintPickedUp.color} paint can!`);
      }

      // Footsteps disabled — too noisy

      // Combat input — disabled when skating (board handles its own controls)
      if (ocean.phase === 'normal' && !skateRef.current.isSkating) {
        let intendedMove = resolveIntendedMove(input);

        // If F pressed and weapon equipped, handle it.
        // Paint tools (spray_can) open the graffiti UI instead of firing
        // a bullet. Regular guns fire + play a sound.
        if (intendedMove === 'gunshot' && weapon.equipped) {
          const def = WEAPON_DEFS[weapon.equipped];
          if (def.isPaintTool) {
            openGraffitiForNearestWall();
            intendedMove = null; // don't treat as combat hit
          } else {
            const result = fireWeapon(weapon);
            if (result.fired) {
              if (weapon.equipped === 'shotgun') playShotgunSound();
              else playGunshot();
            } else {
              intendedMove = null; // can't fire (cooldown/no ammo/reloading)
            }
          }
        } else if (intendedMove === 'gunshot' && !weapon.equipped) {
          intendedMove = null; // no weapon
        }

        if (intendedMove && player.state !== 'dead' && player.state !== 'respawning') {
          // Play attack sound
          if (intendedMove === 'punch') playPunchSound();
          else if (intendedMove === 'kick') playKickSound();
          else if (intendedMove === 'headbutt') playHeadbuttSound();
          else if (intendedMove === 'backflip') playJumpSound();
          // block is silent — no annoying clang on shift

          // Aim resolution:
          //   - Ranged moves use camera-ray aim + soft lock-on (continuous angle)
          //   - Melee falls back to 8-way facing (keeps close-combat feel snappy)
          const isRanged = intendedMove === 'gunshot' || intendedMove === 'forcePush';
          let angle: number;
          if (isRanged) {
            const aim = computeAim(player, input.cameraAngle, mp.remotePlayers.values(), {
              lockRange: intendedMove === 'gunshot' ? 140 : 80,
              lockCone: intendedMove === 'gunshot' ? Math.PI / 10 : Math.PI / 7,
              enableLockOn: true,
            });
            angle = aim.angle;
            aimSlotRef.current.lockedId = aim.lockedId;
            aimSlotRef.current.lockDistance = aim.lockDistance ?? null;
          } else {
            angle = DIRECTION_FACING_ANGLE[player.direction] ?? 0;
          }
          const mouseWorldX = player.x + Math.cos(angle) * 50;
          const mouseWorldY = player.y + Math.sin(angle) * 50;

          const hits = executeMove(
            player,
            intendedMove,
            mouseWorldX,
            mouseWorldY,
            mp.remotePlayers,
            combat,
          );

          // Same move geometry also lands on arena sea-monsters.
          resolveNpcHits(
            arenaRef.current,
            player,
            intendedMove,
            mouseWorldX,
            mouseWorldY,
            npcsRef.current,
            combat,
          );

          if (intendedMove !== 'block') {
            sendAttack(mp, intendedMove, player.x, player.y, angle);
          }
          if (intendedMove === 'forcePush') {
            sendForcePush(mp, player.x, player.y, angle, '#4488ff');
          }

          // Sound on hit
          for (const hit of hits) {
            if (hit.combo >= 3) playComboSound();
            sendHit(mp, hit.targetId, hit.damage, hit.knockX, hit.knockY, hit.move, hit.combo);
            const target = mp.remotePlayers.get(hit.targetId);
            if (target && target.hp <= 0) {
              playDeathSound();
              combat.killFeed.push({
                killer: `Noun #${player.nounId}`,
                victim: `Noun #${target.nounId}`,
                move: hit.move,
                timestamp: Date.now(),
              });
              // Persist kill to K/D stats
              if (connectedWallet && mp.ws?.readyState === WebSocket.OPEN) {
                mp.ws.send(
                  JSON.stringify({
                    type: 'world:kd:save',
                    wallet: connectedWallet,
                    addKills: 1,
                    addDeaths: 0,
                  }),
                );
              }
            }
          }
        }
      }

      // ── Settlement window check (every ~15 seconds) ──
      if (frame % 900 === 0) {
        getAuctionState().then(auction => {
          voipRef.current.settlementWindow = auction.isSettlementWindow;
        });
      }

      // ── VOIP tick ──
      const voip = voipRef.current;
      if (voip.localStream && frame % 6 === 0) {
        const wasSpeaking = voip.isSpeaking;
        checkVoiceActivity(voip);
        // Broadcast speaking state + transcript
        if (mp.ws && mp.ws.readyState === WebSocket.OPEN) {
          if (voip.isSpeaking !== wasSpeaking) {
            mp.ws.send(
              JSON.stringify({
                type: 'world:voip:speaking',
                speaking: voip.isSpeaking,
              }),
            );
          }
          // Broadcast transcript to other players
          const transcript = getCurrentTranscript();
          if (transcript) {
            mp.ws.send(
              JSON.stringify({
                type: 'world:voip:transcript',
                text: transcript,
              }),
            );
          }
        }
        // Update crowd settle
        const shouldSettle = updateCrowdSettle(voip);
        if (shouldSettle) {
          // TODO: trigger sewerpipe.eth settlement via agent hub API
          console.log('[VOIP] SETTLEMENT TRIGGERED BY CROWD!');
        }
        // Update spatial audio listener position
        const rot = DIRECTION_ROTATION[player.direction] ?? 0;
        updateListenerPosition(
          voip,
          player.x * WORLD_SCALE,
          0,
          player.y * WORLD_SCALE,
          Math.sin(rot),
          Math.cos(rot),
        );
        // Update spatial positions for remote players
        for (const [id, rp] of mp.remotePlayers) {
          updateSpatialPosition(voip, id, rp.x * WORLD_SCALE, 0, rp.y * WORLD_SCALE);
        }
      }

      // Tick player — always run, but board overrides movement after
      tickPlayer(player, input, combat);

      // ── Arena run — surface/drive sea monsters, apply their hits ──
      const arena = arenaRef.current;
      if (arena.active) {
        const rosterChanged = tickArena(
          arena,
          npcsRef.current,
          npcCharStates.current,
          player,
          combat,
        );
        if (rosterChanged) setNpcRosterVersion(v => v + 1);
        // Throttle HUD state writes to ~6fps (cheap, avoids churn).
        if (frame % 10 === 0 || arena.over) {
          setArenaHud({
            active: arena.active,
            over: arena.over,
            wave: arena.wave,
            score: arena.score,
            kills: arena.kills,
          });
        }
      }

      // Multiplayer
      tickRemotePlayers(mp);
      if (frame % SEND_INTERVAL === 0) {
        sendPlayerUpdate(mp, player);
      }

      // Effects
      updateParticles(combat.particles);
      updateFloatingTexts(combat.floatingTexts);
      updateForcePushes(combat.forcePushes);
      combat.shake = updateScreenShake(combat.shake);

      // Prune old kills
      const now = Date.now();
      combat.killFeed = combat.killFeed.filter(k => now - k.timestamp < 10000);

      // ── FEATURE 3: Wanted level from mic volume ──
      const voipForWanted = voipRef.current;
      if (voipForWanted.analyser && voipForWanted.localStream && !voipForWanted.isMuted) {
        const wantedData = new Uint8Array(voipForWanted.analyser.frequencyBinCount);
        voipForWanted.analyser.getByteFrequencyData(wantedData);
        let wantedSum = 0;
        for (let i = 0; i < wantedData.length; i++) wantedSum += wantedData[i];
        const vol = wantedSum / wantedData.length / 255; // normalize to 0-1
        let targetStars = 0;
        if (vol > 0.9) targetStars = 5;
        else if (vol > 0.7) targetStars = 4;
        else if (vol > 0.5) targetStars = 3;
        else if (vol > 0.3) targetStars = 2;
        else if (vol > 0.1) targetStars = 1;
        // Instant ramp up, slow decay
        if (targetStars > wantedRef.current) {
          wantedRef.current = targetStars;
        } else {
          wantedRef.current = Math.max(0, wantedRef.current - 0.02);
        }
      } else {
        // Decay when mic off
        wantedRef.current = Math.max(0, wantedRef.current - 0.02);
      }
      // Update React state every ~15 frames to avoid excessive re-renders
      if (frame % 15 === 0) {
        const rounded = Math.ceil(wantedRef.current);
        setWantedLevel(prev => (prev !== rounded ? rounded : prev));
      }

      // Clear input
      clearFrameFlags(input);

      // Update HUD via ref (no React re-renders)
      hudRef.current.hp = player.hp;
      hudRef.current.maxHp = player.maxHp;
      hudRef.current.playerCount = mp.playerCount;
      hudRef.current.comboHits = player.comboHits;
      hudRef.current.controlsVisible = frame < 300;
      hudRef.current.oceanPhase = ocean.phase;
      hudRef.current.oceanAlpha = getOceanOverlayAlpha(ocean);
      hudRef.current.majaAlpha = getGranMajaTextAlpha(ocean);
      hudRef.current.respawnTimer = player.respawnTimer;
      hudRef.current.isDead = player.state === 'dead' || player.state === 'respawning';
      // Update VOIP debug info every 30 frames (~0.5s)
      if (showVoipDebug && frame % 30 === 0) {
        setVoipDebugLines(getVoipDebugInfo(voipRef.current));
      }
      // Track death for K/D (only on transition to dead, not every frame)
      if (
        player.state === 'dead' &&
        player.deathTimer === 59 &&
        connectedWallet &&
        mp.ws?.readyState === WebSocket.OPEN
      ) {
        mp.ws.send(
          JSON.stringify({
            type: 'world:kd:save',
            wallet: connectedWallet,
            addKills: 0,
            addDeaths: 1,
          }),
        );
      }
      // VOIP HUD
      hudRef.current.micEnabled = !!voipRef.current.localStream;
      hudRef.current.isMuted = voipRef.current.isMuted;
      hudRef.current.isSpeaking = voipRef.current.isSpeaking;
      hudRef.current.activeSpeakers =
        voipRef.current.activeSpeakers.size + (voipRef.current.isSpeaking ? 1 : 0);
      hudRef.current.crowdMeter = voipRef.current.crowdMeter;
      hudRef.current.settlementWindow = voipRef.current.settlementWindow;
      hudRef.current.settleTriggered = voipRef.current.settleTriggered;
      hudRef.current.transcript = getCurrentTranscript();
      // Weapon HUD
      hudRef.current.weaponEquipped = weaponRef.current.equipped;
      hudRef.current.weaponAmmo = weaponRef.current.ammo;
      hudRef.current.wantedLevel = Math.ceil(wantedRef.current);
      // Skating HUD
      hudRef.current.isSkating = sk.isSkating;
      hudRef.current.skateSpeed = sk.speed;
      hudRef.current.trickScore = sk.trickScore;
      hudRef.current.currentTrick = sk.currentTrick;
      hudRef.current.comboMultiplier = sk.comboMultiplier;
      hudRef.current.comboScore = sk.comboScore;
      hudRef.current.balanceMeter = sk.balanceMeter;
      hudRef.current.grindActive = sk.grindActive;
      hudRef.current.manualActive = sk.manualActive;
      // Write weapon state to character for gun rendering
      const pcs = playerCharState.current;
      pcs.weaponEquipped = weaponRef.current.equipped;
      pcs.muzzleFlash = weaponRef.current.muzzleFlash;
      pcs.isSkating = skateRef.current.isSkating;
      pcs.trickName = skateRef.current.currentTrick || null;
      pcs.trickTimer =
        skateRef.current.trickTimer > 0
          ? 1 - skateRef.current.trickTimer / 0.8 // normalize to 0-1 progress (0.8s trick duration)
          : 0;
      player.isSkating = skateRef.current.isSkating;
      player.trickName = skateRef.current.currentTrick || null;
      (player as any).weaponEquipped = weaponRef.current.equipped;
      (player as any).paintColor = paintRef.current.hasPaint ? paintRef.current.color : null;
      pcs.airborneVy = player.airborneVy;
      pcs.vx = player.vx;
      pcs.vy = player.vy;
      pcs.paintColor = paintRef.current.hasPaint ? paintRef.current.color : null;
      pcs.swordEquipped = false; // TODO: wire sword pickup
    };

    // ── Per-render sync: interpolated positions → camera target + avatars ──
    const renderSync = (alpha: number, frameDt: number) => {
      const player = playerRef.current;
      if (!player) return;
      const sk = skateRef.current;
      const playerBody = getPlayerBody(player);
      // Interpolate between the last two sim ticks. A big jump (respawn /
      // portal teleport) snaps instead of streaking across the island.
      const pp = prevPlayer.current;
      let px = player.x;
      let py = player.y;
      if (pp.valid && Math.hypot(player.x - pp.x, player.y - pp.y) < 160) {
        px = pp.x + (player.x - pp.x) * alpha;
        py = pp.y + (player.y - pp.y) * alpha;
      }
      const wx = px * WORLD_SCALE;
      const wz = py * WORLD_SCALE;
      let terrainY = getTerrainHeight(wx, wz);
      // Hoverboard hovers OVER water, not under
      if (sk.isSkating && terrainY < 0.1) terrainY = 0.1;
      // Jump height offset — airborneY is negative when up
      const jumpOffset = player.airborneY < 0 ? -player.airborneY * 0.06 : 0;
      const skateOffset = sk.isSkating ? sk.hoverHeight + sk.airborneY : 0;
      const totalYOffset = jumpOffset + skateOffset;

      // Smooth Y interpolation — prevents jolty terrain transitions
      const targetY = terrainY + totalYOffset;
      const prevY = playerTargetRef.current.y;
      // Framerate-independent exponential smoothing; snap on teleports.
      const smoothY =
        Math.abs(targetY - prevY) > 4
          ? targetY
          : prevY + (targetY - prevY) * (1 - Math.exp(-frameDt * 12));

      // Camera follows the smoothed height
      playerTargetRef.current.set(wx, smoothY, wz);

      const pcs = playerCharState.current;
      pcs.x = wx;
      pcs.z = wz;
      pcs.y = smoothY;
      pcs.direction = player.direction;
      pcs.state = player.state;
      pcs.attackType = player.attackType;
      pcs.hitFlash = player.hitFlash;
      pcs.hp = player.hp;

      // Fine-grained locomotion substate + landing juice + wall-run tilt
      // read directly from the authoritative body so Character3D animations
      // match the exact movement state.
      if (playerBody) {
        pcs.locoSubstate = playerBody.loco;
        pcs.landingImpact = playerBody.landingImpact;
        pcs.wallRunSide = playerBody.wallRun
          ? playerBody.wallRun.normalX > 0
            ? 'right'
            : 'left'
          : undefined;
      } else {
        pcs.locoSubstate = 'grounded';
        pcs.landingImpact = 0;
        pcs.wallRunSide = undefined;
      }

      // Update NPC character state refs
      for (let i = 0; i < npcsRef.current.length; i++) {
        const npc = npcsRef.current[i];
        const ncs = npcCharStates.current[i];
        if (!ncs) continue;
        const nx = npc.prevX === undefined ? npc.x : npc.prevX + (npc.x - npc.prevX) * alpha;
        const ny = npc.prevY === undefined ? npc.y : npc.prevY + (npc.y - npc.prevY) * alpha;
        ncs.x = nx * WORLD_SCALE;
        ncs.z = ny * WORLD_SCALE;
        ncs.y = getTerrainHeight(ncs.x, ncs.z);
        ncs.direction = npc.direction;
        ncs.state =
          npc.state === 'chase'
            ? 'walking'
            : npc.state === 'attack'
              ? 'attacking'
              : npc.state === 'dead'
                ? 'dead'
                : npc.state === 'stunned'
                  ? 'stunned'
                  : npc.state === 'patrol'
                    ? npc.patrolWaitTimer > 0
                      ? 'idle'
                      : 'walking'
                    : 'idle';
        ncs.hitFlash = npc.hitFlash;
        ncs.hp = npc.hp;
      }

      // Sync camera-target Object3D with the target Vector3 so CameraRig
      // can read the player position via Object3D.position.
      if (cameraTargetObjRef.current) {
        cameraTargetObjRef.current.position.copy(playerTargetRef.current);
      }
      // Minimap centre (world tile coords).
      hudRef.current.playerTx = px / TILE_SIZE;
      hudRef.current.playerTy = py / TILE_SIZE;
    };

    // Priority -10: runs BEFORE CameraRig's default-priority useFrame so the
    // camera reads the fresh player position each frame.
    useFrame((_, delta) => {
      // Wrap the whole frame so a thrown exception (e.g. a stray null
      // deref triggered by an input edge like Q-tap forcePush) doesn't
      // kill R3F's render loop and freeze the game. Better to drop one
      // frame's logic than halt every subsequent frame forever.
      try {
        const combat = combatRef.current;
        // Real (unscaled) delta, clamped so a tab-blur resume doesn't
        // advance the focus meter / slomo state machine by seconds.
        const frameDt = Math.min(delta, 1 / 20);

        // Real-time systems: bullet-time ramps + focus meter + audio pitch
        // run on wall-clock time, never on scaled sim time.
        combat.slowMo = updateSlomo(combat.slowMo, frameDt);
        updateFocusMeter(frameDt);
        const timeScale = combat.slowMo?.factor ?? 1;
        applySlomoAudio(timeScale);

        // Fixed 60Hz sim. Bullet-time genuinely slows the world by feeding
        // the accumulator scaled time; a slow display runs several ticks per
        // frame; a 120Hz display runs one every other frame and interpolates.
        simAcc.current += frameDt * timeScale;
        let steps = 0;
        while (simAcc.current >= SIM_STEP && steps < MAX_SIM_STEPS) {
          simTick();
          simAcc.current -= SIM_STEP;
          steps++;
        }
        // Hopelessly behind (tab throttled, GC pause): drop the backlog so
        // we never death-spiral, and let time dilate instead.
        if (steps === MAX_SIM_STEPS && simAcc.current >= SIM_STEP) simAcc.current = 0;

        const alpha = Math.max(0, Math.min(1, simAcc.current / SIM_STEP));
        renderSync(alpha, frameDt);
      } catch (err) {
        console.error('[GameLogic] frame skipped due to error:', err);
      }
    }, -10);

    return null;
  }

  // ── Characters (ref-driven, zero re-renders) ─────────────────────────
  // Character3D reads from stateRef each frame — no React state updates.
  //
  // NOTE: the player avatar is rendered by inlining <Character3D> directly at
  // the call site below — NOT via a nested `PlayerCharacter3D` wrapper. A
  // component defined inside WorldPage's body gets a fresh function identity on
  // every WorldPage re-render (wantedLevel / arenaHud / weaponPickups / … all
  // trip it), so React would unmount+remount the whole subtree each time and
  // the avatar's GLB would reload — the "constant flashing" bug. `seed`
  // (useMemo) and `playerCharState` (useRef) are stable, so the inlined
  // Character3D stays mounted across re-renders.

  // Remote players — each gets own Character3D with own GLB
  function RemotePlayers() {
    const remoteCharStates = useRef<Map<string, { seed: INounSeed; state: CharacterState }>>(
      new Map(),
    );

    useFrame(() => {
      const mp = mpRef.current;
      // Update or create state for each remote player
      for (const [id, rp] of mp.remotePlayers) {
        let entry = remoteCharStates.current.get(id);
        if (!entry) {
          let rpSeed: INounSeed;
          try {
            const parts = rp.seedKey.split('-').map(Number);
            rpSeed = {
              background: parts[0],
              body: parts[1],
              accessory: parts[2],
              head: parts[3],
              glasses: parts[4],
            };
          } catch {
            rpSeed = randomSeed();
          }
          entry = {
            seed: rpSeed,
            state: {
              x: 0,
              z: 0,
              y: 0,
              direction: 'up',
              state: 'idle',
              attackType: null,
              hitFlash: 0,
              hp: 100,
              maxHp: 100,
              weaponEquipped: null,
              muzzleFlash: 0,
              isSkating: false,
              trickName: null,
              trickTimer: 0,
              airborneVy: 0,
              vx: 0,
              vy: 0,
              paintColor: null,
              swordEquipped: false,
            },
          };
          remoteCharStates.current.set(id, entry);
        }
        if (!entry) continue;
        const wx = rp.x * WORLD_SCALE;
        const wz = rp.y * WORLD_SCALE;
        entry.state.x = wx;
        entry.state.z = wz;
        entry.state.y = getTerrainHeight(wx, wz);
        entry.state.direction = rp.direction;
        entry.state.state =
          rp.state === 'walking' ? 'walking' : rp.state === 'attacking' ? 'attacking' : 'idle';
        entry.state.hitFlash = rp.hitFlash;
        entry.state.hp = rp.hp;
        entry.state.isSkating = rp.isSkating ?? false;
        entry.state.weaponEquipped = (rp as any).weaponEquipped ?? null;
        entry.state.paintColor = (rp as any).paintColor ?? null;
      }
      // Remove disconnected players
      for (const id of remoteCharStates.current.keys()) {
        if (!mp.remotePlayers.has(id)) {
          remoteCharStates.current.delete(id);
        }
      }
    });

    // Render — stable list from ref, only re-render when player count changes
    const [playerIds, setPlayerIds] = useState<string[]>([]);
    useFrame(() => {
      const ids = Array.from(remoteCharStates.current.keys());
      if (ids.length !== playerIds.length || ids.some((id, i) => id !== playerIds[i])) {
        setPlayerIds(ids);
      }
    });

    return (
      <>
        {playerIds.map(id => {
          const entry = remoteCharStates.current.get(id);
          if (!entry) return null;
          const transcript = remoteTranscriptsRef.current.get(id);
          const showBubble = transcript && Date.now() < transcript.expires;
          return (
            <group key={id}>
              <Character3D seed={entry.seed} stateRef={{ current: entry.state }} />
              {showBubble && (
                <Html
                  position={[entry.state.x, entry.state.y + 0.6, entry.state.z]}
                  center
                  distanceFactor={5}
                  style={{ pointerEvents: 'none' }}
                >
                  <div
                    style={{
                      background: 'rgba(255,255,255,0.92)',
                      color: '#111',
                      borderRadius: 10,
                      padding: '4px 12px',
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: 'bold',
                      maxWidth: 200,
                      textAlign: 'center',
                      wordBreak: 'break-word',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {transcript.text}
                  </div>
                </Html>
              )}
            </group>
          );
        })}
      </>
    );
  }

  // Giant sea monsters — one Character3D per live arena NPC, scaled up.
  // Re-renders only when the roster changes (npcRosterVersion); per-frame
  // motion is driven by mutating npcCharStates in the game loop.
  function SeaMonsters() {
    void npcRosterVersion; // dependency: forces re-render on roster change
    return (
      <>
        {npcsRef.current.map((npc, i) => {
          const cs = npcCharStates.current[i];
          if (!cs) return null;
          return (
            <Character3D
              key={npc.id}
              seed={npc.def.seed}
              stateRef={{ current: cs }}
              scale={npc.def.scale ?? 1}
            />
          );
        })}
      </>
    );
  }

  const isFried = worldCurrent === 'fried';

  const startRaid = () => {
    const player = playerRef.current;
    if (player) {
      player.hp = PLAYER_MAX_HP;
      player.state = 'idle';
      player.deathTimer = 0;
      player.consecutiveGunshots = 0;
      player.iFrames = 0;
    }
    startRun(arenaRef.current, npcsRef.current, npcCharStates.current);
    setNpcRosterVersion(v => v + 1);
    setArenaHud({ active: true, over: false, wave: 1, score: 0, kills: 0 });
    setRaids('on');
  };
  const abandonRaid = () => {
    endRun(arenaRef.current, npcsRef.current, npcCharStates.current);
    setNpcRosterVersion(v => v + 1);
    setArenaHud({ active: false, over: false, wave: 0, score: 0, kills: 0 });
  };

  return (
    <div
      ref={canvasContainerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: isFried ? '#1a4f8a' : '#f7f7f7',
        cursor: 'crosshair',
        overflow: 'hidden',
        // Deep fried aesthetic is fried-world-only.
        filter: isFried ? 'saturate(1.6) contrast(1.15) brightness(1.05)' : 'none',
      }}
    >
      <Canvas
        camera={{ position: [SPAWN_X * WORLD_SCALE, 2, SPAWN_Y * WORLD_SCALE + 3.5], fov: 50 }}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        gl={{ antialias: true, alpha: false }}
      >
        {/* White room — default landing, minimal scene. */}
        {!isFried && (
          <WhiteRoom
            playerRef={playerRef}
            authorId={mpRef.current.myId || 'anon'}
            spawnX={SPAWN_X}
            spawnY={SPAWN_Y}
            activeWallId={graffitiOpen ? graffitiWallId : null}
            onStrokeEnd={wallId => {
              const ws = mpRef.current.ws;
              if (ws) sendSnapshot(ws as unknown as WsLike, wallId, mpRef.current.myId || 'anon');
            }}
          />
        )}

        {/* Scene background — ALWAYS mounted (not gated on isFried) so the
            scene.background gets set in both worlds. Imperative via useThree
            so it bypasses R3F attach= race conditions. */}
        <SceneBackground color={isFried ? '#6a3f55' : '#ffffff'} />
        {!isFried && <fog attach="fog" args={['#ffffff', 40, 340]} />}
        {isFried && (
          <>
            <DystopianFog color="#5a4068" near={60} far={400} />
            <DystopianSky />
          </>
        )}

        {/* Fried world scene — only mount when opted in. */}
        {isFried && (
          <>
            {/* Matrix-style post-FX stack — reads combat.slowMo via timeControl. */}
            <SlomoPostFX />

            {/* Return portal to white room — wall-mounted frame at spawn. */}
            <group
              position={[SPAWN_X * WORLD_SCALE, 1.6, SPAWN_Y * WORLD_SCALE]}
              rotation={[0, Math.PI, 0]}
            >
              <mesh position={[0, 0, -0.02]}>
                <planeGeometry args={[1.8, 3]} />
                <meshBasicMaterial color="#0a0a0a" />
              </mesh>
              <mesh>
                <planeGeometry args={[1.6, 2.8]} />
                <meshBasicMaterial color="#ffffff" toneMapped={false} />
              </mesh>
              <Html
                position={[0, 2, 0]}
                center
                distanceFactor={10}
                style={{ pointerEvents: 'none' }}
              >
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: '#fff',
                    background: 'rgba(0,0,0,0.85)',
                    border: '1px solid #fff',
                    padding: '5px 9px',
                    letterSpacing: '2px',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                  }}
                >
                  [E] RETURN TO WHITE ROOM
                </div>
              </Html>
            </group>

            {/* World geometry root — bounded raycast target for camera
            collision push-in (CameraRig uses this as sceneRootRef). */}
            <group ref={sceneRootRef}>
              <Lighting />
              <AnimatedOcean />
              <TerrainChunks />
              {/* Paintable floor grid overlaid on the terrain — every stroke
                  persists via partykit (surfaceId keyed by tile coords). */}
              <PaintableFloor
                worldId="city"
                tilesX={16}
                tilesZ={16}
                tileSize={CORE_WORLD_SIZE / 16}
                origin={[0, 0, 0]}
                authorId={mpRef.current.myId || 'anon'}
                onStrokeEnd={surfaceId => {
                  const ws = mpRef.current.ws;
                  if (ws)
                    sendSnapshot(ws as unknown as WsLike, surfaceId, mpRef.current.myId || 'anon');
                }}
              />
              <Flora />
              <FallingLeaves targetRef={playerTargetRef} />
              <CrystalBallMountain nounSeed={predictedSeed ?? auctionNounSeed ?? seed} />
              <Gravestones />
              <VenetianBoats />
              <GasStation
                position={[48 * TILE_SIZE * WORLD_SCALE, 0.35, 45 * TILE_SIZE * WORLD_SCALE]}
                rotationY={-0.4}
              />

              {/* Dystopian atmosphere (replaces sunny birds + puffy clouds) */}
              <SmogClouds />
              <Vultures />
              <RainParticles />
              <NeonBillboards />
              <Dolphins />

              {/* Joystick billboard near southeast coast */}
              <Billboard
                position={[25 * TILE_SIZE * WORLD_SCALE, 0.3, 45 * TILE_SIZE * WORLD_SCALE]}
                text="🕹️ NOUN.WTF/WORLD"
                rotation={0.3}
              />

              {/* World objects */}
              <Billboard
                position={[45 * WORLD_SCALE, 0.8, 38 * WORLD_SCALE]}
                text={
                  billboardAds['ad-board-1']?.imageUrl
                    ? `AD: ${billboardAds['ad-board-1'].paidBy.slice(0, 8)}...`
                    : 'probe.wtf'
                }
                url={billboardAds['ad-board-1']?.imageUrl || 'https://probe.wtf'}
              />
              <Billboard
                position={[55 * WORLD_SCALE, 0.8, 42 * WORLD_SCALE]}
                text={
                  billboardAds['ad-board-2']?.imageUrl
                    ? `AD: ${billboardAds['ad-board-2'].paidBy.slice(0, 8)}...`
                    : 'YOUR AD HERE ⌐◧-◧'
                }
                url={billboardAds['ad-board-2']?.imageUrl}
                rotation={0.5}
              />
              <Billboard
                position={[35 * WORLD_SCALE, 0.8, 55 * WORLD_SCALE]}
                text={
                  billboardAds['ad-board-3']?.imageUrl
                    ? `AD: ${billboardAds['ad-board-3'].paidBy.slice(0, 8)}...`
                    : 'pooter.world'
                }
                url={billboardAds['ad-board-3']?.imageUrl || 'https://pooter.world'}
                rotation={-0.3}
              />
              {/* [E] ADVERTISE prompts near ad billboards */}
              {AD_BILLBOARDS.map(board => (
                <Html
                  key={`ad-prompt-${board.id}`}
                  position={[board.worldX * WORLD_SCALE, 0.3, board.worldZ * WORLD_SCALE]}
                  center
                  distanceFactor={6}
                  style={{ pointerEvents: 'none' }}
                >
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '10px',
                      color: '#ffaa00',
                      textShadow: '0 0 4px rgba(0,0,0,0.8)',
                      whiteSpace: 'nowrap',
                      userSelect: 'none',
                      opacity: 0.8,
                    }}
                  >
                    [E] ADVERTISE
                  </div>
                </Html>
              ))}

              <WinnieVan position={[58 * WORLD_SCALE, 0.35, 54 * WORLD_SCALE]} rotation={0.8} />
              <MechanicSign position={[56 * WORLD_SCALE, 0.35, 52 * WORLD_SCALE]} />

              {/* Graffiti walls — powered by @nouns/graffiti */}
              <GraffitiWalls
                activeWallId={graffitiOpen ? graffitiWallId : null}
                authorId={mpRef.current.myId || 'anon'}
                onStrokeEnd={wallId => {
                  const ws = mpRef.current.ws;
                  if (ws)
                    sendSnapshot(ws as unknown as WsLike, wallId, mpRef.current.myId || 'anon');
                }}
              />

              {/* Mega Ramp */}
              <MegaRamp3D />

              {/* NYC Apartment Block (adjacent to mega ramp) */}
              <StaticBatch>
                <NYCApartmentBlock />
              </StaticBatch>

              {/* Burj Khalifa — so tall it disappears into the clouds */}
              <StaticBatch>
                <BurjKhalifa />
              </StaticBatch>

              {/* Caribbean Office (southeast coast) */}
              <StaticBatch>
                <CaribbeanOffice />
              </StaticBatch>

              {/* City block density — street furniture, parked cars, storefronts, dumpsters */}
              <StaticBatch>
                <CityBlock />
              </StaticBatch>

              {/* Distant lofi Terraforms-style skyline at the horizon */}
              <TerraformsHorizon />

              {/* Fortnite-style build mode — hold B, 1-7 pick, Space place */}
              <BuildMode
                inputRef={inputRef}
                playerRef={buildPlayerRef}
                authorId={mpRef.current.myId || 'anon'}
                wsRef={buildWsRef}
                store={buildStoreRef.current}
                onActiveChange={(a, k) => {
                  setBuildHudActive(a);
                  setBuildHudKind(k);
                }}
              />

              {/* Hoverboard Pickup (near mega ramp) */}
              {!hasHoverboard && (
                <HoverboardPickup3D
                  position={[
                    HOVERBOARD_PICKUP_X,
                    getTerrainHeight(HOVERBOARD_PICKUP_X, HOVERBOARD_PICKUP_Z) + 0.3,
                    HOVERBOARD_PICKUP_Z,
                  ]}
                  playerDistance={(() => {
                    const p = playerRef.current;
                    if (!p) return 99;
                    const px = p.x * WORLD_SCALE;
                    const pz = p.y * WORLD_SCALE;
                    return Math.sqrt(
                      (px - HOVERBOARD_PICKUP_X) ** 2 + (pz - HOVERBOARD_PICKUP_Z) ** 2,
                    );
                  })()}
                />
              )}

              {/* Price label floating above hoverboard pickup */}
              {!hasHoverboard && (
                <Html
                  position={[
                    HOVERBOARD_PICKUP_X,
                    getTerrainHeight(HOVERBOARD_PICKUP_X, HOVERBOARD_PICKUP_Z) + 1.8,
                    HOVERBOARD_PICKUP_Z,
                  ]}
                  center
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      color: '#00ffcc',
                      textShadow: '0 0 8px rgba(0,255,204,0.6), 0 2px 4px rgba(0,0,0,0.8)',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                    }}
                  >
                    0.01 ETH
                    <div style={{ fontSize: '10px', color: '#aaa', marginTop: 2 }}>
                      [E] to interact
                    </div>
                  </div>
                </Html>
              )}

              {/* Treasure Chest */}
              <TreasureChest3D
                position={[
                  chestWorldX,
                  getTerrainHeight(chestWorldX, chestWorldZ) + 0.1,
                  chestWorldZ,
                ]}
                pendingCount={0}
                onInteract={() => setDepositOpen(true)}
                playerDistance={99}
              />

              {/* Dropped items from last drop party */}
              {droppedItems
                .filter(d => !d.claimed)
                .map(item => (
                  <DroppedItem3D
                    key={item.dropId}
                    position={[
                      item.worldX * WORLD_SCALE,
                      getTerrainHeight(item.worldX * WORLD_SCALE, item.worldY * WORLD_SCALE) + 0.1,
                      item.worldY * WORLD_SCALE,
                    ]}
                    itemType={item.itemType}
                    claimed={item.claimed}
                  />
                ))}
            </group>
          </>
        )}

        {/* Paint cans + weapon pickups — rendered in BOTH worlds so
            they're accessible from the white-room too. State is global
            (getActivePaintCans / getActivePickups). */}
        {paintCans
          .filter(c => !c.picked)
          .map(can => (
            <PaintCanPickup3D
              key={can.id}
              position={[
                can.worldX * WORLD_SCALE,
                (isFried
                  ? getTerrainHeight(can.worldX * WORLD_SCALE, can.worldY * WORLD_SCALE)
                  : 0) + 0.3,
                can.worldY * WORLD_SCALE,
              ]}
              color={can.color}
            />
          ))}
        {weaponPickups
          .filter(p => !p.picked)
          .map(pickup => (
            <WeaponPickup3D
              key={pickup.id}
              position={[
                pickup.worldX * WORLD_SCALE,
                (isFried
                  ? getTerrainHeight(pickup.worldX * WORLD_SCALE, pickup.worldY * WORLD_SCALE)
                  : 0) + 0.2,
                pickup.worldY * WORLD_SCALE,
              ]}
              type={pickup.type}
              picked={pickup.picked}
            />
          ))}

        {/* Shared systems — mounted in both worlds so state (player pos,
            multiplayer connection, camera follow, combat loop) survives
            the white ↔ fried world swap. */}
        <Character3D seed={seed} stateRef={playerCharState} />
        <RemotePlayers />
        <SeaMonsters />

        {/* Invisible follow target — kept in sync with playerTargetRef
            each tick so CameraRig can read its Object3D.position. */}
        <object3D ref={cameraTargetObjRef} />
        <CameraRig
          target={cameraTargetObjRef}
          inputRef={inputRef}
          playerCharState={playerCharState}
          combatRef={combatRef}
          sceneRootRef={sceneRootRef}
        />
        <GameLogic />
        <DevHooks />
      </Canvas>

      {/* Deep fried grain overlay — fried world only */}
      {isFried && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 5,
            background:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
            opacity: 0.04,
            mixBlendMode: 'overlay',
          }}
        />
      )}

      {/* White → Fried transition overlay (CSS white flash + grain fade) */}
      <TransitionOverlay />

      {/* First-mount Matrix suck/zoom cinematic entry */}
      <GlitchEntry />

      <HUDLive hudRef={hudRef} />

      {/* Fries logo — same pixel art as homepage navbar */}
      <div
        style={{
          position: 'fixed',
          top: 14,
          left: 16,
          zIndex: 20,
          transform: 'scale(1.5)',
          transformOrigin: 'top left',
        }}
      >
        <LolLogo />
      </div>

      {/* FEATURE 1: "NOUNS WORLD" cloud text intro — only in fried world */}
      {isFried && introPhase !== 'done' && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: 50,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '25vh',
            opacity: introOpacity,
            transition: 'none',
          }}
        >
          <div
            style={{
              fontFamily: "'Comic Sans MS', 'Comic Sans', cursive",
              fontWeight: 'bold',
              fontSize: '120px',
              color: '#fff',
              textShadow: [
                '0 0 20px rgba(255,255,255,0.9)',
                '4px 4px 8px rgba(220,220,220,0.8)',
                '-4px -4px 8px rgba(220,220,220,0.8)',
                '4px -4px 8px rgba(240,240,240,0.7)',
                '-4px 4px 8px rgba(240,240,240,0.7)',
                '0 6px 15px rgba(200,200,200,0.6)',
                '0 -6px 15px rgba(200,200,200,0.6)',
                '6px 0 15px rgba(200,200,200,0.6)',
                '-6px 0 15px rgba(200,200,200,0.6)',
                '0 0 40px rgba(255,255,255,0.5)',
                '0 0 80px rgba(255,255,255,0.3)',
              ].join(', '),
              letterSpacing: '12px',
              userSelect: 'none',
              textAlign: 'center',
              lineHeight: 1,
            }}
          >
            FRIED
            <br />
            WORLD
          </div>
        </div>
      )}

      {/* FEATURE 3: Wanted level stars */}
      {wantedLevel > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 38,
            right: 16,
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#ffdd00',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
            zIndex: 15,
            letterSpacing: '2px',
          }}
        >
          {'★'.repeat(wantedLevel)}
          {'☆'.repeat(5 - wantedLevel)}
          {wantedLevel >= 3 && (
            <span
              style={{
                display: 'block',
                fontSize: '10px',
                color: '#ff4444',
                letterSpacing: '1px',
                marginTop: '2px',
              }}
            >
              WANTED
            </span>
          )}
        </div>
      )}

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />

      {/* Live movement-feel tuner — backslash (\) to toggle. */}
      <MovementTuningPanel />

      {/* ── Raid: giant monster survival run — fried island only, opt-in ── */}
      {isFried && arenaHud.active && !arenaHud.over && (
        <div
          style={{
            position: 'fixed',
            top: 44,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontWeight: 700,
            fontSize: 14,
            color: '#fff',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            background: 'rgba(8,8,12,0.55)',
            border: '1px solid rgba(255,61,240,0.4)',
            borderRadius: 8,
            padding: '6px 10px 6px 16px',
          }}
        >
          <span style={{ color: '#ff3df0' }}>WAVE {arenaHud.wave}</span>
          <span>SCORE {arenaHud.score}</span>
          <span style={{ opacity: 0.8 }}>KILLS {arenaHud.kills}</span>
          <button
            type="button"
            onClick={abandonRaid}
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: 1,
              color: '#fff',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 6,
              padding: '3px 8px',
            }}
          >
            ABANDON
          </button>
        </div>
      )}

      {isFried && !arenaHud.active && (raidPref === 'ask' || arenaHud.over) && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            zIndex: 30,
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'ui-monospace, Menlo, monospace',
            color: '#fff',
            textAlign: 'center',
            background: 'rgba(8,8,12,0.82)',
            border: '1px solid rgba(255,61,240,0.45)',
            borderRadius: 12,
            padding: '20px 28px',
            boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          }}
        >
          {arenaHud.over ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#ff3df0' }}>RUN OVER</div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>
                Reached wave {arenaHud.wave} · {arenaHud.kills} monsters slain
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>SCORE {arenaHud.score}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#ff3df0' }}>RAID</div>
              <div style={{ fontSize: 12, opacity: 0.8, maxWidth: 260 }}>
                Giant monsters rise from the deep and march on you. Survive the waves — or skip it
                and just explore the island.
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={startRaid}
              style={{
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: 1,
                color: '#000',
                background: '#ff3df0',
                border: 'none',
                borderRadius: 8,
                padding: '8px 22px',
              }}
            >
              {arenaHud.over ? 'RAID AGAIN' : 'START RAID'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRaids('off');
                if (arenaHud.over) abandonRaid();
              }}
              style={{
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: 1,
                color: '#fff',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 8,
                padding: '8px 18px',
              }}
            >
              {arenaHud.over ? 'EXPLORE' : 'JUST EXPLORE'}
            </button>
          </div>
          {!arenaHud.over && (
            <div style={{ fontSize: 10, opacity: 0.55 }}>
              Change your mind any time via the ⚔ pill.
            </div>
          )}
        </div>
      )}

      {isFried && !arenaHud.active && !arenaHud.over && raidPref !== 'ask' && (
        <div
          style={{
            position: 'fixed',
            top: 44,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          {raidPref === 'on' ? (
            <>
              <button
                type="button"
                onClick={startRaid}
                style={{
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 800,
                  fontSize: 11,
                  letterSpacing: 1,
                  color: '#000',
                  background: '#ff3df0',
                  border: 'none',
                  borderRadius: 999,
                  padding: '5px 12px',
                }}
              >
                ⚔ START RAID
              </button>
              <button
                type="button"
                onClick={() => setRaids('off')}
                title="Turn raids off"
                style={{
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: '#fff',
                  background: 'rgba(8,8,12,0.55)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: 999,
                  width: 24,
                  height: 24,
                  lineHeight: '20px',
                  padding: 0,
                }}
              >
                ×
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setRaids('on')}
              title="Raids are off — click to enable"
              style={{
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 10,
                letterSpacing: 1,
                color: 'rgba(255,255,255,0.6)',
                background: 'rgba(8,8,12,0.45)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 999,
                padding: '4px 10px',
              }}
            >
              ⚔ raids off
            </button>
          )}
        </div>
      )}

      {/* Hoverboard purchase modal */}
      <HoverboardPurchaseModal
        open={hoverboardModalOpen}
        onClose={() => setHoverboardModalOpen(false)}
        onPurchased={() => {
          setHasHoverboard(true);
          setHoverboardModalOpen(false);
          mountBoard(skateRef.current);
        }}
        isFree={isOwnerWallet}
      />

      {/* Billboard ad purchase modal */}
      <BillboardAdModal
        open={billboardAdOpen}
        boardId={billboardAdBoardId}
        onClose={() => setBillboardAdOpen(false)}
        onPurchased={(boardId, ad) => {
          setBillboardAds(prev => ({ ...prev, [boardId]: ad }));
          setBillboardAdOpen(false);
        }}
      />

      {/* Hoverboard hint */}
      {skateRef.current.isSkating && (
        <div
          style={{
            position: 'fixed',
            bottom: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'monospace',
            fontSize: 11,
            color: '#666',
            pointerEvents: 'none',
            zIndex: 15,
          }}
        >
          [V] DISMOUNT · [R] BOOST
        </div>
      )}
      {false && (
        <>
          {/* Dead skating HUD — kept for reference */}
          <div
            style={{
              position: 'fixed',
              top: 80,
              left: 16,
              fontFamily: 'monospace',
              fontSize: '14px',
              color: '#00ffcc',
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
              zIndex: 15,
            }}
          >
            <div style={{ fontSize: 11, color: '#888', letterSpacing: 1 }}>TRICK SCORE</div>
            <div style={{ fontSize: 22, fontWeight: 'bold' }}>
              {skateRef.current.trickScore.toLocaleString()}
            </div>
          </div>

          {/* K/D Ratio (below trick score) */}
          {connectedWallet && (
            <div
              style={{
                position: 'fixed',
                top: 60,
                right: 16,
                fontFamily: 'monospace',
                fontSize: '12px',
                color: '#aaa',
                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                pointerEvents: 'none',
                zIndex: 15,
              }}
            >
              <span style={{ color: '#4caf50' }}>{kdStats.kills}</span>
              <span style={{ color: '#666' }}> / </span>
              <span style={{ color: '#f44336' }}>{kdStats.deaths}</span>
              <span style={{ color: '#555', marginLeft: 4, fontSize: 10 }}>K/D</span>
            </div>
          )}

          {/* Current trick / combo display (center-top) */}
          {skateRef.current.currentTrick && (
            <div
              style={{
                position: 'fixed',
                top: '18%',
                left: '50%',
                transform: 'translateX(-50%)',
                fontFamily: 'monospace',
                fontSize: skateRef.current.comboMultiplier >= 3 ? '28px' : '20px',
                fontWeight: 'bold',
                color:
                  skateRef.current.comboMultiplier >= 5
                    ? '#ff4444'
                    : skateRef.current.comboMultiplier >= 3
                      ? '#ffaa00'
                      : '#00ffcc',
                textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                pointerEvents: 'none',
                zIndex: 15,
                textAlign: 'center',
                letterSpacing: 2,
                transition: 'font-size 0.15s',
              }}
            >
              {skateRef.current.currentTrick}
              {skateRef.current.comboMultiplier > 1 && skateRef.current.comboScore > 0 && (
                <div style={{ fontSize: 13, color: '#aaa', marginTop: 4 }}>
                  {skateRef.current.comboScore} x {skateRef.current.comboMultiplier}
                </div>
              )}
            </div>
          )}

          {/* Balance meter (during grind/manual) */}
          {(skateRef.current.grindActive || skateRef.current.manualActive) && (
            <div
              style={{
                position: 'fixed',
                bottom: 120,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 200,
                height: 12,
                background: 'rgba(0,0,0,0.6)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 6,
                overflow: 'hidden',
                pointerEvents: 'none',
                zIndex: 15,
              }}
            >
              {/* Balance indicator */}
              <div
                style={{
                  position: 'absolute',
                  top: 1,
                  left: `${50 + skateRef.current.balanceMeter * 48}%`,
                  width: 4,
                  height: 10,
                  background: Math.abs(skateRef.current.balanceMeter) > 0.7 ? '#ff4444' : '#00ffcc',
                  borderRadius: 2,
                  transition: 'left 0.05s',
                }}
              />
              {/* Center mark */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  width: 1,
                  height: 12,
                  background: 'rgba(255,255,255,0.4)',
                }}
              />
            </div>
          )}

          {/* Speed indicator */}
          <div
            style={{
              position: 'fixed',
              bottom: 100,
              left: 16,
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#888',
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
              zIndex: 15,
            }}
          >
            SPEED {(skateRef.current.speed * 10).toFixed(0)} MPH
          </div>

          {/* "S to dismount" hint */}
          <div
            style={{
              position: 'fixed',
              bottom: 60,
              left: '50%',
              transform: 'translateX(-50%)',
              fontFamily: 'monospace',
              fontSize: '11px',
              color: '#666',
              pointerEvents: 'none',
              zIndex: 15,
            }}
          >
            [V] dismount
          </div>

          {/* Tricks reference panel (right side) */}
          <div
            style={{
              position: 'fixed',
              top: 80,
              right: 16,
              fontFamily: 'monospace',
              fontSize: '10px',
              color: '#ccc',
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
              zIndex: 15,
              background: 'rgba(0,0,0,0.5)',
              borderRadius: 8,
              padding: '10px 14px',
              border: '1px solid rgba(0,255,204,0.2)',
              lineHeight: 1.8,
              minWidth: 180,
            }}
          >
            <div
              style={{
                color: '#00ffcc',
                fontWeight: 'bold',
                fontSize: 12,
                marginBottom: 6,
                letterSpacing: 1,
              }}
            >
              🃏 TRICKS
            </div>
            <div>
              <span style={{ color: '#00ffcc' }}>SPACE</span> — Ollie
            </div>
            <div>
              <span style={{ color: '#00ffcc' }}>SPACE+←</span> — Kickflip
            </div>
            <div>
              <span style={{ color: '#00ffcc' }}>SPACE+→</span> — Heelflip
            </div>
            <div>
              <span style={{ color: '#00ffcc' }}>SPACE+↑</span> — Hardflip
            </div>
            <div>
              <span style={{ color: '#00ffcc' }}>SPACE+↓</span> — Pop Shove-it
            </div>
            <div>
              <span style={{ color: '#ffaa00' }}>J</span> — 180 Spin
            </div>
            <div>
              <span style={{ color: '#ffaa00' }}>K</span> — Kickflip
            </div>
            <div>
              <span style={{ color: '#ff4444' }}>G</span> — Grind (near rail)
            </div>
            <div
              style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 4 }}
            >
              <div>
                <span style={{ color: '#8888ff' }}>SHIFT</span> — Pump/Crouch
              </div>
              <div>
                <span style={{ color: '#8888ff' }}>←/→</span> — Balance (grind)
              </div>
              <div
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  paddingTop: 4,
                  marginTop: 4,
                }}
              >
                <span style={{ color: '#ff88ff' }}>L</span> — Method Air
              </div>
              <div>
                <span style={{ color: '#ff88ff' }}>L+←</span> — Melon Grab
              </div>
              <div>
                <span style={{ color: '#ff88ff' }}>L+→</span> — Indy Grab
              </div>
              <div>
                <span style={{ color: '#ff88ff' }}>L+↑</span> — Nose Grab
              </div>
              <div>
                <span style={{ color: '#ff88ff' }}>L+↓</span> — Tail Grab
              </div>
              <div
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  paddingTop: 4,
                  marginTop: 4,
                }}
              >
                <span style={{ color: '#888' }}>V</span> — Dismount
              </div>
            </div>
          </div>
        </>
      )}

      {/* Weapon crosshair — only visible when armed with a *gun* (not the
          spray can), tints red on lock-on. */}
      <Crosshair
        slot={aimSlotRef.current}
        visible={
          !!weaponRef.current.equipped &&
          !WEAPON_DEFS[weaponRef.current.equipped].isPaintTool &&
          !graffitiOpen
        }
      />

      {/* Build-mode HUD — piece name + hotkeys hint */}
      <BuildHud active={buildHudActive} kind={buildHudKind} />

      {/* Graffiti paint HUD — powered by @nouns/graffiti */}
      <PaintHUD
        open={graffitiOpen && !!graffitiWallId}
        onClose={() => {
          setGraffitiOpen(false);
          setGraffitiWallId(null);
        }}
        position="right"
      />

      {/* Paint can HUD indicator */}
      {paintRef.current.hasPaint && !graffitiOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'monospace',
            fontSize: '13px',
            color: paintRef.current.color,
            textShadow: '0 0 8px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
            zIndex: 20,
            letterSpacing: '1px',
          }}
        >
          SPRAY CAN EQUIPPED — FIND A WALL AND PRESS [G] OR [F]
        </div>
      )}

      {/* VOIP Debug Overlay (press ` to toggle) */}
      {showVoipDebug && (
        <div
          style={{
            position: 'fixed',
            bottom: 80,
            left: 16,
            background: 'rgba(0,0,0,0.85)',
            color: '#0f0',
            fontFamily: 'monospace',
            fontSize: 11,
            padding: '8px 12px',
            borderRadius: 8,
            zIndex: 30,
            maxWidth: 400,
            whiteSpace: 'pre',
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: '#ff0', marginBottom: 4 }}>VOIP DEBUG (press ` to hide)</div>
          {voipDebugLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {/* Mobile camera orbit zone — mid-right vertical strip, drag to
          orbit the rig. Auto-hides on non-touch devices. */}
      <CameraTouchZone inputRef={inputRef} />

      {/* Mobile virtual controls */}
      {isTouchDevice() && (
        <MobileControls
          inputRef={inputRef}
          onJump={() => {
            const p = playerRef.current;
            if (p && p.jumpCount < 3) {
              p.airborneVy = -0.15;
              p.jumpCount++;
              p.state = 'airborne';
            }
          }}
          onWeaponCycle={() => {
            const next = cycleWeapon(weaponRef.current);
            if (!next) return null;
            return next === 'spray_can' ? '🎨' : '🔫';
          }}
          weaponLabel={
            weaponRef.current.equipped === 'spray_can'
              ? '🎨'
              : weaponRef.current.equipped
                ? '🔫'
                : '🔄'
          }
        />
      )}
    </div>
  );
}
