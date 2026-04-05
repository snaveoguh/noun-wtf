// ── 3D Rigged Character with Voxel Noun Head ────────────────────────
// Each instance loads its own GLB copy for independent skeletons.

import { useEffect, useRef, useMemo } from 'react';
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
import type { Direction, MoveType, PlayerState } from './types';

const MODEL_PATH = '/models/character.glb';
const VOXEL_HEAD_SCALE = 0.28;
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
  blocking: 'Block',
  backflip: 'Jump_Full_Long',
  stunned: 'Hit_A',
  dead: 'Death_A',
  respawning: 'Idle',
  airborne: 'Jump_Full_Short',
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
            headGroup.position.set(0, 1.2, 0);
            const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
            if (nounHead.headGeo) headGroup.add(new THREE.Mesh(nounHead.headGeo, mat));
            if (nounHead.glassesGeo) headGroup.add(new THREE.Mesh(nounHead.glassesGeo, mat.clone()));
            child.add(headGroup);
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

    // Always face current direction
    const targetRot =
      s.direction === 'up' ? Math.PI :
      s.direction === 'down' ? 0 :
      s.direction === 'left' ? Math.PI * 1.5 :
      Math.PI * 0.5;
    g.rotation.y = targetRot;

    // Animation crossfade
    if (mixer && Object.keys(actions).length > 0) {
      let animKey = s.state as string;
      if (s.state === 'attacking' && s.attackType) animKey = `attacking_${s.attackType}`;
      const clipName = ANIM_MAP[animKey] ?? 'Idle';
      const isOneShot = ['attacking', 'dead', 'backflip', 'stunned'].includes(s.state);

      if (clipName !== prevAnimRef.current && actions[clipName] && !oneShotPlaying.current) {
        const prev = actions[prevAnimRef.current];
        const next = actions[clipName]!;
        if (prev) prev.fadeOut(0.15);
        next.reset().fadeIn(0.15).play();

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
          next.setLoop(THREE.LoopRepeat, Infinity);
          prevAnimRef.current = clipName;
        }
      }

      mixer.update(delta);
    }

    // visibility managed by model load — no toggling
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
