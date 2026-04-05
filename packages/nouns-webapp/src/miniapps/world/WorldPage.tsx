// ── Nouns World — Immersive 3D PvP Fighting Arena ────────────────────
//
// Three.js R3F scene with third-person RPG camera, animated Noun
// sprites on billboarded quads, 3D island terrain, day/night cycle,
// and the full combat + multiplayer system from the engine.

import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useAppSelector } from '@/hooks';

import { SEND_INTERVAL, TILE_SIZE, MAP_SIZE, PLAYER_MAX_HP } from './engine/types';
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
import { TreasureChest3D } from './engine/TreasureChest3D';
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

function CrystalBallMountain({ nounSeed }: { nounSeed: INounSeed }) {
  const ballGroupRef = useRef<THREE.Group>(null);

  // Build the voxel Noun inside the ball
  const { bodyGeo, blingGeo, headGeo, glassesGeo } = useMemo(() => {
    try {
      const layers = seedToLayers(nounSeed, getNounData, ImageData.palette, DEFAULT_VIS);
      return buildNounGeometries(layers);
    } catch {
      return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
    }
  }, [nounSeed]);

  useFrame(({ clock }) => {
    if (ballGroupRef.current) {
      ballGroupRef.current.rotation.y = clock.elapsedTime * 0.3;
      // Gentle float
      ballGroupRef.current.position.y = MOUNTAIN_HEIGHT + BALL_RADIUS + 0.5 + Math.sin(clock.elapsedTime * 0.5) * 0.15;
    }
  });

  return (
    <group position={[CRYSTAL_BALL_X, 0, CRYSTAL_BALL_Z]}>
      {/* Rocky mountain base — stack of cones */}
      <mesh position={[0, 0, 0]}>
        <coneGeometry args={[3, MOUNTAIN_HEIGHT * 0.6, 8]} />
        <meshStandardMaterial color="#555" roughness={1} />
      </mesh>
      <mesh position={[0, MOUNTAIN_HEIGHT * 0.3, 0]}>
        <coneGeometry args={[2, MOUNTAIN_HEIGHT * 0.5, 7]} />
        <meshStandardMaterial color="#666" roughness={0.9} />
      </mesh>
      <mesh position={[0, MOUNTAIN_HEIGHT * 0.55, 0]}>
        <coneGeometry args={[1.2, MOUNTAIN_HEIGHT * 0.4, 6]} />
        <meshStandardMaterial color="#777" roughness={0.8} />
      </mesh>
      {/* Peak */}
      <mesh position={[0, MOUNTAIN_HEIGHT * 0.8, 0]}>
        <coneGeometry args={[0.6, MOUNTAIN_HEIGHT * 0.3, 5]} />
        <meshStandardMaterial color="#888" roughness={0.7} />
      </mesh>

      {/* Glass sphere */}
      <mesh position={[0, MOUNTAIN_HEIGHT + BALL_RADIUS + 0.5, 0]}>
        <sphereGeometry args={[BALL_RADIUS, 32, 24]} />
        <meshPhysicalMaterial
          color="#aaddff"
          transparent
          opacity={0.25}
          roughness={0}
          metalness={0.1}
          transmission={0.8}
          thickness={0.5}
        />
      </mesh>

      {/* Inner glow */}
      <pointLight position={[0, MOUNTAIN_HEIGHT + BALL_RADIUS + 0.5, 0]} color="#6699ff" intensity={2} distance={8} />

      {/* Rotating voxel Noun inside the sphere */}
      <group ref={ballGroupRef} position={[0, MOUNTAIN_HEIGHT + BALL_RADIUS + 0.5, 0]} scale={[0.05, 0.05, 0.05]}>
        {bodyGeo && <mesh geometry={bodyGeo}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>}
        {blingGeo && <mesh geometry={blingGeo}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>}
        {headGeo && <mesh geometry={headGeo}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>}
        {glassesGeo && <mesh geometry={glassesGeo}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>}
      </group>
    </group>
  );
}

// ── Water plane (animated) ────────────────────────────────────────────

function Water() {
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

function CameraController({ target }: { target: THREE.Vector3 }) {
  const { camera } = useThree();

  useFrame(() => {
    // Dead simple: camera always behind (+Z), slightly above, looking at player
    const desired = new THREE.Vector3(target.x, target.y + 1.5, target.z + 3.5);
    camera.position.lerp(desired, 0.1);
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
  return <HUD {...s} />;
}

function HUD({
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
        WASD move &middot; Arrows pan camera &middot; ESC exit
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
    </div>
  );
}

// ── Main WorldPage Component ──────────────────────────────────────────

export default function WorldPage() {
  const navigate = useNavigate();
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
    direction: 'up', state: 'idle', attackType: null, hitFlash: 0, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
  });
  const npcCharStates = useRef<CharacterState[]>(
    npcsRef.current.map(npc => ({
      x: npc.x * WORLD_SCALE, z: npc.y * WORLD_SCALE, y: 0,
      direction: 'down' as Direction, state: 'idle' as PlayerState, attackType: null, hitFlash: 0, hp: npc.hp, maxHp: npc.maxHp,
    }))
  );
  const frameRef = useRef(0);
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
  });

  const seed = useMemo(() => currentNounSeed || randomSeed(), [currentNounSeed]);
  const seedKey = useMemo(() => seedToKey(seed), [seed]);

  // Initialize player + multiplayer
  useEffect(() => {
    const player = createPlayer(SPAWN_X, SPAWN_Y, 0, seedKey);
    playerRef.current = player;

    // Multiplayer
    const mp = mpRef.current;
    connectMultiplayer(mp);
    setupMessageHandler(mp, { current: player }, combatRef);

    return () => {
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

  // ESC handler
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        disconnectMultiplayer(mpRef.current);
        navigate('/');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate]);

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

      // Combat input
      if (ocean.phase === 'normal') {
        const intendedMove = resolveIntendedMove(input);
        if (intendedMove && player.state !== 'dead' && player.state !== 'respawning') {
          // Use player facing direction for attack direction
          const facingAngle = player.direction === 'up' ? -Math.PI / 2 : player.direction === 'down' ? Math.PI / 2 : player.direction === 'left' ? Math.PI : 0;
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

          for (const hit of hits) {
            sendHit(mp, hit.targetId, hit.damage, hit.knockX, hit.knockY, hit.move, hit.combo);
            const target = mp.remotePlayers.get(hit.targetId);
            if (target && target.hp <= 0) {
              combat.killFeed.push({
                killer: `Noun #${player.nounId}`,
                victim: `Noun #${target.nounId}`,
                move: hit.move,
                timestamp: Date.now(),
              });
            }
          }

          // NPC hit detection disabled — NPCs not rendered
          // TODO: re-enable with separate GLB instances
        }
      }

      // NPCs disabled — rendering removed, so disable AI too
      // TODO: re-enable when NPC characters use separate GLB instances

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
            state: { x: 0, z: 0, y: 0, direction: 'up', state: 'idle', attackType: null, hitFlash: 0, hp: 100, maxHp: 100 },
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
        <Water />
        <Terrain />
        <Trees />
        <Rocks />
        <CrystalBallMountain nounSeed={seed} />

        {/* Treasure Chest — southwest of spawn */}
        <TreasureChest3D
          position={[(SPAWN_X - 4 * TILE_SIZE) * WORLD_SCALE, getTerrainHeight((SPAWN_X - 4 * TILE_SIZE) * WORLD_SCALE, (SPAWN_Y + 4 * TILE_SIZE) * WORLD_SCALE) + 0.1, (SPAWN_Y + 4 * TILE_SIZE) * WORLD_SCALE]}
          pendingCount={0}
          onInteract={() => {}}
          playerDistance={99}
        />

        <PlayerCharacter3D />
        <RemotePlayers />

        <CameraController target={playerTargetRef.current} />
        <GameLogic />
      </Canvas>

      <HUDLive hudRef={hudRef} />
    </div>
  );
}
