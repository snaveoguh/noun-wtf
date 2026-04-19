// ── 3D Rigged Character with Voxel Noun Head ────────────────────────
// Each instance loads its own GLB copy for independent skeletons.

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { buildNounGeometries, seedToLayers, type LayerVisibility } from '@nouns/voxel-engine';
import { ImageData, getNounData } from '@noundry/nouns-assets';
import type { INounSeed } from '@/wrappers/nounToken';
import { DIRECTION_ROTATION } from './types';
import type { Direction, MoveType, PlayerState } from './types';

const MODEL_PATH = '/models/character.glb';
const VOXEL_HEAD_SCALE = 0.14; // 50% smaller head
const HEAD_VIS: LayerVisibility = { body: false, accessory: false, head: true, glasses: true };
const BODY_SCALE = 0.14;

// Set of clip names actually present in the loaded GLB. Populated the first
// time the model is parsed; shared across all character instances (same GLB
// buffer is reused). We read this lazily from pickClip().
const availableClipNames = new Set<string>();
let availableClipsLogged = false;

/**
 * Return the first clip in `candidates` that exists in the loaded GLB,
 * falling back to `fallback` otherwise. Emits a dev-only warning when none
 * of the candidates match — helpful for discovering missing mappings.
 */
function pickClip(candidates: string[], fallback: string): string {
  // When availableClipNames hasn't been populated yet (very first frame),
  // return the first candidate — it'll be reassigned on next render or the
  // runtime look-up in actionsRef.current will fall back to Idle.
  if (availableClipNames.size === 0) return candidates[0] ?? fallback;
  for (const name of candidates) {
    if (availableClipNames.has(name)) return name;
  }
  if (import.meta.env.DEV) {
    console.warn(
      `[Character3D] No matching clip for candidates ${JSON.stringify(candidates)}; falling back to "${fallback}"`,
    );
  }
  return availableClipNames.has(fallback) ? fallback : (candidates[0] ?? fallback);
}

// Idle variants — cycled every ~8-10 seconds while in the idle state so the
// model doesn't look frozen. Filtered down at runtime to the ones that exist.
const IDLE_VARIANT_CANDIDATES = ['Idle', 'Idle_A', 'Idle_B', 'Idle_Breathing'];
const IDLE_CYCLE_SECONDS = 9;

/**
 * Animation state-key → clip-name mapping. Values go through pickClip() so
 * missing clips fall back gracefully instead of blowing up the crossfade.
 *
 * Getters are used (not static lookup) because availableClipNames is
 * populated asynchronously on GLB load; by calling getAnimMap() *after*
 * load, we get correct resolution.
 */
function getAnimMap(): Record<string, string> {
  return {
    idle: pickClip(['Idle'], 'Idle'),
    walking: pickClip(['Walking_A', 'Walking_B'], 'Walking_A'),
    // Differentiated movement — dashing uses a full sprint if available,
    // otherwise falls through to running.
    dashing: pickClip(['Sprint', 'Dodge_Forward', 'Running_B', 'Running_A'], 'Running_A'),
    walking_sprint: pickClip(['Running_B', 'Running_A'], 'Running_A'),
    walking_fast: pickClip(['Running_A', 'Running_B'], 'Running_A'),
    attacking_punch: pickClip(
      ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B'],
      'Unarmed_Melee_Attack_Punch_A',
    ),
    attacking_kick: pickClip(['Unarmed_Melee_Attack_Kick'], 'Unarmed_Melee_Attack_Kick'),
    attacking_headbutt: pickClip(
      ['Unarmed_Melee_Attack_Punch_B', 'Unarmed_Melee_Attack_Punch_A'],
      'Unarmed_Melee_Attack_Punch_B',
    ),
    attacking_uppercut: pickClip(
      ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B'],
      'Unarmed_Melee_Attack_Punch_A',
    ),
    attacking_spinAttack: pickClip(
      ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal'],
      '1H_Melee_Attack_Slice_Diagonal',
    ),
    attacking_forcePush: pickClip(['Spellcast_Shoot', 'Spellcast_Raise'], 'Spellcast_Shoot'),
    attacking_gunshot: pickClip(['1H_Ranged_Shoot'], '1H_Ranged_Shoot'),
    attacking_headshot: pickClip(['1H_Ranged_Shoot'], '1H_Ranged_Shoot'),
    aiming: pickClip(['1H_Ranged_Aiming'], '1H_Ranged_Aiming'),
    reloading: pickClip(['1H_Ranged_Reload'], '1H_Ranged_Reload'),
    blocking: pickClip(['Block'], 'Block'),
    blocking_hit: pickClip(['Block_Hit', 'Block'], 'Block'),
    backflip: pickClip(['Jump_Full_Long', 'Jump_Full_Short'], 'Jump_Full_Long'),
    stunned: pickClip(['Hit_A'], 'Hit_A'),
    wounded: pickClip(['Hit_B', 'Hit_A'], 'Hit_B'),
    knocked: pickClip(['Death_A'], 'Death_A'),
    dead: pickClip(['Death_A'], 'Death_A'),
    dead_headshot: pickClip(['Death_B', 'Death_A'], 'Death_B'),
    respawning: pickClip(['Idle'], 'Idle'),
    airborne: pickClip(['Jump_Full_Short', 'Jump_Full_Long'], 'Jump_Full_Short'),
    // Rising vs. falling split. Many rigs ship distinct up/hang/down clips.
    airborne_rising: pickClip(
      ['Jump_Full_Short', 'Jump_Start', 'Jump_Full_Long'],
      'Jump_Full_Short',
    ),
    airborne_falling: pickClip(
      ['Jump_Full_Long_Fall', 'Jump_Land', 'Falling', 'Jump_Full_Long'],
      'Jump_Full_Long',
    ),
    // Climbing / hanging — user added climb to locomotion.
    climbing: pickClip(['Climbing_Ladder', 'Climbing', 'Hang_Idle', 'Hang'], 'Idle'),
  };
}

// Animations that play at custom speeds
const ANIM_SPEED: Partial<Record<string, number>> = {
  knocked: 0.5, // slow-motion fall for combo knockdown
  wounded: 0.6, // slightly slowed knee collapse
};

export interface CharacterState {
  x: number;
  z: number;
  y: number;
  direction: Direction;
  state: PlayerState;
  attackType: MoveType | null;
  hitFlash: number;
  hp: number;
  maxHp: number;
  weaponEquipped: string | null;
  muzzleFlash: number;
  isSkating: boolean;
  trickName: string | null; // current trick animation (kickflip, heelflip, etc)
  trickTimer: number; // 0-1 progress through trick animation
  airborneVy: number; // vertical velocity — negative=rising, positive=falling
  vx: number; // horizontal velocity for lean direction
  vy: number;
  paintColor: string | null; // spray can color if holding one
  swordEquipped: boolean;
}

function getNounBodyColor(seed: INounSeed): string {
  const palette = ImageData.palette;
  const { parts } = getNounData(seed);
  const bodyData = parts[0]?.data;
  if (!bodyData) return '#888888';
  const hex = bodyData.replace(/^0x/, '');
  const pairs = hex.substring(10).match(/.{1,4}/g) ?? [];
  for (const pair of pairs) {
    const colorIdx = parseInt(pair.substring(2, 4), 16);
    if (colorIdx > 0 && palette[colorIdx]) return `#${palette[colorIdx]}`;
  }
  return '#888888';
}

// Cache the raw ArrayBuffer so we don't re-fetch for each instance
let glbBuffer: ArrayBuffer | null = null;
let glbFetching: Promise<ArrayBuffer> | null = null;

function fetchGLB(): Promise<ArrayBuffer> {
  if (glbBuffer) return Promise.resolve(glbBuffer);
  if (!glbFetching) {
    glbFetching = fetch(MODEL_PATH)
      .then(r => r.arrayBuffer())
      .then(buf => {
        glbBuffer = buf;
        return buf;
      });
  }
  return glbFetching;
}

/** Shadow that stays on the ground and shrinks/fades when character jumps */
function ShadowCircle({ stateRef }: { stateRef: React.RefObject<CharacterState> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const s = stateRef.current;
    const m = meshRef.current;
    if (!s || !m) return;
    // How high above terrain? s.y includes terrain + jump offset
    // We approximate: if state is airborne/backflip, character is jumping
    const isJumping = s.state === 'airborne' || s.state === 'backflip';
    // Shadow should be at ground level (offset DOWN from character position)
    // Since the group is at s.y, we offset the shadow back to terrain
    const jumpHeight = isJumping ? 2 : 0; // approximate
    m.position.y = -jumpHeight + 0.02; // push shadow down to ground
    // Scale shadow smaller when higher
    const scale = isJumping ? 0.12 : 0.25;
    m.scale.set(scale, scale, 1);
    // Fade when high
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.opacity = isJumping ? 0.06 : 0.15;
  });
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <circleGeometry args={[1, 12]} />
      <meshBasicMaterial color="#000" transparent opacity={0.15} />
    </mesh>
  );
}

/** Hoverboard mesh — animates trick rotations (kickflip, heelflip, etc) */
function HoverboardMesh({ stateRef }: { stateRef: React.RefObject<CharacterState> }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = groupRef.current;
    const s = stateRef.current;
    if (!g || !s) return;
    g.visible = s.isSkating;
    if (!s.isSkating) return;

    const t = s.trickTimer ?? 0; // 0-1 progress through trick

    // Base position
    g.position.y = 0.01;

    if (s.trickName && t > 0) {
      // Trick-specific board rotations
      const trick = s.trickName;
      if (trick === 'Kickflip' || trick === 'Double Kickflip') {
        // Roll 360° (or 720° for double) on the length axis
        const flips = trick === 'Double Kickflip' ? 2 : 1;
        g.rotation.x = t * Math.PI * 2 * flips;
        g.rotation.y = 0;
        g.rotation.z = 0;
      } else if (trick === 'Heelflip') {
        // Roll -360° (opposite direction from kickflip)
        g.rotation.x = -t * Math.PI * 2;
        g.rotation.y = 0;
        g.rotation.z = 0;
      } else if (trick === '180' || trick === '360') {
        // Spin on vertical axis
        const spins = trick === '360' ? 2 : 1;
        g.rotation.x = 0;
        g.rotation.y = t * Math.PI * spins;
        g.rotation.z = 0;
      } else if (trick === 'Hardflip') {
        // Kickflip + 180 spin combo
        g.rotation.x = t * Math.PI * 2;
        g.rotation.y = t * Math.PI;
        g.rotation.z = 0;
      } else if (trick === 'Pop Shove-it') {
        // Board spins 180 under feet (y-axis rotation only)
        g.rotation.x = 0;
        g.rotation.y = t * Math.PI;
        g.rotation.z = 0;
      } else if (trick.includes('Grab') || trick === 'Method Air') {
        // Board grabs — board tilts toward grab direction
        const tiltPhase = Math.sin(t * Math.PI); // smooth in/out
        if (trick === 'Indy Grab') {
          g.rotation.z = tiltPhase * 0.4; // tilt right (indy = right hand, right rail)
        } else if (trick === 'Melon Grab') {
          g.rotation.z = -tiltPhase * 0.4; // tilt left (melon = left hand, left rail)
        } else if (trick === 'Nose Grab') {
          g.rotation.x = -tiltPhase * 0.3; // nose dips down
        } else if (trick === 'Tail Grab') {
          g.rotation.x = tiltPhase * 0.3; // tail dips down
        } else if (trick === 'Method Air') {
          // Board tweaked behind with body lean
          g.rotation.x = tiltPhase * 0.5;
          g.rotation.z = tiltPhase * 0.3;
        }
      } else {
        // Generic trick — small flip
        g.rotation.x = t * Math.PI * 2;
        g.rotation.y = 0;
        g.rotation.z = 0;
      }
    } else {
      // Idle bob
      g.rotation.x = Math.sin(Date.now() * 0.003) * 0.01;
      g.rotation.y = 0;
      g.rotation.z = 0;
    }
  });
  return (
    <group ref={groupRef} position={[0, 0.01, 0]} scale={[0.35, 0.35, 0.35]} visible={false}>
      <mesh>
        <boxGeometry args={[1.2, 0.04, 0.3]} />
        <meshStandardMaterial
          color="#00ffcc"
          emissive="#00ffcc"
          emissiveIntensity={2}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>
      <pointLight position={[0, -0.06, 0]} color="#00ffcc" intensity={0.8} distance={0.5} />
      {/* Nose accent (left side) */}
      <mesh position={[0.55, 0.03, 0]}>
        <boxGeometry args={[0.1, 0.02, 0.24]} />
        <meshBasicMaterial color="#ff00ff" />
      </mesh>
      {/* Tail accent (right side) */}
      <mesh position={[-0.55, 0.03, 0]}>
        <boxGeometry args={[0.1, 0.02, 0.24]} />
        <meshBasicMaterial color="#ff00ff" />
      </mesh>
    </group>
  );
}

interface Character3DProps {
  seed: INounSeed;
  stateRef: React.RefObject<CharacterState>;
}

export function Character3D({ seed, stateRef }: Character3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const prevAnimRef = useRef('');
  const oneShotPlaying = useRef(false);
  const voxelHeadRef = useRef<THREE.Group | null>(null);
  const gunGroupRef = useRef<THREE.Group | null>(null);
  const handBoneRef = useRef<THREE.Object3D | null>(null);
  // Anim map resolved post-GLB-load so pickClip can see availableClipNames.
  const animMapRef = useRef<Record<string, string>>({});
  // Idle clip variants actually present on the model (populated on load).
  const idleVariantsRef = useRef<string[]>(['Idle']);
  // Index into idleVariantsRef for cycling.
  const idleVariantIndexRef = useRef(0);
  // Timestamp (seconds elapsed since first idle frame) for variant cycling.
  const idleTimerRef = useRef(0);
  // Previous high-level state, used to reset the idle cycle on re-entry.
  const prevStateRef = useRef<string>('');

  const nounHeadRef = useRef(
    (() => {
      try {
        const layers = seedToLayers(seed, getNounData, ImageData.palette, HEAD_VIS);
        return buildNounGeometries(layers);
      } catch {
        return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
      }
    })(),
  );

  const bodyColorRef = useRef(getNounBodyColor(seed));

  // Load fresh GLB instance — runs ONCE per mount
  useEffect(() => {
    const nounHead = nounHeadRef.current;
    const bodyColor = bodyColorRef.current;
    let cancelled = false;
    let model: THREE.Group | null = null;

    fetchGLB().then(buffer => {
      if (cancelled || !groupRef.current) return;

      const loader = new GLTFLoader();
      loader.parse(buffer.slice(0), '', gltf => {
        if (cancelled || !groupRef.current) return;

        model = gltf.scene;
        model.scale.set(BODY_SCALE, BODY_SCALE, BODY_SCALE);

        // Setup: hide head/cape/weapons, tint body
        let chestBone: THREE.Object3D | null = null;
        model.traverse((child: THREE.Object3D) => {
          if (child.name === 'Rogue_Head' || child.name === 'Rogue_Cape') child.visible = false;
          if (
            child.name.includes('Knife') ||
            child.name.includes('Crossbow') ||
            child.name.includes('Throwable') ||
            child.name.includes('1H_') ||
            child.name.includes('2H_') ||
            child.name === 'Rogue_ArmLeft' ||
            child.name === 'Knife_Offhand' ||
            // Hide ALL left-side bones/meshes EXCEPT legs
            (child.name.endsWith('.l') &&
              !child.name.toLowerCase().includes('leg') &&
              !child.name.toLowerCase().includes('foot') &&
              !child.name.toLowerCase().includes('toe')) ||
            child.name.toLowerCase().includes('armleft') ||
            child.name.toLowerCase().includes('arm_left') ||
            child.name.toLowerCase().includes('arm_l')
          ) {
            // Hide weapons + left arm (exact names only — don't match legs!)
            child.visible = false;
          }
          // Store chest/spine bone for safety vest attachment
          if (
            (child.name === 'chest' || child.name === 'spine_01' || child.name === 'spine') &&
            (child as any).isBone
          ) {
            chestBone = child;
          }
          // Disable frustum culling on EVERYTHING to prevent disappearing on turn
          child.frustumCulled = false;
          if ((child as THREE.SkinnedMesh).isSkinnedMesh && child.visible) {
            const mesh = child as THREE.SkinnedMesh;
            const color = child.name.includes('Leg') ? '#443322' : bodyColor;
            mesh.material = new THREE.MeshBasicMaterial({ color, side: THREE.FrontSide });
            // Clip the left arm stump from Rogue_Body by zeroing out vertices
            // that extend too far to the character's left (positive X in model space)
            if (child.name === 'Rogue_Body') {
              const geo = mesh.geometry;
              const pos = geo.getAttribute('position');
              if (pos) {
                const arr = pos.array as Float32Array;
                for (let i = 0; i < arr.length; i += 3) {
                  // Model's left arm extends in +X. Clip vertices beyond the shoulder
                  if (arr[i] > 0.35) {
                    arr[i] = 0.35; // clamp X to shoulder width
                    arr[i + 1] *= 0.95; // slightly flatten
                  }
                }
                pos.needsUpdate = true;
                geo.computeBoundingSphere();
              }
            }
          }
        });

        // ── Safety Vest ──
        if (chestBone) {
          const vestGroup = new THREE.Group();
          vestGroup.name = '__safetyVest';

          const vestColor = '#CCFF00';
          const vestMat = new THREE.MeshBasicMaterial({ color: vestColor });
          const stripMat = new THREE.MeshStandardMaterial({
            color: '#dddddd',
            metalness: 0.9,
            roughness: 0.2,
            emissive: new THREE.Color('#666666'),
          });

          // Front panel — slightly curved via thin box
          const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.15), vestMat);
          frontPanel.position.set(0, 0.2, 0.55);
          vestGroup.add(frontPanel);

          // Back panel
          const backPanel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.15), vestMat);
          backPanel.position.set(0, 0.2, -0.55);
          vestGroup.add(backPanel);

          // Shoulder straps connecting front to back
          const strapMat = vestMat.clone();
          const leftStrap = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 1.0), strapMat);
          leftStrap.position.set(-0.55, 1.2, 0);
          vestGroup.add(leftStrap);

          const rightStrap = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 1.0), strapMat);
          rightStrap.position.set(0.55, 1.2, 0);
          vestGroup.add(rightStrap);

          // Reflective strips — chest level (front + back)
          const stripGeo = new THREE.BoxGeometry(1.5, 0.2, 0.17);
          const frontStripChest = new THREE.Mesh(stripGeo, stripMat);
          frontStripChest.position.set(0, 0.7, 0.56);
          vestGroup.add(frontStripChest);

          const backStripChest = new THREE.Mesh(stripGeo, stripMat.clone());
          backStripChest.position.set(0, 0.7, -0.56);
          vestGroup.add(backStripChest);

          // Reflective strips — waist level (front + back)
          const frontStripWaist = new THREE.Mesh(stripGeo.clone(), stripMat.clone());
          frontStripWaist.position.set(0, -0.4, 0.56);
          vestGroup.add(frontStripWaist);

          const backStripWaist = new THREE.Mesh(stripGeo.clone(), stripMat.clone());
          backStripWaist.position.set(0, -0.4, -0.56);
          vestGroup.add(backStripWaist);

          // Scale vest to fit body at BODY_SCALE
          // Scale vest tiny to fit small body + cut front open
          vestGroup.scale.set(0.15, 0.15, 0.15);
          frontPanel.scale.x = 0.7; // narrower front = open vest look
          (chestBone as THREE.Object3D).add(vestGroup);
        }

        // Attach voxel head to head bone
        model.traverse((child: THREE.Object3D) => {
          if (child.name === 'head' && (child as any).isBone) {
            const headGroup = new THREE.Group();
            headGroup.scale.set(VOXEL_HEAD_SCALE, VOXEL_HEAD_SCALE, VOXEL_HEAD_SCALE);
            headGroup.position.set(0, 0.65, 0);
            headGroup.frustumCulled = false;
            const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
            if (nounHead.headGeo) {
              const headMesh = new THREE.Mesh(nounHead.headGeo, mat);
              headMesh.frustumCulled = false;
              headGroup.add(headMesh);
            }
            if (nounHead.glassesGeo) {
              const glassesMesh = new THREE.Mesh(nounHead.glassesGeo, mat.clone());
              glassesMesh.frustumCulled = false;
              headGroup.add(glassesMesh);
            }
            child.add(headGroup);
            voxelHeadRef.current = headGroup;
          }
          // Store hand bone for gun attachment
          // Find hand bone for item attachment — try multiple names
          if (
            !handBoneRef.current &&
            (child as any).isBone &&
            (child.name === 'handslot.r' ||
              child.name === 'hand.r' ||
              child.name === 'hand_r' ||
              child.name === 'Hand_R' ||
              child.name === 'RightHand' ||
              child.name === 'mixamorig:RightHand' ||
              (child.name.toLowerCase().includes('hand') && child.name.toLowerCase().includes('r')))
          ) {
            handBoneRef.current = child;
            console.log(`[Character3D] Found hand bone: ${child.name}`);
          }
        });

        // Fallback: if no hand bone found, create a dummy attach point on the model
        if (!handBoneRef.current) {
          const dummyHand = new THREE.Group();
          dummyHand.name = '__fallbackHand';
          dummyHand.position.set(1.5, 3.5, 1); // right side, chest height, in front
          model.add(dummyHand);
          handBoneRef.current = dummyHand;
          console.log('[Character3D] No hand bone found, using fallback attach point');
        }

        // Animation mixer
        const mixer = new THREE.AnimationMixer(model);
        const actions: Record<string, THREE.AnimationAction> = {};
        for (const clip of gltf.animations) {
          actions[clip.name] = mixer.clipAction(clip);
          availableClipNames.add(clip.name);
        }
        // One-time dev listing of every clip the model ships with — helps
        // discover names for expanding ANIM_MAP further. Gated behind
        // import.meta.env.DEV so production builds stay quiet.
        if (import.meta.env.DEV && !availableClipsLogged) {
          availableClipsLogged = true;

          console.log(
            `[Character3D] GLB animation clips (${gltf.animations.length}):`,
            gltf.animations.map(c => c.name).sort(),
          );
        }
        // Rebuild the idle-variant list now that we know what's actually in
        // the GLB, and rebuild the anim map with resolved clip names.
        idleVariantsRef.current = IDLE_VARIANT_CANDIDATES.filter(n => availableClipNames.has(n));
        if (idleVariantsRef.current.length === 0) idleVariantsRef.current = ['Idle'];
        animMapRef.current = getAnimMap();
        if (actions['Idle']) actions['Idle'].play();

        groupRef.current!.add(model);
        mixerRef.current = mixer;
        actionsRef.current = actions;
        prevAnimRef.current = 'Idle';
      });
    });

    return () => {
      cancelled = true;
      // Don't remove model — prevents flash on strict mode re-mount
      // Model will be replaced if seed changes (effect re-runs)
    };
  }, []);

  // Per-frame update
  useFrame((_, delta) => {
    const g = groupRef.current;
    const s = stateRef.current;
    const mixer = mixerRef.current;
    const actions = actionsRef.current;
    if (!g || !s) return;

    // Position — hover bob when on board (character + board move together)
    const hoverBob = s.isSkating ? 0.15 + Math.sin(Date.now() * 0.005) * 0.02 : 0;
    g.position.set(s.x, s.y + 0.14 + hoverBob, s.z);

    // Face direction — on board: character 90° side-on, board points forward
    const baseRotY = DIRECTION_ROTATION[s.direction] ?? 0;
    g.rotation.y = s.isSkating ? baseRotY + Math.PI / 2 : baseRotY;

    // Airborne pose — different based on rising vs falling
    if (s.state === 'airborne' || s.state === 'backflip') {
      const isFalling = s.airborneVy > 0.5;
      const isRising = s.airborneVy < -0.5;
      const t = Date.now() * 0.015;

      if (isFalling) {
        // SKYDIVING — flat on stomach, face looking at ground
        g.rotation.x = Math.PI / 2; // 90 degrees — completely face down
        // Gentle lean based on movement (very subtle since air control is gentle)
        const leanX = (s.vx || 0) * 2; // amplify the tiny air control for visible lean
        const leanZ = (s.vy || 0) * 2;
        g.rotation.z = -leanX + Math.sin(t * 1.5) * 0.02; // lean left/right
        g.rotation.x += leanZ * 0.3; // lean forward/back slightly
        g.rotation.y = baseRotY + Math.sin(t * 1.2) * 0.03; // wind sway
      } else if (isRising) {
        // RISING — slight backward tilt, arms flailing
        g.rotation.x = -0.15 + Math.sin(t * 3.7) * 0.1;
        g.rotation.z = Math.cos(t * 4.3) * 0.08;
      } else {
        // PEAK — maximum wobble/flailing
        g.rotation.x = Math.sin(t * 3.7) * 0.15;
        g.rotation.z = Math.cos(t * 4.3) * 0.12;
      }
    } else if (s.isSkating) {
      // SKATING — lean body into turns, slight forward crouch
      // Slight forward crouch on board — no velocity-based lean (vx compounds)
      g.rotation.x = 0.1;
      g.rotation.z = 0;
    } else {
      g.rotation.x = 0;
      g.rotation.z = 0;
    }

    // Animation crossfade
    if (mixer && Object.keys(actions).length > 0) {
      let animKey = s.state as string;
      // On hoverboard — idle stance (rotation handles the visual).
      // Airborne resolves to rising/falling below when a clip exists.
      if (s.isSkating) animKey = 'idle';
      else if (s.state === 'airborne') {
        // Rising vs falling split — negative vy = going up, positive = falling.
        // Small deadband around 0 keeps it from flickering at the apex.
        if (s.airborneVy < -0.2) animKey = 'airborne_rising';
        else if (s.airborneVy > 0.2) animKey = 'airborne_falling';
        else animKey = 'airborne';
      } else if (s.state === 'attacking' && s.attackType) {
        animKey = `attacking_${s.attackType}`;
      }
      // Headshot death uses alternate death animation
      if (s.state === 'dead' && s.attackType === 'headshot') animKey = 'dead_headshot';

      // Idle-variant cycling: when the character stays in 'idle' for
      // IDLE_CYCLE_SECONDS, switch to the next available idle variant.
      // Reset whenever the state changes (so we don't cycle mid-combat etc.).
      if (animKey === 'idle') {
        if (prevStateRef.current !== 'idle') {
          idleTimerRef.current = 0;
        } else {
          idleTimerRef.current += delta;
          if (idleTimerRef.current >= IDLE_CYCLE_SECONDS) {
            idleTimerRef.current = 0;
            const variants = idleVariantsRef.current;
            if (variants.length > 1) {
              idleVariantIndexRef.current = (idleVariantIndexRef.current + 1) % variants.length;
            }
          }
        }
      } else {
        idleTimerRef.current = 0;
      }
      prevStateRef.current = animKey;

      // Resolve the clip name through the (post-load) anim map.
      // Special-case: idle goes through the cycling variant list instead.
      let clipName: string;
      if (animKey === 'idle' && idleVariantsRef.current.length > 0) {
        clipName = idleVariantsRef.current[idleVariantIndexRef.current] ?? 'Idle';
      } else {
        clipName = animMapRef.current[animKey] ?? 'Idle';
      }
      const isOneShot = ['attacking', 'dead', 'backflip', 'stunned', 'knocked', 'wounded'].includes(
        s.state,
      );

      if (clipName !== prevAnimRef.current && actions[clipName] && !oneShotPlaying.current) {
        const prev = actions[prevAnimRef.current];
        const next = actions[clipName]!;
        if (prev) {
          prev.crossFadeTo(next, 0.1, true);
        }
        next.reset().fadeIn(0.05).play();

        // Apply custom animation speed (e.g. 0.5x for knocked)
        const customSpeed = ANIM_SPEED[animKey];
        next.timeScale = customSpeed ?? 1;

        if (isOneShot) {
          next.setLoop(THREE.LoopOnce, 1);
          next.clampWhenFinished = true;
          oneShotPlaying.current = true;
          const onFinished = () => {
            mixer.removeEventListener('finished', onFinished);
            oneShotPlaying.current = false;
            prevAnimRef.current = '__done';
          };
          mixer.addEventListener('finished', onFinished);
        } else {
          next.setLoop(THREE.LoopRepeat, Infinity);
        }
        prevAnimRef.current = clipName;
      }

      if (!oneShotPlaying.current && !isOneShot && prevAnimRef.current === '__done') {
        const next = actions[clipName];
        if (next) {
          next.reset().fadeIn(0.15).play();
          next.timeScale = 1;
          next.setLoop(THREE.LoopRepeat, Infinity);
          prevAnimRef.current = clipName;
        }
      }

      mixer.update(delta);
    }

    // Voxel head subtle idle animation
    const head = voxelHeadRef.current;
    if (head) {
      const t = Date.now() * 0.001;
      // Gentle nod left/right
      head.rotation.z = Math.sin(t * 0.4) * 0.03;
      // Very subtle forward/back nod
      head.rotation.x = Math.sin(t * 0.6) * 0.015;

      // Noggle blink — squash Y scale briefly every ~8-12 seconds
      const blinkCycle = t % 10; // 10 second cycle
      if (blinkCycle > 9.7 && blinkCycle < 9.85) {
        // Blink! Squash the glasses
        head.children.forEach((child, i) => {
          if (i > 0) {
            // glasses are second child
            child.scale.y = 0.3; // squash
          }
        });
      } else if (blinkCycle > 9.85 && blinkCycle < 9.9) {
        // Open back up
        head.children.forEach((child, i) => {
          if (i > 0) child.scale.y = 1;
        });
      }

      // Swap pupil colors (black<->white) every ~20 seconds to look different direction
      const lookCycle = Math.floor(t / 20) % 2;
      head.children.forEach((child, i) => {
        if (i > 0 && (child as THREE.Mesh).geometry) {
          const geo = (child as THREE.Mesh).geometry;
          const colors = geo.attributes.color;
          if (colors && !(geo as any).__origColors) {
            // Store original colors on first frame
            (geo as any).__origColors = new Float32Array(colors.array);
          }
          if (colors && (geo as any).__origColors) {
            const orig = (geo as any).__origColors as Float32Array;
            const arr = colors.array as Float32Array;
            for (let ci = 0; ci < arr.length; ci += 3) {
              const r = orig[ci],
                g = orig[ci + 1],
                b = orig[ci + 2];
              // Detect near-black (pupil) and near-white (eye white)
              const isBlack = r < 0.05 && g < 0.05 && b < 0.05;
              const isWhite = r > 0.9 && g > 0.9 && b > 0.9;
              if (lookCycle === 1) {
                if (isBlack) {
                  arr[ci] = 1;
                  arr[ci + 1] = 1;
                  arr[ci + 2] = 1;
                } else if (isWhite) {
                  arr[ci] = 0;
                  arr[ci + 1] = 0;
                  arr[ci + 2] = 0;
                } else {
                  arr[ci] = orig[ci];
                  arr[ci + 1] = orig[ci + 1];
                  arr[ci + 2] = orig[ci + 2];
                }
              } else {
                arr[ci] = orig[ci];
                arr[ci + 1] = orig[ci + 1];
                arr[ci + 2] = orig[ci + 2];
              }
            }
            colors.needsUpdate = true;
          }
        }
      });
    }

    // ── Item in hand ──
    const handBone = handBoneRef.current;
    if (handBone) {
      // Determine what should be in hand (priority: gun > spray can > sword > nothing)
      const wantedItem = s.weaponEquipped
        ? `gun:${s.weaponEquipped}`
        : s.paintColor
          ? `spray:${s.paintColor}`
          : s.swordEquipped
            ? 'sword'
            : null;
      const currentItem = gunGroupRef.current?.name ?? null;

      if (wantedItem !== currentItem) {
        // Remove old item
        if (gunGroupRef.current) {
          handBone.remove(gunGroupRef.current);
          gunGroupRef.current = null;
        }

        if (wantedItem) {
          const item = new THREE.Group();
          item.name = wantedItem;

          if (wantedItem.startsWith('gun:')) {
            // Gun mesh
            const gunType = wantedItem.split(':')[1];
            const mat = new THREE.MeshBasicMaterial({
              color: gunType === 'shotgun' ? '#8B4513' : gunType === 'uzi' ? '#333' : '#555',
            });
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2, 6), mat);
            barrel.rotation.x = Math.PI / 2;
            barrel.position.z = 1;
            item.add(barrel);
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.4), mat);
            item.add(body);
            const grip = new THREE.Mesh(
              new THREE.BoxGeometry(0.15, 0.5, 0.2),
              new THREE.MeshBasicMaterial({ color: '#222' }),
            );
            grip.position.set(0, -0.4, -0.05);
            item.add(grip);
            const flash = new THREE.PointLight('#ff8800', 0, 3);
            flash.name = '__gunFlash';
            flash.position.set(0, 0, 2.2);
            item.add(flash);
          } else if (wantedItem.startsWith('spray:')) {
            // Spray can mesh
            const canColor = wantedItem.split(':')[1];
            const canBody = new THREE.Mesh(
              new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8),
              new THREE.MeshBasicMaterial({ color: canColor }),
            );
            item.add(canBody);
            // Nozzle
            const nozzle = new THREE.Mesh(
              new THREE.CylinderGeometry(0.06, 0.06, 0.08, 6),
              new THREE.MeshBasicMaterial({ color: '#444' }),
            );
            nozzle.position.y = 0.29;
            item.add(nozzle);
            // White tip
            const tip = new THREE.Mesh(
              new THREE.SphereGeometry(0.03, 6, 6),
              new THREE.MeshBasicMaterial({ color: '#fff' }),
            );
            tip.position.y = 0.35;
            item.add(tip);
          } else if (wantedItem === 'sword') {
            // Sword mesh
            const blade = new THREE.Mesh(
              new THREE.BoxGeometry(0.06, 1.8, 0.02),
              new THREE.MeshBasicMaterial({ color: '#c0c0c0' }),
            );
            blade.position.y = 1;
            item.add(blade);
            // Guard
            const guard = new THREE.Mesh(
              new THREE.BoxGeometry(0.3, 0.06, 0.06),
              new THREE.MeshBasicMaterial({ color: '#8B7355' }),
            );
            guard.position.y = 0.1;
            item.add(guard);
            // Grip
            const grip = new THREE.Mesh(
              new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6),
              new THREE.MeshBasicMaterial({ color: '#5C4033' }),
            );
            grip.position.y = -0.1;
            item.add(grip);
          }

          // Scale relative to hand bone (character is 0.14 world scale)
          item.scale.set(1.0, 1.0, 1.0);
          item.position.set(0, 0.3, 0.2);
          item.rotation.set(-Math.PI / 6, 0, 0);
          handBone.add(item);
          gunGroupRef.current = item;
        }
      }

      // Muzzle flash for guns
      if (gunGroupRef.current && s.weaponEquipped) {
        const flash = gunGroupRef.current.getObjectByName('__gunFlash') as THREE.PointLight;
        if (flash) {
          flash.intensity = s.muzzleFlash > 0 ? 5 + Math.random() * 3 : 0;
        }
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Shadow circle — stays on ground, shrinks when airborne */}
      <ShadowCircle stateRef={stateRef} />
      {/* Hoverboard — always mounted, visibility toggled by useFrame */}
      <HoverboardMesh stateRef={stateRef} />
    </group>
  );
}
