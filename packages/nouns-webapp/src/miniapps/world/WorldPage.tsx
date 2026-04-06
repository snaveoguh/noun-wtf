// ── Nouns World — Immersive 3D PvP Fighting Arena ────────────────────
//
// Three.js R3F scene with third-person RPG camera, animated Noun
// sprites on billboarded quads, 3D island terrain, day/night cycle,
// and the full combat + multiplayer system from the engine.

import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useAppSelector } from '@/hooks';
import { GameHUD } from './engine/GameHUD';

import { SEND_INTERVAL, TILE_SIZE, MAP_SIZE, PLAYER_MAX_HP, DIRECTION_ROTATION, DIRECTION_FACING_ANGLE } from './engine/types';
import type { Player, Direction, PlayerState } from './engine/types';
import {
  createInputState,
  attachInputListeners,
  resolveIntendedMove,
  clearFrameFlags,
  type InputState,
} from './engine/input';
import { SPAWN_X, SPAWN_Y, ISLAND_MAP } from './engine/tilemap';
import { Tile } from './engine/types';
import { seedToKey, randomSeed } from './engine/sprites';
import { isInDeepWater } from './engine/physics';
import {
  createPlayer,
  createCombatState,
  executeMove,
  tickPlayer,
} from './engine/combat';
import {
  updateParticles,
  updateFloatingTexts,
  updateForcePushes,
  updateScreenShake,
  updateSlowMo,
} from './engine/particles';
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
import {
  buildNounGeometries,
  seedToLayers,
  type LayerVisibility as VoxelLayerVis,
} from '@nouns/voxel-engine';
import { ImageData, getNounData } from '@noundry/nouns-assets';
// Spritesheet compositor available for future use
// import { composeSpritesheet, getFrame, extractFrameCanvas } from './engine/spritesheet';
import {
  createNPCs,
  type NPC,
} from './engine/npcs';
// NPC combat imports — disabled until NPCs re-enabled
// import { MOVE_DEFS, resolveDamage } from './engine/moves';
// import { spawnHitSparks, spawnDamageText, spawnDeathExplosion, createScreenShake, createSlowMo } from './engine/particles';
import { Character3D, type CharacterState } from './engine/Character3D';
import { TreasureChest3D, DroppedItem3D } from './engine/TreasureChest3D';
import { DepositModal } from './wager/DepositModal';
import { useClaimDrop } from './wager/treasureChest';
import { getActiveDrops, getNearbyDrop, markClaimed, type DroppedItem } from './engine/drops';
import { getAuctionState } from './engine/settlement';
import {
  playPunchSound, playKickSound, playHeadbuttSound, playGunshot,
  playShotgunSound, playDeathSound, playPickupSound,
  playComboSound, playJumpSound, playBlockSound,
} from './engine/sounds';
import {
  createWeaponState, checkWeaponPickup, fireWeapon, tickReload, tickMuzzleFlash,
  spawnWeaponPickup, getActivePickups, type WeaponState, type WeaponPickup,
} from './engine/weapons';
import { WeaponPickup3D } from './engine/WeaponPickup3D';
import { BirdFlocks, CloudLayer, AnimatedOcean, Dolphins } from './engine/Atmosphere';
import { Billboard, WinnieVan, MechanicSign } from './engine/WorldObjects';
import { MegaRamp3D } from './engine/MegaRamp3D';
import {
  createVoipState,
  initVoip,
  checkVoiceActivity,
  updateCrowdSettle,
  toggleMute,
  callPeer,
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
import type { INounSeed } from '@/wrappers/nounToken';

// ── Constants ─────────────────────────────────────────────────────────

const WORLD_SCALE = 0.1; // Scale world coords to Three.js units
const TERRAIN_SIZE = MAP_SIZE * TILE_SIZE * WORLD_SCALE;
// Camera params in CameraController

// ── Tile colors for terrain texture ───────────────────────────────────

function tileColor(tile: Tile): [number, number, number] {
  switch (tile) {
    case Tile.DeepWater: return [26, 79, 138];
    case Tile.Water: return [59, 125, 216];
    case Tile.Sand: return [232, 213, 163];
    case Tile.Grass: return [90, 143, 60];
    case Tile.Tree: return [45, 107, 30];
    case Tile.Flower: return [100, 153, 70];
    case Tile.Path: return [196, 165, 110];
    case Tile.Rock: return [136, 136, 136];
    case Tile.Spawn: return [106, 168, 79];
    case Tile.Arena: return [139, 105, 20];
    default: return [26, 79, 138];
  }
}

// ── Generate terrain texture from tilemap ─────────────────────────────

function generateTerrainTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(MAP_SIZE, MAP_SIZE);

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const tile = ISLAND_MAP[y]?.[x] ?? Tile.DeepWater;
      const [r, g, b] = tileColor(tile);
      const i = (y * MAP_SIZE + x) * 4;
      imageData.data[i] = r;
      imageData.data[i + 1] = g;
      imageData.data[i + 2] = b;
      imageData.data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

// ── Generate heightmap from tilemap ───────────────────────────────────

function generateHeightmap(): Float32Array {
  const heights = new Float32Array((MAP_SIZE + 1) * (MAP_SIZE + 1));
  for (let y = 0; y <= MAP_SIZE; y++) {
    for (let x = 0; x <= MAP_SIZE; x++) {
      const tile = ISLAND_MAP[Math.min(y, MAP_SIZE - 1)]?.[Math.min(x, MAP_SIZE - 1)] ?? Tile.DeepWater;
      let h = 0;
      if (tile === Tile.DeepWater) h = -2;
      else if (tile === Tile.Water) h = -1;
      else if (tile === Tile.Sand) h = 0.2;
      else if (tile === Tile.Grass || tile === Tile.Flower || tile === Tile.Spawn) h = 0.5;
      else if (tile === Tile.Path) h = 0.4;
      else if (tile === Tile.Tree) h = 0.6;
      else if (tile === Tile.Rock) h = 0.8;
      else if (tile === Tile.Arena) h = 0.5;
      heights[y * (MAP_SIZE + 1) + x] = h;
    }
  }
  return heights;
}

// ── Terrain height sampling ───────────────────────────────────────────

const HEIGHT_SCALE = WORLD_SCALE * 8;

/** Get terrain height in Three.js Y at a given world X/Z position */
function getTerrainHeight(worldX: number, worldZ: number): number {
  // Convert Three.js world coords back to tile coords
  const tx = Math.floor(worldX / (TILE_SIZE * WORLD_SCALE));
  const tz = Math.floor(worldZ / (TILE_SIZE * WORLD_SCALE));
  if (tx < 0 || tx >= MAP_SIZE || tz < 0 || tz >= MAP_SIZE) return -2 * HEIGHT_SCALE;
  const tile = ISLAND_MAP[tz]?.[tx] ?? Tile.DeepWater;
  let h = 0;
  if (tile === Tile.DeepWater) h = -2;
  else if (tile === Tile.Water) h = -1;
  else if (tile === Tile.Sand) h = 0.2;
  else if (tile === Tile.Grass || tile === Tile.Flower || tile === Tile.Spawn) h = 0.5;
  else if (tile === Tile.Path) h = 0.4;
  else if (tile === Tile.Tree) h = 0.6;
  else if (tile === Tile.Rock) h = 0.8;
  else if (tile === Tile.Arena) h = 0.5;
  return h * HEIGHT_SCALE;
}

// ── Terrain Component ─────────────────────────────────────────────────

function Terrain() {
  const texture = useMemo(() => generateTerrainTexture(), []);
  const heightmap = useMemo(() => generateHeightmap(), []);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      MAP_SIZE,
      MAP_SIZE,
    );
    // Apply heightmap
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, heightmap[i] * WORLD_SCALE * 8);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [heightmap]);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[TERRAIN_SIZE / 2, 0, TERRAIN_SIZE / 2]}>
      <meshStandardMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Trees (3D cylinders + spheres on Tree tiles) ──────────────────────

function Trees() {
  const treePositions = useMemo(() => {
    const positions: [number, number][] = [];
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        if (ISLAND_MAP[y]?.[x] === Tile.Tree) {
          positions.push([
            (x + 0.5) * TILE_SIZE * WORLD_SCALE,
            (y + 0.5) * TILE_SIZE * WORLD_SCALE,
          ]);
        }
      }
    }
    return positions;
  }, []);

  return (
    <group>
      {treePositions.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          {/* Trunk */}
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.08, 0.12, 1.2, 6]} />
            <meshStandardMaterial color="#6b4226" />
          </mesh>
          {/* Canopy */}
          <mesh position={[0, 1.4, 0]}>
            <sphereGeometry args={[0.5, 8, 6]} />
            <meshStandardMaterial color="#2d6b1e" />
          </mesh>
          <mesh position={[0.15, 1.6, 0.1]}>
            <sphereGeometry args={[0.35, 6, 5]} />
            <meshStandardMaterial color="#1e5214" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ── Rocks ─────────────────────────────────────────────────────────────

function Rocks() {
  const rockPositions = useMemo(() => {
    const positions: [number, number][] = [];
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        if (ISLAND_MAP[y]?.[x] === Tile.Rock) {
          positions.push([
            (x + 0.5) * TILE_SIZE * WORLD_SCALE,
            (y + 0.5) * TILE_SIZE * WORLD_SCALE,
          ]);
        }
      }
    }
    return positions;
  }, []);

  return (
    <group>
      {rockPositions.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.2, z]}>
          <dodecahedronGeometry args={[0.3, 0]} />
          <meshStandardMaterial color="#888" roughness={0.9} />
        </mesh>
      ))}
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

function SmokeParticles({ count, radius, height, baseY }: { count: number; radius: number; height: number; baseY: number }) {
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

function LavaCracks({ baseRadius, height, segments }: { baseRadius: number; height: number; segments: number }) {
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
  const ballGroupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.PointLight>(null);

  // Build the voxel Noun inside the ball
  const { bodyGeo, blingGeo, headGeo, glassesGeo } = useMemo(() => {
    try {
      const layers = seedToLayers(nounSeed, getNounData, ImageData.palette, DEFAULT_VIS);
      return buildNounGeometries(layers);
    } catch {
      return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
    }
  }, [nounSeed]);

  const eyeY = MOUNTAIN_HEIGHT + BALL_RADIUS + 0.5;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ballGroupRef.current) {
      ballGroupRef.current.rotation.y = t * 0.4;
      ballGroupRef.current.position.y = eyeY + Math.sin(t * 0.8) * 0.1;
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
      <pointLight ref={pulseRef} position={[0, eyeY, 0]} color="#ff3300" intensity={3} distance={15} />
      {/* Secondary ambient glow — red/orange uplighting */}
      <pointLight position={[0, MOUNTAIN_HEIGHT * 0.3, 0]} color="#ff2200" intensity={1.5} distance={8} />

      {/* Swirling smoke particles */}
      <SmokeParticles count={60} radius={1.8} height={MOUNTAIN_HEIGHT * 1.2} baseY={MOUNTAIN_HEIGHT * 0.3} />

      {/* Rotating voxel Noun inside the fiery ring */}
      <group ref={ballGroupRef} position={[0, eyeY, 0]} scale={[0.05, 0.05, 0.05]}>
        {bodyGeo && <mesh geometry={bodyGeo}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>}
        {blingGeo && <mesh geometry={blingGeo}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>}
        {headGeo && <mesh geometry={headGeo}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>}
        {glassesGeo && <mesh geometry={glassesGeo}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>}
      </group>
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
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[TERRAIN_SIZE / 2, -0.15, TERRAIN_SIZE / 2]}>
      <planeGeometry args={[TERRAIN_SIZE * 1.5, TERRAIN_SIZE * 1.5]} />
      <meshStandardMaterial color="#3377cc" transparent opacity={0.8} side={THREE.DoubleSide} />
    </mesh>
  );
}

const DEFAULT_VIS: VoxelLayerVis = { body: true, accessory: true, head: true, glasses: true };

// ── Third-Person Camera — arrow keys orbit, always behind player ──────

function CameraController({ target, inputRef, playerCharState }: {
  target: THREE.Vector3;
  inputRef: React.RefObject<InputState>;
  playerCharState: React.RefObject<CharacterState>;
}) {
  const { camera } = useThree();
  const orbitX = useRef(0);
  const orbitY = useRef(0.3);

  useFrame((_, delta) => {
    const input = inputRef.current;
    const pcs = playerCharState.current;

    // Arrow keys pan camera when idle
    if (input) {
      const panSpeed = 1.5;
      if (input.keys.has('arrowleft')) orbitX.current -= panSpeed * delta;
      if (input.keys.has('arrowright')) orbitX.current += panSpeed * delta;
      if (input.keys.has('arrowup')) orbitY.current = Math.min(orbitY.current + panSpeed * delta * 0.5, 1.2);
      if (input.keys.has('arrowdown')) orbitY.current = Math.max(orbitY.current - panSpeed * delta * 0.5, 0.05);
    }

    // When walking — instant snap camera behind player
    if (pcs && (pcs.state === 'walking' || pcs.state === 'dashing')) {
      const behindAngle =
        pcs.direction === 'up' ? 0 :
        pcs.direction === 'down' ? Math.PI :
        pcs.direction === 'left' ? Math.PI * 0.5 :
        pcs.direction === 'right' ? Math.PI * 1.5 :
        pcs.direction === 'up-left' ? Math.PI * 0.25 :
        pcs.direction === 'up-right' ? Math.PI * 1.75 :
        pcs.direction === 'down-left' ? Math.PI * 0.75 :
        Math.PI * 1.25;
      orbitX.current = behindAngle;
    }

    const camDist = 3.5;
    const desired = new THREE.Vector3(
      target.x + Math.sin(orbitX.current) * Math.cos(orbitY.current) * camDist,
      target.y + Math.sin(orbitY.current) * camDist + 0.5,
      target.z + Math.cos(orbitX.current) * Math.cos(orbitY.current) * camDist,
    );

    camera.position.copy(desired);
    camera.lookAt(target.x, target.y + 0.5, target.z);
  });

  return null;
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
      <ambientLight ref={ambientRef} intensity={0.6} />
      <directionalLight
        ref={dirLightRef}
        position={[20, 30, 10]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <hemisphereLight args={['#87ceeb', '#5a8f3c', 0.3]} />
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
  controlsVisible: _controlsVisible,
  oceanPhase: _oceanPhase,
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
      <div style={{
        position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
        width: 200, height: 14, background: 'rgba(0,0,0,0.5)', borderRadius: 4,
      }}>
        <div style={{
          width: `${(hp / maxHp) * 100}%`, height: '100%', borderRadius: 4,
          background: hp / maxHp > 0.5 ? '#4a4' : hp / maxHp > 0.25 ? '#ca4' : '#c44',
          transition: 'width 0.1s',
        }} />
        <span style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#fff', fontSize: 10, fontFamily: 'monospace',
        }}>
          {hp} / {maxHp}
        </span>
      </div>

      {/* Player count */}
      <div style={{
        position: 'absolute', top: 16, right: 16, color: '#fff', fontFamily: 'monospace',
        fontSize: 12, textShadow: '0 1px 3px rgba(0,0,0,0.8)',
      }}>
        {playerCount} online
      </div>

      {/* Combo */}
      {comboHits >= 2 && (
        <div style={{
          position: 'absolute', right: 20, top: '40%', color: '#ffdd00',
          fontFamily: 'monospace', fontWeight: 'bold', textAlign: 'right',
          fontSize: 20 + Math.min(comboHits, 10) * 3,
          textShadow: '0 2px 6px rgba(0,0,0,0.8)',
        }}>
          {comboHits}x<br />
          <span style={{ fontSize: 14, color: '#ffaa00' }}>COMBO</span>
        </div>
      )}

      {/* Controls — always visible */}
      <div style={{
        position: 'absolute', bottom: 55, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 4, fontFamily: 'monospace', fontSize: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 600,
      }}>
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
          <div key={key} style={{
            background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '2px 5px',
            border: `1px solid ${color}40`, textAlign: 'center', minWidth: 44,
          }}>
            <div style={{ color, fontWeight: 'bold', fontSize: 11 }}>{key}</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 8 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Movement hint */}
      <div style={{
        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
        color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', fontSize: 10,
        textShadow: '0 1px 2px rgba(0,0,0,0.8)', textAlign: 'center',
      }}>
        WASD move &middot; F fire &middot; E interact &middot; M mic &middot; ESC exit
      </div>

      {/* Ocean death overlay */}
      {oceanAlpha > 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `rgba(0,0,0,${oceanAlpha})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column',
        }}>
          {majaAlpha > 0 && (
            <>
              <div style={{
                color: '#fff', fontSize: 64, fontFamily: 'serif', fontWeight: 'bold',
                opacity: majaAlpha,
              }}>
                Gran Maja
              </div>
              <div style={{
                color: 'rgba(255,255,255,0.7)', fontSize: 24, fontFamily: 'serif',
                opacity: majaAlpha, marginTop: 8,
              }}>
                swallowed you whole
              </div>
            </>
          )}
        </div>
      )}

      {/* Respawn */}
      {isDead && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexDirection: 'column',
        }}>
          <div style={{
            color: '#fff', fontSize: 48, fontFamily: 'monospace', fontWeight: 'bold',
            textShadow: '0 2px 8px rgba(0,0,0,0.8)',
          }}>
            {Math.ceil(respawnTimer / 60)}
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.7)', fontSize: 18, fontFamily: 'monospace',
          }}>
            RESPAWNING
          </div>
        </div>
      )}

      {/* Weapon ammo (bottom right) */}
      {(weaponEquipped as any) && (
        <div style={{
          position: 'absolute', bottom: 35, right: 16,
          background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '6px 12px',
          fontFamily: 'monospace', color: '#fff', fontSize: 13,
          border: '1px solid rgba(255,255,255,0.2)',
        }}>
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
        <div style={{
          position: 'absolute', top: '25%', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255,255,255,0.9)', color: '#111', borderRadius: 12,
          padding: '6px 14px', fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold',
          maxWidth: 280, textAlign: 'center', wordBreak: 'break-word',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}>
          {transcript}
          {/* Speech bubble tail */}
          <div style={{
            position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
            borderTop: '8px solid rgba(255,255,255,0.9)',
          }} />
        </div>
      )}

      {/* ── VOIP UI ─────────────────────────────────────────── */}

      {/* Mic indicator (top left) */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: !micEnabled ? 'rgba(100,100,100,0.5)'
            : isMuted ? 'rgba(255,50,50,0.6)'
            : isSpeaking ? 'rgba(50,255,50,0.7)'
            : 'rgba(50,150,50,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, border: '2px solid rgba(255,255,255,0.3)',
          transition: 'background 0.2s',
        }}>
          {!micEnabled ? '🔇' : isMuted ? '🔴' : '🎤'}
        </div>
        <span style={{
          color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', fontSize: 10,
        }}>
          {!micEnabled ? 'M to enable mic' : isMuted ? 'MUTED' : isSpeaking ? 'SPEAKING' : 'MIC ON'}
        </span>
      </div>

      {/* Settlement window banner */}
      {settlementWindow && (
        <div style={{
          position: 'absolute', top: 50, left: '50%', transform: 'translateX(-50%)',
          background: settleTriggered ? 'rgba(50,255,50,0.3)' : 'rgba(255,50,50,0.3)',
          border: `2px solid ${settleTriggered ? '#4f4' : '#f44'}`,
          borderRadius: 8, padding: '8px 24px',
          fontFamily: 'monospace', fontWeight: 'bold', fontSize: 14,
          color: '#fff', textAlign: 'center',
          textShadow: '0 1px 4px rgba(0,0,0,0.8)',
        }}>
          {settleTriggered ? '⌐◧-◧ SETTLED! DROP PARTY!' : '⌐◧-◧ SETTLEMENT WINDOW — SHOUT TO SETTLE!'}
        </div>
      )}

      {/* Crowd settle meter */}
      {settlementWindow && micEnabled && !settleTriggered && (
        <div style={{
          position: 'absolute', top: 90, left: '50%', transform: 'translateX(-50%)',
          width: 200, textAlign: 'center',
        }}>
          <div style={{
            height: 8, background: 'rgba(0,0,0,0.5)', borderRadius: 4, overflow: 'hidden',
          }}>
            <div style={{
              width: `${crowdMeter * 100}%`, height: '100%',
              background: `linear-gradient(90deg, #ff4444, #ffaa00, #44ff44)`,
              transition: 'width 0.1s',
              borderRadius: 4,
            }} />
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', fontSize: 10, marginTop: 4,
          }}>
            {activeSpeakers} / 3 speakers
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main WorldPage Component ──────────────────────────────────────────

export default function WorldPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentNounSeed = useAppSelector(state => (state as any).onDisplayAuction?.seed);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Game state refs (mutable, no re-renders)
  const playerRef = useRef<Player | null>(null);
  const inputRef = useRef<InputState>(createInputState());
  const combatRef = useRef(createCombatState());
  const oceanRef = useRef(createOceanDeathState());
  const mpRef = useRef(createMultiplayerState());
  const npcsRef = useRef<NPC[]>(createNPCs());
  const playerCharState = useRef<CharacterState>({
    x: SPAWN_X * WORLD_SCALE, z: SPAWN_Y * WORLD_SCALE, y: 0,
    direction: 'up', state: 'idle', attackType: null, hitFlash: 0, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, weaponEquipped: null, muzzleFlash: 0,
  });
  const npcCharStates = useRef<CharacterState[]>(
    npcsRef.current.map(npc => ({
      x: npc.x * WORLD_SCALE, z: npc.y * WORLD_SCALE, y: 0,
      direction: 'down' as Direction, state: 'idle' as PlayerState, attackType: null, hitFlash: 0, hp: npc.hp, maxHp: npc.maxHp, weaponEquipped: null, muzzleFlash: 0,
    }))
  );
  const frameRef = useRef(0);
  const voipRef = useRef<VoipState>(createVoipState());
  const weaponRef = useRef<WeaponState>(createWeaponState());
  const [weaponPickups, setWeaponPickups] = useState<WeaponPickup[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const playerTargetRef = useRef(new THREE.Vector3(SPAWN_X * WORLD_SCALE, 0, SPAWN_Y * WORLD_SCALE));

  // HUD state — ref only, HUD component reads via DOM manipulation (no React re-renders)
  const hudRef = useRef({
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
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
    weaponEquipped: null as (string | null),
    weaponAmmo: 0,
  });

  // Seed priority: URL param > Redux auction state > random
  const seed = useMemo(() => {
    const seedParam = searchParams.get('seed');
    if (seedParam) {
      const parts = seedParam.split('-').map(Number);
      if (parts.length === 5 && parts.every(n => !isNaN(n))) {
        return { background: parts[0], body: parts[1], accessory: parts[2], head: parts[3], glasses: parts[4] };
      }
    }
    return currentNounSeed || randomSeed();
  }, [searchParams, currentNounSeed]);
  const seedKey = useMemo(() => seedToKey(seed), [seed]);

  // Initialize player + multiplayer
  useEffect(() => {
    const player = createPlayer(SPAWN_X, SPAWN_Y, 0, seedKey);
    playerRef.current = player;

    // Spawn weapon pickups around the island
    spawnWeaponPickup('pistol', SPAWN_X + 80, SPAWN_Y - 60);
    spawnWeaponPickup('shotgun', SPAWN_X - 100, SPAWN_Y + 40);
    spawnWeaponPickup('uzi', SPAWN_X + 50, SPAWN_Y + 90);
    setWeaponPickups([...getActivePickups()]);

    // Multiplayer
    const mp = mpRef.current;
    connectMultiplayer(mp);
    setupMessageHandler(mp, { current: player }, combatRef);

    // VOIP signaling message handler
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
          }
        } catch {}
      });
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
      const ok = await initVoip(voip);
      if (ok) {
        setMicEnabled(true);
        startSpeechToText(voip);
        // Connect to all existing peers
        const mp = mpRef.current;
        for (const [id] of mp.remotePlayers) {
          if (mp.ws) callPeer(voip, id, mp.ws, mp.myId);
        }
      }
    } else {
      toggleMute(voip);
      if (voip.isMuted) stopSpeechToText();
      else startSpeechToText(voip);
    }
  };

  // ESC + E + M key handler
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (depositOpen) {
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
      if (e.key === 'e' || e.key === 'E') {
        const p = playerRef.current;
        if (!p) return;
        const px = p.x * WORLD_SCALE;
        const pz = p.y * WORLD_SCALE;

        // Check distance to chest
        const chestDist = Math.sqrt((px - chestWorldX) ** 2 + (pz - chestWorldZ) ** 2);
        if (chestDist < 3) {
          setDepositOpen(true);
          return;
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
  }, [navigate, depositOpen, claimDrop, chestWorldX, chestWorldZ]);

  // ── Game Logic Component (runs inside R3F) ──────────────────────────

  function GameLogic() {
    useFrame(() => {
      const player = playerRef.current;
      const input = inputRef.current;
      const combat = combatRef.current;
      const ocean = oceanRef.current;
      const mp = mpRef.current;
      if (!player) return;

      frameRef.current++;
      const frame = frameRef.current;

      // Ocean death
      const inWater = isInDeepWater(player.x, player.y, ISLAND_MAP);
      tickOceanDeath(ocean, inWater);
      if (ocean.phase === 'respawning' && ocean.timer === 59) {
        player.x = SPAWN_X;
        player.y = SPAWN_Y;
        player.vx = 0;
        player.vy = 0;
        player.hp = player.maxHp;
      }

      // ── Weapon pickup check (GTA style — auto on walk-over) ──
      const weapon = weaponRef.current;
      const pickedUp = checkWeaponPickup(player.x, player.y, weapon);
      if (pickedUp) {
        playPickupSound();
        setWeaponPickups([...getActivePickups()]);
      }
      tickReload(weapon);
      tickMuzzleFlash(weapon);

      // Footsteps disabled — too noisy

      // Combat input
      if (ocean.phase === 'normal') {
        let intendedMove = resolveIntendedMove(input);

        // If F pressed and gun equipped, override to gunshot
        if (intendedMove === 'gunshot' && weapon.equipped) {
          const result = fireWeapon(weapon);
          if (result.fired) {
            if (weapon.equipped === 'shotgun') playShotgunSound();
            else playGunshot();
          } else {
            intendedMove = null; // can't fire (cooldown/no ammo/reloading)
          }
        } else if (intendedMove === 'gunshot' && !weapon.equipped) {
          intendedMove = null; // no gun
        }

        if (intendedMove && player.state !== 'dead' && player.state !== 'respawning') {
          // Play attack sound
          if (intendedMove === 'punch') playPunchSound();
          else if (intendedMove === 'kick') playKickSound();
          else if (intendedMove === 'headbutt') playHeadbuttSound();
          else if (intendedMove === 'backflip') playJumpSound();
          else if (intendedMove === 'block') playBlockSound();

          // Use player facing direction for attack direction
          const facingAngle = DIRECTION_FACING_ANGLE[player.direction] ?? 0;
          const angle = facingAngle;
          const mouseWorldX = player.x + Math.cos(angle) * 50;
          const mouseWorldY = player.y + Math.sin(angle) * 50;

          const hits = executeMove(player, intendedMove, mouseWorldX, mouseWorldY, mp.remotePlayers, combat);

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
            mp.ws.send(JSON.stringify({
              type: 'world:voip:speaking',
              speaking: voip.isSpeaking,
            }));
          }
          // Broadcast transcript to other players
          const transcript = getCurrentTranscript();
          if (transcript) {
            mp.ws.send(JSON.stringify({
              type: 'world:voip:transcript',
              text: transcript,
            }));
          }
        }
        // Update crowd settle
        const shouldSettle = updateCrowdSettle(voip);
        if (shouldSettle) {
          // TODO: trigger nounirl.eth settlement via agent hub API
          console.log('[VOIP] SETTLEMENT TRIGGERED BY CROWD!');
        }
        // Update spatial audio listener position
        const rot = DIRECTION_ROTATION[player.direction] ?? 0;
        updateListenerPosition(voip, player.x * WORLD_SCALE, 0, player.y * WORLD_SCALE,
          Math.sin(rot),
          Math.cos(rot),
        );
        // Update spatial positions for remote players
        for (const [id, rp] of mp.remotePlayers) {
          updateSpatialPosition(voip, id, rp.x * WORLD_SCALE, 0, rp.y * WORLD_SCALE);
        }
      }

      // Tick player
      tickPlayer(player, input, combat);

      // Update camera target + character state ref
      const wx = player.x * WORLD_SCALE;
      const wz = player.y * WORLD_SCALE;
      const terrainY = getTerrainHeight(wx, wz);
      playerTargetRef.current.set(wx, terrainY, wz);
      const pcs = playerCharState.current;
      pcs.x = wx; pcs.z = wz; pcs.y = terrainY;
      pcs.direction = player.direction;
      pcs.state = player.state;
      pcs.attackType = player.attackType;
      pcs.hitFlash = player.hitFlash;
      pcs.hp = player.hp;

      // Update NPC character state refs
      for (let i = 0; i < npcsRef.current.length; i++) {
        const npc = npcsRef.current[i];
        const ncs = npcCharStates.current[i];
        if (!ncs) continue;
        ncs.x = npc.x * WORLD_SCALE;
        ncs.z = npc.y * WORLD_SCALE;
        ncs.y = getTerrainHeight(ncs.x, ncs.z);
        ncs.direction = npc.direction;
        ncs.state = npc.state === 'chase' ? 'walking' : npc.state === 'attack' ? 'attacking' : npc.state === 'dead' ? 'dead' : npc.state === 'stunned' ? 'stunned' : npc.state === 'patrol' ? (npc.patrolWaitTimer > 0 ? 'idle' : 'walking') : 'idle';
        ncs.hitFlash = npc.hitFlash;
        ncs.hp = npc.hp;
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
      combat.slowMo = updateSlowMo(combat.slowMo);

      // Prune old kills
      const now = Date.now();
      combat.killFeed = combat.killFeed.filter(k => now - k.timestamp < 10000);

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
      // VOIP HUD
      hudRef.current.micEnabled = !!voipRef.current.localStream;
      hudRef.current.isMuted = voipRef.current.isMuted;
      hudRef.current.isSpeaking = voipRef.current.isSpeaking;
      hudRef.current.activeSpeakers = voipRef.current.activeSpeakers.size + (voipRef.current.isSpeaking ? 1 : 0);
      hudRef.current.crowdMeter = voipRef.current.crowdMeter;
      hudRef.current.settlementWindow = voipRef.current.settlementWindow;
      hudRef.current.settleTriggered = voipRef.current.settleTriggered;
      hudRef.current.transcript = getCurrentTranscript();
      // Weapon HUD
      hudRef.current.weaponEquipped = weaponRef.current.equipped;
      hudRef.current.weaponAmmo = weaponRef.current.ammo;
      // Write weapon state to character for gun rendering
      pcs.weaponEquipped = weaponRef.current.equipped;
      pcs.muzzleFlash = weaponRef.current.muzzleFlash;
    });

    return null;
  }

  // ── Characters (ref-driven, zero re-renders) ─────────────────────────
  // Character3D reads from stateRef each frame — no React state updates.

  function PlayerCharacter3D() {
    return <Character3D seed={seed} stateRef={playerCharState} />;
  }

  // Remote players — each gets own Character3D with own GLB
  function RemotePlayers() {
    const remoteCharStates = useRef<Map<string, { seed: INounSeed; state: CharacterState }>>(new Map());

    useFrame(() => {
      const mp = mpRef.current;
      // Update or create state for each remote player
      for (const [id, rp] of mp.remotePlayers) {
        let entry = remoteCharStates.current.get(id);
        if (!entry) {
          let rpSeed: INounSeed;
          try {
            const parts = rp.seedKey.split('-').map(Number);
            rpSeed = { background: parts[0], body: parts[1], accessory: parts[2], head: parts[3], glasses: parts[4] };
          } catch {
            rpSeed = randomSeed();
          }
          entry = {
            seed: rpSeed,
            state: { x: 0, z: 0, y: 0, direction: 'up', state: 'idle', attackType: null, hitFlash: 0, hp: 100, maxHp: 100, weaponEquipped: null, muzzleFlash: 0 },
          };
          remoteCharStates.current.set(id, entry);
        }
        const wx = rp.x * WORLD_SCALE;
        const wz = rp.y * WORLD_SCALE;
        entry.state.x = wx;
        entry.state.z = wz;
        entry.state.y = getTerrainHeight(wx, wz);
        entry.state.direction = rp.direction;
        entry.state.state = rp.state === 'walking' ? 'walking' : rp.state === 'attacking' ? 'attacking' : 'idle';
        entry.state.hitFlash = rp.hitFlash;
        entry.state.hp = rp.hp;
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
          return <Character3D key={id} seed={entry.seed} stateRef={{ current: entry.state }} />;
        })}
      </>
    );
  }

  return (
    <div ref={canvasContainerRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#1a4f8a', cursor: 'crosshair', overflow: 'hidden' }}>
      <Canvas
        shadows
        camera={{ position: [SPAWN_X * WORLD_SCALE, 2, SPAWN_Y * WORLD_SCALE + 3.5], fov: 50 }}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        gl={{ antialias: true, alpha: false }}
      >
        {/* Sky color */}
        <color attach="background" args={['#87ceeb']} />
        <fog attach="fog" args={['#87ceeb', 30, 80]} />

        <Lighting />
        <AnimatedOcean />
        <Terrain />
        <Trees />
        <Rocks />
        <CrystalBallMountain nounSeed={seed} />

        {/* Atmosphere */}
        <BirdFlocks />
        <CloudLayer />
        <Dolphins />

        {/* World objects */}
        <Billboard position={[45 * WORLD_SCALE, 0.8, 38 * WORLD_SCALE]} text="probe.wtf" url="https://probe.wtf" />
        <Billboard position={[55 * WORLD_SCALE, 0.8, 42 * WORLD_SCALE]} text="YOUR AD HERE ⌐◧-◧" rotation={0.5} />
        <Billboard position={[35 * WORLD_SCALE, 0.8, 55 * WORLD_SCALE]} text="pooter.world" url="https://pooter.world" rotation={-0.3} />
        <WinnieVan position={[58 * WORLD_SCALE, 0.35, 54 * WORLD_SCALE]} rotation={0.8} />
        <MechanicSign position={[56 * WORLD_SCALE, 0.35, 52 * WORLD_SCALE]} />

        {/* Mega Ramp */}
        <MegaRamp3D />

        {/* Treasure Chest */}
        <TreasureChest3D
          position={[chestWorldX, getTerrainHeight(chestWorldX, chestWorldZ) + 0.1, chestWorldZ]}
          pendingCount={0}
          onInteract={() => setDepositOpen(true)}
          playerDistance={99}
        />

        {/* Dropped items from last drop party */}
        {droppedItems.filter(d => !d.claimed).map(item => (
          <DroppedItem3D
            key={item.dropId}
            position={[item.worldX * WORLD_SCALE, getTerrainHeight(item.worldX * WORLD_SCALE, item.worldY * WORLD_SCALE) + 0.1, item.worldY * WORLD_SCALE]}
            itemType={item.itemType}
            claimed={item.claimed}
          />
        ))}

        {/* Weapon pickups on the ground */}
        {weaponPickups.filter(p => !p.picked).map(pickup => (
          <WeaponPickup3D
            key={pickup.id}
            position={[pickup.worldX * WORLD_SCALE, getTerrainHeight(pickup.worldX * WORLD_SCALE, pickup.worldY * WORLD_SCALE) + 0.2, pickup.worldY * WORLD_SCALE]}
            type={pickup.type}
            picked={pickup.picked}
          />
        ))}

        <PlayerCharacter3D />
        <RemotePlayers />

        <CameraController target={playerTargetRef.current} inputRef={inputRef} playerCharState={playerCharState} />
        <GameLogic />
      </Canvas>

      <HUDLive hudRef={hudRef} />
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </div>
  );
}
