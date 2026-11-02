// ── NOUN STADIUM's crowd: one InstancedMesh, animated on the GPU ─────────
//
// Every fan is the same low-poly blocky Noun (body, square head, a noggles
// hint, two arms, legs; ~56 triangles) placed on a seat by its instance
// matrix. Everything that moves is in the vertex shader, driven by a few
// uniforms: idle sway, standing up, jumping, arms up, and a Mexican wave
// travelling round the bowl. Per fan there's one vec4 (fan end, two
// randoms, its wave coordinate), so there's no per-frame CPU per fan; the
// view only eases the uniforms. Shirts come from the kits (uniforms), so
// setKits never touches the instances. A quiet stadium shows fewer fans
// (InstancedMesh.count: the seat list is shuffled, so any prefix is an even
// spread).

import * as THREE from 'three';

import { getToonRamp } from '../../../render/Toon';

import { Geo } from './geo';
import { type SeatList } from './seats';

/** Part ids (vertex attribute aPart). */
const BODY = 0;
const HEAD = 1;
const FIXED = 2;
const ARM_L = 3;
const ARM_R = 4;
const LEGS = 5;

/** Hip height over the tread when seated (the model's origin is at the hip). */
const HIP = 0.42;
const SHOULDER = 0.5;

/** The fan model (origin at the hips, facing +z), with aPart per vertex. */
export function fanGeometry(): THREE.BufferGeometry {
  const g = new Geo(false);
  const parts: number[] = [];
  const mark = (part: number) => {
    while (parts.length < g.vertexCount) parts.push(part);
  };
  // legs (seated: hidden by the row in front; standing: stretched)
  g.box(-0.16, -HIP, -0.05, 0.16, 0, 0.15, 0x2a2d36, '-y');
  mark(LEGS);
  // body (white: tinted by the shirt)
  g.box(-0.2, 0, -0.12, 0.2, SHOULDER + 0.06, 0.12, 0xffffff, '-y');
  mark(BODY);
  // head (white: tinted from the palette)
  g.box(-0.22, SHOULDER + 0.06, -0.2, 0.22, SHOULDER + 0.5, 0.22, 0xffffff, '-y');
  mark(HEAD);
  // noggles: a red frame and two dark lenses on the face
  const yN = SHOULDER + 0.3;
  g.quad(
    [-0.24, yN - 0.07, 0.225],
    [0.24, yN - 0.07, 0.225],
    [0.24, yN + 0.07, 0.225],
    [-0.24, yN + 0.07, 0.225],
    [0, 0, 1],
    0xd8302c,
  );
  for (const cx of [-0.11, 0.11])
    g.quad(
      [cx - 0.07, yN - 0.05, 0.232],
      [cx + 0.07, yN - 0.05, 0.232],
      [cx + 0.07, yN + 0.05, 0.232],
      [cx - 0.07, yN + 0.05, 0.232],
      [0, 0, 1],
      0x101010,
    );
  mark(FIXED);
  // arms (hang from the shoulders; the shader swings them up)
  g.box(-0.31, 0.06, -0.06, -0.2, SHOULDER + 0.04, 0.06, 0xffffff, '');
  mark(ARM_L);
  g.box(0.2, 0.06, -0.06, 0.31, SHOULDER + 0.04, 0.06, 0xffffff, '');
  mark(ARM_R);
  const geo = g.toGeometry();
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1));
  return geo;
}

export interface CrowdUniforms {
  uTime: { value: number };
  /** Excitement of fan end 0, end 1 and the neutrals (0 calm … 1 frenzy). */
  uEx: { value: THREE.Vector3 };
  /** Wave: position round the bowl (0..1), strength. */
  uWave: { value: THREE.Vector2 };
  uShirt0: { value: THREE.Color };
  uShirt1: { value: THREE.Color };
  uAlt0: { value: THREE.Color };
  uAlt1: { value: THREE.Color };
}

const HEAD_GLSL = /* glsl */ `
attribute float aPart;
attribute vec4 aCrowd;
uniform float uTime;
uniform vec3 uEx;
uniform vec2 uWave;
uniform vec3 uShirt0;
uniform vec3 uShirt1;
uniform vec3 uAlt0;
uniform vec3 uAlt1;
vec3 nfHead(float r) {
  // Noun-ish head colours
  float k = floor(r * 6.0);
  if (k < 1.0) return vec3(0.93, 0.62, 0.38);
  if (k < 2.0) return vec3(0.55, 0.33, 0.2);
  if (k < 3.0) return vec3(0.98, 0.82, 0.25);
  if (k < 4.0) return vec3(0.35, 0.65, 0.85);
  if (k < 5.0) return vec3(0.8, 0.35, 0.6);
  return vec3(0.6, 0.85, 0.45);
}
mat2 nfRot(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
`;

const ANIM_GLSL = /* glsl */ `
  float nfFan = aCrowd.x;
  float nfR = aCrowd.y;
  float nfEx = nfFan < 0.5 ? uEx.x : (nfFan < 1.5 ? uEx.y : uEx.z);
  float nfT = uTime + nfR * 37.0;
  float nfWd = fract(aCrowd.z - uWave.x + 0.5) - 0.5;
  float nfWave = uWave.y * exp(-nfWd * nfWd * 1400.0);
  float nfStand = max(smoothstep(0.3, 0.7, nfEx + (nfR - 0.5) * 0.35), nfWave);
  float nfHop = smoothstep(0.72, 1.0, nfEx) * max(0.0, sin(nfT * 8.5)) * 0.32;
  float nfArms = max(smoothstep(0.5, 0.92, nfEx + (aCrowd.w - 0.5) * 0.25), nfWave);
  float nfArmA = nfArms * (2.6 + 0.35 * sin(nfT * 7.0)) + (1.0 - nfArms) * 0.08 * sin(nfT * 1.3);
  float nfSway = sin(nfT * (0.9 + nfR * 0.7)) * (0.035 + 0.09 * nfEx);
  bool nfIsArm = aPart > 2.5 && aPart < 4.5;
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  vec3 nfShirt = nfFan < 0.5 ? (aCrowd.w < 0.3 ? uAlt0 : uShirt0)
    : nfFan < 1.5 ? (aCrowd.w < 0.3 ? uAlt1 : uShirt1)
    : nfHead(fract(nfR * 7.31)) * 0.8;
  if (aPart < 0.5 || nfIsArm) vColor.rgb *= nfShirt;
  else if (aPart < 1.5) vColor.rgb *= nfHead(nfR);
#endif
`;

const NORMAL_GLSL = /* glsl */ `
  if (nfIsArm) objectNormal.yz = nfRot(-nfArmA) * objectNormal.yz;
`;

const POS_GLSL = /* glsl */ `
  if (nfIsArm) {
    vec2 q = transformed.yz - vec2(${SHOULDER.toFixed(3)}, 0.0);
    q = nfRot(-nfArmA) * q;
    transformed.yz = q + vec2(${SHOULDER.toFixed(3)}, 0.0);
  }
  if (aPart > 4.5) transformed.y *= 1.0 + nfStand;
  else transformed.y += nfStand * ${HIP.toFixed(3)} + nfHop;
  transformed.x += nfSway * max(0.0, transformed.y);
  transformed.y += ${HIP.toFixed(3)};
`;

/** The crowd's material: toon (or Lambert), patched with the animation. */
export function crowdMaterial(toon: boolean, u: CrowdUniforms): THREE.Material {
  const m = toon
    ? new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp() })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  m.userData.noToon = true;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = HEAD_GLSL + sh.vertexShader;
    sh.vertexShader = sh.vertexShader
      .replace('#include <color_vertex>', '#include <color_vertex>\n' + ANIM_GLSL)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + NORMAL_GLSL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + POS_GLSL);
  };
  m.customProgramCacheKey = () => 'nf-crowd-v1';
  return m;
}

export function crowdUniforms(): CrowdUniforms {
  return {
    uTime: { value: 0 },
    uEx: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
    uWave: { value: new THREE.Vector2(0, 0) },
    uShirt0: { value: new THREE.Color(0xd22d2d) },
    uShirt1: { value: new THREE.Color(0x2d5bd2) },
    uAlt0: { value: new THREE.Color(0xffffff) },
    uAlt1: { value: new THREE.Color(0xffffff) },
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

/**
 * The crowd mesh for the first `n` seats; fill it in slices with
 * `fillCrowd` (instance matrices + the per-fan vec4).
 */
export function crowdMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  n: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  geo.setAttribute('aCrowd', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'stadium:crowd';
  return mesh;
}

/** Fill instances [i0, i1) from the seat list. Returns i1. */
export function fillCrowd(
  mesh: THREE.InstancedMesh,
  seats: SeatList,
  i0: number,
  i1: number,
): number {
  const attr = mesh.geometry.getAttribute('aCrowd') as THREE.InstancedBufferAttribute;
  const a = attr.array as Float32Array;
  const end = Math.min(i1, mesh.instanceMatrix.count, seats.count);
  for (let i = i0; i < end; i++) {
    const s = 0.92 + seats.data[i * 4 + 3]! * 0.16;
    _q.setFromAxisAngle(Y, seats.yaw[i]!);
    _s.set(s, s, s);
    _t.set(seats.pos[i * 3]!, seats.pos[i * 3 + 1]!, seats.pos[i * 3 + 2]!);
    _m.compose(_t, _q, _s);
    mesh.setMatrixAt(i, _m);
    a[i * 4] = seats.data[i * 4]!;
    a[i * 4 + 1] = seats.data[i * 4 + 1]!;
    a[i * 4 + 2] = seats.data[i * 4 + 2]!;
    a[i * 4 + 3] = seats.data[i * 4 + 3]!;
  }
  mesh.instanceMatrix.needsUpdate = true;
  attr.needsUpdate = true;
  return end;
}
