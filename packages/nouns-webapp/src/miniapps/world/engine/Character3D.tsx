// ── 3D Rigged Character with Voxel Noun Head ────────────────────────
// Each instance loads its own GLB copy for independent skeletons.

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  buildNounGeometries,
  seedToLayers,
  type LayerVisibility,
} from '@nouns/voxel-engine';
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
  stunned: 'Hit_A',                         // punch/kick recoil — head sway, slight stumble
  wounded: 'Hit_B',                         // gunshot — collapse to one knee, hold pose
  knocked: 'Death_A',                       // 3-hit combo knockdown — played at 0.5x speed
  dead: 'Death_A',                          // full death fall
  dead_headshot: 'Death_B',                 // headshot instant kill — alternate death anim
  respawning: 'Idle',
  airborne: 'Jump_Full_Short',
};

// Animations that play at custom speeds
const ANIM_SPEED: Partial<Record<string, number>> = {
  knocked: 0.5,    // slow-motion fall for combo knockdown
  wounded: 0.6,    // slightly slowed knee collapse
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
    glbFetching = fetch(MODEL_PATH).then(r => r.arrayBuffer()).then(buf => {
      glbBuffer = buf;
      return buf;
    });
  }
  return glbFetching;
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

  const nounHeadRef = useRef((() => {
    try {
      const layers = seedToLayers(seed, getNounData, ImageData.palette, HEAD_VIS);
      return buildNounGeometries(layers);
    } catch {
      return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
    }
  })());

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
      loader.parse(buffer.slice(0), '', (gltf) => {
        if (cancelled || !groupRef.current) return;

        model = gltf.scene;
        model.scale.set(BODY_SCALE, BODY_SCALE, BODY_SCALE);

        // Setup: hide head/cape/weapons, tint body
        model.traverse((child: THREE.Object3D) => {
          if (child.name === 'Rogue_Head' || child.name === 'Rogue_Cape') child.visible = false;
          if (child.name.includes('Knife') || child.name.includes('Crossbow') ||
              child.name.includes('Throwable') || child.name.includes('handslot') ||
              child.name.includes('1H_') || child.name.includes('2H_') ||
              child.name === 'Rogue_ArmLeft') {
            child.visible = false;
          }
          if ((child as THREE.SkinnedMesh).isSkinnedMesh && child.visible) {
            const mesh = child as THREE.SkinnedMesh;
            const color = child.name.includes('Leg') ? '#443322' : bodyColor;
            mesh.material = new THREE.MeshBasicMaterial({ color });
            mesh.frustumCulled = false;
          }
        });

        // Attach voxel head to head bone
        model.traverse((child: THREE.Object3D) => {
          if (child.name === 'head' && (child as any).isBone) {
            const headGroup = new THREE.Group();
            headGroup.scale.set(VOXEL_HEAD_SCALE, VOXEL_HEAD_SCALE, VOXEL_HEAD_SCALE);
            headGroup.position.set(0, 0.65, 0);
            const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
            if (nounHead.headGeo) headGroup.add(new THREE.Mesh(nounHead.headGeo, mat));
            if (nounHead.glassesGeo) headGroup.add(new THREE.Mesh(nounHead.glassesGeo, mat.clone()));
            child.add(headGroup);
            voxelHeadRef.current = headGroup;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    g.rotation.y = DIRECTION_ROTATION[s.direction] ?? 0;

    // Animation crossfade
    if (mixer && Object.keys(actions).length > 0) {
      let animKey = s.state as string;
      if (s.state === 'attacking' && s.attackType) animKey = `attacking_${s.attackType}`;
      // Headshot death uses alternate death animation
      if (s.state === 'dead' && s.attackType === 'headshot') animKey = 'dead_headshot';
      const clipName = ANIM_MAP[animKey] ?? 'Idle';
      const isOneShot = [
        'attacking', 'dead', 'backflip', 'stunned',
        'knocked', 'wounded',
      ].includes(s.state);

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
          if (i > 0) { // glasses are second child
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
          if (colors && !((geo as any).__origColors)) {
            // Store original colors on first frame
            (geo as any).__origColors = new Float32Array(colors.array);
          }
          if (colors && (geo as any).__origColors) {
            const orig = (geo as any).__origColors as Float32Array;
            const arr = colors.array as Float32Array;
            for (let ci = 0; ci < arr.length; ci += 3) {
              const r = orig[ci], g = orig[ci + 1], b = orig[ci + 2];
              // Detect near-black (pupil) and near-white (eye white)
              const isBlack = r < 0.05 && g < 0.05 && b < 0.05;
              const isWhite = r > 0.9 && g > 0.9 && b > 0.9;
              if (lookCycle === 1) {
                if (isBlack) { arr[ci] = 1; arr[ci + 1] = 1; arr[ci + 2] = 1; }
                else if (isWhite) { arr[ci] = 0; arr[ci + 1] = 0; arr[ci + 2] = 0; }
                else { arr[ci] = orig[ci]; arr[ci + 1] = orig[ci + 1]; arr[ci + 2] = orig[ci + 2]; }
              } else {
                arr[ci] = orig[ci]; arr[ci + 1] = orig[ci + 1]; arr[ci + 2] = orig[ci + 2];
              }
            }
            colors.needsUpdate = true;
          }
        }
      });
    }
  });

  return (
    <group ref={groupRef}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.25, 12]} />
        <meshBasicMaterial color="#000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}
