// ── The Big Drop's sky dome: gradient, big low sun, cloud sea below ──────
//
// Drawn first, at infinity (xyww), round the camera. Above the horizon: a
// deep high-altitude gradient, a warm band on the sun's side, the sun's disc,
// glow, a 22° halo with sun dogs, thin cirrus, and later on stars and aurora
// curtains. Below the horizon (a big part of the frame looking down a 49°
// slope): a toon cloud sea on a plane far below the rider that slides past
// as you ride (parallax), with darker gaps, fading into the fog colour at
// the horizon so the terrain's fogged far edge melts into it.
//
// A second copy in 'front' mode draws only the cloud sea, a little nearer
// and with its own offset, after the distant ranges: their feet sink into it.

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Just inside the far plane: the front cloud layer depth-tests against
  // the scene (it's drawn after it), everything else ignores depth
  gl_Position = vec4(p.xy, p.w * 0.9999995, p.w);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uBand;
uniform float uBandK;
uniform vec3 uToSun;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uStorm;
uniform float uAurora;
uniform float uStars;
uniform float uTime;
uniform vec2 uCloudOff;
uniform float uCloudDepth;
uniform float uCover;
varying vec3 vDir;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < OCTAVES; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

// The cloud sea: x = coverage (0..1, toon edged), y = sunlit (0..1), z = how
// far it is (0 near .. 1 at the horizon)
vec3 cloudSea(vec3 d, float depthM, vec2 off) {
  float dn = max(-d.y, 1e-3);
  vec2 p = (d.xz / dn * depthM + off) / 2600.0;
  p += vec2(uTime * 0.004, uTime * 0.0017);
  float n = fbm(p);
  float fw = fwidth(n) + 1e-4;
  float cov = smoothstep(uCover - fw, uCover + fw, n);
  // Sunlit side: the noise climbs toward the sun
  float n2 = fbm(p - uToSun.xz * 0.11);
  float lit = smoothstep(-0.02 - fw, -0.02 + fw, n - n2);
  float dist = depthM / dn;
  // Haze toward the horizon (distance) and toward the steep (the fogged far
  // edge of the slope sits there: it melts into haze, not into cloud)
  float far = 1.0 - exp(-dist / 110000.0);
  float steep = smoothstep(0.45, 0.8, dn);
  return vec3(cov, lit, max(far, steep));
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
#ifdef FRONT
  // Cloud sea only, in front of the distant ranges
  if (h > -0.004) discard;
  vec3 cs = cloudSea(d, uCloudDepth, uCloudOff);
  vec3 cc = mix(uCloudShade, uCloudLit, cs.y);
  float a = cs.x * (1.0 - smoothstep(0.55, 0.95, cs.z)) * (1.0 - uStorm);
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(cc, uHaze, smoothstep(0.2, 0.9, cs.z)), a);
#else
  vec3 sd = uToSun;
  float cosS = dot(d, sd);
  // Above: horizon → mid → zenith
  float up = max(h, 0.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.28, up));
  col = mix(col, uZenith, smoothstep(0.22, 0.95, up));
  // The warm band, strongest toward the sun
  vec2 dh = normalize(d.xz + vec2(1e-5));
  vec2 sh = normalize(sd.xz + vec2(1e-5));
  float az = dot(dh, sh) * 0.5 + 0.5;
  float band = uBandK * exp(-abs(h) * 11.0) * (0.3 + 0.7 * az * az);
  col = mix(col, uBand, clamp(band, 0.0, 1.0) * 0.85);
  // Cirrus streaks (day only)
  if (h > 0.0) {
    vec2 q = d.xz / (h + 0.08);
    float c = fbm(vec2(q.x * 0.45 + uTime * 0.002, q.y * 2.2) + 3.0);
    float ci = smoothstep(0.62, 0.76, c) * smoothstep(0.02, 0.2, h) * (1.0 - uStars);
    col = mix(col, mix(uCloudLit, uBand, 0.25 * uBandK), ci * 0.32);
  }
  // Stars
  if (uStars > 0.001 && h > 0.0) {
    vec2 sp = d.xz / (h + 1.0) * 160.0;
    vec2 cell = floor(sp);
    float r = h21(cell);
    vec2 at = cell + vec2(h21(cell + 7.3), h21(cell + 1.9));
    float star = step(0.93, r) * (1.0 - smoothstep(0.0, 0.09 + 0.07 * fract(r * 13.0), length(sp - at)));
    star *= 0.6 + 0.4 * sin(uTime * (2.0 + 3.0 * r) + r * 40.0);
    col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.0, 0.15, h) * 1.6;
  }
  // Aurora curtains
  if (uAurora > 0.001 && h > 0.0) {
    float a = atan(d.x, d.z);
    float t = uTime;
    float wave = sin(a * 3.0 + t * 0.07 + 2.0 * vn(vec2(a * 2.0 + t * 0.05, 1.0)));
    float e0 = 0.16 + 0.07 * wave;
    float v = h - e0;
    float curtain = smoothstep(-0.015, 0.01, v) * exp(-max(v, 0.0) * 5.5);
    float rays = 0.55 + 0.45 * vn(vec2(a * 70.0 + t * 0.4, t * 0.15));
    float side = smoothstep(-0.2, 0.6, sin(a * 1.3 + 0.8));
    vec3 ac = mix(vec3(0.15, 1.0, 0.55), vec3(0.85, 0.25, 0.95), smoothstep(0.0, 0.22, v));
    col += ac * curtain * rays * side * uAurora * 0.9;
  }
  // Below: haze, then the cloud sea
  float below = 1.0 - smoothstep(-0.035, 0.012, h);
  vec3 low = uHaze;
  if (h < 0.012) {
    vec3 cs = cloudSea(d, uCloudDepth, uCloudOff);
    vec3 gap = mix(mix(uCloudShade, uZenith, 0.3), uHaze, 0.35);
    vec3 cc = mix(gap, mix(uCloudShade, uCloudLit, cs.y), cs.x);
    low = mix(cc, uHaze, smoothstep(0.15, 0.85, cs.z));
  }
  col = mix(col, low, below);
  // The sun: glow, a big disc, the 22° halo and sun dogs
  float above = smoothstep(-0.012, 0.004, h);
  float glow = pow(max(cosS, 0.0), 6.0) * 0.28 + pow(max(cosS, 0.0), 90.0) * 0.55;
  // Above the horizon only: below it the sky must match the fog exactly
  // (the terrain's far clip shows sky there)
  col += uSunColor * glow * (1.0 - 0.55 * uStorm) * above;
  float fw = fwidth(cosS) + 1e-5;
  float disc = smoothstep(0.99955 - fw, 0.99955 + fw, cosS) * above;
  float ang = acos(clamp(cosS, -1.0, 1.0));
  float clear = (1.0 - uStorm) * (1.0 - uStars) * smoothstep(-0.05, 0.05, sd.y);
  float halo = exp(-pow((ang - 0.384) / 0.014, 2.0)) * 0.14;
  float azd = acos(clamp(dot(dh, sh), -1.0, 1.0));
  float ed = asin(clamp(h, -1.0, 1.0)) - asin(clamp(sd.y, -1.0, 1.0));
  float dogs = exp(-pow((azd - 0.41) / 0.016, 2.0) - pow(ed / 0.03, 2.0)) * 0.6;
  col += (uSunColor * halo + mix(vec3(1.0, 0.55, 0.4), vec3(0.7, 0.85, 1.0), smoothstep(0.39, 0.43, azd)) * dogs) * clear * above;
  col = mix(col, uSunColor * 2.6 + 0.4, disc * (1.0 - 0.7 * uStorm));
  // The summit storm whites it all out
  col = mix(col, uHaze, uStorm * 0.85);
  gl_FragColor = vec4(col, 1.0);
#endif
  #include <colorspace_fragment>
}
`;

export interface SkyUniforms {
  [k: string]: THREE.IUniform;
  uZenith: { value: THREE.Color };
  uMid: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uHaze: { value: THREE.Color };
  uBand: { value: THREE.Color };
  uBandK: { value: number };
  uToSun: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uCloudLit: { value: THREE.Color };
  uCloudShade: { value: THREE.Color };
  uStorm: { value: number };
  uAurora: { value: number };
  uStars: { value: number };
  uTime: { value: number };
  uCloudOff: { value: THREE.Vector2 };
  uCloudDepth: { value: number };
  uCover: { value: number };
}

export function skyUniforms(): SkyUniforms {
  return {
    uZenith: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uBand: { value: new THREE.Color() },
    uBandK: { value: 0 },
    uToSun: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uStorm: { value: 0 },
    uAurora: { value: 0 },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uCloudOff: { value: new THREE.Vector2() },
    uCloudDepth: { value: 9000 },
    uCover: { value: 0.52 },
  };
}

/**
 * A dome that sits on the camera and draws at infinity. `front` = the
 * see-through cloud-sea layer (drawn after the ranges).
 */
export function makeSkyDome(
  uniforms: SkyUniforms,
  opts: { front: boolean; octaves: number; renderOrder: number },
): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    defines: opts.front ? { OCTAVES: opts.octaves, FRONT: 1 } : { OCTAVES: opts.octaves },
    side: THREE.BackSide,
    depthWrite: false,
    // The front layer draws with the transparent pass, after the terrain:
    // it only shows where nothing nearer was drawn
    depthTest: opts.front,
    fog: false,
    transparent: opts.front,
  });
  mat.name = opts.front ? 'BigDropCloudFront' : 'BigDropSky';
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), mat);
  mesh.name = mat.name;
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.renderOrder;
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
  };
  return mesh;
}
