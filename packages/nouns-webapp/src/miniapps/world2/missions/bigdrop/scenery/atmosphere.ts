// ── The Big Drop's atmosphere: sky, sun, fog, distant ranges, snow, wind ──
//
// One PeakSystem that owns everything about the air: the sky dome (with its
// cloud sea), the distant mountain rings and the giant Noun, the fog the
// terrain fades into, the sun and fill lights (their direction drives the
// shadows, so they always agree with the sun in the sky), snowfall round
// the camera and the wind. All of it follows journey.ts by depth. peak.ts
// saves the scene's fog, background, sky and light settings on the way in
// and puts them back on the way out; this restores the shadow direction.

import type { PeakCtx, PeakSystem } from '../contract';

import * as THREE from 'three';

import { inkExcluded } from '../../../render/Toon';

import { fogDensityAt, SkyState, skyAt, snowfallAt } from './journey';
import {
  LAYERS,
  liftAt,
  makeFarMesh,
  nounGeometry,
  rangeUniforms,
  ringGeometry,
  type RangeUniforms,
} from './ranges';
import { makeSkyDome, skyUniforms } from './skyDome';

const SNOW = { low: 500, medium: 900, high: 1200 } as const;
const SNOW_BOX = 70;
const OCTAVES = { low: 3, medium: 4, high: 5 } as const;
/** The front cloud layer's depth below the camera (m; the main one's is in skyDome.ts). */
const FRONT_DEPTH = 7000;
const DEG = Math.PI / 180;

/** Where the giant Noun stands (azimuth from +Z, deg), on the near ring's skyline. */
const NOUN_AZ = -24;

interface Ring {
  mesh: THREE.Mesh;
  u: RangeUniforms;
  layer: (typeof LAYERS)[number] | null;
}

export class Atmosphere implements PeakSystem {
  private readonly state = new SkyState();
  private readonly sky = skyUniforms();
  private readonly fog = new THREE.FogExp2(0xdfe6ee, 0.0035);
  private readonly bg = new THREE.Color();
  private readonly meshes: THREE.Object3D[] = [];
  private readonly rings: Ring[] = [];
  private snow: THREE.Points | null = null;
  private snowVel: Float32Array | null = null;
  private wind: {
    gain: GainNode;
    roar: GainNode;
    bp: BiquadFilterNode;
    nodes: AudioScheduledSourceNode[];
  } | null = null;
  private windT = 0;
  private time = 0;
  private readonly sunDir: THREE.Vector3 | null;
  private readonly savedSunDir = new THREE.Vector3();
  private readonly baseSun: number;
  private readonly baseHemi: number;
  private readonly lightCol = new THREE.Color();
  private readonly shadeCol = new THREE.Color();
  /** The front cloud layer's own offset (it drifts a little faster: nearer). */
  private readonly frontOff = new THREE.Vector2();

  constructor(private ctx: PeakCtx) {
    const gfx = ctx.game.gfx;
    const q = ctx.quality;
    // Graphics keeps the shadow direction private (TimeOfDay writes it the same way)
    const priv = gfx as unknown as { sunDir?: THREE.Vector3 };
    this.sunDir = priv.sunDir instanceof THREE.Vector3 ? priv.sunDir : null;
    if (this.sunDir !== null) this.savedSunDir.copy(this.sunDir);
    this.baseSun = gfx.sun.intensity;
    this.baseHemi = gfx.hemi.intensity;

    const dome = makeSkyDome(this.sky, { front: false, octaves: OCTAVES[q], renderOrder: -1000 });
    this.add(dome);
    // Rings far → near, then the Noun in front of the far ones
    LAYERS.forEach((layer, i) => {
      const u = rangeUniforms(layer.haze);
      const cols = q === 'low' ? Math.round(layer.columns * 0.6) : layer.columns;
      const mesh = makeFarMesh(ringGeometry(layer, cols), u, -990 + i * 2, `BigDropRange${i}`);
      this.rings.push({ mesh, u, layer });
      this.add(mesh);
    });
    {
      const near = LAYERS[LAYERS.length - 1]!;
      const u = rangeUniforms(0.12);
      const mesh = makeFarMesh(
        nounGeometry(NOUN_AZ * DEG, (near.base + near.amp * 0.55) * DEG),
        u,
        -987,
        'BigDropGiantNoun',
        THREE.FrontSide,
      );
      this.rings.push({ mesh, u, layer: null });
      this.add(mesh);
    }
    if (q !== 'low') {
      const u = this.sky;
      // The front layer shares the colours; its own depth and offset
      const front = makeSkyDome(
        {
          ...u,
          uCloudDepth: { value: FRONT_DEPTH },
          uCloudOff: { value: this.frontOff },
          uCover: { value: 0.6 },
        },
        { front: true, octaves: OCTAVES[q], renderOrder: -980 },
      );
      this.add(front);
    }
    this.makeSnow();
    this.startWind();
    this.apply();
  }

  private add(o: THREE.Object3D) {
    inkExcluded.add(o);
    this.meshes.push(o);
    this.ctx.group.add(o);
  }

  update(dt: number) {
    this.time += dt;
    this.apply();
    this.updateSnow(dt);
    this.updateWind(dt);
  }

  private apply() {
    const ctx = this.ctx;
    const gfx = ctx.game.gfx;
    const scene = gfx.scene;
    const depth = ctx.depth;
    const s = skyAt(depth, this.state);
    const u = this.sky;
    u.uZenith.value.copy(s.zenith);
    u.uMid.value.copy(s.mid);
    u.uHorizon.value.copy(s.horizon);
    u.uHaze.value.copy(s.haze);
    u.uBand.value.copy(s.band);
    u.uBandK.value = s.bandK;
    u.uToSun.value.copy(s.toSun);
    u.uSunColor.value.copy(s.sun);
    u.uCloudLit.value.copy(s.cloudLit);
    u.uCloudShade.value.copy(s.cloudShade);
    u.uStorm.value = s.storm;
    u.uAurora.value = s.aurora;
    u.uStars.value = s.stars;
    u.uTime.value = this.time;
    // The cloud sea is a plane far below: it slides past as you ride
    const rp = ctx.riderPeak;
    u.uCloudOff.value.set(rp.x, rp.z);
    this.frontOff.set(rp.x + 5200, rp.z * 1.25);
    // Fog: the far terrain edge melts into the haze below the horizon
    this.fog.color.copy(s.haze);
    this.fog.density = fogDensityAt(depth);
    this.bg.copy(s.haze);
    if (scene.fog !== this.fog) scene.fog = this.fog;
    if (scene.background !== this.bg) scene.background = this.bg;
    if (gfx.sky.visible) gfx.sky.visible = false;
    // Lights follow the sun in the sky (and so do the shadows)
    gfx.sun.color.copy(s.sun);
    gfx.sun.intensity = this.baseSun * s.sunK * (1 - 0.35 * s.storm);
    gfx.hemi.color.copy(s.hemiSky);
    gfx.hemi.groundColor.copy(s.hemiGround);
    gfx.hemi.intensity = this.baseHemi * s.hemiK;
    this.sunDir?.copy(s.lightDir);
    // Ranges: rise as you descend, drift round at their own rates
    const lift = liftAt(depth);
    this.lightCol.copy(s.sun).lerp(s.hemiSky, 0.25);
    this.shadeCol.copy(s.hemiSky).lerp(s.zenith, 0.35);
    for (const r of this.rings) {
      const L = r.layer ?? LAYERS[LAYERS.length - 1]!;
      r.u.uLift.value = L.lift * DEG * lift;
      r.u.uRot.value = depth * L.drift;
      r.u.uHaze.value.copy(s.haze);
      r.u.uHazeK.value = Math.min(1, (r.layer?.haze ?? 0.12) + 0.6 * s.storm);
      r.u.uToLight.value.copy(s.toSun);
      r.u.uLight.value.copy(this.lightCol);
      r.u.uShade.value.copy(this.shadeCol);
      r.u.uCloud.value.copy(s.cloudLit).lerp(s.haze, 0.5);
      r.u.uCloudEl.value = (L.base - 1) * DEG + L.lift * DEG * lift;
    }
  }

  // ── Snow: falling round the camera, thick in the summit storm ─────────

  private makeSnow() {
    const n = SNOW[this.ctx.quality];
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const c = this.ctx.game.gfx.camera.position;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = c.x + (Math.random() - 0.5) * SNOW_BOX;
      pos[i * 3 + 1] = c.y + (Math.random() - 0.5) * SNOW_BOX * 0.6;
      pos[i * 3 + 2] = c.z + (Math.random() - 0.5) * SNOW_BOX;
      vel[i * 3] = 0.6 + Math.random() * 0.8;
      vel[i * 3 + 1] = -(0.8 + Math.random() * 1.2);
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.12,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    m.name = 'BigDropSnowfall';
    this.snow = new THREE.Points(geo, m);
    this.snow.name = 'BigDropSnowfall';
    this.snow.frustumCulled = false;
    this.snowVel = vel;
    this.add(this.snow);
  }

  private updateSnow(dt: number) {
    const sn = this.snow;
    const vel = this.snowVel;
    if (sn === null || vel === null) return;
    const amount = snowfallAt(this.ctx.depth);
    sn.visible = amount > 0.01;
    (sn.material as THREE.PointsMaterial).opacity = 0.9 * amount;
    if (!sn.visible) return;
    const attr = sn.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    const c = this.ctx.game.gfx.camera.position;
    const half = SNOW_BOX / 2;
    const hy = half * 0.6;
    const t = this.time;
    const n = a.length / 3;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      a[o] += (vel[o]! + Math.sin(t * 0.9 + i) * 0.4) * dt;
      a[o + 1] += vel[o + 1]! * dt;
      a[o + 2] += (vel[o + 2]! + Math.cos(t * 0.7 + i * 1.3) * 0.4) * dt;
      // Wrap round the camera: riding fast streams the flakes past you
      const dx = a[o]! - c.x;
      if (dx > half || dx < -half) a[o] -= Math.round(dx / SNOW_BOX) * SNOW_BOX;
      const dz = a[o + 2]! - c.z;
      if (dz > half || dz < -half) a[o + 2] -= Math.round(dz / SNOW_BOX) * SNOW_BOX;
      const dy = a[o + 1]! - c.y;
      if (dy > hy || dy < -hy) a[o + 1] -= Math.round(dy / (SNOW_BOX * 0.6)) * SNOW_BOX * 0.6;
    }
    attr.needsUpdate = true;
  }

  rebase(d: THREE.Vector3) {
    const sn = this.snow;
    if (sn === null) return;
    const attr = sn.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += d.x;
      arr[i + 1] += d.y;
      arr[i + 2] += d.z;
    }
    attr.needsUpdate = true;
  }

  // ── Wind: a cold hiss in the storm, a roar as you pick up speed ────────

  private startWind() {
    const au = this.ctx.game.audio;
    const ac = au.ctx;
    const out = au.master;
    if (ac === null || out === null || this.wind !== null) return;
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.09, ac.currentTime, 1.5);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.7;
    bp.connect(gain);
    gain.connect(out);
    // Noise from a looping buffer, with a slow gust on the filter
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(bp);
    src.start();
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.11;
    const depth = ac.createGain();
    depth.gain.value = 260;
    lfo.connect(depth);
    depth.connect(bp.frequency);
    lfo.start();
    // Speed roar: the same noise, low-passed, swelling with speed
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    const roar = ac.createGain();
    roar.gain.value = 0;
    src.connect(lp);
    lp.connect(roar);
    roar.connect(out);
    this.wind = { gain, roar, bp, nodes: [src, lfo] };
  }

  private updateWind(dt: number) {
    const w = this.wind;
    const ac = this.ctx.game.audio.ctx;
    if (w === null || ac === null) return;
    // A few parameter updates a second is plenty (and keeps the event list short)
    this.windT -= dt;
    if (this.windT > 0) return;
    this.windT = 0.2;
    const speed = this.ctx.game.player.speed;
    const fast = THREE.MathUtils.smoothstep(speed, 15, 220);
    const hiss = 0.035 + 0.055 * snowfallAt(this.ctx.depth) + 0.05 * fast;
    w.gain.gain.setTargetAtTime(hiss, ac.currentTime, 0.4);
    w.roar.gain.setTargetAtTime(0.16 * fast, ac.currentTime, 0.4);
    w.bp.frequency.setTargetAtTime(520 + 900 * fast, ac.currentTime, 0.4);
  }

  private stopWind() {
    const w = this.wind;
    const ac = this.ctx.game.audio.ctx;
    if (w === null) return;
    this.wind = null;
    if (ac === null) return;
    w.gain.gain.cancelScheduledValues(ac.currentTime);
    w.roar.gain.cancelScheduledValues(ac.currentTime);
    w.gain.gain.setTargetAtTime(0, ac.currentTime, 0.3);
    w.roar.gain.setTargetAtTime(0, ac.currentTime, 0.3);
    const stopAt = ac.currentTime + 1.5;
    for (const n of w.nodes) n.stop(stopAt);
    setTimeout(() => {
      w.gain.disconnect();
      w.roar.disconnect();
    }, 1800);
  }

  dispose() {
    this.stopWind();
    this.sunDir?.copy(this.savedSunDir);
    for (const o of this.meshes) {
      this.ctx.group.remove(o);
      inkExcluded.delete(o);
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    this.meshes.length = 0;
    this.rings.length = 0;
    this.snow = null;
    this.snowVel = null;
  }
}

export const makeAtmosphere = (ctx: PeakCtx): PeakSystem => new Atmosphere(ctx);
