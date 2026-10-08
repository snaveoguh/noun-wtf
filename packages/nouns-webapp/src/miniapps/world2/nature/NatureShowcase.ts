// ── Drop-in park corner, fountain and fallback-tree upgrade ─────────────

import type { NatureSystem } from './index';
import type { GroundQuery } from './shared';
import type { WaterBody } from './Water';

import * as THREE from 'three';

import { NATURE_BED_LAYER, Rng, groundAt, natureUniforms, toonMaterial } from './shared';
import { FLOWER_CELLS } from './textures';
import { applyCaustics } from './Water';

/** Irregular closed blob (XZ) around a centre. */
function blob(
  cx: number,
  cz: number,
  r: number,
  seed: number,
  n = 18,
  amp = 0.22,
): [number, number][] {
  const rng = new Rng(seed);
  const ph = [rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)];
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k =
      1 +
      amp *
        (0.6 * Math.sin(a * 2 + ph[0]) +
          0.3 * Math.sin(a * 3 + ph[1]) +
          0.2 * Math.sin(a * 5 + ph[2]));
    out.push([cx + Math.cos(a) * r * k, cz + Math.sin(a) * r * k * 0.8]);
  }
  return out;
}

export interface ShowcaseResult {
  group: THREE.Group;
  pond: WaterBody;
  stream: WaterBody;
  bounds: THREE.Box3;
}

/**
 * Lay out a ~30×44 m lush park corner centred on `origin`: a pond ringed
 * with boulders, a winding stream with pebble banks, broadleaf trees,
 * palms on the plaza side, bushes (some flowering), dense grass and
 * meadow flowers on a lawn. Call `nature.build()` afterwards and merge
 * `nature.collisionMeshes()` into the collision world.
 */
export function buildNatureShowcase(
  nature: NatureSystem,
  ground: GroundQuery | null,
  origin: THREE.Vector3,
): ShowcaseResult {
  const g0 = groundAt(ground, origin.x, origin.z, origin.y);
  const Y = g0.y;
  const O = new THREE.Vector3(origin.x, Y, origin.z);
  const at = (x: number, z: number): [number, number] => [O.x + x, O.z + z];
  const level = Y + 0.035;

  // ── Pond
  const pondPts = blob(4, -6, 5.2, 3).map(([x, z]) => at(x, z));
  const pond = nature.water.create({
    name: 'pond',
    shape: { type: 'polygon', points: pondPts },
    level,
    depth: 0.75,
    shoreWidth: 1.6,
    beach: 0.8,
    ripples: [
      [O.x + 5.5, O.z - 6.5, 0.35],
      [O.x + 1.5, O.z - 4.5, 0.25],
    ],
  });
  // ── Stream (flows south)
  const streamPts: [number, number][] = [
    at(-10, 17),
    at(-8, 12),
    at(-10.5, 6),
    at(-7.5, 0),
    at(-9.5, -6),
    at(-7, -12),
    at(-9, -17),
  ];
  const stream = nature.water.create({
    name: 'stream',
    shape: { type: 'path', points: streamPts, width: 2.0 },
    level,
    depth: 0.35,
    shoreWidth: 0.6,
    beach: 0.6,
    flowSpeed: 1.2,
  });

  // ── Boulders around the pond (gap on the lawn side for access)
  const wet = nature.wetRocks;
  const ring = pondPts.map(([x, z]) => new THREE.Vector3(x, level, z));
  wet.addAlong(ring, {
    closed: true,
    spacing: 1.25,
    size: [0.45, 1.0],
    offset: -0.25,
    jitter: 0.3,
    pebbles: 3,
    ground,
    skip: t => t > 0.62 && t < 0.8,
  });
  // A few rocks standing in the water
  const rng = new Rng(42);
  for (const [x, z, s] of [
    [5.5, -6.5, 0.9],
    [1.5, -4.5, 0.6],
    [6.8, -4.2, 0.5],
  ] as const) {
    wet.add({
      position: new THREE.Vector3(O.x + x, level - 0.45, O.z + z),
      size: new THREE.Vector3(s * 1.2, s, s),
      rotation: new THREE.Euler(0, rng.range(0, 6), 0),
      variant: rng.int(0, 4),
      collide: true,
    });
  }
  // Stream banks + stepping stones
  const sp = streamPts.map(([x, z]) => new THREE.Vector3(x, level, z));
  for (const side of [-1, 1]) {
    wet.addAlong(sp, {
      spacing: 1.7,
      size: [0.3, 0.75],
      offset: side * 1.25,
      jitter: 0.2,
      pebbles: 2,
      ground,
    });
  }
  for (const t of [0.32, 0.36, 0.4]) {
    const curve = new THREE.CatmullRomCurve3(sp, false, 'centripetal');
    const p = curve.getPointAt(t);
    wet.add({
      position: new THREE.Vector3(p.x + rng.range(-0.3, 0.3), level - 0.12, p.z),
      size: new THREE.Vector3(0.55, 0.32, 0.5),
      variant: rng.int(0, 4),
    });
  }
  // Rock piles at the stream's source and mouth
  for (const [x, z] of [streamPts[0], streamPts[streamPts.length - 1]]) {
    for (let i = 0; i < 4; i++) {
      wet.add({
        position: new THREE.Vector3(
          x + rng.range(-1.2, 1.2),
          level - 0.1,
          z + rng.range(-0.8, 0.8),
        ),
        size: rng.range(0.6, 1.2),
        variant: rng.int(0, 4),
        collide: true,
      });
    }
  }

  // ── Vegetation
  const lawn = { type: 'rect' as const, center: at(0, 0), size: [30, 44] as [number, number] };
  const nearWater = (x: number, z: number, m: number) =>
    pond.edgeDistance(x, z) > -m || stream.edgeDistance(x, z) > -m;
  const f = nature.foliage;
  f.addLawn(lawn, Y);
  for (const [x, z, s] of [
    [-2, 13, 1.1],
    [8, 11, 1],
    [11, -16, 1.05],
    [-13, -15, 0.95],
    [-1, -18, 0.9],
    [-14, 8, 0.9],
  ] as const) {
    f.addPlant({
      kind: 'broadleaf',
      position: new THREE.Vector3(O.x + x, Y, O.z + z),
      rotation: x * 1.3,
      scale: s,
    });
  }
  for (const [x, z, s] of [
    [13, 9, 1],
    [13.5, 0.5, 1.1],
    [12.5, 17, 0.9],
    [13, -9, 1.05],
  ] as const) {
    f.addPlant({
      kind: 'palm',
      position: new THREE.Vector3(O.x + x, Y, O.z + z),
      rotation: z,
      scale: s,
    });
  }
  f.scatter(ground, [
    {
      region: lawn,
      y: Y,
      grass: 1,
      flowers: 0.9,
      bushes: 3.2,
      inset: 1.2,
      exclude: (x, z) => nearWater(x, z, 1.3),
    },
  ]);
  // Flowering bushes hugging the pond
  for (let i = 0; i < 7; i++) {
    const p = ring[(i * 5 + 2) % ring.length];
    const dir = new THREE.Vector3(p.x - (O.x + 4), 0, p.z - (O.z - 6)).normalize();
    f.addPlant({
      kind: i % 2 === 0 ? 'flowerBush' : 'bush',
      position: new THREE.Vector3(p.x + dir.x * 1.6, Y, p.z + dir.z * 1.6),
      rotation: i,
      scale: rng.range(0.8, 1.1),
    });
  }
  const bounds = new THREE.Box3(
    new THREE.Vector3(O.x - 15, Y - 1, O.z - 22),
    new THREE.Vector3(O.x + 15, Y + 12, O.z + 22),
  );
  return { group: nature.group, pond, stream, bounds };
}

// ── Fountain ────────────────────────────────────────────────────────────

const CURTAIN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;
const CURTAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
float h( float x ) { return fract( sin( x * 91.7 ) * 43758.5 ); }
void main() {
  // Long, thin falling streaks (cel water sheet): per-column speed/phase.
  float cols = 110.0;
  float c = floor( vUv.x * cols );
  float fx = fract( vUv.x * cols );
  float speed = 0.9 + h( c ) * 0.8;
  float s = fract( vUv.y * 0.9 + uTime * speed + h( c + 7.0 ) );
  float on = step( 0.35, s ) * step( 0.45, h( c + 11.0 ) ) * step( abs( fx - 0.5 ), 0.32 );
  float base = 0.22 + 0.1 * step( 0.5, h( c + 3.0 ) );
  float a = mix( base, 0.85, on ) * smoothstep( 0.0, 0.12, vUv.y );
  gl_FragColor = vec4( mix( uColor, vec3( 1.0 ), on * 0.85 ), a );
}
`;

/**
 * Two-tier plaza fountain: stone basin + rim (collision), caustic basin
 * floor, rippling water, pedestal, upper bowl and a stylised falling
 * water curtain. Returns the group (already added to `nature.group`).
 */
export function createFountain(
  nature: NatureSystem,
  center: THREE.Vector3,
  opts: { radius?: number; stone?: number } = {},
): THREE.Group {
  const R = opts.radius ?? 3.4;
  const group = new THREE.Group();
  group.name = 'fountain';
  group.position.copy(center);
  const stone = toonMaterial({ color: opts.stone ?? 0xf1e6d2 });
  const rimH = 0.5;
  const level = center.y + rimH - 0.12;
  // Rim: lathe profile (outer wall, rounded cap, inner wall)
  const prof = [
    new THREE.Vector2(R + 0.35, 0),
    new THREE.Vector2(R + 0.35, rimH - 0.08),
    new THREE.Vector2(R + 0.28, rimH),
    new THREE.Vector2(R + 0.02, rimH),
    new THREE.Vector2(R - 0.02, rimH - 0.08),
    new THREE.Vector2(R - 0.02, -0.15),
  ];
  const rim = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), stone);
  rim.castShadow = true;
  rim.receiveShadow = true;
  rim.layers.enable(NATURE_BED_LAYER);
  group.add(rim);
  // Basin floor (tiles via pebble map would be busy — flat stone with caustics)
  const floorMat = applyCaustics(toonMaterial({ color: 0x8fd6d0 }), level, 0.8);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 48), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = rimH - 0.55;
  floor.receiveShadow = true;
  floor.layers.enable(NATURE_BED_LAYER);
  group.add(floor);
  // Pedestal + upper bowl
  const pedMat = applyCaustics(toonMaterial({ color: opts.stone ?? 0xf1e6d2 }), level, 0.8);
  const ped = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.55, 0),
        new THREE.Vector2(0.38, 0.4),
        new THREE.Vector2(0.28, 1.2),
        new THREE.Vector2(0.4, 1.45),
        new THREE.Vector2(1.15, 1.55),
        new THREE.Vector2(1.2, 1.72),
        new THREE.Vector2(1.05, 1.7),
      ],
      32,
    ),
    pedMat,
  );
  ped.position.y = rimH - 0.55;
  ped.castShadow = true;
  ped.receiveShadow = true;
  ped.layers.enable(NATURE_BED_LAYER);
  group.add(ped);
  const topY = rimH - 0.55 + 1.66;
  // Curtain of water falling from the upper bowl
  const uTime = natureUniforms.uTime;
  const curtain = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.32, topY - (level - center.y), 48, 1, true),
    new THREE.ShaderMaterial({
      vertexShader: CURTAIN_VERT,
      fragmentShader: CURTAIN_FRAG,
      uniforms: { uTime, uColor: { value: new THREE.Color(0.55, 0.92, 1.0) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  curtain.position.y = (topY + (level - center.y)) / 2;
  group.add(curtain);
  nature.group.add(group);
  group.updateMatrixWorld(true);
  // Water surfaces
  const ripples: [number, number, number][] = [0, 1, 2, 3, 4].map(i => {
    const a = (i / 5) * Math.PI * 2;
    return [center.x + Math.cos(a) * 1.3, center.z + Math.sin(a) * 1.3, 0.5];
  });
  nature.water.create({
    name: 'fountain-water',
    shape: { type: 'circle', center: [center.x, center.z], radius: R },
    level,
    bed: false,
    ripples,
    look: { foamWidth: 0.05 },
  });
  nature.water.create({
    name: 'fountain-upper',
    shape: { type: 'circle', center: [center.x, center.z], radius: 1.08 },
    level: center.y + topY + 0.02,
    bed: false,
    ripples: [[center.x, center.z, 0.6]],
  });
  // Collision: solid cylinder for the rim
  const col = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R + 0.35, rimH, 24));
  col.position.set(center.x, center.y + rimH / 2, center.z);
  col.updateMatrixWorld(true);
  nature.addCollision(col);
  return group;
}

// ── Fallback-park upgrade ───────────────────────────────────────────────

/**
 * Replace FallbackPark's placeholder trees (brown cylinder trunk +
 * icosahedron blobs) with instanced palms/broadleaves. Uses
 * `userData.natureTree = { x, z, s }` when present, otherwise detects the
 * placeholder meshes by geometry type + colour. The existing trunk
 * collision boxes are kept. Call `nature.build()` afterwards.
 */
export function replaceFallbackTrees(levelRoot: THREE.Object3D, nature: NatureSystem): number {
  const remove: THREE.Object3D[] = [];
  const spots: { x: number; y: number; z: number; s: number }[] = [];
  levelRoot.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh !== true) return;
    const tag = m.userData.natureTree as { x: number; z: number; s: number } | undefined;
    const mat = m.material as THREE.MeshStandardMaterial;
    const hex = mat.color?.getHex();
    if (m.geometry.type === 'IcosahedronGeometry' && hex === 0x3f7a35) {
      remove.push(m);
      return;
    }
    if (tag !== undefined) {
      spots.push({ x: tag.x, y: 0, z: tag.z, s: tag.s });
      remove.push(m);
      return;
    }
    if (m.geometry.type === 'CylinderGeometry' && hex === 0x6b4a2f) {
      const h = (m.geometry as THREE.CylinderGeometry).parameters.height;
      const s = h / 3.2;
      spots.push({ x: m.position.x, y: m.position.y - h / 2, z: m.position.z, s });
      remove.push(m);
    }
  });
  for (const r of remove) r.parent?.remove(r);
  spots.forEach((p, i) => {
    nature.foliage.addPlant({
      kind: i % 3 === 1 ? 'broadleaf' : 'palm',
      position: new THREE.Vector3(p.x, p.y, p.z),
      rotation: i * 2.1,
      scale: p.s,
      collide: false,
    });
    // a skirt of bushes + flowers at each base (reads as a planter)
    for (let k = 0; k < 2; k++) {
      const a = i * 1.7 + k * Math.PI;
      nature.foliage.addPlant({
        kind: k === 0 ? 'flowerBush' : 'bush',
        position: new THREE.Vector3(p.x + Math.cos(a) * 1.3, p.y, p.z + Math.sin(a) * 1.3),
        rotation: a,
        scale: 0.7,
      });
    }
  });
  return spots.length;
}

/** Re-export so callers can pick blossom colours without importing textures. */
export const BLOSSOMS = {
  pink: FLOWER_CELLS.pinkBlossom,
  white: FLOWER_CELLS.whiteBlossom,
  yellow: FLOWER_CELLS.yellowBlossom,
  blue: FLOWER_CELLS.blueBlossom,
};
