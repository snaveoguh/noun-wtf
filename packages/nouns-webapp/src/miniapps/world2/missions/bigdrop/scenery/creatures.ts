// ── Creature models for the Big Drop's skies (instanced, flapped on the GPU) ─
//
// Three kinds, each one InstancedMesh: NOGBIRDS (a square Noun head with red
// noggles and stubby flapping wings), PTEROS (long-necked, crested, bat-
// winged, gliding with slow beats) and JELLY KITES (glowing bells trailing
// ribbon tentacles, pulsing as they drift). The flap is a vertex-shader bend
// driven by per-instance phase / amplitude attributes, so the CPU only moves
// each creature once a frame. Forward is +Z, wings along ±X, up +Y.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { getToonRamp } from '../../../render/Toon';

export type CreatureKind = 'nogbird' | 'ptero' | 'jelly';

/** Per-vertex: colour, flap weight (signed distance out along the wing), tint mask. */
function part(
  g: THREE.BufferGeometry,
  hex: number,
  opts: { wingRoot?: number; tint?: boolean; sway?: number } = {},
): THREE.BufferGeometry {
  const n = g.index !== null ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.deleteAttribute('uv');
  n.deleteAttribute('normal');
  n.computeVertexNormals();
  const p = n.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const flap = new Float32Array(p.count);
  const tint = new Float32Array(p.count);
  const c = new THREE.Color(hex);
  for (let i = 0; i < p.count; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    const x = p.getX(i);
    if (opts.wingRoot !== undefined) {
      const d = Math.max(0, Math.abs(x) - opts.wingRoot);
      flap[i] = Math.sign(x) * d;
    } else if (opts.sway !== undefined) flap[i] = opts.sway * Math.max(0, -p.getY(i));
    tint[i] = opts.tint === true ? 1 : 0;
  }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  n.setAttribute('aFlap', new THREE.BufferAttribute(flap, 1));
  n.setAttribute('aTintMask', new THREE.BufferAttribute(tint, 1));
  return n;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

const RED = 0xf3322c;

function noggles(x: number, y: number, z: number, s: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const f = new THREE.BoxGeometry(0.36 * s, 0.3 * s, 0.06 * s);
    f.translate(x + side * 0.22 * s, y, z);
    out.push(part(f, RED));
    const w = new THREE.BoxGeometry(0.13 * s, 0.2 * s, 0.02 * s);
    w.translate(x + side * 0.22 * s - 0.07 * s, y, z + 0.035 * s);
    out.push(part(w, 0xffffff));
    const b = new THREE.BoxGeometry(0.13 * s, 0.2 * s, 0.02 * s);
    b.translate(x + side * 0.22 * s + 0.065 * s, y, z + 0.035 * s);
    out.push(part(b, 0x0b0b0f));
  }
  const bridge = new THREE.BoxGeometry(0.1 * s, 0.06 * s, 0.06 * s);
  bridge.translate(x, y + 0.04 * s, z);
  out.push(part(bridge, RED));
  return out;
}

/** A square Noun head with wings. Span ~3.6 m. */
export function nogbirdGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const head = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  head.translate(0, 0, 0.1);
  parts.push(part(head, 0xffffff, { tint: true }));
  parts.push(...noggles(0, 0.08, 0.58, 1));
  const beak = new THREE.ConeGeometry(0.14, 0.4, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, -0.22, 0.72);
  parts.push(part(beak, 0xffb41f));
  for (const side of [-1, 1]) {
    // A swept wing: wide at the root, a point at the tip
    const w = new THREE.BufferGeometry();
    const r = 0.42 * side;
    const t = 1.85 * side;
    const v = [r, 0, 0.35, t, 0.05, -0.15, r, 0, -0.35, r, 0, 0.35, r, 0, -0.35, t, 0.05, -0.15];
    w.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    parts.push(part(w, 0xffffff, { wingRoot: 0.42, tint: true }));
    const under = w.clone();
    under.translate(0, -0.04, 0);
    parts.push(part(under, 0xd8dcef, { wingRoot: 0.42, tint: true }));
  }
  const tail = new THREE.BoxGeometry(0.5, 0.06, 0.5);
  tail.translate(0, 0.1, -0.55);
  parts.push(part(tail, 0x1b1b24));
  return merged(parts);
}

/** Long neck, crest, bat wings. Span ~9 m. */
export function pteroGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(0.28, 0.42, 2.2, 6);
  body.rotateX(Math.PI / 2);
  parts.push(part(body, 0xffffff, { tint: true }));
  const neck = new THREE.CylinderGeometry(0.14, 0.22, 1.9, 5);
  neck.rotateX(Math.PI / 2 - 0.5);
  neck.translate(0, 0.42, 1.75);
  parts.push(part(neck, 0xffffff, { tint: true }));
  const head = new THREE.BoxGeometry(0.42, 0.42, 0.62);
  head.translate(0, 0.88, 2.65);
  parts.push(part(head, 0xffffff, { tint: true }));
  const bill = new THREE.ConeGeometry(0.14, 1.3, 4);
  bill.rotateX(Math.PI / 2);
  bill.translate(0, 0.8, 3.5);
  parts.push(part(bill, 0xffc84a));
  const crest = new THREE.ConeGeometry(0.12, 1.1, 4);
  crest.rotateX(-Math.PI / 2 - 0.5);
  crest.translate(0, 1.2, 2.05);
  parts.push(part(crest, 0xff2f8e));
  parts.push(...noggles(0, 0.95, 2.97, 0.62));
  const tail = new THREE.ConeGeometry(0.16, 1.6, 4);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0, -1.8);
  parts.push(part(tail, 0x2a2440));
  for (const side of [-1, 1]) {
    // A bat wing: leading edge out to a claw, scalloped trailing edge
    const s = side;
    const pts = [
      [0.3 * s, 0, 0.7],
      [2.4 * s, 0.25, 0.9],
      [4.6 * s, 0.1, 0.2],
      [3.2 * s, 0, -0.5],
      [1.9 * s, 0, -0.2],
      [0.3 * s, 0, -0.9],
    ];
    const v: number[] = [];
    const fan = (a: number, b: number, c: number) => v.push(...pts[a]!, ...pts[b]!, ...pts[c]!);
    fan(0, 1, 4);
    fan(1, 3, 4);
    fan(1, 2, 3);
    fan(0, 4, 5);
    const w = new THREE.BufferGeometry();
    w.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    parts.push(part(w, 0x6b4cc8, { wingRoot: 0.3 }));
    const back = w.clone();
    back.translate(0, -0.05, 0);
    parts.push(part(back, 0x3c2a7a, { wingRoot: 0.3 }));
  }
  return merged(parts);
}

/** A glowing bell with trailing ribbons. ~3 m across, 7 m long. */
export function jellyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bell = new THREE.SphereGeometry(1.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  bell.scale(1, 0.8, 1);
  parts.push(part(bell, 0xffffff, { tint: true }));
  const rim = new THREE.TorusGeometry(1.45, 0.16, 4, 12);
  rim.rotateX(Math.PI / 2);
  parts.push(part(rim, 0xffffff));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const len = 4.5 + (i % 3) * 1.4;
    const rib = new THREE.PlaneGeometry(0.28, len, 1, 6);
    rib.translate(0, -len / 2, 0);
    rib.rotateY(a);
    rib.translate(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
    parts.push(part(rib, 0xffffff, { tint: true, sway: 1 }));
  }
  return merged(parts);
}

/** Shared `uTime` for every creature material. */
export const creatureTime = { value: 0 };

/**
 * The material for a kind: toon (or standard) with the flap bend and the
 * per-instance tint injected; jellies are unlit and glowing.
 */
export function creatureMaterial(kind: CreatureKind, toon: boolean): THREE.Material {
  let m: THREE.Material;
  if (kind === 'jelly')
    m = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
  else if (toon)
    m = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getToonRamp(),
      side: THREE.DoubleSide,
      emissive: 0x1a2030,
    });
  else
    m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.8,
      emissive: 0x1a2030,
    });
  m.name = `BigDrop_${kind}`;
  const bend =
    kind === 'jelly'
      ? /* glsl */ `
        float pulse = sin(aPhase + uTime * aRate);
        transformed.xz *= 1.0 + 0.16 * pulse * step(-0.01, transformed.y);
        transformed.x += sin(uTime * aRate * 0.6 + aPhase + transformed.y * 0.8) * 0.35 * aFlap;
        transformed.z += cos(uTime * aRate * 0.5 + aPhase + transformed.y * 0.7) * 0.35 * aFlap - 0.12 * aFlap * aFlap;
      `
      : /* glsl */ `
        float ang = sin(aPhase + uTime * aRate) * aAmp + aAmp * 0.25;
        float d = abs(aFlap);
        float sg = sign(aFlap);
        transformed.x += sg * d * (cos(ang) - 1.0);
        transformed.y += d * sin(ang);
      `;
  m.onBeforeCompile = shader => {
    shader.uniforms.uTime = creatureTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        attribute float aFlap;
        attribute float aTintMask;
        attribute float aPhase;
        attribute float aRate;
        attribute float aAmp;
        attribute vec3 aTint;`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${bend}`)
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vColor.rgb *= mix(vec3(1.0), aTint, aTintMask);`,
      );
  };
  m.customProgramCacheKey = () => `bigdrop-creature-${kind}`;
  return m;
}
