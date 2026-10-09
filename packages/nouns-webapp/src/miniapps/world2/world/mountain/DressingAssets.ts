// ── Mountain dressing: shared geometries + materials ────────────────────
//
// Built once (warmDressing) and shared by every chunk, so a chunk only owns
// its per-instance matrices / colours. Reuses the nature layer wholesale:
// the grass tuft + bush + broadleaf generators from nature/Foliage.ts, its
// wind / grass-fade shader patch, its shared toon materials for bark /
// leaves / bushes, and nature/Rocks.ts boulders. Grass + flowers get their
// own material instances because the mountain needs longer fade distances
// than the plaza lawn. Flowers are geometric clumps (flat star heads tinted
// per instance) rather than the lawn's alpha sprites: at riding distance the
// ink pass turns small alpha cut-outs into dark smudges, while solid heads
// read as bright dots of colour.

import type { Quality } from '../../render/Graphics';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import {
  foliageMaterials,
  generateBroadleaf,
  generateBush,
  generateGrassTuft,
  type FoliageMaterials,
} from '../../nature/Foliage';
import { generateBoulder, rockMaterial } from '../../nature/Rocks';
import { Rng, chainPatch, patchFoliageMaterial, toonMaterial } from '../../nature/shared';
import { FLOWER_CELLS } from '../../nature/textures';

export interface DressingAssets {
  grassGeo: THREE.BufferGeometry;
  grassMat: THREE.MeshToonMaterial;
  flowerGeo: THREE.BufferGeometry;
  flowerMat: THREE.MeshToonMaterial;
  bushLeaves: THREE.BufferGeometry;
  bushBlossoms: THREE.BufferGeometry;
  treeWood: THREE.BufferGeometry;
  treeLeaves: THREE.BufferGeometry;
  rockGeo: THREE.BufferGeometry;
  /** Low-detail twin of rockGeo for big-rock colliders. */
  rockCollider: THREE.BufferGeometry;
  /** Hex prism trunk collider (base at y = 0, 3 m tall, r ≈ 0.34). */
  trunkCollider: THREE.BufferGeometry;
  rockMat: THREE.Material;
  foliage: FoliageMaterials;
  /** Grass / flower fade (camera distance, m): fully drawn → gone. */
  grassFade: [number, number];
  flowerFade: [number, number];
}

let assets: DressingAssets | null = null;

/**
 * Three tufts merged into one loose clump (~1.6 m across): triples the
 * apparent density for the same instance count. The tufts keep their own
 * `wind` weights, so the clump still sways blade by blade.
 */
function grassClump(blades: number): THREE.BufferGeometry {
  const offs: [number, number, number][] = [
    [0, 0, 0],
    [0.55, 0.3, 2.1],
    [-0.35, -0.5, 4.2],
  ];
  const parts = offs.map(([x, z, r], i) => {
    const g = generateGrassTuft(31337 + i * 7, blades);
    g.rotateY(r);
    g.translate(x, 0, z);
    return g;
  });
  const out = mergeGeometries(parts, false) ?? parts[0];
  for (const g of parts) if (g !== out) g.dispose();
  out.computeBoundingSphere();
  return out;
}

/**
 * Clump of 6 flowers (~0.9 m across): six-petal star heads, tilted, on
 * stubby stems. Petals are white with aTint = 1 (instance colour shows through);
 * stems + yellow centres have aTint = 0. Carries the nature `wind` attribute.
 */
function flowerClump(): THREE.BufferGeometry {
  const rng = new Rng(4711);
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const tint: number[] = [];
  const wind: number[] = [];
  const idx: number[] = [];
  const v = (
    x: number,
    y: number,
    z: number,
    n: [number, number, number],
    c: [number, number, number],
    t: number,
    h: number,
  ) => {
    pos.push(x, y, z);
    nrm.push(...n);
    col.push(...c);
    tint.push(t);
    wind.push(Math.min(1, h / 0.5) ** 1.5, h * 0.6);
    return pos.length / 3 - 1;
  };
  const STEM: [number, number, number] = [0.22, 0.55, 0.12];
  const CENTRE: [number, number, number] = [1, 0.82, 0.15];
  const PETAL: [number, number, number] = [1, 1, 1];
  for (let i = 0; i < 6; i++) {
    const a = i * 2.4 + rng.range(-0.3, 0.3);
    const r = i === 0 ? 0 : rng.range(0.2, 0.42);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = rng.range(0.1, 0.3);
    const R = rng.range(0.15, 0.21);
    // Heads tilt out (up to ~40°) so plenty face a low camera, not edge-on
    const ta = rng.range(0, Math.PI * 2);
    const tilt = rng.range(0.25, 0.75);
    const up = new THREE.Vector3(Math.cos(ta) * tilt, 1, Math.sin(ta) * tilt).normalize();
    // short, fat stem stub under each head (low enough not to read as a post)
    const sn: [number, number, number] = [0, 1, 0];
    const s0 = v(x - 0.025, 0, z, sn, STEM, 0, 0);
    const s1 = v(x + 0.025, 0, z, sn, STEM, 0, 0);
    const s2 = v(x, h, z, sn, STEM, 0, h);
    idx.push(s0, s1, s2);
    // head: star fan in the plane ⟂ up
    const t1 = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
    const t2 = new THREE.Vector3().crossVectors(t1, up).normalize();
    // Shade petals as if facing the sky: an even, bright toon band
    const n: [number, number, number] = [up.x * 0.4, 1, up.z * 0.4];
    const c = v(x, h, z, n, PETAL, 1, h);
    const ring: number[] = [];
    const P = 12;
    for (let k = 0; k < P; k++) {
      const ang = (k / P) * Math.PI * 2;
      const rr = k % 2 === 0 ? R : R * 0.45;
      const px = x + (t1.x * Math.cos(ang) + t2.x * Math.sin(ang)) * rr;
      const py = h + (t1.y * Math.cos(ang) + t2.y * Math.sin(ang)) * rr;
      const pz = z + (t1.z * Math.cos(ang) + t2.z * Math.sin(ang)) * rr;
      ring.push(v(px, py, pz, n, PETAL, 1, h));
    }
    for (let k = 0; k < P; k++) idx.push(c, ring[(k + 1) % P], ring[k]);
    // yellow centre, a hair above the petals
    const cc = v(x + up.x * 0.012, h + up.y * 0.012, z + up.z * 0.012, n, CENTRE, 0, h);
    const cr: number[] = [];
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      const rr = R * 0.3;
      cr.push(
        v(
          x + up.x * 0.012 + (t1.x * Math.cos(ang) + t2.x * Math.sin(ang)) * rr,
          h + up.y * 0.012 + (t1.y * Math.cos(ang) + t2.y * Math.sin(ang)) * rr,
          z + up.z * 0.012 + (t1.z * Math.cos(ang) + t2.z * Math.sin(ang)) * rr,
          n,
          CENTRE,
          0,
          h,
        ),
      );
    }
    for (let k = 0; k < 6; k++) idx.push(cc, cr[(k + 1) % 6], cr[k]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(wind, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Instance colour only where the vertex says so (aTint), e.g. petals but not stems. */
function maskInstanceColor(m: THREE.Material) {
  chainPatch(m, 'tintmask', shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;')
      .replace(
        '#include <color_vertex>',
        `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR
vColor.rgb *= color.rgb;
#endif
#ifdef USE_INSTANCING_COLOR
vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aTint );
#endif`,
      );
  });
}

const GRASS_WIND = { swayAmp: 0.12, swayFreq: 1.7, flutterAmp: 0.015, flutterFreq: 8 };

/** Build the shared assets (call during loading so the first chunk doesn't pay). */
export function warmDressing(quality: Quality = 'medium'): DressingAssets {
  if (assets !== null) return assets;
  const q = quality;
  const foliage = foliageMaterials(q);
  const grassFade: [number, number] = q === 'low' ? [24, 36] : q === 'medium' ? [36, 54] : [46, 68];
  const flowerFade: [number, number] =
    q === 'low' ? [40, 60] : q === 'medium' ? [60, 90] : [75, 110];

  const grassMat = toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
  grassMat.name = 'DressingGrass';
  patchFoliageMaterial(grassMat, {
    key: 'dress-grass',
    wind: GRASS_WIND,
    bentNormals: true,
    translucency: { color: new THREE.Color(1.0, 1.0, 0.5), strength: 0.35 },
    grass: { fadeStart: grassFade[0], fadeEnd: grassFade[1], trample: true },
    tipLight: 0.12,
  });
  const flowerMat = toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
  flowerMat.name = 'DressingFlowers';
  patchFoliageMaterial(flowerMat, {
    key: 'dress-flowers',
    wind: GRASS_WIND,
    grass: { fadeStart: flowerFade[0], fadeEnd: flowerFade[1], trample: true },
  });
  maskInstanceColor(flowerMat);

  const dens = q === 'low' ? 0.55 : q === 'medium' ? 1 : 1.3;
  const bush = generateBush({
    seed: 4242,
    radius: 0.95,
    leafDensity: dens,
    blossom: FLOWER_CELLS.whiteBlossom,
  });
  const tree = generateBroadleaf({ seed: 777, leafDensity: dens });

  const rockGeo = generateBoulder({ seed: 9101, detail: 2, squash: 0.7, lumpiness: 0.45 });
  const rockCollider = generateBoulder({ seed: 9101, detail: 1, squash: 0.7, lumpiness: 0.45 });
  const trunk = new THREE.CylinderGeometry(0.3, 0.38, 3, 6, 1, false);
  trunk.translate(0, 1.5, 0);
  const trunkCollider = trunk.index !== null ? trunk.toNonIndexed() : trunk;
  trunkCollider.deleteAttribute('normal');
  trunkCollider.deleteAttribute('uv');

  assets = {
    grassGeo: grassClump(q === 'low' ? 4 : q === 'medium' ? 5 : 7),
    grassMat,
    flowerGeo: flowerClump(),
    flowerMat,
    bushLeaves: bush.leaves,
    bushBlossoms: bush.blossoms ?? bush.leaves,
    treeWood: tree.wood ?? new THREE.BufferGeometry(),
    treeLeaves: tree.leaves,
    rockGeo,
    rockCollider,
    trunkCollider,
    rockMat: rockMaterial(),
    foliage,
    grassFade,
    flowerFade,
  };
  return assets;
}
