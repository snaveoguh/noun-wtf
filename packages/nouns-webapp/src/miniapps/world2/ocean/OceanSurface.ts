// ── The ocean surface: one camera-following mesh, one draw ───────────────
//
// A polar grid centred under the camera (rings spaced geometrically, dense
// at your feet, out to the far plane) whose vertex shader runs the wave
// field (waves.ts WAVES_GLSL, the CPU's maths) at each vertex's coast
// coords: Gerstner swell (sets, shoaling, breaking), chop, the swash.
// MeshStandardMaterial patched, so three's sun specular (glints), env
// reflection, shadows, fog and tone mapping all come for free: sunsets
// land on the water with the time of day. Translucent in the shallows (the
// sand shows through), foam on breaking crests, the bore and the
// waterline. No extra passes: the lagoon's refraction pre-pass isn't used.
//
// Far rings fade the swell out before their spacing could alias it, the
// chop is per-pixel (normals) and fades with distance too.

import * as THREE from 'three';

import { inkExcluded } from '../render/Toon';

import { COAST, type CoastFrame } from './coast';
import { WAVES_GLSL } from './waves';

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** GLSL copy of coast.ts shoreLine / shoreDistUV. */
const COAST_GLSL = /* glsl */ `
uniform vec4 uFrame;   // fx, fz, rx, rz
uniform vec4 uCoast;   // side, uB, time, swell fade start
uniform vec2 uGrid;    // mesh origin − town origin (world xz)
float c_cove(float u, out float dv) {
  float w = w_smooth(${f(COAST.cove0)}, ${f(COAST.cove1)}, abs(u - uCoast.y));
  float a = u / 160.0 + 1.0;
  float b = u / 63.0 + 2.0;
  dv = w * (35.0 / 160.0 * cos(a) + 20.0 / 63.0 * cos(b));
  return w * (35.0 * sin(a) + 20.0 * sin(b));
}
float c_dist(float u, float vp) {
  float v = ${f(COAST.shore)};
  float dv = 0.0;
  if (u > ${f(COAST.dnU)}) { float e = u - ${f(COAST.dnU)}; v += ${f(COAST.dnK)} * e * e; dv += ${f(2 * COAST.dnK)} * e; }
  else if (u < ${f(COAST.upU)}) { float e = ${f(COAST.upU)} - u; v += ${f(COAST.upK)} * e * e; dv -= ${f(2 * COAST.upK)} * e; }
  float cd;
  v += c_cove(u, cd);
  dv += cd;
  float dPar = (vp - v) / sqrt(1.0 + dv * dv);
  float dCirc = ${f(COAST.far)} - length(vec2(u - uCoast.y, vp - ${f(COAST.shore)}));
  return min(dPar, dCirc);
}
vec2 c_uv(vec2 L) { return vec2(dot(L, uFrame.xy), dot(L, uFrame.zw) * uCoast.x); }
`;

const VERT_PARS = /* glsl */ `
${WAVES_GLSL}
${COAST_GLSL}
varying vec3 vOc;    // d (rest), water depth, foam
varying vec2 vL;     // world xz − town origin
varying float vCam;  // distance from the camera (m)
// The displaced point (relative to the rest point L) at rest point L
vec3 o_point(vec2 L, float t, float swellK, float chopK, out float od, out vec4 os, out float ok) {
  vec2 uv = c_uv(L);
  float d = c_dist(uv.x, uv.y);
  float k;
  vec4 s = w_swell(d, uv.x - uCoast.y, t, k);
  float e = 0.75;
  float gu = (c_dist(uv.x + e, uv.y) - c_dist(uv.x - e, uv.y));
  float gv = (c_dist(uv.x, uv.y + e) - c_dist(uv.x, uv.y - e));
  vec2 g = gu * uFrame.xy + gv * uCoast.x * uFrame.zw;
  g /= max(1e-5, length(g));
  float sinp = sin(s.x);
  vec2 off = -g * s.z * swellK * sinp;
  float y = s.y * swellK * cos(s.x) + w_chop(L, t) * chopK;
  od = d;
  os = s;
  ok = k;
  return vec3(off.x, y, off.y);
}
`;

const VERT_MAIN = /* glsl */ `
  float t = uCoast.z;
  vec2 L0 = uGrid + position.xz;
  float camDist = length(position.xz);
  // far rings: fade the swell before the grid can alias it; the chop is per pixel past 40 m
  float swellK = 1.0 - w_smooth(uCoast.w, uCoast.w * 2.2, camDist);
  float chopK = 1.0 - w_smooth(25.0, 60.0, camDist);
  float d0; vec4 s0; float k0;
  vec3 p0 = o_point(L0, t, swellK, chopK, d0, s0, k0);
  float dd; vec4 ss; float kk;
  float e = 0.5 + camDist * 0.02;
  vec3 px = o_point(L0 + vec2(e, 0.0), t, swellK, chopK, dd, ss, kk) + vec3(e, 0.0, 0.0);
  vec3 pz = o_point(L0 + vec2(0.0, e), t, swellK, chopK, dd, ss, kk) + vec3(0.0, 0.0, e);
  vec3 wPos = vec3(position.x, 0.0, position.z) + p0;
  vec3 objectNormal = normalize(cross(pz - p0, px - p0));
  float br = d0 > 0.0 ? w_broken(d0, uv0a(L0), t, s0.x, k0) : 0.0;
  float foam = w_foam(br, s0.x, d0) * (0.35 + 0.65 * swellK);
  vOc = vec3(d0, max(0.0, w_bed(d0) + p0.y), foam);
  vL = L0 + p0.xz;
  vCam = camDist;
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vOc;
varying vec2 vL;
varying float vCam;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uT;
uniform float uDebug;
float o_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float o_noise(vec2 p) {
  vec2 i = floor(p); vec2 fr = fract(p);
  vec2 u = fr * fr * fr * (fr * (fr * 6.0 - 15.0) + 10.0);
  return mix(mix(o_hash(i), o_hash(i + vec2(1.0, 0.0)), u.x), mix(o_hash(i + vec2(0.0, 1.0)), o_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// streaky foam: three octaves, stretched along the crest
float o_foamNoise(vec2 p) {
  return o_noise(p) * 0.5 + o_noise(p * 2.13 + 7.1) * 0.3 + o_noise(p * 4.7 - 3.3) * 0.2;
}
`;

const FRAG_COLOR = /* glsl */ `
  float od = vOc.x;
  if (od < -8.0) discard;
  float depth = vOc.y;
  float deepK = smoothstep(2.0, 22.0, depth);
  vec3 water = mix(uShallow, uMid, smoothstep(0.3, 3.5, depth));
  water = mix(water, uDeep, deepK);
  // foam: the wave's own (crest / bore / trail) broken up by drifting noise
  vec2 fp = vL * 0.55 + vec2(uT * 0.21, -uT * 0.13);
  float n = o_foamNoise(fp);
  float foam = smoothstep(0.5, 0.8, vOc.z * (0.35 + 0.95 * n));
  // the waterline: a lace of foam where the swash runs up
  float lace = (1.0 - smoothstep(0.0, 0.3, depth)) * smoothstep(0.45, 0.7, n);
  foam = max(foam, lace);
  diffuseColor.rgb = mix(water, uFoam, foam);
  totalEmissiveRadiance += uFoam * foam * 0.3;
  // see the sand in the shallows; never a hard edge where it meets the beach
  diffuseColor.a = mix(mix(0.25, 0.96, smoothstep(0.05, 1.4, depth)), 1.0, foam);
  diffuseColor.a *= smoothstep(-8.0, -1.0, od) * 0.999 + 0.001;
  // dev: 1 = coast distance bands (red: inland), 2 = water depth, 3 = foam
  if (uDebug > 0.5) {
    diffuseColor.a = 1.0;
    if (uDebug < 1.5) diffuseColor.rgb = od < 0.0 ? vec3(1.0, 0.0, 0.0) : vec3(fract(od / 50.0), 0.2, 1.0 - fract(od / 50.0));
    else if (uDebug < 2.5) diffuseColor.rgb = vec3(depth / 5.0);
    else diffuseColor.rgb = vec3(vOc.z);
  }
`;

const FRAG_NORMAL = /* glsl */ `
  {
    // per-pixel ripples (fade with distance: no sparkle soup far away)
    float rk = 1.0 - smoothstep(30.0, 220.0, vCam);
    vec2 q = vL;
    float t = uT;
    vec2 dn = vec2(0.0);
    dn += vec2(0.62, 0.31) * 0.07 * cos(0.62 * q.x + 0.31 * q.y - 2.39 * t);
    dn += vec2(-0.38, 0.95) * 0.045 * cos(-0.38 * q.x + 0.95 * q.y - 3.11 * t + 1.7);
    dn += vec2(2.3, 1.1) * 0.012 * cos(2.3 * q.x + 1.1 * q.y - 5.3 * t + 0.4);
    dn += vec2(-1.4, 2.6) * 0.009 * cos(-1.4 * q.x + 2.6 * q.y - 6.1 * t + 2.2);
    dn *= rk * (1.0 - vOc.z * 0.6);
    // (the tilt itself, in view space: never normalised, it's small)
    vec3 nv = (viewMatrix * vec4(-dn.x, 0.0, -dn.y, 0.0)).xyz;
    normal = normalize(normal + nv);
  }
`;

export interface OceanSurfaceOpts {
  /** Rings, segments, far radius (m). */
  rings: number;
  segments: number;
  radius: number;
  /** Swell fades out from this distance (m) to 2.2× it. */
  swellFade: number;
}

export const OCEAN_HIGH: OceanSurfaceOpts = { rings: 110, segments: 128, radius: 3000, swellFade: 380 };
export const OCEAN_LOW: OceanSurfaceOpts = { rings: 78, segments: 88, radius: 2400, swellFade: 260 };

/** The polar grid: centre vertex + rings (r0 · q^i), CCW from above. */
export function polarGrid(o: OceanSurfaceOpts): THREE.BufferGeometry {
  const r0 = 0.6;
  const q = Math.pow(o.radius / r0, 1 / (o.rings - 1));
  const n = o.segments;
  const pos = new Float32Array((1 + o.rings * n) * 3);
  let r = r0;
  for (let i = 0; i < o.rings; i++) {
    for (let j = 0; j < n; j++) {
      // stagger alternate rings by half a segment: rounder triangles
      const a = ((j + (i % 2) * 0.5) / n) * Math.PI * 2;
      const k = 1 + i * n + j;
      pos[k * 3] = Math.cos(a) * r;
      pos[k * 3 + 2] = Math.sin(a) * r;
    }
    r *= q;
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) idx.push(0, 1 + ((j + 1) % n), 1 + j);
  for (let i = 0; i + 1 < o.rings; i++) {
    const a0 = 1 + i * n;
    const b0 = 1 + (i + 1) * n;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      idx.push(a0 + j, a0 + j1, b0 + j);
      idx.push(a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  // never culled (it's always around the camera); a sane sphere anyway
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), o.radius);
  return g;
}

export class OceanSurface {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private uniforms = {
    uFrame: { value: new THREE.Vector4() },
    uCoast: { value: new THREE.Vector4() },
    uGrid: { value: new THREE.Vector2() },
    uT: { value: 0 },
    uDebug: { value: 0 },
    uDeep: { value: new THREE.Color(0x0a3550) },
    uMid: { value: new THREE.Color(0x11708c) },
    uShallow: { value: new THREE.Color(0x45d6cf) },
    uFoam: { value: new THREE.Color(0xf6fbff) },
  };

  constructor(
    private c: CoastFrame,
    readonly opts: OceanSurfaceOpts,
  ) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.16,
      metalness: 0.02,
      envMapIntensity: 0.7,
      transparent: true,
      depthWrite: true,
    });
    mat.name = 'Ocean';
    const u = this.uniforms;
    u.uFrame.value.set(c.fx, c.fz, c.rx, c.rz);
    u.uCoast.value.set(c.side, c.uB, 0, opts.swellFade);
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}\nfloat uv0a(vec2 L) { return c_uv(L).x - uCoast.y; }`)
        .replace('#include <beginnormal_vertex>', VERT_MAIN)
        .replace('#include <begin_vertex>', 'vec3 transformed = wPos;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
    };
    mat.customProgramCacheKey = () => 'ocean-v1';
    const mesh = new THREE.Mesh(polarGrid(opts), mat);
    mesh.name = 'ocean';
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 1;
    inkExcluded.add(mesh);
    this.mesh = mesh;
  }

  /** Dev: 0 off, 1 coast distance, 2 depth, 3 foam. */
  set debug(v: number) {
    this.uniforms.uDebug.value = v;
  }

  /** Follow the camera, advance the clock (t: seaClock seconds). */
  update(camX: number, camZ: number, t: number) {
    const m = this.mesh;
    m.position.set(camX, this.c.sea, camZ);
    m.updateMatrixWorld();
    this.uniforms.uGrid.value.set(camX - this.c.ox, camZ - this.c.oz);
    this.uniforms.uCoast.value.z = t;
    this.uniforms.uT.value = t;
  }

  dispose() {
    inkExcluded.delete(this.mesh);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
