// ── Noun seed → 3D head geometry + body/shirt texture ───────────────────

import { ImageData, getNounData } from '@noundry/nouns-assets';
import {
  buildNounGeometries,
  decodeParts,
  seedToLayers,
  type LayerVisibility,
} from '@nouns/voxel-engine';
import * as THREE from 'three';

import { toonify } from '../render/Toon';

import { loadGlbHead } from './GlbHead';
import { buildSmoothHead, headProfile, type SmoothHead } from './SmoothHead';

export interface NounSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

const HEAD_VIS: LayerVisibility = { body: false, accessory: false, head: true, glasses: true };

export function seedKey(s: NounSeed) {
  return `${s.background}-${s.body}-${s.accessory}-${s.head}-${s.glasses}`;
}

export function randomSeed(): NounSeed {
  return {
    background: Math.floor(Math.random() * 2),
    body: Math.floor(Math.random() * 30),
    accessory: Math.floor(Math.random() * 140),
    head: Math.floor(Math.random() * 240),
    glasses: Math.floor(Math.random() * 20),
  };
}

export function parseSeedKey(k: string | null | undefined): NounSeed | null {
  if (!k) return null;
  const p = k.split('-').map(Number);
  if (p.length !== 5 || p.some(n => !Number.isFinite(n))) return null;
  return { background: p[0], body: p[1], accessory: p[2], head: p[3], glasses: p[4] };
}

interface HeadBuild {
  group: THREE.Group;
  /** Approximate skin color sampled from the head (for hands/neck tint). */
  skin: THREE.Color;
}

const headGeoCache = new Map<
  string,
  {
    head: THREE.BufferGeometry | null;
    glasses: THREE.BufferGeometry | null;
    smooth: SmoothHead | null;
  }
>();

/**
 * Build the voxel head + glasses, normalised so the head is `width` metres
 * wide with its bottom-centre at the group origin, facing +Z.
 */
export function buildNounHead(seed: NounSeed, width = 0.62): HeadBuild {
  const key = `${seed.head}-${seed.glasses}`;
  const headName = (ImageData.images.heads as { filename: string }[])[seed.head]?.filename ?? '';
  const profile = headProfile(headName);
  let geos = headGeoCache.get(key);
  if (geos === undefined) {
    const layers = seedToLayers(seed, getNounData, ImageData.palette, HEAD_VIS);
    const g = buildNounGeometries(layers);
    const smooth = buildSmoothHead(layers.head, profile);
    // Glasses: keep them voxel, seated on the smooth head's front plateau
    if (g.glassesGeo !== null && smooth !== null) {
      g.glassesGeo.computeBoundingBox();
      const bb = g.glassesGeo.boundingBox!;
      g.glassesGeo.translate(0, 0, smooth.frontZ - 0.35 - bb.min.z);
    }
    geos = { head: g.headGeo, glasses: g.glassesGeo, smooth };
    headGeoCache.set(key, geos);
  }
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const glassMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.25,
    metalness: 0.1,
  });
  const box = new THREE.Box3();
  if (geos.smooth !== null) {
    const m = new THREE.Mesh(
      geos.smooth.geometry,
      new THREE.MeshStandardMaterial({
        map: geos.smooth.texture,
        roughness: 0.55,
        metalness: 0.02,
      }),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    inner.add(m);
    box.union(geos.smooth.geometry.boundingBox!);
  } else if (geos.head !== null) {
    const m = new THREE.Mesh(
      geos.head,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }),
    );
    m.castShadow = true;
    inner.add(m);
    geos.head.computeBoundingBox();
    box.union(geos.head.boundingBox!);
  }
  let glassesMesh: THREE.Mesh | null = null;
  if (geos.glasses !== null) {
    const m = new THREE.Mesh(geos.glasses, glassMat);
    m.castShadow = true;
    inner.add(m);
    glassesMesh = m;
  }
  // Head pixels: x across, y up, z depth (front = +z). Normalise.
  if (box.isEmpty()) box.set(new THREE.Vector3(-8, 0, -1), new THREE.Vector3(8, 12, 1));
  const w = box.max.x - box.min.x;
  const s = width / Math.max(1, w);
  inner.scale.setScalar(s);
  // Anchor at the Nouns art's neck line (top of the body sprite, pixel row
  // y = 11 → -5 in centred coords) rather than the head's lowest pixel, so
  // heads sit exactly as in the 2D art (some overhang the shoulders).
  // Flat heads (cards, signs) are thinner than the neck, which would bulge
  // through the card's face: sit them in front of the neck instead.
  const flat = profile.crisp === true;
  const NECK_Y = -5;
  // 3D models sit a little above the shoulders so a bit of neck shows;
  // flush on the shoulders they read as squashed / neckless
  const NECK_GAP = 1.4;
  inner.position.set(
    -((box.min.x + box.max.x) / 2) * s,
    -NECK_Y * s,
    -((box.min.z + box.max.z) / 2) * s + (flat ? 0.08 : 0),
  );

  // Swap in the hand-modelled 3D head when one exists (?heads=pixel keeps
  // the generated ones). The generated head shows until it loads.
  if (USE_MODELS) {
    const generated = [...inner.children];
    void loadGlbHead(seed.head, seed.glasses).then(loaded => {
      if (loaded === null) return;
      const model = loaded.object;
      // Match whatever look the character already has (toon or lit)
      const toon = generated.some(
        o => ((o as THREE.Mesh).material as THREE.Material)?.userData?.toonSrc !== undefined,
      );
      if (toon) toonify(model);
      // Models without glasses of their own keep this Noun's voxel glasses
      const keepGlasses = !loaded.hasGlasses && glassesMesh !== null;
      for (const o of generated) o.visible = keepGlasses && o === glassesMesh;
      // Seat every model the same way instead of per-head nudges: lowest
      // point just onto the shoulder line, centred over the neck across
      // and front-to-back, so no head sinks into the torso.
      const mb = new THREE.Box3().setFromObject(model);
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      // Thin models (cards, disks) would have the neck poke through their
      // face: sit them in front of it like flat generated heads
      const thinNudge = !flat && mb.max.z - mb.min.z <= 4 ? 0.08 / s : 0;
      model.position.set(
        cx - (mb.min.x + mb.max.x) / 2,
        NECK_Y + NECK_GAP - mb.min.y,
        cz - (mb.min.z + mb.max.z) / 2 + thinNudge,
      );
      inner.add(model);
      if (keepGlasses) {
        geos.head?.computeBoundingBox();
        const artMinY = geos.head?.boundingBox?.min.y ?? NECK_Y;
        seatGlasses(glassesMesh!, model, NECK_Y + NECK_GAP - artMinY);
      }
    });
  }

  // Skin tone: most common head colour
  const skin = dominantColor(geos.head) ?? new THREE.Color(0xd8b48c);
  return { group, skin };
}

/**
 * Put this Noun's voxel glasses on a model drawn in the 2D art's pixel
 * frame (the noundry set: same columns, rows offset by `dy` so the model's
 * lowest point lines up with the art head's), resting on the model's face
 * wherever the glasses cover it.
 */
function seatGlasses(glasses: THREE.Mesh, model: THREE.Object3D, dy: number) {
  glasses.geometry.computeBoundingBox();
  const gb = glasses.geometry.boundingBox!;
  const px = model.position.x;
  glasses.position.set(px, dy, 0);
  const x0 = gb.min.x + px;
  const x1 = gb.max.x + px;
  const y0 = gb.min.y + dy;
  const y1 = gb.max.y + dy;
  // Voxel faces are merged into large quads, so test triangles (not just
  // vertices) against the glasses' footprint. Model space = this frame
  // offset by model.position (its meshes carry no transforms).
  let front = -Infinity;
  let maxZ = -Infinity;
  const { x: mx, y: my, z: mz } = model.position;
  model.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx !== null ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      let ax = Infinity,
        bx = -Infinity,
        ay = Infinity,
        by = -Infinity,
        tz = -Infinity;
      for (let k = 0; k < 3; k++) {
        const i = idx !== null ? idx.getX(t + k) : t + k;
        const x = pos.getX(i) + mx;
        const y = pos.getY(i) + my;
        const z = pos.getZ(i) + mz;
        ax = Math.min(ax, x);
        bx = Math.max(bx, x);
        ay = Math.min(ay, y);
        by = Math.max(by, y);
        tz = Math.max(tz, z);
      }
      maxZ = Math.max(maxZ, tz);
      if (bx > x0 && ax < x1 && by > y0 && ay < y1) front = Math.max(front, tz);
    }
  });
  if (front === -Infinity) front = maxZ;
  // Sink a hair into the face so no gap shows at grazing angles
  glasses.position.z = front - gb.min.z - 0.1;
}

const USE_MODELS =
  typeof window === 'undefined' ||
  new URLSearchParams(window.location.search).get('heads') !== 'pixel';

function dominantColor(geo: THREE.BufferGeometry | null): THREE.Color | null {
  if (!geo?.attributes.color) return null;
  const c = geo.attributes.color;
  const counts = new Map<string, number>();
  for (let i = 0; i < c.count; i += 24) {
    const k = `${c.getX(i).toFixed(3)},${c.getY(i).toFixed(3)},${c.getZ(i).toFixed(3)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  if (!best) return null;
  const [r, g, b] = best.split(',').map(Number);
  // Colours are linear already
  return new THREE.Color(r, g, b);
}

export interface UVRect {
  /** [u0, v0, u1, v1] in glTF UV space (v = 0 at the TOP of the image). */
  rect: [number, number, number, number];
}

export interface BodyTextureOptions {
  size?: number;
  /** Where the torso front graphic goes (glTF UV convention). */
  front?: [number, number, number, number];
  back?: [number, number, number, number];
}

const bodyTexCache = new Map<string, { texture: THREE.CanvasTexture; shirt: THREE.Color }>();

/**
 * Paint the Noun's body colour + accessory pixel art into a shirt texture.
 * The 32×32 Nouns art has the torso at the bottom rows; we crop that and
 * draw it nearest-neighbour into the front-of-torso UV rect.
 */
export function buildBodyTexture(seed: NounSeed, opts: BodyTextureOptions = {}) {
  const size = opts.size ?? 512;
  const key = `${seed.body}-${seed.accessory}-${size}-${opts.front?.join(',')}-${opts.back?.join(',')}`;
  const hit = bodyTexCache.get(key);
  if (hit) return hit;

  const { parts } = getNounData(seed);
  const bodyPx = decodeParts([parts[0]], ImageData.palette);
  const accPx = parts[1] !== undefined ? decodeParts([parts[1]], ImageData.palette) : [];

  // Dominant body colour (shirt base)
  const counts = new Map<string, number>();
  for (const p of bodyPx) {
    const k = `${p.r},${p.g},${p.b}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let base = '200,200,200';
  let n = 0;
  for (const [k, c] of counts) if (c > n) [base, n] = [k, c];
  const [br, bg, bb] = base.split(',').map(Number);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = `rgb(${br},${bg},${bb})`;
  ctx.fillRect(0, 0, size, size);
  // Subtle fabric noise so large flat areas don't look plastic
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const k = 1 + (Math.random() - 0.5) * 0.06;
    img.data[i] *= k;
    img.data[i + 1] *= k;
    img.data[i + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);

  // Torso crop: the body sprite bounding box (y is bottom-up in VoxelPixel)
  const all = [...bodyPx, ...accPx];
  let minX = 32,
    maxX = 0,
    minY = 32,
    maxY = 0;
  for (const p of bodyPx) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const drawRegion = (r: [number, number, number, number], withAccessory: boolean) => {
    const [u0, v0, u1, v1] = r;
    const x0 = u0 * size;
    const y0 = v0 * size;
    const w = (u1 - u0) * size;
    const h = (v1 - v0) * size;
    const px = w / cw;
    const py = h / ch;
    const src = withAccessory ? all : bodyPx;
    for (const p of src) {
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const col = p.x - minX;
      const row = maxY - p.y; // top-down
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ctx.fillRect(
        Math.floor(x0 + col * px),
        Math.floor(y0 + row * py),
        Math.ceil(px),
        Math.ceil(py),
      );
    }
  };
  drawRegion(opts.front ?? [0, 0, 0.5, 0.5], true);
  if (opts.back) drawRegion(opts.back, false);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  const shirt = new THREE.Color(`rgb(${br},${bg},${bb})`);
  const out = { texture, shirt };
  bodyTexCache.set(key, out);
  return out;
}
