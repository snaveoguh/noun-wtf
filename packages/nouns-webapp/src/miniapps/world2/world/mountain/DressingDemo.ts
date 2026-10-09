// ── Dev: standalone dressing test patch (?dressing=1) ───────────────────
//
// A 2×2-chunk downhill heightfield east of the plaza (x 128–384, z −128–128)
// with a meandering dirt track, a trench like the real mountain's and one
// guaranteed hollow, dressed by MountainDressing exactly as the endless
// mountain's chunks would be. Lets the dressing be judged (and screenshot)
// without the mountain itself. Exposed as `window.__dressing`.

import type { Graphics } from '../../render/Graphics';

import * as THREE from 'three';

import { toonify } from '../../render/Toon';

import { MountainDressing, type DressingChunkStats, type DressingResult } from './Dressing';
import { fbm, smoothstep, type TerrainQuery } from './dressingUtil';

const CHUNK = 128;
const X0 = 128;
const Z0 = -128;
const N = 2;
const TRACK_HALF = 6.5;
const SEED = 0x6e6f756e;
/** Float the patch well above the plaza's surroundings (nothing clips it). */
const DEMO_Y = 60;
/** Hand-placed springs so the small patch always shows creeks + a crossing. */
export const DEMO_SPRINGS: [number, number][] = [
  [140, 58],
  [150, -62],
  [232, 74],
];

/** The demo heightfield: radial-ish slope down +X, hills, a track trench, a hollow. */
export function demoTerrain(): TerrainQuery {
  const TX0 = 60;
  const TSTEP = 2;
  const tx: number[] = [];
  const tz: number[] = [];
  for (let x = TX0; x <= 640; x += TSTEP) {
    tx.push(x);
    tz.push(26 * Math.sin((x - 96) / 66) + 10 * Math.sin((x - 96) / 27 + 1));
  }
  const trackDist = (x: number, z: number) => {
    let best = Infinity;
    const i0 = Math.max(0, Math.min(tx.length - 2, Math.floor((x - TX0) / TSTEP)));
    for (const dir of [1, -1]) {
      for (let i = dir === 1 ? i0 : i0 - 1; i >= 0 && i < tx.length - 1; i += dir) {
        const gap = dir === 1 ? tx[i] - x : x - tx[i + 1];
        if (gap > best) break;
        const ax = tx[i];
        const az = tz[i];
        const dx = tx[i + 1] - ax;
        const dz = tz[i + 1] - az;
        let u = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
        if (d < best) best = d;
      }
    }
    return Math.min(best, 96);
  };
  const height = (x: number, z: number) => {
    const d = trackDist(x, z);
    const base = -2.5 - 0.14 * (x - 100);
    const hills = fbm(x, z, 90, SEED + 3) * 5.5 + fbm(x, z, 28, SEED + 7) * 1.4;
    const mask = smoothstep(TRACK_HALF, TRACK_HALF + 34, d);
    const trench = 3.4 * smoothstep(0, 55, d);
    const hx = x - 322;
    const hz = z + 74;
    const hollow = -5.2 * Math.exp(-(hx * hx + hz * hz) / (2 * 12 * 12));
    return DEMO_Y + base + hills * mask + trench + hollow * mask;
  };
  return {
    height,
    trackDist,
    normal(x, z, out) {
      const e = 0.3;
      const gx = (height(x + e, z) - height(x - e, z)) / (2 * e);
      const gz = (height(x, z + e) - height(x, z - e)) / (2 * e);
      return out.set(-gx, 1, -gz).normalize();
    },
  };
}

const GRASS = new THREE.Color(0x5cc04a);
const GRASS_DRY = new THREE.Color(0x9ccf4f);
const GRASS_DARK = new THREE.Color(0x3f9a3c);
const DIRT = new THREE.Color(0xc58a4e);

function terrainMesh(t: TerrainQuery, ox: number, oz: number, toon: boolean): THREE.Mesh {
  const n = 64;
  const step = CHUNK / n;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = ox + i * step;
      const z = oz + j * step;
      pos.push(i * step, t.height(x, z), j * step);
      const tn = fbm(x, z, 23, SEED + 51);
      c.copy(GRASS).lerp(tn > 0 ? GRASS_DRY : GRASS_DARK, Math.min(1, Math.abs(tn) * 0.9));
      c.lerp(DIRT, smoothstep(TRACK_HALF + 2, TRACK_HALF - 0.5, t.trackDist(x, z)));
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.name = 'dressing-demo-terrain';
  m.position.set(ox, 0, oz);
  m.receiveShadow = true;
  m.updateMatrixWorld(true);
  if (toon) toonify(m);
  return m;
}

export interface DressingDemo {
  group: THREE.Group;
  /** Terrain + dressing colliders, world space (add to CollisionWorld.build). */
  collisionMeshes: THREE.Mesh[];
  dressing: MountainDressing;
  chunks: DressingResult[];
  stats: DressingChunkStats[];
  /** Camera to (px, py, pz) looking at (tx, ty, tz), then render one frame. */
  view(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void;
  /** Ground height of the demo patch. */
  height(x: number, z: number): number;
  /** Rebuild every chunk (timing check). */
  rebuild(): DressingChunkStats[];
  dispose(): void;
}

export function buildDressingDemo(gfx: Graphics): DressingDemo {
  const terrain = demoTerrain();
  const dressing = new MountainDressing(terrain, {
    seed: SEED,
    trackHalf: TRACK_HALF,
    quality: gfx.quality,
    springs: DEMO_SPRINGS,
  });
  const group = new THREE.Group();
  group.name = 'dressing-demo';
  const collisionMeshes: THREE.Mesh[] = [];
  const chunks: DressingResult[] = [];
  const stats: DressingChunkStats[] = [];
  const build = () => {
    for (const c of chunks) c.dispose();
    chunks.length = 0;
    stats.length = 0;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const ox = X0 + ix * CHUNK;
        const oz = Z0 + iz * CHUNK;
        const r = dressing.populate({
          ix: ox / CHUNK,
          iz: oz / CHUNK,
          size: CHUNK,
          origin: { x: ox, z: oz },
        });
        if (r === null) continue;
        r.object.position.set(ox, 0, oz);
        r.object.updateMatrixWorld(true);
        group.add(r.object);
        chunks.push(r);
        stats.push(r.stats);
        if (r.collision !== undefined) {
          const cm = new THREE.Mesh(r.collision);
          cm.position.set(ox, 0, oz);
          cm.updateMatrixWorld(true);
          collisionMeshes.push(cm);
        }
      }
    }
    return stats;
  };
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const m = terrainMesh(terrain, X0 + ix * CHUNK, Z0 + iz * CHUNK, gfx.toon);
      group.add(m);
      collisionMeshes.push(m);
    }
  }
  build();
  gfx.scene.add(group);
  const target = new THREE.Vector3();
  return {
    group,
    collisionMeshes,
    dressing,
    chunks,
    stats,
    height: terrain.height,
    view(px, py, pz, tx, ty, tz) {
      const cam = gfx.camera;
      cam.position.set(px, py, pz);
      cam.lookAt(tx, ty, tz);
      cam.updateMatrixWorld(true);
      gfx.followShadow(target.set(tx, ty, tz));
      gfx.render(1 / 60);
    },
    rebuild: () => {
      const s = build().slice();
      for (const c of chunks) if (c.object.parent === null) group.add(c.object);
      return s;
    },
    dispose() {
      for (const c of chunks) c.dispose();
      gfx.scene.remove(group);
    },
  };
}
