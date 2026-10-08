// ── Time-of-day presets: Afternoon / Golden / Blue hour / Night ─────────
//
// Drives the existing Graphics rig (sun, hemi, Sky shader, fog, PMREM env,
// exposure, bloom) plus a few night-only extras (star dome, moon disc,
// emissive lamps/windows, additive lamp light pools). Transitions are
// time-based (≈2 s) and self-driven via requestAnimationFrame, so calling
// `applyTimeOfDay()` is all the integration needed.

import type { GroundQuery } from './shared';
import type { LevelData } from '../world/Level';

import * as THREE from 'three';

import { groundAt } from './shared';
import { softSpotTexture } from './textures';

export type TimeOfDayPreset = 'afternoon' | 'golden' | 'blue' | 'night';

/** Minimal slice of render/Graphics this module touches. */
export interface TodHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** three's Sky backdrop — hidden and replaced by the stylised dome. */
  sky: THREE.Object3D;
}

interface PresetDef {
  /** Elevation (deg) of the sun disc on the sky dome (can be < 0). */
  skySun: number;
  /** Elevation (deg) of the directional light (moon / skylight when the sun is down). */
  light: number;
  /** Azimuth offset (deg) applied to the directional light vs the sky sun. */
  lightAz: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  zenith: number;
  mid: number;
  horizon: number;
  ground: number;
  cloud: number;
  cloudShade: number;
  cloudCover: number;
  fog: number;
  fogMul: number;
  envIntensity: number;
  exposure: number;
  bloomThreshold: number;
  bloomIntensity: number;
  lamps: number;
  stars: number;
  shadowStrength: number;
}

/** Jet-Set-Radio-ish palettes: hot cyan/yellow day, magenta/orange sunset, violet neon night. */
export const TIME_OF_DAY_PRESETS: Record<TimeOfDayPreset, PresetDef> = {
  afternoon: {
    skySun: 55,
    light: 52,
    lightAz: 0,
    sunColor: 0xfff1c4,
    sunIntensity: 3.0,
    hemiSky: 0x9fe6ff,
    hemiGround: 0xffc27a,
    hemiIntensity: 1.15,
    zenith: 0x0078ff,
    mid: 0x22ccff,
    horizon: 0xfff27a,
    ground: 0x9a7a52,
    cloud: 0xffffff,
    cloudShade: 0xa9d4ff,
    cloudCover: 0.56,
    fog: 0xc8f2ff,
    fogMul: 0.9,
    envIntensity: 1,
    exposure: 1,
    bloomThreshold: 0.92,
    bloomIntensity: 0.5,
    lamps: 0,
    stars: 0,
    shadowStrength: 1,
  },
  golden: {
    skySun: 5,
    light: 11,
    lightAz: 0,
    sunColor: 0xff8f3a,
    sunIntensity: 3.0,
    hemiSky: 0xff7fbf,
    hemiGround: 0x5a2a6a,
    hemiIntensity: 1.0,
    zenith: 0x3b1d8f,
    mid: 0xff2f8a,
    horizon: 0xffa31f,
    ground: 0x4a2440,
    cloud: 0xffc48a,
    cloudShade: 0xc23a8c,
    cloudCover: 0.6,
    fog: 0xff7d86,
    fogMul: 1.25,
    envIntensity: 0.9,
    exposure: 1.05,
    bloomThreshold: 0.85,
    bloomIntensity: 0.75,
    lamps: 0.2,
    stars: 0,
    shadowStrength: 1,
  },
  blue: {
    skySun: -4,
    light: 38,
    lightAz: 160,
    sunColor: 0x7d8cff,
    sunIntensity: 0.7,
    hemiSky: 0x6f74ff,
    hemiGround: 0x26124c,
    hemiIntensity: 1.0,
    zenith: 0x08135e,
    mid: 0x2d38c4,
    horizon: 0xa06cff,
    ground: 0x1c1036,
    cloud: 0x6c66dc,
    cloudShade: 0x2c2580,
    cloudCover: 0.62,
    fog: 0x4c3aa0,
    fogMul: 1.2,
    envIntensity: 0.8,
    exposure: 1.2,
    bloomThreshold: 0.7,
    bloomIntensity: 0.95,
    lamps: 0.8,
    stars: 0.3,
    shadowStrength: 0.65,
  },
  night: {
    skySun: -20,
    light: 42,
    lightAz: 200,
    sunColor: 0x7078ff,
    sunIntensity: 0.45,
    hemiSky: 0x3c2ca8,
    hemiGround: 0x120826,
    hemiIntensity: 0.85,
    zenith: 0x02031a,
    mid: 0x140a40,
    horizon: 0x44146e,
    ground: 0x0c0618,
    cloud: 0x2a1d5c,
    cloudShade: 0x130c30,
    cloudCover: 0.64,
    fog: 0x1c0f40,
    fogMul: 1.5,
    envIntensity: 0.7,
    exposure: 1.3,
    bloomThreshold: 0.55,
    bloomIntensity: 1.15,
    lamps: 1,
    stars: 1,
    shadowStrength: 0.75,
  },
};

interface State {
  skyDir: THREE.Vector3;
  lightDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  cloud: THREE.Color;
  cloudShade: THREE.Color;
  cloudCover: number;
  fog: THREE.Color;
  fogDensity: number;
  envIntensity: number;
  exposure: number;
  bloomThreshold: number;
  bloomIntensity: number;
  lamps: number;
  stars: number;
  shadowStrength: number;
}

const COLOR_KEYS = [
  'sunColor',
  'hemiSky',
  'hemiGround',
  'zenith',
  'mid',
  'horizon',
  'ground',
  'cloud',
  'cloudShade',
  'fog',
] as const;
const NUM_KEYS = [
  'sunIntensity',
  'hemiIntensity',
  'cloudCover',
  'fogDensity',
  'envIntensity',
  'exposure',
  'bloomThreshold',
  'bloomIntensity',
  'lamps',
  'stars',
  'shadowStrength',
] as const;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}
`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunVis;
uniform vec3 uCloud;
uniform vec3 uCloudShade;
uniform float uCloudCover;
uniform float uTime;
varying vec3 vDir;
float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vn( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), f.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float fbm( vec2 p ) { float s = 0.0; float a = 0.5; for ( int i = 0; i < 4; i ++ ) { s += a * vn( p ); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  vec3 col;
  if ( h >= 0.0 ) {
    col = h < 0.22 ? mix( uHorizon, uMid, smoothstep( 0.0, 0.22, h ) ) : mix( uMid, uZenith, smoothstep( 0.22, 0.8, h ) );
  } else {
    col = mix( uHorizon, uGround, smoothstep( 0.0, -0.12, h ) );
  }
  // Sun: hard disc + one flat halo ring (graphic, not physical)
  float sd = dot( d, uSunDir );
  float fw = fwidth( sd ) + 1e-5;
  float disc = smoothstep( 0.9993 - fw, 0.9993 + fw, sd );
  float ring = smoothstep( 0.985 - fw, 0.985 + fw, sd ) * 0.35 + smoothstep( 0.94 - fw, 0.94 + fw, sd ) * 0.15;
  col = mix( col, col + uSunColor * 0.6, ring * uSunVis );
  // Toon clouds on a virtual plane: flat fill + a shaded underside band
  if ( h > 0.0 ) {
    vec2 uv = d.xz / ( h + 0.12 ) * 0.9 + vec2( uTime * 0.004, uTime * 0.002 );
    float n = fbm( uv );
    float n2 = fbm( uv + uSunDir.xz * 0.12 );
    float cfw = fwidth( n ) + 1e-4;
    float cl = smoothstep( uCloudCover - cfw, uCloudCover + cfw, n ) * smoothstep( 0.02, 0.12, h );
    float shade = smoothstep( uCloudCover + 0.05 - cfw, uCloudCover + 0.05 + cfw, n2 );
    vec3 cc = mix( uCloudShade, uCloud, shade );
    col = mix( col, cc, cl );
    disc *= 1.0 - cl;
  }
  col = mix( col, uSunColor * 4.0, disc * uSunVis );
  gl_FragColor = vec4( col, 1.0 );
}
`;

function dirFrom(elevDeg: number, azRad: number): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(elevDeg);
  // direction the light TRAVELS (from sky to ground)
  return new THREE.Vector3(
    -Math.cos(e) * Math.cos(azRad),
    -Math.sin(e),
    -Math.cos(e) * Math.sin(azRad),
  ).normalize();
}

/** Night window palette: neon signage colours (cycled per material). */
const NEON = [0x22f0ff, 0xff2fd6, 0xffd21f, 0xff8a2a, 0x7cff4a, 0x6a5cff];

type EmissiveMat = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number };

interface EmissiveRecord {
  mat: EmissiveMat;
  emissive: THREE.Color;
  intensity: number;
  kind: 'lamp' | 'window';
  nightColor: THREE.Color;
  nightIntensity: number;
}

interface BloomLike {
  intensity: number;
  luminanceMaterial: { threshold: number };
}

export class TimeOfDay {
  readonly host: TodHost;
  preset: TimeOfDayPreset = 'afternoon';
  private azimuth: number;
  private baseFogDensity = 0.0016;
  private from: State;
  private to: State;
  private cur: State;
  private t0 = 0;
  private duration = 2;
  private raf = 0;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envStep = -1;
  private emissives: EmissiveRecord[] = [];
  private pools: THREE.Mesh[] = [];
  private poolMat: THREE.MeshBasicMaterial;
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  /** Stylised gradient + toon-cloud sky that replaces three's Sky. */
  readonly skyDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private ground: GroundQuery | null;
  private scanned = new WeakSet<THREE.Object3D>();

  constructor(host: TodHost, opts: { level?: LevelData; ground?: GroundQuery | null } = {}) {
    this.host = host;
    this.ground = opts.ground ?? null;
    const d =
      opts.level?.sun.direction ?? host.sun.position.clone().sub(host.sun.target.position).negate();
    this.azimuth = Math.atan2(-d.z, -d.x);
    if (opts.level !== undefined) this.baseFogDensity = opts.level.fog.density;
    else if (host.scene.fog instanceof THREE.FogExp2) this.baseFogDensity = host.scene.fog.density;
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new THREE.Color() },
          uMid: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uGround: { value: new THREE.Color() },
          uCloud: { value: new THREE.Color() },
          uCloudShade: { value: new THREE.Color() },
          uCloudCover: { value: 0.6 },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color() },
          uSunVis: { value: 1 },
          uTime: { value: 0 },
        },
      }),
    );
    this.skyDome.name = 'tod-sky';
    this.skyDome.frustumCulled = false;
    this.skyDome.renderOrder = -10;
    host.scene.add(this.skyDome);
    this.cur = this.stateFor('afternoon', opts.level);
    this.from = this.cloneState(this.cur);
    this.to = this.cloneState(this.cur);
    this.poolMat = new THREE.MeshBasicMaterial({
      map: softSpotTexture(),
      color: new THREE.Color(1.0, 0.72, 0.4),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.poolMat.polygonOffset = true;
    this.poolMat.polygonOffsetFactor = -2;
    // Stars
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let s = 12345;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const z = 0.05 + rnd() * 0.95;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos[i * 3] = Math.cos(a) * r * 1100;
      pos[i * 3 + 1] = z * 1100;
      pos[i * 3 + 2] = Math.sin(a) * r * 1100;
      const b = 0.4 + Math.pow(rnd(), 3) * 2.2;
      const warm = rnd();
      col[i * 3] = b * (0.85 + warm * 0.15);
      col[i * 3 + 1] = b * 0.9;
      col[i * 3 + 2] = b * (1 - warm * 0.15);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        size: 1.6,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    this.stars.visible = false;
    this.stars.name = 'tod-stars';
    host.scene.add(this.stars);
    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(16, 32),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.2, 2.15, 2.0),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.moon.visible = false;
    this.moon.frustumCulled = false;
    this.moon.name = 'tod-moon';
    host.scene.add(this.moon);
    if (opts.level !== undefined) this.scanEmissives(opts.level.root);
  }

  private stateFor(p: TimeOfDayPreset, level?: LevelData): State {
    const d = TIME_OF_DAY_PRESETS[p];
    // Afternoon keeps the level's authored sun direction; palettes are stylised.
    const afternoonFromLevel = p === 'afternoon' && level !== undefined;
    const lightDir = afternoonFromLevel
      ? level.sun.direction.clone().normalize()
      : dirFrom(d.light, this.azimuth + THREE.MathUtils.degToRad(d.lightAz));
    const C = (x: number) => new THREE.Color(x);
    return {
      skyDir: afternoonFromLevel ? lightDir.clone() : dirFrom(d.skySun, this.azimuth),
      lightDir,
      sunColor: C(d.sunColor),
      sunIntensity: d.sunIntensity,
      hemiSky: C(d.hemiSky),
      hemiGround: C(d.hemiGround),
      hemiIntensity: level?.baked === true ? d.hemiIntensity * 0.4 : d.hemiIntensity,
      zenith: C(d.zenith),
      mid: C(d.mid),
      horizon: C(d.horizon),
      ground: C(d.ground),
      cloud: C(d.cloud),
      cloudShade: C(d.cloudShade),
      cloudCover: d.cloudCover,
      fog: C(d.fog),
      fogDensity: this.baseFogDensity * d.fogMul,
      envIntensity: d.envIntensity * (level?.baked === true ? 0.6 : 1),
      exposure: d.exposure,
      bloomThreshold: d.bloomThreshold,
      bloomIntensity: d.bloomIntensity,
      lamps: d.lamps,
      stars: d.stars,
      shadowStrength: d.shadowStrength,
    };
  }

  private cloneState(s: State): State {
    const out = { ...s, skyDir: s.skyDir.clone(), lightDir: s.lightDir.clone() };
    for (const k of COLOR_KEYS) out[k] = s[k].clone();
    return out;
  }

  /**
   * Find emissive materials (lamp heads, windows) under `root` and remember
   * their daytime values so night can boost them. Warm emissives are lamps
   * (get a ground light pool), cool/dark emissives are windows.
   */
  scanEmissives(root: THREE.Object3D) {
    if (this.scanned.has(root)) return;
    this.scanned.add(root);
    const seen = new Set<THREE.Material>();
    root.updateMatrixWorld(true);
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        // Any lit material with an emissive colour (standard, toon, lambert, phong…)
        const sm = m as unknown as EmissiveMat;
        if (!(sm.emissive instanceof THREE.Color)) continue;
        const lum = sm.emissive.r + sm.emissive.g + sm.emissive.b;
        if (lum <= 0.001 && mesh.userData.nightGlow === undefined) continue;
        const warm = sm.emissive.r > sm.emissive.b * 1.2 || mesh.userData.lamp === true;
        if (warm && (mesh.userData.lamp === true || lum > 0.5)) {
          const p = new THREE.Vector3();
          mesh.getWorldPosition(p);
          this.registerLamp(p, sm.emissive.clone(), mesh.userData.lampHeight as number | undefined);
        }
        if (seen.has(sm)) continue;
        seen.add(sm);
        this.emissives.push({
          mat: sm,
          emissive: sm.emissive.clone(),
          intensity: sm.emissiveIntensity,
          kind: warm ? 'lamp' : 'window',
          nightColor: warm
            ? new THREE.Color(1.0, 0.8, 0.5)
            : new THREE.Color(NEON[this.emissives.length % NEON.length]),
          nightIntensity: warm ? 6 : 1.4,
        });
      }
    });
  }

  /** Add a warm light pool on the ground under a lamp at `pos`. */
  registerLamp(pos: THREE.Vector3, color = new THREE.Color(1, 0.75, 0.45), height?: number) {
    const g = groundAt(this.ground, pos.x, pos.z, pos.y - (height ?? 5), pos.y - 0.3);
    const r = Math.max(3, (pos.y - g.y) * 0.9);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), this.poolMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, g.y + 0.03, pos.z);
    m.visible = false;
    m.renderOrder = 2;
    m.name = 'tod-lamp-pool';
    m.userData.color = color;
    this.host.scene.add(m);
    this.pools.push(m);
  }

  set(preset: TimeOfDayPreset, opts: { duration?: number; level?: LevelData } = {}) {
    this.preset = preset;
    if (opts.level !== undefined) this.scanEmissives(opts.level.root);
    this.from = this.cloneState(this.cur);
    this.to = this.stateFor(preset, opts.level);
    this.duration = opts.duration ?? 2;
    this.t0 = performance.now();
    this.envStep = -1;
    if (this.duration <= 0) {
      this.tick(true);
      return;
    }
    cancelAnimationFrame(this.raf);
    const loop = () => {
      const done = this.tick(false);
      if (!done) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Advance the transition; returns true when finished. Safe to call every frame. */
  tick(force = false): boolean {
    const raw =
      this.duration <= 0 || force ? 1 : (performance.now() - this.t0) / (this.duration * 1000);
    const t = Math.min(1, Math.max(0, raw));
    const k = t * t * (3 - 2 * t);
    const a = this.from;
    const b = this.to;
    const c = this.cur;
    const L = THREE.MathUtils.lerp;
    c.skyDir.copy(a.skyDir).lerp(b.skyDir, k).normalize();
    c.lightDir.copy(a.lightDir).lerp(b.lightDir, k).normalize();
    for (const key of COLOR_KEYS) c[key].copy(a[key]).lerp(b[key], k);
    for (const key of NUM_KEYS) c[key] = L(a[key], b[key], k);
    this.applyState();
    const step = t >= 1 ? 4 : Math.floor(t * 4);
    if (step !== this.envStep) {
      this.envStep = step;
      this.buildEnvironment();
    }
    return t >= 1;
  }

  private applyState() {
    const h = this.host;
    const c = this.cur;
    // Graphics keeps the shadow-follow direction in a private field.
    const gfxPriv = h as unknown as { sunDir?: THREE.Vector3; bloom?: BloomLike };
    if (gfxPriv.sunDir instanceof THREE.Vector3) gfxPriv.sunDir.copy(c.lightDir);
    // Re-aim the light now (followShadow will keep it centred on the player)
    const tgt = h.sun.target.position;
    h.sun.position.copy(tgt).addScaledVector(c.lightDir, -90);
    h.sun.color.copy(c.sunColor);
    h.sun.intensity = c.sunIntensity;
    h.sun.shadow.intensity = c.shadowStrength;
    h.hemi.color.copy(c.hemiSky);
    h.hemi.groundColor.copy(c.hemiGround);
    h.hemi.intensity = c.hemiIntensity;
    h.sky.visible = false;
    const u = this.skyDome.material.uniforms;
    (u.uZenith.value as THREE.Color).copy(c.zenith);
    (u.uMid.value as THREE.Color).copy(c.mid);
    (u.uHorizon.value as THREE.Color).copy(c.horizon);
    (u.uGround.value as THREE.Color).copy(c.ground);
    (u.uCloud.value as THREE.Color).copy(c.cloud);
    (u.uCloudShade.value as THREE.Color).copy(c.cloudShade);
    u.uCloudCover.value = c.cloudCover;
    (u.uSunDir.value as THREE.Vector3).copy(c.skyDir).negate();
    (u.uSunColor.value as THREE.Color).copy(c.sunColor);
    u.uSunVis.value = THREE.MathUtils.smoothstep(-c.skyDir.y, -0.08, 0.02);
    if (h.scene.fog instanceof THREE.FogExp2) {
      h.scene.fog.color.copy(c.fog);
      h.scene.fog.density = c.fogDensity;
    } else if (h.scene.fog === null) {
      h.scene.fog = new THREE.FogExp2(c.fog, c.fogDensity);
    }
    h.scene.environmentIntensity = c.envIntensity;
    h.renderer.toneMappingExposure = c.exposure;
    const bloom = gfxPriv.bloom;
    if (bloom !== undefined) {
      bloom.intensity = c.bloomIntensity;
      bloom.luminanceMaterial.threshold = c.bloomThreshold;
    }
    for (const e of this.emissives) {
      e.mat.emissive.copy(e.emissive).lerp(e.nightColor, Math.min(1, c.lamps * 1.5));
      e.mat.emissiveIntensity = THREE.MathUtils.lerp(e.intensity, e.nightIntensity, c.lamps);
    }
    this.poolMat.opacity = c.lamps * 0.85;
    for (const p of this.pools) p.visible = c.lamps > 0.02;
    const sm = this.stars.material as THREE.PointsMaterial;
    sm.opacity = c.stars;
    this.stars.visible = c.stars > 0.01;
    const mm = this.moon.material as THREE.MeshBasicMaterial;
    mm.opacity = c.stars;
    this.moon.visible = c.stars > 0.01;
  }

  /** Keep sky decorations centred on the camera (call per frame; cheap). */
  update() {
    const cam = this.host.camera;
    this.skyDome.position.copy(cam.position);
    this.skyDome.material.uniforms.uTime.value = performance.now() / 1000;
    if (this.stars.visible) this.stars.position.copy(cam.position);
    if (this.moon.visible) {
      this.moon.position.copy(cam.position).addScaledVector(this.cur.lightDir, -1000);
      this.moon.lookAt(cam.position);
    }
  }

  /** NaN-safe gradient env (same approach as Graphics.buildEnvironment). */
  private buildEnvironment() {
    const c = this.cur;
    const pmrem = new THREE.PMREMGenerator(this.host.renderer);
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 48, 24);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 50;
      if (y >= 0.22) col.copy(c.mid).lerp(c.zenith, Math.min(1, (y - 0.22) / 0.6));
      else if (y >= 0) col.copy(c.horizon).lerp(c.mid, y / 0.22);
      else col.copy(c.horizon).lerp(c.ground, Math.min(1, -y * 4));
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }),
    );
    envScene.add(dome);
    const disc = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 16, 8),
      new THREE.MeshBasicMaterial({
        color: c.sunColor.clone().multiplyScalar(Math.min(30, c.sunIntensity * 9)),
      }),
    );
    disc.position.copy(c.lightDir).multiplyScalar(-45);
    envScene.add(disc);
    const rt = pmrem.fromScene(envScene, 0.03, 0.1, 200);
    this.envRT?.dispose();
    this.envRT = rt;
    this.host.scene.environment = rt.texture;
    pmrem.dispose();
    geo.dispose();
    (dome.material as THREE.Material).dispose();
    disc.geometry.dispose();
    (disc.material as THREE.Material).dispose();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.envRT?.dispose();
    this.host.scene.remove(this.stars, this.moon, ...this.pools);
    this.stars.geometry.dispose();
    this.moon.geometry.dispose();
  }
}

const controllers = new WeakMap<object, TimeOfDay>();

/**
 * Switch the scene to a time-of-day preset with a smooth (~2 s) transition.
 * The first call creates a TimeOfDay controller bound to `gfx` (also scans
 * `level.root` for lamps/windows). Pass `{ duration: 0 }` for an instant cut.
 */
export function applyTimeOfDay(
  gfx: TodHost,
  preset: TimeOfDayPreset,
  level?: LevelData,
  opts: { duration?: number; ground?: GroundQuery | null } = {},
): TimeOfDay {
  let tod = controllers.get(gfx);
  if (tod === undefined) {
    tod = new TimeOfDay(gfx, { level, ground: opts.ground });
    controllers.set(gfx, tod);
  }
  tod.set(preset, { duration: opts.duration, level });
  return tod;
}

/** The controller previously created by applyTimeOfDay (if any). */
export function getTimeOfDay(gfx: TodHost): TimeOfDay | undefined {
  return controllers.get(gfx);
}
