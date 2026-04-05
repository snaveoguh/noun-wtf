// ── 3D Rigged Character with Voxel Noun Head ────────────────────────

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

import {
  buildNounGeometries,
  seedToLayers,
  type LayerVisibility,
} from '@nouns/voxel-engine';
import { ImageData, getNounData } from '@noundry/nouns-assets';
import type { INounSeed } from '@/wrappers/nounToken';
import type { Direction, MoveType, PlayerState } from './types';

const MODEL_PATH = '/models/character.glb';
const VOXEL_HEAD_SCALE = 0.14; // Doubled because body is halved
const HEAD_VIS: LayerVisibility = { body: false, accessory: false, head: true, glasses: true };

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

useGLTF.preload(MODEL_PATH);

interface Character3DProps {
  seed: INounSeed;
  stateRef: React.RefObject<CharacterState>;
}

export function Character3D({ seed, stateRef }: Character3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const prevAnimRef = useRef('');
  const oneShotPlaying = useRef(false); // true while a one-shot animation is playing

  const { scene, animations } = useGLTF(MODEL_PATH);
  const { actions, mixer } = useAnimations(animations, groupRef);

  const nounHead = useMemo(() => {
    try {
      const layers = seedToLayers(seed, getNounData, ImageData.palette, HEAD_VIS);
      return buildNounGeometries(layers);
    } catch {
      return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
    }
  }, [seed]);

  const bodyColor = useMemo(() => getNounBodyColor(seed), [seed]);

  // Setup scene — runs once via scene.__setup flag
  useEffect(() => {
    if ((scene.userData as any).__setup) return;
    (scene.userData as any).__setup = true;

    // Hide head, cape, weapons; set solid colors
    scene.traverse((child: THREE.Object3D) => {
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

    // Attach voxel head to head bone (only if not already attached)
    scene.traverse((child: THREE.Object3D) => {
      if (child.name === 'head' && (child as any).isBone) {
        // Remove any previously attached voxel heads
        const existing = child.children.filter(c => c.name === '__nounHead');
        existing.forEach(c => child.remove(c));

        const headGroup = new THREE.Group();
        headGroup.name = '__nounHead';
        headGroup.scale.set(VOXEL_HEAD_SCALE, VOXEL_HEAD_SCALE, VOXEL_HEAD_SCALE);
        headGroup.position.set(0, 0.45, 0);
        const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
        if (nounHead.headGeo) headGroup.add(new THREE.Mesh(nounHead.headGeo, mat));
        if (nounHead.glassesGeo) headGroup.add(new THREE.Mesh(nounHead.glassesGeo, mat.clone()));
        child.add(headGroup);
      }
    });

    // Start idle
    if (actions['Idle']) actions['Idle']!.play();
  }, [scene, actions, bodyColor, nounHead]);

  // Per-frame update from stateRef
  useFrame((_, delta) => {
    const g = groupRef.current;
    const s = stateRef.current;
    if (!g || !s) return;

    g.position.set(s.x, s.y + 0.05, s.z);

    // Model faces +Z at rotation 0. Camera at +Z. So rotation PI = facing away.
    // Set initial facing away
    if (prevAnimRef.current === '') {
      g.rotation.y = Math.PI;
      prevAnimRef.current = 'Idle';
    }

    // Rotation — direct set, no lerp (eliminates all spazzing)
    if (s.state === 'walking' || s.state === 'dashing' || s.state === 'attacking') {
      const target =
        s.direction === 'up' ? Math.PI :
        s.direction === 'down' ? 0 :
        s.direction === 'left' ? Math.PI * 1.5 :
        Math.PI * 0.5;
      g.rotation.y = target;
    }

    // Animation crossfade
    if (Object.keys(actions).length > 0) {
      let animKey = s.state as string;
      if (s.state === 'attacking' && s.attackType) animKey = `attacking_${s.attackType}`;
      const clipName = ANIM_MAP[animKey] ?? 'Idle';
      const isOneShot = ['attacking', 'dead', 'backflip', 'stunned'].includes(s.state);

      // Don't re-trigger if a one-shot is already playing
      if (clipName !== prevAnimRef.current && actions[clipName] && !oneShotPlaying.current) {
        const prev = actions[prevAnimRef.current];
        const next = actions[clipName]!;
        if (prev) prev.fadeOut(0.15);
        next.reset().fadeIn(0.15).play();

        if (isOneShot) {
          next.setLoop(THREE.LoopOnce, 1);
          next.clampWhenFinished = true;
          oneShotPlaying.current = true;
          // Auto-return to idle when done
          const onFinished = () => {
            mixer.removeEventListener('finished', onFinished);
            oneShotPlaying.current = false;
            prevAnimRef.current = '__done'; // force re-eval next frame
          };
          mixer.addEventListener('finished', onFinished);
        } else {
          next.setLoop(THREE.LoopRepeat, Infinity);
        }
        prevAnimRef.current = clipName;
      }

      // If one-shot finished and state went back to idle/walking, transition
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

    g.visible = true;
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} scale={0.28} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.35, 12]} />
        <meshBasicMaterial color="#000" transparent opacity={0.2} />
      </mesh>
    </group>
  );
}
