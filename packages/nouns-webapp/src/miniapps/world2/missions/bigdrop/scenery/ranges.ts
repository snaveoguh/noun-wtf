// ── Distant snowy ranges + a giant Noun on the skyline ──────────────────
//
// Rings of mountains all round the horizon, drawn at infinity after the sky
// (they sit on the camera, so they're always on the horizon however far you
// ride). Several depths: the near ring is big, crisp and tall, the far ones
// smaller and lost in blue haze. From the summit you look down on them
// (their peaks poke out of the cloud sea below the horizon); as you descend
// they rise until, at the bottom, they tower over you. Each ring drifts
// round at its own slow rate, so they slide past each other (parallax).
//
// Flat-shaded low-poly facets with three toon bands, snow caps above a
// ragged snowline, rock on the steep faces, an ink line along the ridge.

import * as THREE from 'three';

import { hash2, vnoise } from '../../../world/mountain/config';

/** Placement of one ring (angles in degrees, at the summit). */
export interface RangeLayer {
  seed: number;
  /** Columns round the full circle. */
  columns: number;
  /** Ridge elevation: base and amplitude (deg). */
  base: number;
  amp: number;
  /** Noise frequency round the circle (features per radian, roughly). */
  freq: number;
  /** 0 = crisp, 1 = all haze. */
  haze: number;
  /** How far it rises by the bottom (deg). */
  lift: number;
  /** Drift (radians per m of depth). */
  drift: number;
}

export const LAYERS: readonly RangeLayer[] = [
  {
    seed: 11,
    columns: 320,
    base: -1.5,
    amp: 4.5,
    freq: 5,
    haze: 0.62,
    lift: 7,
    drift: 1 / 1_400_000,
  },
  {
    seed: 23,
    columns: 280,
    base: -6,
    amp: 7,
    freq: 3.4,
    haze: 0.42,
    lift: 12,
    drift: -1 / 700_000,
  },
  {
    seed: 37,
    columns: 240,
    base: -12,
    amp: 10,
    freq: 2.3,
    haze: 0.22,
    lift: 19,
    drift: 1 / 320_000,
  },
];

/** Ridge elevation (deg) of `layer` at azimuth `a` (radians); periodic. */
export function ridgeAt(layer: RangeLayer, a: number): number {
  const f = layer.freq;
  const x = Math.cos(a) * f;
  const z = Math.sin(a) * f;
  // Ridged noise: sharp peaks, broad saddles
  let r = 0;
  let amp = 1;
  let sum = 0;
  let fx = x;
  let fz = z;
  for (let o = 0; o < 4; o++) {
    const n = 1 - Math.abs(vnoise(fx, fz, layer.seed + o * 101));
    r += amp * n * n;
    sum += amp;
    amp *= 0.5;
    fx *= 2.1;
    fz *= 2.1;
  }
  return layer.base + layer.amp * (r / sum - 0.25) * 1.6;
}

/** How far the rings have risen by `depth`: 0 at the summit, 1 at the bottom. */
export function liftAt(depth: number): number {
  return Math.log1p(Math.max(0, depth) / 30_000) / Math.log1p(1_000_000 / 30_000);
}

const VERT = /* glsl */ `
attribute vec3 tint;
uniform float uLift;
uniform float uRot;
varying vec3 vColor;
varying vec3 vN;
varying float vEl;
varying float vTop;
attribute float top;
void main() {
  vec3 p = position;
  float r = length(p.xz);
  float az = atan(p.x, p.z) + uRot;
  float el = atan(p.y, r) + uLift;
  vec3 d = vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az)) * 1000.0;
  float c = cos(uRot);
  float s = sin(uRot);
  vN = vec3(normal.x * c + normal.z * s, normal.y, -normal.x * s + normal.z * c);
  vColor = tint;
  vEl = el;
  vTop = top;
  vec4 q = projectionMatrix * modelViewMatrix * vec4(d, 1.0);
  gl_Position = q.xyww;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uHaze;
uniform float uHazeK;
uniform vec3 uToLight;
uniform vec3 uLight;
uniform vec3 uShade;
uniform vec3 uCloud;
uniform float uCloudEl;
uniform vec3 uInk;
varying vec3 vColor;
varying vec3 vN;
varying float vEl;
varying float vTop;
void main() {
  vec3 n = normalize(vN);
  float l = dot(n, uToLight);
  // Three toon bands
  float band = l > 0.35 ? 1.0 : l > 0.0 ? 0.8 : 0.6;
  vec3 col = vColor * mix(uShade, uLight, band) * band;
  // Ink along the ridge line
  float fw = fwidth(vTop) * 1.6 + 1e-4;
  col = mix(col, uInk, smoothstep(1.0 - fw * 1.8, 1.0 - fw * 0.4, vTop) * 0.85);
  col = mix(col, uHaze, uHazeK);
  // Feet in the cloud sea
  col = mix(col, uCloud, 1.0 - smoothstep(uCloudEl - 0.05, uCloudEl + 0.02, vEl));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export interface RangeUniforms {
  [k: string]: THREE.IUniform;
  uLift: { value: number };
  uRot: { value: number };
  uHaze: { value: THREE.Color };
  uHazeK: { value: number };
  uToLight: { value: THREE.Vector3 };
  uLight: { value: THREE.Color };
  uShade: { value: THREE.Color };
  uCloud: { value: THREE.Color };
  uCloudEl: { value: number };
  uInk: { value: THREE.Color };
}

const SNOW = new THREE.Color(0xf4f8ff);
const SNOW_BLUE = new THREE.Color(0xd5e2f6);
const ROCK = new THREE.Color(0x5d6a82);
const ROCK_WARM = new THREE.Color(0x7a6f78);

/** Unit-radius geometry of one ring: base, a shoulder row and the ridge. */
export function ringGeometry(layer: RangeLayer, columns = layer.columns): THREE.BufferGeometry {
  const deg = Math.PI / 180;
  const N = columns;
  const BASE = -32 * deg;
  // Rows: base, shoulder, ridge (radius pulled in on the shoulders so the
  // faces facet like real spurs)
  const rows = 3;
  const P: number[][] = [];
  const T: number[] = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const top = ridgeAt(layer, a) * deg;
    for (let r = 0; r < rows; r++) {
      const f = r / (rows - 1);
      const jit = hash2(i, r, layer.seed);
      const el =
        r === 0 ? BASE : r === rows - 1 ? top : BASE + (top - BASE) * (0.72 + 0.12 * (jit - 0.5));
      const rad = r === rows - 1 ? 1 : 1 - 0.035 * jit - (r === 0 ? 0 : 0.01);
      P.push([
        Math.sin(a) * rad * Math.cos(el),
        Math.sin(el) * rad,
        Math.cos(a) * rad * Math.cos(el),
      ]);
      T.push(f);
    }
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const tops: number[] = [];
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  const tri = (ia: number, ib: number, ic: number, k: number) => {
    va.fromArray(P[ia]!);
    vb.fromArray(P[ib]!);
    vc.fromArray(P[ic]!);
    n.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va)).normalize();
    // Face the viewer at the centre
    const centre = va.clone().add(vb).add(vc);
    if (n.dot(centre) > 0) n.negate();
    const tf = (T[ia]! + T[ib]! + T[ic]!) / 3;
    const snowLine = 0.45 + 0.3 * hash2(k, 7, layer.seed);
    const steep = 1 - Math.abs(n.y);
    if (tf > snowLine && steep < 0.985) c.copy(hash2(k, 3, layer.seed) > 0.4 ? SNOW : SNOW_BLUE);
    else c.copy(ROCK).lerp(ROCK_WARM, hash2(k, 5, layer.seed));
    for (const [v, t] of [
      [va, T[ia]!],
      [vb, T[ib]!],
      [vc, T[ic]!],
    ] as const) {
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
      tops.push(t);
    }
  };
  for (let i = 0; i < N; i++)
    for (let r = 0; r < rows - 1; r++) {
      const a = i * rows + r;
      const b = (i + 1) * rows + r;
      tri(a, b, a + 1, i * 4 + r * 2);
      tri(a + 1, b, b + 1, i * 4 + r * 2 + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('top', new THREE.Float32BufferAttribute(tops, 1));
  return g;
}

/**
 * A giant Noun head carved out of a far peak: a snow-capped square head on a
 * rock plinth, wearing red noggles. Unit scale: about 0.1 rad wide, at
 * azimuth `az` (radians), standing on elevation `el`.
 */
export function nounGeometry(az: number, el: number): THREE.BufferGeometry {
  const parts: { g: THREE.BufferGeometry; c: number }[] = [];
  const add = (g: THREE.BufferGeometry, c: number) => parts.push({ g: g.toNonIndexed(), c });
  // Plinth: a stepped rock spire
  const plinth = new THREE.CylinderGeometry(0.05, 0.11, 0.16, 6, 1);
  plinth.translate(0, -0.08, 0);
  add(plinth, 0x6a7088);
  // The head
  const head = new THREE.BoxGeometry(0.11, 0.09, 0.08);
  head.translate(0, 0.045, 0);
  add(head, 0xe9eef8);
  const cap = new THREE.BoxGeometry(0.114, 0.012, 0.084);
  cap.translate(0, 0.094, 0);
  add(cap, 0xffffff);
  // Noggles on the face toward the viewer (−z of this frame)
  const red = 0xf3322c;
  const frameL = new THREE.BoxGeometry(0.036, 0.03, 0.012);
  frameL.translate(-0.022, 0.05, -0.044);
  add(frameL, red);
  const frameR = frameL.clone();
  frameR.translate(0.05, 0, 0);
  add(frameR, red);
  const bridge = new THREE.BoxGeometry(0.016, 0.006, 0.012);
  bridge.translate(0.003, 0.054, -0.044);
  add(bridge, red);
  const arm = new THREE.BoxGeometry(0.02, 0.006, 0.012);
  arm.translate(-0.048, 0.054, -0.044);
  add(arm, red);
  for (const dx of [-0.022, 0.028]) {
    const w = new THREE.BoxGeometry(0.012, 0.018, 0.004);
    w.translate(dx - 0.007, 0.05, -0.051);
    add(w, 0xffffff);
    const b = new THREE.BoxGeometry(0.012, 0.018, 0.004);
    b.translate(dx + 0.006, 0.05, -0.051);
    add(b, 0x0b0b0f);
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const tops: number[] = [];
  const m = new THREE.Matrix4();
  // Face the centre: local −z points back toward the viewer
  m.makeRotationY(az);
  const at = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  const c = new THREE.Color();
  for (const { g, c: hex } of parts) {
    g.applyMatrix4(m);
    g.translate(at.x, at.y, at.z);
    g.computeVertexNormals();
    c.set(hex);
    const p = g.getAttribute('position');
    const nn = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      col.push(c.r, c.g, c.b);
      tops.push(0);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('tint', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('top', new THREE.Float32BufferAttribute(tops, 1));
  return out;
}

export function rangeUniforms(hazeK: number): RangeUniforms {
  return {
    uLift: { value: 0 },
    uRot: { value: 0 },
    uHaze: { value: new THREE.Color() },
    uHazeK: { value: hazeK },
    uToLight: { value: new THREE.Vector3(0, 1, 0) },
    uLight: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.7, 0.8, 1) },
    uCloud: { value: new THREE.Color() },
    uCloudEl: { value: -0.2 },
    uInk: { value: new THREE.Color(0x1a2036) },
  };
}

export function makeFarMesh(
  geo: THREE.BufferGeometry,
  uniforms: RangeUniforms,
  renderOrder: number,
  name: string,
  side: THREE.Side = THREE.DoubleSide,
): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side,
  });
  mat.name = name;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
  };
  return mesh;
}
