// ── Nature layer: shared uniforms, RNG/noise, shader patches, instancing ──
//
// Every foliage / water / rock material in this folder pulls its animated
// inputs (time, wind, player position, caustics) from `natureUniforms`, so a
// single `NatureSystem.update()` per frame drives the whole layer.

import * as THREE from 'three';

import { getToonRamp as getGameToonRamp } from '../render/Toon';

export type NatureQuality = 'low' | 'medium' | 'high';

/** Camera layer used by the water refraction pre-pass (bed, rocks, basin walls). */
export const NATURE_BED_LAYER = 5;

export const natureUniforms = {
  uTime: { value: 0 },
  /** Normalised XZ wind direction. */
  uWindDir: { value: new THREE.Vector2(0.82, 0.57) },
  /** 0 = calm, 1 = breezy, 2 = windy. */
  uWindStrength: { value: 1 },
  /** Player (or camera target) world position; grass bends away from it. */
  uPlayerPos: { value: new THREE.Vector3(1e5, 0, 1e5) },
  /** Tileable caustics pattern (set by the water module). */
  uCaustics: { value: null as THREE.Texture | null },
  /** Sun colour * intensity (synced from the scene's directional light). */
  uSunColor: { value: new THREE.Color(1, 1, 1) },
};

// ── RNG + noise ─────────────────────────────────────────────────────────

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed | 0) ^ 0x9e3779b9;
    for (let i = 0; i < 4; i++) this.next();
  }
  /** mulberry32 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  /** Approximate gaussian (mean 0, sd 1). */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.73;
  }
  /** Uniform direction on the unit sphere. */
  dir(out = new THREE.Vector3()): THREE.Vector3 {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(a), z, r * Math.sin(a));
  }
}

export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1440662683 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** 2D value noise, optionally periodic (for tileable textures). */
export function valueNoise2(x: number, y: number, seed: number, period = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const w = (v: number) => (period > 0 ? ((v % period) + period) % period : v);
  const a = hash3(w(xi), w(yi), 0, seed);
  const b = hash3(w(xi + 1), w(yi), 0, seed);
  const c = hash3(w(xi), w(yi + 1), 0, seed);
  const d = hash3(w(xi + 1), w(yi + 1), 0, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** Tileable fBm in [0,1] for u,v in [0,1). */
export function fbm2(u: number, v: number, seed: number, octaves: number, basePeriod: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(u * period, v * period, seed + o * 31, period);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** Smooth 3D value noise in [0,1]. */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const zf = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k, seed);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), xf), l(h(0, 1, 0), h(1, 1, 0), xf), yf),
    l(l(h(0, 0, 1), h(1, 0, 1), xf), l(h(0, 1, 1), h(1, 1, 1), xf), yf),
    zf,
  );
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x * f, y * f, z * f, seed + o * 13);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

// ── Ground placement ────────────────────────────────────────────────────

/** Anything with the CollisionWorld raycast signature. */
export interface GroundQuery {
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    far: number,
  ): { point: THREE.Vector3; normal: THREE.Vector3 } | null;
}

const _down = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();

/** Ground height at (x,z) via a downward ray, or `fallback` when nothing is hit. */
export function groundAt(
  ground: GroundQuery | null | undefined,
  x: number,
  z: number,
  fallback: number,
  fromY = fallback + 30,
): { y: number; normal: THREE.Vector3 } {
  if (ground !== null && ground !== undefined) {
    _o.set(x, fromY, z);
    const hit = ground.raycast(_o, _down, 80);
    if (hit !== null) return { y: hit.point.y, normal: hit.normal };
  }
  return { y: fallback, normal: new THREE.Vector3(0, 1, 0) };
}

// ── Regions (rectangles / polygons on the XZ plane) ─────────────────────

export type Region =
  | { type: 'rect'; center: THREE.Vector2 | [number, number]; size: [number, number]; rot?: number }
  | { type: 'circle'; center: THREE.Vector2 | [number, number]; radius: number }
  | { type: 'polygon'; points: (THREE.Vector2 | [number, number])[] };

const v2 = (p: THREE.Vector2 | [number, number]) =>
  Array.isArray(p) ? new THREE.Vector2(p[0], p[1]) : p.clone();

export interface RegionSampler {
  area: number;
  bbox: THREE.Box2;
  contains(x: number, z: number): boolean;
  /** Signed-ish distance to the boundary (positive inside). */
  edgeDistance(x: number, z: number): number;
}

export function regionSampler(r: Region): RegionSampler {
  if (r.type === 'circle') {
    const c = v2(r.center);
    return {
      area: Math.PI * r.radius * r.radius,
      bbox: new THREE.Box2(
        new THREE.Vector2(c.x - r.radius, c.y - r.radius),
        new THREE.Vector2(c.x + r.radius, c.y + r.radius),
      ),
      contains: (x, z) => (x - c.x) ** 2 + (z - c.y) ** 2 <= r.radius * r.radius,
      edgeDistance: (x, z) => r.radius - Math.hypot(x - c.x, z - c.y),
    };
  }
  const pts =
    r.type === 'polygon'
      ? r.points.map(v2)
      : (() => {
          const c = v2(r.center);
          const [w, d] = r.size;
          const rot = r.rot ?? 0;
          return [
            [-w / 2, -d / 2],
            [w / 2, -d / 2],
            [w / 2, d / 2],
            [-w / 2, d / 2],
          ].map(([x, z]) => new THREE.Vector2(x, z).rotateAround(new THREE.Vector2(), rot).add(c));
        })();
  const bbox = new THREE.Box2().setFromPoints(pts);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const contains = (x: number, z: number) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  };
  const edgeDistance = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const abx = b.x - a.x;
      const abz = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / (abx * abx + abz * abz)),
      );
      best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.y + abz * t)));
    }
    return contains(x, z) ? best : -best;
  };
  return { area: Math.abs(area) / 2, bbox, contains, edgeDistance };
}

// ── Shader patching ─────────────────────────────────────────────────────

export interface WindPatch {
  /** World-space sway amplitude (m) at wind weight 1. */
  swayAmp: number;
  swayFreq: number;
  /** Leaf flutter amplitude (m) along the (bent) normal. */
  flutterAmp: number;
  flutterFreq: number;
}

export interface FoliagePatchOptions {
  key: string;
  wind?: WindPatch;
  /** Back-lit transmission tint (multiplied with albedo). */
  translucency?: { color: THREE.Color; strength: number };
  /** Use the vertex normal on both faces (canopy-volume shading). */
  bentNormals?: boolean;
  /** Boost alpha with mip level so alpha-tested cards don't thin out at distance. */
  alphaMip?: { texSize: number; amount: number };
  /** Grass: shrink blades into the ground between these camera distances; bend from player. */
  grass?: { fadeStart: number; fadeEnd: number; trample: boolean };
  /** Instanced atlas cell lookup: attribute `aCell` (float) on the InstancedMesh geometry. */
  atlas?: { cols: number; rows: number };
  /** Extra brightness at the very top of the vertex wind weight (sun-kissed tips). */
  tipLight?: number;
}

const WIND_PARS = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
attribute vec2 wind;
#ifdef NW_GRASS
uniform vec3 uPlayerPos;
uniform vec2 uGrassFade;
#endif
#ifdef NW_ATLAS
attribute float aCell;
#endif
#ifdef NW_TIPLIGHT
varying float vNwTip;
#endif
mat3 nwModelBasis() {
  mat3 m = mat3( modelMatrix );
  #ifdef USE_INSTANCING
  m = m * mat3( instanceMatrix );
  #endif
  return m;
}
vec3 nwOrigin() {
  #ifdef USE_INSTANCING
  return ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz;
  #else
  return modelMatrix[ 3 ].xyz;
  #endif
}
`;

const WIND_VERTEX = /* glsl */ `
{
  mat3 nwM = nwModelBasis();
  float nwS2 = max( dot( nwM[ 0 ], nwM[ 0 ] ), 1e-6 );
  vec3 nwO = nwOrigin();
  vec3 nwP = nwO + nwM * transformed;
  vec3 nwOff = vec3( 0.0 );
  #ifdef NW_WIND
  float ph = dot( nwO.xz, vec2( 0.131, 0.173 ) );
  float t = uTime;
  vec3 wd = vec3( uWindDir.x, 0.0, uWindDir.y );
  vec3 wp = vec3( -wd.z, 0.0, wd.x );
  float gust = 0.6 + 0.4 * sin( t * 0.37 + ph * 0.5 ) * sin( t * 0.21 + 1.3 + nwP.x * 0.02 );
  float sway = 0.45 + 0.4 * sin( t * NW_SWAY_FREQ + ph ) + 0.15 * sin( t * NW_SWAY_FREQ * 2.31 + ph * 1.7 );
  float side = sin( t * NW_SWAY_FREQ * 0.83 + ph * 2.1 ) * 0.3;
  nwOff += ( wd * sway + wp * side ) * gust * uWindStrength * NW_SWAY_AMP * wind.x;
  vec3 nwN = normalize( nwM * normal );
  float fl = sin( t * NW_FLUT_FREQ + dot( nwP, vec3( 5.1, 3.7, 4.3 ) ) ) * 0.6
           + sin( t * NW_FLUT_FREQ * 1.73 + dot( nwP, vec3( -2.3, 6.1, 3.1 ) ) ) * 0.4;
  nwOff += nwN * fl * NW_FLUT_AMP * wind.y * ( 0.35 + 0.65 * gust ) * uWindStrength;
  #endif
  #ifdef NW_GRASS
  float nwD = distance( nwO.xz, cameraPosition.xz );
  float nwF = 1.0 - smoothstep( uGrassFade.x, uGrassFade.y, nwD );
  #ifdef NW_TRAMPLE
  vec3 away = nwO - uPlayerPos;
  away.y = 0.0;
  float ad = length( away );
  float tr = ( 1.0 - smoothstep( 0.35, 1.4, ad ) ) * step( abs( nwO.y - uPlayerPos.y ), 1.5 );
  nwOff += ( away / max( ad, 1e-3 ) ) * tr * 0.35 * wind.x;
  nwF *= 1.0 - tr * 0.55;
  #endif
  transformed.y *= nwF;
  #endif
  // world offset -> local (rotation * uniform scale inverse)
  transformed += ( transpose( nwM ) * nwOff ) / nwS2;
}
#ifdef NW_TIPLIGHT
vNwTip = wind.x;
#endif
`;

const ATLAS_VERTEX = /* glsl */ `
#if defined( NW_ATLAS ) && defined( USE_MAP )
vMapUv = ( uv + vec2( mod( aCell, NW_ATLAS_COLS ), floor( aCell / NW_ATLAS_COLS ) ) )
  / vec2( NW_ATLAS_COLS, NW_ATLAS_ROWS );
#endif
`;

const ALPHA_MIP = /* glsl */ `
#if defined( USE_MAP ) && defined( NW_ALPHA_MIP )
{
  vec2 nwDx = dFdx( vMapUv * NW_TEX_SIZE );
  vec2 nwDy = dFdy( vMapUv * NW_TEX_SIZE );
  float nwLod = max( 0.0, 0.5 * log2( max( dot( nwDx, nwDx ), dot( nwDy, nwDy ) ) ) );
  diffuseColor.a = min( 1.0, diffuseColor.a * ( 1.0 + nwLod * NW_ALPHA_MIP ) );
}
#endif
`;

const TRANS_PARS = /* glsl */ `
uniform vec3 uTransColor;
uniform float uTransStrength;
#ifdef NW_TIPLIGHT
varying float vNwTip;
#endif
`;

const DIR_HOOK = '// NW_DIR_LIGHT_HOOK';

/**
 * Insert GLSL into the (shadowed) directional-light loop, right after
 * RE_Direct. `directLight`, `geometryNormal`, `geometryViewDir`,
 * `diffuseColor` and `reflectedLight` are in scope. Composable: several
 * patches can hook the same shader.
 */
export function injectDirLightHook(fragmentShader: string, code: string): string {
  let fs = fragmentShader;
  if (!fs.includes(DIR_HOOK)) {
    const chunk = THREE.ShaderChunk.lights_fragment_begin.replace(
      /(RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);)(\s*}\s*#pragma unroll_loop_end\s*#endif\s*#if \( NUM_RECT_AREA_LIGHTS)/,
      `$1\n${DIR_HOOK}$2`,
    );
    fs = fs.replace('#include <lights_fragment_begin>', chunk);
  }
  return fs.replace(DIR_HOOK, `${code}\n${DIR_HOOK}`);
}

// Cel version: back-lit leaves get a flat bright rim band instead of a soft glow.
const TRANSLUCENCY_HOOK = /* glsl */ `
{
  float nwBack = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 3.0 );
  float nwThru = saturate( dot( -geometryNormal, directLight.direction ) );
  float nwT = nwBack * 1.6 + nwThru * 0.55;
  float nwFw = fwidth( nwT ) + 1e-3;
  float nwBand = smoothstep( 0.5 - nwFw, 0.5 + nwFw, nwT );
  reflectedLight.directDiffuse += directLight.color * uTransColor * diffuseColor.rgb * nwBand * uTransStrength;
}
`;

// ── Toon ramp ───────────────────────────────────────────────────────────

let toonRamp: THREE.Texture | null = null;

/**
 * Shared toon gradient map for every nature MeshToonMaterial — defaults to
 * the game's ramp (render/Toon.ts) so foliage, rocks and the level band
 * identically. Override with setToonRamp() before building.
 */
export function getToonRamp(): THREE.Texture {
  if (toonRamp === null) toonRamp = getGameToonRamp();
  return toonRamp;
}

/** Use the game's own ramp (call before any nature material is created). */
export function setToonRamp(t: THREE.Texture) {
  toonRamp = t;
}

/** MeshToonMaterial preset wired to the shared ramp. */
export function toonMaterial(p: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: getToonRamp(), ...p });
}

/** Chain an extra onBeforeCompile patch onto a material (keeps existing patches). */
export function chainPatch(
  mat: THREE.Material,
  key: string,
  fn: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
) {
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    fn(shader);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|${key}`;
  mat.needsUpdate = true;
}

/**
 * Patch a MeshStandardMaterial (or MeshDepthMaterial for shadows) with the
 * nature-layer wind / bent-normal / translucency / alpha-mip / grass logic.
 * Depth materials only get the vertex + alpha parts.
 */
export function patchFoliageMaterial<T extends THREE.Material>(mat: T, o: FoliagePatchOptions): T {
  const defines: Record<string, string | number | boolean> = {};
  if (o.wind !== undefined) {
    defines.NW_WIND = '';
    defines.NW_SWAY_AMP = o.wind.swayAmp.toFixed(4);
    defines.NW_SWAY_FREQ = o.wind.swayFreq.toFixed(4);
    defines.NW_FLUT_AMP = o.wind.flutterAmp.toFixed(4);
    defines.NW_FLUT_FREQ = o.wind.flutterFreq.toFixed(4);
  }
  if (o.grass !== undefined) {
    defines.NW_GRASS = '';
    if (o.grass.trample) defines.NW_TRAMPLE = '';
  }
  if (o.atlas !== undefined) {
    defines.NW_ATLAS = '';
    defines.NW_ATLAS_COLS = o.atlas.cols.toFixed(1);
    defines.NW_ATLAS_ROWS = o.atlas.rows.toFixed(1);
  }
  if (o.alphaMip !== undefined) {
    defines.NW_ALPHA_MIP = o.alphaMip.amount.toFixed(3);
    defines.NW_TEX_SIZE = o.alphaMip.texSize.toFixed(1);
  }
  if (o.tipLight !== undefined) {
    defines.NW_TIPLIGHT = '';
    defines.NW_TIP_AMT = o.tipLight.toFixed(3);
  }
  mat.defines = { ...(mat.defines ?? {}), ...defines };
  const isDepth = (mat as unknown as THREE.MeshDepthMaterial).isMeshDepthMaterial === true;
  const transColor = new THREE.Uniform(o.translucency?.color ?? new THREE.Color(0, 0, 0));
  const transStrength = new THREE.Uniform(o.translucency?.strength ?? 0);
  const grassFade = new THREE.Uniform(
    new THREE.Vector2(o.grass?.fadeStart ?? 1e4, o.grass?.fadeEnd ?? 1e4 + 1),
  );
  mat.userData.nwUniforms = { transColor, transStrength, grassFade };

  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = natureUniforms.uTime;
    shader.uniforms.uWindDir = natureUniforms.uWindDir;
    shader.uniforms.uWindStrength = natureUniforms.uWindStrength;
    shader.uniforms.uPlayerPos = natureUniforms.uPlayerPos;
    shader.uniforms.uGrassFade = grassFade;
    shader.uniforms.uTransColor = transColor;
    shader.uniforms.uTransStrength = transStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${ATLAS_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `${ALPHA_MIP}\n#include <alphatest_fragment>`,
    );
    if (isDepth) return;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${TRANS_PARS}`,
    );
    if (o.bentNormals === true) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;`,
      );
    }
    if (o.tipLight !== undefined) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + NW_TIP_AMT * vNwTip;`,
      );
    }
    if (o.translucency !== undefined) {
      shader.fragmentShader = injectDirLightHook(shader.fragmentShader, TRANSLUCENCY_HOOK);
    }
  };
  const key = `nw-${o.key}-${isDepth ? 'd' : 'c'}-${JSON.stringify(defines)}-${
    o.bentNormals === true ? 1 : 0
  }-${o.translucency !== undefined ? 1 : 0}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Shadow-casting depth material that matches a patched alpha-tested foliage material. */
export function foliageDepthMaterial(
  map: THREE.Texture | null,
  alphaTest: number,
  o: FoliagePatchOptions,
): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map,
    alphaTest: map !== null ? alphaTest : 0,
    side: THREE.DoubleSide,
  });
  return patchFoliageMaterial(m, o);
}

// ── Chunked instancing ──────────────────────────────────────────────────

export interface InstanceSpec {
  matrix: THREE.Matrix4;
  color?: THREE.Color;
  cell?: number;
}

/**
 * Split instances into XZ grid chunks so each InstancedMesh gets a tight
 * bounding sphere (frustum culling) and can be distance-culled.
 */
export function buildInstancedChunks(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: InstanceSpec[],
  opts: {
    chunkSize: number;
    castShadow: boolean;
    receiveShadow: boolean;
    depthMaterial?: THREE.Material;
    name: string;
  },
): THREE.InstancedMesh[] {
  const buckets = new Map<string, InstanceSpec[]>();
  const p = new THREE.Vector3();
  for (const inst of instances) {
    p.setFromMatrixPosition(inst.matrix);
    const k = `${Math.floor(p.x / opts.chunkSize)},${Math.floor(p.z / opts.chunkSize)}`;
    let b = buckets.get(k);
    if (b === undefined) {
      b = [];
      buckets.set(k, b);
    }
    b.push(inst);
  }
  const out: THREE.InstancedMesh[] = [];
  const hasColor = instances.some(i => i.color !== undefined);
  const hasCell = instances.some(i => i.cell !== undefined);
  for (const list of buckets.values()) {
    const geo = hasCell ? geometry.clone() : geometry;
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    mesh.name = opts.name;
    const cells = hasCell ? new Float32Array(list.length) : null;
    list.forEach((inst, i) => {
      mesh.setMatrixAt(i, inst.matrix);
      if (hasColor) mesh.setColorAt(i, inst.color ?? new THREE.Color(1, 1, 1));
      if (cells !== null) cells[i] = inst.cell ?? 0;
    });
    if (cells !== null) geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    mesh.castShadow = opts.castShadow;
    mesh.receiveShadow = opts.receiveShadow;
    if (opts.depthMaterial !== undefined) mesh.customDepthMaterial = opts.depthMaterial;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    out.push(mesh);
  }
  return out;
}

/** Give every vertex of a geometry the same `wind` attribute value (or a callback). */
export function setWindAttribute(
  geo: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number, i: number) => [number, number],
) {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const [a, b] = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    arr[i * 2] = a;
    arr[i * 2 + 1] = b;
  }
  geo.setAttribute('wind', new THREE.BufferAttribute(arr, 2));
}
