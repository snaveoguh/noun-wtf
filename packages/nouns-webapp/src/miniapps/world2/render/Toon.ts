// ── Jet Set Radio look: cel-shaded materials + screen-space ink outlines ──

import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

let ramp: THREE.DataTexture | null = null;

/**
 * Objects the ink pass must ignore (additive glows, light pools, particles):
 * they're invisible-edged planes, so their normals would draw black boxes.
 */
export const inkExcluded = new Set<THREE.Object3D>();

/** Shared 3-band toon ramp (shadow / mid / lit). */
export function getToonRamp(): THREE.DataTexture {
  if (ramp !== null) return ramp;
  // JSR shadows stay colourful: lift the dark band well off black
  const tones = [120, 190, 255];
  const data = new Uint8Array(tones.length * 4);
  tones.forEach((t, i) => data.set([t, t, t, 255], i * 4));
  ramp = new THREE.DataTexture(data, tones.length, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

type LitMaterial =
  | THREE.MeshStandardMaterial
  | THREE.MeshPhysicalMaterial
  | THREE.MeshLambertMaterial
  | THREE.MeshPhongMaterial;

function isLit(m: THREE.Material): m is LitMaterial {
  const t = m.type;
  return (
    t === 'MeshStandardMaterial' ||
    t === 'MeshPhysicalMaterial' ||
    t === 'MeshLambertMaterial' ||
    t === 'MeshPhongMaterial'
  );
}

const converted = new WeakMap<THREE.Material, THREE.MeshToonMaterial>();

export function toToon(src: THREE.Material): THREE.Material {
  if (!isLit(src) || src.userData.noToon === true) return src;
  const hit = converted.get(src);
  if (hit !== undefined) return hit;
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshToonMaterial({
    name: s.name,
    color: s.color.clone(),
    map: s.map,
    gradientMap: getToonRamp(),
    emissive: s.emissive.clone(),
    emissiveMap: s.emissiveMap,
    emissiveIntensity: s.emissiveIntensity,
    lightMap: s.lightMap,
    lightMapIntensity: s.lightMapIntensity,
    aoMap: s.aoMap,
    aoMapIntensity: s.aoMapIntensity,
    normalMap: s.normalMap,
    alphaMap: s.alphaMap,
    transparent: s.transparent,
    opacity: s.opacity,
    alphaTest: s.alphaTest,
    side: s.side,
    vertexColors: s.vertexColors,
    depthWrite: s.depthWrite,
    polygonOffset: s.polygonOffset,
    polygonOffsetFactor: s.polygonOffsetFactor,
    polygonOffsetUnits: s.polygonOffsetUnits,
  });
  m.userData = { ...s.userData, toonFrom: s.type, toonSrc: s };
  converted.set(src, m);
  return m;
}

/** Convert every lit material under `root` to the shared toon ramp. */
export function toonify(root: THREE.Object3D) {
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.material === undefined) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(toToon);
    else mesh.material = toToon(mesh.material);
  });
}

// ── Ink outlines ─────────────────────────────────────────────────────────
//
// Edges from (a) the Laplacian of inverse view depth — zero on any plane,
// so floors at grazing angles stay clean while silhouettes pop — and
// (b) normal discontinuities when a normal buffer is supplied.

const fragment = /* glsl */ `
uniform sampler2D normalBuffer;
uniform vec3 lineColor;
uniform float thickness;
uniform float depthThreshold;
uniform float normalThreshold;
uniform float useNormals;
uniform float fadeStart;
uniform float fadeEnd;

float invZ(const in vec2 uv) {
  return 1.0 / max(1e-4, -getViewZ(readDepth(uv)));
}

vec3 nrm(const in vec2 uv) {
  return normalize(texture2D(normalBuffer, uv).xyz * 2.0 - 1.0);
}

float edgeAt(const in vec2 uv, const in vec2 t) {
  float zc = -getViewZ(readDepth(uv));
  float wc = 1.0 / max(1e-4, zc);
  float w1 = invZ(uv + vec2(t.x, 0.0));
  float w2 = invZ(uv - vec2(t.x, 0.0));
  float w3 = invZ(uv + vec2(0.0, t.y));
  float w4 = invZ(uv - vec2(0.0, t.y));
  float lap = abs(w1 + w2 + w3 + w4 - 4.0 * wc) / wc;
  float e = smoothstep(depthThreshold, depthThreshold * 1.8, lap);
  if (useNormals > 0.5) {
    vec3 nc = nrm(uv);
    float d = min(min(dot(nc, nrm(uv + vec2(t.x, 0.0))), dot(nc, nrm(uv - vec2(t.x, 0.0)))),
                  min(dot(nc, nrm(uv + vec2(0.0, t.y))), dot(nc, nrm(uv - vec2(0.0, t.y)))));
    // NB: smoothstep needs edge0 < edge1 (reversed edges are undefined in GLSL
    // and turn NaN/white on real GPUs) — invert instead.
    e = max(e, 1.0 - smoothstep(normalThreshold - 0.15, normalThreshold, d));
  }
  return e;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float zc = -getViewZ(depth);
  vec2 t = texelSize * thickness;
  // Dilate: an edge anywhere in a small cross makes this pixel ink, which
  // gives bold, even-width lines instead of 1px hairlines.
  float edge = edgeAt(uv, t);
  edge = max(edge, edgeAt(uv + vec2(t.x, 0.0) * 0.6, t));
  edge = max(edge, edgeAt(uv - vec2(t.x, 0.0) * 0.6, t));
  edge = max(edge, edgeAt(uv + vec2(0.0, t.y) * 0.6, t));
  edge = max(edge, edgeAt(uv - vec2(0.0, t.y) * 0.6, t));
  float fade = depth >= 0.9999 ? 0.0 : 1.0 - smoothstep(fadeStart, fadeEnd, zc);
  edge *= max(fade, 0.0);
  outputColor = vec4(mix(inputColor.rgb, lineColor, edge * 0.92), inputColor.a);
}
`;

export class InkOutlineEffect extends Effect {
  constructor(
    opts: {
      normalBuffer?: THREE.Texture | null;
      thickness?: number;
      color?: THREE.ColorRepresentation;
    } = {},
  ) {
    super('InkOutlineEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['normalBuffer', new THREE.Uniform(opts.normalBuffer ?? null)],
        ['lineColor', new THREE.Uniform(new THREE.Color(opts.color ?? 0x0a0812))],
        ['thickness', new THREE.Uniform(opts.thickness ?? 1.25)],
        ['depthThreshold', new THREE.Uniform(0.08)],
        ['normalThreshold', new THREE.Uniform(0.55)],
        [
          'useNormals',
          new THREE.Uniform(opts.normalBuffer !== null && opts.normalBuffer !== undefined ? 1 : 0),
        ],
        ['fadeStart', new THREE.Uniform(45)],
        ['fadeEnd', new THREE.Uniform(160)],
      ]),
    });
  }

  set thickness(v: number) {
    this.uniforms.get('thickness')!.value = v;
  }
}

/**
 * Clamp the graded colour to ≥ 0 before output. Contrast/saturation push
 * near-blacks slightly negative; the sRGB encode then takes pow() of a
 * negative, which is NaN on Apple GPUs (renders WHITE) while software GL
 * quietly returns 0. Must be the last effect in the grading pass.
 */
export class ClampEffect extends Effect {
  constructor(debug = false) {
    super(
      'ClampEffect',
      `uniform float debugNeg;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (debugNeg > 0.5 && !(min(c.r, min(c.g, c.b)) >= 0.0)) { outputColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
  // min/max lower to IEEE fmin/fmax on Metal, which return the non-NaN
  // operand even under fast-math (ternary NaN checks get optimised away)
  c = min(max(c, vec3(0.0)), vec3(64.0));
  outputColor = vec4(c, clamp(inputColor.a, 0.0, 1.0));
}`,
      {
        blendFunction: BlendFunction.SET,
        uniforms: new Map([['debugNeg', new THREE.Uniform(debug ? 1 : 0)]]),
      },
    );
  }
}
