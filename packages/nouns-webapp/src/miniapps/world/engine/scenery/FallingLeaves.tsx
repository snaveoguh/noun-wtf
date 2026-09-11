// ── FallingLeaves — leaves drift off nearby canopies in the wind ─────
//
// A single InstancedMesh of small quads. Each leaf spawns at the top of a
// tree within ~45 units of the player (see floraData.pickTreeNear), falls
// with a flutter, rides the shared wind, settles on the terrain for a
// beat, then respawns. No trees nearby → no leaves. CPU cost is a few
// hundred matrix writes per frame.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleTerrainY } from '../tilemap';
import { getFloraData, pickTreeNear } from './floraData';
import { WIND } from './wind';

const PALETTE = ['#c8742a', '#d9a441', '#8a9a2f', '#b5522f', '#e0c060', '#6f8f2a', '#a3b24a'];
const SPAWN_RADIUS = 46;
const DESPAWN_RADIUS = 70;
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

interface LeavesProps {
  /** Player position (Three.js units). */
  targetRef: React.MutableRefObject<THREE.Vector3>;
  count?: number;
}

export function FallingLeaves({ targetRef, count = 240 }: LeavesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geo = useMemo(() => new THREE.PlaneGeometry(0.15, 0.1), []);
  const mat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  // Per-leaf state: x y z vx vy vz rx ry rz spinA spinB phase rest alive
  const state = useMemo(() => {
    const s = {
      pos: new Float32Array(count * 3),
      vel: new Float32Array(count * 3),
      rot: new Float32Array(count * 3),
      spin: new Float32Array(count * 2),
      phase: new Float32Array(count),
      rest: new Float32Array(count),
      alive: new Uint8Array(count),
    };
    for (let i = 0; i < count; i++) s.phase[i] = Math.random() * Math.PI * 2;
    return s;
  }, [count]);

  // Colours once.
  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    for (let i = 0; i < count; i++) {
      tmpColor.set(PALETTE[i % PALETTE.length]);
      m.setColorAt(i, tmpColor);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [count]);

  useFrame((_, delta) => {
    const m = meshRef.current;
    if (!m) return;
    const dt = Math.min(delta, 0.05);
    const p = targetRef.current;
    const { pos, vel, rot, spin, phase, rest, alive } = state;
    const trees = getFloraData().trees;
    let spawns = 0;
    const t = WIND.time;
    const wx = WIND.dirX * WIND.strength;
    const wz = WIND.dirZ * WIND.strength;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      if (!alive[i]) {
        if (spawns < 4 && Math.random() < 0.35) {
          const ti = pickTreeNear(p.x, p.z, SPAWN_RADIUS);
          if (ti >= 0) {
            spawns++;
            alive[i] = 1;
            rest[i] = 0;
            pos[i3] = trees.xyz[ti * 3] + (Math.random() - 0.5) * 1.2;
            pos[i3 + 1] = trees.xyz[ti * 3 + 1] - Math.random() * 0.8;
            pos[i3 + 2] = trees.xyz[ti * 3 + 2] + (Math.random() - 0.5) * 1.2;
            vel[i3] = 0;
            vel[i3 + 1] = -(0.35 + Math.random() * 0.3);
            vel[i3 + 2] = 0;
            rot[i3] = Math.random() * 6.28;
            rot[i3 + 1] = Math.random() * 6.28;
            rot[i3 + 2] = Math.random() * 6.28;
            spin[i * 2] = (Math.random() - 0.5) * 6;
            spin[i * 2 + 1] = (Math.random() - 0.5) * 4;
          }
        }
        if (!alive[i]) {
          dummy.position.set(0, -50, 0);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
          continue;
        }
      }

      let x = pos[i3];
      let y = pos[i3 + 1];
      let z = pos[i3 + 2];
      const ground = sampleTerrainY(x, z) + 0.02;
      if (y > ground) {
        const ph = phase[i];
        x += (Math.sin(t * 2.1 + ph) * 0.55 + wx * 1.1) * dt;
        z += (Math.cos(t * 1.7 + ph * 1.3) * 0.55 + wz * 1.1) * dt;
        y += vel[i3 + 1] * dt * (0.7 + 0.3 * Math.sin(t * 3.3 + ph));
        rot[i3] += spin[i * 2] * dt;
        rot[i3 + 1] += spin[i * 2 + 1] * dt;
        rot[i3 + 2] += Math.sin(t * 2.6 + ph) * 1.5 * dt;
        if (y <= ground) {
          y = ground;
          rot[i3] = -Math.PI / 2 + (Math.random() - 0.5) * 0.4;
        }
      } else {
        rest[i] += dt;
        if (rest[i] > 2.2) alive[i] = 0;
      }
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz > DESPAWN_RADIUS * DESPAWN_RADIUS) alive[i] = 0;

      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;
      dummy.position.set(x, y, z);
      dummy.rotation.set(rot[i3], rot[i3 + 1], rot[i3 + 2]);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geo, mat, count]}
      frustumCulled={false}
      raycast={() => undefined}
    />
  );
}
