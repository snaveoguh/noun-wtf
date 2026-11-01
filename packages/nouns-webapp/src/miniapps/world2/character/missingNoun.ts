// ── Missingnoun: the rider that's just a glitching head and noggles ────────
//
// `head-missingnoun` is a V2 head (index 252 of the V2 art; V1's 252 is
// shrimp tempura), so it's built from the V2 art set: the glasses are the
// same 23 in both sets. A missingnoun rider has no body, arms, legs, shoes
// or outfit (NounCharacter hides the rig's meshes but keeps the rig, so the
// head still rides, jumps and tricks on its bone): only this head, glitching.
//
// The glitch: every few frames the head jumps a little sideways and squashes,
// and now and then splits into red / cyan ghosts and a sliced band of the
// head smears out of line, like a broken frame. `glitchAt` is the pure
// schedule (tested); the meshes just follow it.

import { ImageDataV2, getNounDataV2 } from '@nouns/assets';
import { buildNounGeometries, seedToLayers, type LayerVisibility } from '@nouns/voxel-engine';
import * as THREE from 'three';

/** The V2 head art's index for missingnoun. */
export const MISSINGNOUN_V2_HEAD = 252;

const HEAD_ONLY: LayerVisibility = { body: false, accessory: false, head: true, glasses: true };

export interface GlitchState {
  /** Sideways jump (fraction of the head's width). */
  dx: number;
  /** Vertical squash (1 = none). */
  sy: number;
  /** Red / cyan ghosts showing, and how far apart (fraction of width). */
  split: number;
  /** A sliced band: its centre (0 bottom … 1 top) and offset (fraction of width), or null. */
  slice: { at: number; dx: number } | null;
}

/** Deterministic noise in [0, 1) from an integer. */
function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Frames of the glitch per second: it holds each pose for one of these. */
const STEP_HZ = 14;

/**
 * The glitch at time `t` (s): mostly still with small jitters, a burst of
 * splits and slices every second or so. Pure: the same `t` and `seed`
 * always give the same frame.
 */
export function glitchAt(t: number, seed = 0): GlitchState {
  const step = Math.floor(t * STEP_HZ);
  const r = (k: number) => hash(step * 7 + k + seed * 101);
  // A burst a third of a second long, about every 1.4 s
  const burst = (t + hash(seed) * 1.4) % 1.4 < 0.34;
  const jitter = burst ? 0.09 : r(1) < 0.25 ? 0.025 : 0;
  return {
    dx: (r(2) * 2 - 1) * jitter,
    sy: burst && r(3) < 0.5 ? 0.86 + r(4) * 0.1 : 1,
    split: burst && r(5) < 0.7 ? 0.03 + r(6) * 0.05 : 0,
    slice: burst && r(7) < 0.6 ? { at: 0.2 + r(8) * 0.6, dx: (r(9) * 2 - 1) * 0.18 } : null,
  };
}

export interface MissingNounHead {
  group: THREE.Group;
  skin: THREE.Color;
  /** Advance the glitch (call once a frame). */
  tick: (dt: number) => void;
}

/**
 * The missingnoun head + this rider's noggles, `width` metres wide, bottom
 * centre at the group origin, facing +Z (like buildNounHead), glitching.
 */
export function buildMissingNounHead(glasses: number, width = 0.62): MissingNounHead {
  const seed = {
    background: 0,
    body: 0,
    accessory: 0,
    head: MISSINGNOUN_V2_HEAD,
    glasses: Math.max(0, Math.min(ImageDataV2.images.glasses.length - 1, glasses)),
  };
  const layers = seedToLayers(seed, getNounDataV2, ImageDataV2.palette, HEAD_ONLY);
  const g = buildNounGeometries(layers);
  const group = new THREE.Group();
  /** Moves with the glitch (sideways jump, squash). */
  const shake = new THREE.Group();
  const inner = new THREE.Group();
  group.add(shake);
  shake.add(inner);
  const box = new THREE.Box3();
  const parts: THREE.Mesh[] = [];
  const solid = (geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    );
    m.castShadow = true;
    inner.add(m);
    parts.push(m);
    geo.computeBoundingBox();
    box.union(geo.boundingBox!);
    return m;
  };
  if (g.headGeo !== null) solid(g.headGeo);
  if (g.glassesGeo !== null) solid(g.glassesGeo);
  if (box.isEmpty()) box.set(new THREE.Vector3(-8, 0, -1), new THREE.Vector3(8, 12, 1));
  const w = Math.max(16, box.max.x - box.min.x);
  const h = box.max.y - box.min.y;
  const s = width / w;
  inner.scale.setScalar(s);
  // Seated at the Nouns art's neck line like every head (pixel row 11 → -5
  // centred): missingnoun's art runs down past it, filling the body's space
  const NECK_Y = -5;
  inner.position.set(
    -((box.min.x + box.max.x) / 2) * s,
    -NECK_Y * s,
    -((box.min.z + box.max.z) / 2) * s,
  );

  // Red / cyan ghosts (the RGB split) and the sliced band: copies of the
  // head, drawn flat and see-through, shown only in a burst
  const ghostMat = (c: number) =>
    new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  const ghost = (c: number) => {
    const o = new THREE.Group();
    for (const p of parts) o.add(new THREE.Mesh(p.geometry, ghostMat(c)));
    o.scale.copy(inner.scale);
    o.position.copy(inner.position);
    o.visible = false;
    shake.add(o);
    return o;
  };
  const red = ghost(0xff2040);
  const cyan = ghost(0x20e0ff);
  // The slice: the head again, squashed into a thin band and smeared
  // sideways (a torn scanline)
  const BAND = 0.14;
  const slice = new THREE.Group();
  for (const p of parts) slice.add(new THREE.Mesh(p.geometry, p.material));
  slice.scale.set(s, s * BAND, s * 1.02);
  slice.visible = false;
  shake.add(slice);

  const seedN = Math.floor(Math.random() * 1000);
  let t = Math.random() * 10;
  const tick = (dt: number) => {
    t += dt;
    const gs = glitchAt(t, seedN);
    shake.position.x = gs.dx * width;
    shake.scale.y = gs.sy;
    red.visible = cyan.visible = gs.split > 0;
    red.position.x = inner.position.x - gs.split * width;
    cyan.position.x = inner.position.x + gs.split * width;
    slice.visible = gs.slice !== null;
    if (gs.slice !== null) {
      // Centred on the band's height in the art, squashed to BAND of it
      const yc = inner.position.y + (box.min.y + gs.slice.at * h) * s;
      slice.position.set(
        inner.position.x + gs.slice.dx * width,
        yc - ((box.min.y + box.max.y) / 2) * s * BAND,
        inner.position.z + 0.01,
      );
    }
  };
  return { group, skin: new THREE.Color(0x9aa0a8), tick };
}
