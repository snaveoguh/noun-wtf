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

const ANIM_MAP: Record<string, string> = {
  idle: 'Idle',
  walking: 'Walking_A',
  dashing: 'Running_A',
  attacking_punch: 'Unarmed_Melee_Attack_Punch_A',
  attacking_kick: 'Unarmed_Melee_Attack_Kick',
  attacking_headbutt: 'Unarmed_Melee_Attack_Punch_B',
  attacking_uppercut: 'Unarmed_Melee_Attack_Punch_A',
  attacking_spinAttack: '1H_Melee_Attack_Slice_Diagonal',
  attacking_forcePush: 'Spellcast_Shoot',
  attacking_gunshot: '1H_Ranged_Shoot',
  attacking_headshot: '1H_Ranged_Shoot',
  aiming: '1H_Ranged_Aiming',
  reloading: '1H_Ranged_Reload',
  blocking: 'Block',
  backflip: 'Jump_Full_Long',
  stunned: 'Hit_A', // punch/kick recoil — head sway, slight stumble
  wounded: 'Hit_B', // gunshot — collapse to one knee, hold pose
  knocked: 'Death_A', // 3-hit combo knockdown — played at 0.5x speed
  dead: 'Death_A', // full death fall
  dead_headshot: 'Death_B', // headshot instant kill — alternate death anim
  respawning: 'Idle',
  airborne: 'Jump_Full_Short',
};

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

/** Hoverboard mesh — visibility toggled imperatively via useFrame (instant on/off) */
function HoverboardMesh({ stateRef }: { stateRef: React.RefObject<CharacterState> }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    g.visible = stateRef.current?.isSkating ?? false;
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
      <mesh position={[0.55, 0.03, 0]}>
        <boxGeometry args={[0.1, 0.02, 0.24]} />
        <meshBasicMaterial color="#ff00ff" />
      </mesh>
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
            mesh.material = new THREE.MeshBasicMaterial({ color });
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
            const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
            if (nounHead.headGeo) headGroup.add(new THREE.Mesh(nounHead.headGeo, mat));
            if (nounHead.glassesGeo)
              headGroup.add(new THREE.Mesh(nounHead.glassesGeo, mat.clone()));
            child.add(headGroup);
            voxelHeadRef.current = headGroup;
          }
          // Store hand bone for gun attachment
          if (child.name === 'handslot.r') {
            handBoneRef.current = child;
          }
        });

        // Animation mixer
        const mixer = new THREE.AnimationMixer(model);
        const actions: Record<string, THREE.AnimationAction> = {};
        for (const clip of gltf.animations) {
          actions[clip.name] = mixer.clipAction(clip);
        }
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

    // Position
    g.position.set(s.x, s.y + 0.05, s.z);

    // Always face current direction (8-way)
    const baseRotY = DIRECTION_ROTATION[s.direction] ?? 0;
    g.rotation.y = baseRotY;

    // Flailing wobble at jump peak — arms/legs waving like it's sketchy
    if (s.state === 'airborne' || s.state === 'backflip') {
      const t = Date.now() * 0.015;
      const wobbleAmount = 0.12; // how much it wobbles
      g.rotation.x = Math.sin(t * 3.7) * wobbleAmount;
      g.rotation.z = Math.cos(t * 4.3) * wobbleAmount * 0.7;
    } else {
      g.rotation.x = 0;
      g.rotation.z = 0;
    }

    // Animation crossfade
    if (mixer && Object.keys(actions).length > 0) {
      let animKey = s.state as string;
      if (s.state === 'attacking' && s.attackType) animKey = `attacking_${s.attackType}`;
      // Headshot death uses alternate death animation
      if (s.state === 'dead' && s.attackType === 'headshot') animKey = 'dead_headshot';
      const clipName = ANIM_MAP[animKey] ?? 'Idle';
      const isOneShot = ['attacking', 'dead', 'backflip', 'stunned', 'knocked', 'wounded'].includes(
        s.state,
      );

      if (clipName !== prevAnimRef.current && actions[clipName] && !oneShotPlaying.current) {
        const prev = actions[prevAnimRef.current];
        const next = actions[clipName]!;
        if (prev) prev.fadeOut(0.15);
        next.reset().fadeIn(0.15).play();

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

    // ── Gun in hand ──
    const handBone = handBoneRef.current;
    if (handBone) {
      const wep = s.weaponEquipped;
      if (wep && !gunGroupRef.current) {
        // Create tiny gun mesh and attach to hand
        const gun = new THREE.Group();
        const gunScale = 0.08; // very small to not drag on floor
        const mat = new THREE.MeshBasicMaterial({
          color: wep === 'shotgun' ? '#8B4513' : wep === 'uzi' ? '#333' : '#555',
        });
        // Barrel
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2, 6), mat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.z = 1;
        gun.add(barrel);
        // Body
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.4), mat);
        gun.add(body);
        // Grip
        const grip = new THREE.Mesh(
          new THREE.BoxGeometry(0.15, 0.5, 0.2),
          new THREE.MeshBasicMaterial({ color: '#222' }),
        );
        grip.position.set(0, -0.4, -0.05);
        gun.add(grip);
        // Muzzle flash light (starts off)
        const flash = new THREE.PointLight('#ff8800', 0, 3);
        flash.name = '__gunFlash';
        flash.position.set(0, 0, 2.2);
        gun.add(flash);

        gun.scale.set(gunScale, gunScale, gunScale);
        gun.position.set(0, 0, 0.3);
        gun.rotation.set(0, 0, -Math.PI / 4);
        handBone.add(gun);
        gunGroupRef.current = gun;
      } else if (!wep && gunGroupRef.current) {
        // Remove gun
        handBone.remove(gunGroupRef.current);
        gunGroupRef.current = null;
      }

      // Muzzle flash
      if (gunGroupRef.current) {
        const flash = gunGroupRef.current.getObjectByName('__gunFlash') as THREE.PointLight;
        if (flash) {
          if (s.muzzleFlash > 0) {
            flash.intensity = 5 + Math.random() * 3;
          } else {
            flash.intensity = 0;
          }
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
