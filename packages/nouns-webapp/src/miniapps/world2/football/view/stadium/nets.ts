// ── The goal nets: light grids that bulge when the ball hits them ───────
//
// Both nets are one mesh (one draw): four panels per goal (top, back, two
// sides) as fine grids with a tiled mesh texture (alpha-tested). Each
// vertex knows its goal (aGoal) and how free it is (aPin: 0 on the frame,
// 1 mid-panel), so the vertex shader can push it out along its normal from
// a hit point with a decaying ripple: per goal, one vec4 (hit point, time)
// and a strength. No CPU per vertex, ever.

import type { PitchSpec } from '../../contract';

import * as THREE from 'three';

import { getToonRamp } from '../../../render/Toon';

import { goalShape } from './build';

type P3 = [number, number, number];

/** Bilinear grid over 4 corners (a b c d round the edge), `nu` × `nv` cells. */
function panel(
  out: { pos: number[]; nrm: number[]; uv: number[]; goal: number[]; pin: number[]; idx: number[] },
  a: P3,
  b: P3,
  c: P3,
  d: P3,
  n: P3,
  nu: number,
  nv: number,
  g: number,
) {
  const base = out.pos.length / 3;
  const lu = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const lv = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  const cell = 0.12;
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      for (let k = 0; k < 3; k++) {
        const p = (1 - v) * ((1 - u) * a[k] + u * b[k]) + v * ((1 - u) * d[k] + u * c[k]);
        out.pos.push(p);
        out.nrm.push(n[k]);
      }
      out.uv.push((u * lu) / cell, (v * lv) / cell);
      out.goal.push(g);
      out.pin.push(Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const q = base + j * (nu + 1) + i;
      out.idx.push(q, q + 1, q + nu + 2, q, q + nu + 2, q + nu + 1);
    }
}

/** Both nets for a pitch (pitch-local). */
export function netGeometry(p: PitchSpec): THREE.BufferGeometry {
  const out = { pos: [], nrm: [], uv: [], goal: [], pin: [], idx: [] } as {
    pos: number[];
    nrm: number[];
    uv: number[];
    goal: number[];
    pin: number[];
    idx: number[];
  };
  const { rearTop, bend } = goalShape(p);
  const gw = p.goalWidth / 2 + p.postRadius;
  const gh = p.goalHeight + p.postRadius;
  const nu = Math.max(6, Math.round(p.goalWidth / 0.35));
  for (const [e, g] of [
    [-1, 0],
    [1, 1],
  ] as const) {
    const z0 = e * (p.length / 2 + p.postRadius * 2);
    const zT = e * (p.length / 2 + bend);
    const zB = e * (p.length / 2 + p.goalDepth);
    // top: crossbar → rear top
    panel(
      out,
      [-gw, gh, z0],
      [gw, gh, z0],
      [gw, rearTop, zT],
      [-gw, rearTop, zT],
      [0, 1, e * 0.3],
      nu,
      3,
      g,
    );
    // back: rear top → ground at the back
    panel(
      out,
      [-gw, rearTop, zT],
      [gw, rearTop, zT],
      [gw, 0, zB],
      [-gw, 0, zB],
      [0, 0.35, e],
      nu,
      6,
      g,
    );
    // sides (quad: front-bottom, back-bottom, rear top, front top)
    for (const sx of [-1, 1]) {
      const x = sx * gw;
      panel(out, [x, 0, z0], [x, 0, zB], [x, rearTop, zT], [x, gh, z0], [sx, 0, 0], 5, 6, g);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  geo.setAttribute('aGoal', new THREE.Float32BufferAttribute(out.goal, 1));
  geo.setAttribute('aPin', new THREE.Float32BufferAttribute(out.pin, 1));
  geo.setIndex(out.idx);
  geo.computeBoundingSphere();
  return geo;
}

export interface NetUniforms {
  uNetTime: { value: number };
  /** Per goal (−z end, +z end): hit point (pitch-local) + the time it hit. */
  uHit0: { value: THREE.Vector4 };
  uHit1: { value: THREE.Vector4 };
  /** Per goal: strength 0..1. */
  uStr: { value: THREE.Vector2 };
}

export function netUniforms(): NetUniforms {
  return {
    uNetTime: { value: 0 },
    uHit0: { value: new THREE.Vector4(0, 0, 0, -100) },
    uHit1: { value: new THREE.Vector4(0, 0, 0, -100) },
    uStr: { value: new THREE.Vector2(0, 0) },
  };
}

export function netMaterial(toon: boolean, map: THREE.Texture, u: NetUniforms): THREE.Material {
  const opts = { color: 0xf4f4f4, map, alphaTest: 0.45, side: THREE.DoubleSide };
  const m = toon
    ? new THREE.MeshToonMaterial({ ...opts, gradientMap: getToonRamp() })
    : new THREE.MeshLambertMaterial(opts);
  m.userData.noToon = true;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader =
      /* glsl */ `
attribute float aGoal;
attribute float aPin;
uniform float uNetTime;
uniform vec4 uHit0;
uniform vec4 uHit1;
uniform vec2 uStr;
` +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
  vec4 nh = aGoal < 0.5 ? uHit0 : uHit1;
  float ns = aGoal < 0.5 ? uStr.x : uStr.y;
  float age = max(0.0, uNetTime - nh.w);
  float dist = length(position - nh.xyz);
  float env = ns * exp(-age * 2.2) * aPin;
  float bulge = exp(-dist * dist * 1.1) * 0.42 + 0.07 * sin(dist * 7.0 - age * 15.0) * exp(-dist * 0.6);
  transformed += normalize(objectNormal) * env * bulge;`,
      );
  };
  m.customProgramCacheKey = () => 'nf-net-v1';
  return m;
}
