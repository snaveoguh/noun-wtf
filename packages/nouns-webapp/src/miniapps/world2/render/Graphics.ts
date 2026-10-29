// ── Renderer, lighting, sky + post-processing stack ─────────────────────

import type { LiteState } from './deviceTier';
import type { LevelData } from '../world/Level';
import type { N8AOPostPass } from 'n8ao';

import {
  BloomEffect,
  BrightnessContrastEffect,
  type Effect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  NormalPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

import { envMapSize } from './textureDiet';
import { ClampEffect, InkOutlineEffect, inkExcluded } from './Toon';

export type Quality = 'low' | 'medium' | 'high';

const SHADOW_EXTENT = { low: 18, medium: 24, high: 30 };
const SHADOW_SIZE = { low: 1024, medium: 2048, high: 4096 };

/**
 * Pixel ratio a tier boots with. High draws at 1.5 on a Retina screen, not
 * 2: 2 is 78% more pixels through every pass (scene, normals, ink, grade,
 * 3 SMAA passes) for a difference hard to see under the outlines, and it
 * was what kept laptops hot. `sharp` (Settings → Sharp) asks for the full 2.
 */
export function bootScale(quality: Quality, dpr: number, sharp = false): number {
  const max = quality === 'low' ? 1 : quality === 'high' && sharp ? 2 : 1.5;
  return Math.min(dpr || 1, max);
}

export class Graphics {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  /** Exposed for ?diag=1 */
  inkPass: EffectPass | null = null;
  /** Bypass the composer entirely (?diag=1) */
  rawRender = false;
  /**
   * The adaptive step-down state (render scale, shadows, post;
   * qualityController.ts). Only 'low' drops shadows or post; medium/high
   * only ever change the render scale.
   */
  lite: LiteState;
  gradePass: EffectPass | null = null;
  /** SMAA (medium / high), last in the stack; the desktop ladder can turn it off. */
  private aaPass: EffectPass | null = null;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  quality: Quality;
  /** Jet Set Radio cel-shaded look (disable with ?toon=0). */
  toon = new URLSearchParams(window.location.search).get('toon') !== '0';
  outline: InkOutlineEffect | null = null;
  private ao: InstanceType<typeof N8AOPostPass> | null = null;
  private bloom: BloomEffect;
  private sunDir = new THREE.Vector3(-0.45, -0.75, 0.48).normalize();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private pixelRatio = 1;
  /** Ink thickness (buffer px) as designed, and the render scale it was designed at. */
  private inkBase = 0;
  private inkAtScale = 1;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.pixelRatio = bootScale(quality, window.devicePixelRatio);
    this.lite =
      quality === 'low'
        ? { scale: this.pixelRatio, shadows: true, post: true }
        : {
            scale: this.pixelRatio,
            shadows: true,
            post: true,
            aa: true,
            shadowMap: SHADOW_SIZE[quality],
          };
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated in r183 (silently remapped to PCF, which
    // left early-compiled shaders with mismatched shadow samplers).
    // BASIC, not PCF: r183's PCF path samples a hardware depth-compare
    // sampler (sampler2DShadow) that returns garbage on Apple GPUs, turning
    // everything inside the shadow frustum (rider, board, nearby road) WHITE.
    // Basic does a plain texture read + step(); hard shadow edges also suit
    // the cel look. ?shadows=pcf opts back in for comparison.
    this.renderer.shadowMap.type =
      new URLSearchParams(window.location.search).get('shadows') === 'pcf'
        ? THREE.PCFShadowMap
        : THREE.BasicShadowMap;

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.15, 3000);

    // Sun + sky fill
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    this.sun.castShadow = true;
    const ext = SHADOW_EXTENT[quality];
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 220;
    sc.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(SHADOW_SIZE[quality], SHADOW_SIZE[quality]);
    // Basic (single-tap) shadows need a stronger bias than PCF or the
    // rider/heads get acne stripes.
    const pcf = this.renderer.shadowMap.type === THREE.PCFShadowMap;
    this.sun.shadow.bias = pcf ? -0.00025 : -0.0012;
    this.sun.shadow.normalBias = pcf ? 0.035 : 0.09;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a48, 0.35);
    this.scene.add(this.hemi);

    this.sky = new Sky();
    this.sky.scale.setScalar(2500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5.5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.84;
    this.scene.add(this.sky);

    // Post stack
    // Low (phones): 8-bit buffers halve the bandwidth of every pass; there's
    // no tone mapping or grade on low for the extra range to matter
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: quality === 'low' ? THREE.UnsignedByteType : THREE.HalfFloatType,
      multisampling: 0,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Normals for crease outlines (skip on low to save a scene pass)
    let normalPass: NormalPass | null = null;
    if (this.toon && quality !== 'low') {
      normalPass = new NormalPass(this.scene, this.camera);
      // Hide glow/particle planes while normals render so they never get inked
      const np = normalPass;
      const renderNormals = np.render.bind(np);
      np.render = (...args: Parameters<typeof np.render>) => {
        const hidden: THREE.Object3D[] = [];
        for (const o of inkExcluded) {
          if (o.visible) {
            o.visible = false;
            hidden.push(o);
          }
        }
        renderNormals(...args);
        for (const o of hidden) o.visible = true;
      };
      this.composer.addPass(normalPass);
    }
    const aoParam = new URLSearchParams(window.location.search).get('fx');
    // Toon mode skips SSAO: cel shading doesn't want it, and N8AO clobbers the
    // depth the ink pass reads.
    if (quality !== 'low' && (aoParam === null ? !this.toon : aoParam.split(',').includes('ao'))) {
      // N8AO (~140 KB) only loads when it's used (never in the default toon
      // look); it slots in ahead of the effect passes once it arrives
      void import('n8ao').then(({ N8AOPostPass: AO }) => {
        const ao = new AO(this.scene, this.camera, 1, 1);
        const c = ao.configuration;
        c.aoRadius = 1.6;
        c.distanceFalloff = 0.6;
        c.intensity = this.toon ? 1.3 : 2.2;
        c.aoSamples = quality === 'high' ? 16 : 8;
        c.denoiseSamples = quality === 'high' ? 8 : 4;
        c.halfRes = quality !== 'high';
        c.depthAwareUpsampling = true;
        c.gammaCorrection = false;
        c.color = new THREE.Color(0x0b0d18);
        const at = this.composer.passes.findIndex(p => p instanceof EffectPass);
        this.composer.addPass(ao, at < 0 ? undefined : at);
        ao.setSize(
          this.renderer.domElement.clientWidth * this.pixelRatio,
          this.renderer.domElement.clientHeight * this.pixelRatio,
        );
        this.ao = ao;
      });
    }
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: 0.55,
      // Toon: only true emissives (neon, lamps, glints) should bloom
      luminanceThreshold: this.toon ? 1.15 : 0.92,
      luminanceSmoothing: 0.2,
      radius: 0.7,
    });
    // JSR wants punchy, saturated colour: neutral tone curve + extra saturation
    const tone = new ToneMappingEffect({
      mode: this.toon ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX,
    });
    const grade = new BrightnessContrastEffect({
      brightness: 0.0,
      contrast: this.toon ? 0.12 : 0.08,
    });
    const sat = new HueSaturationEffect({ saturation: this.toon ? 0.28 : 0.12 });
    if (this.toon) {
      this.inkBase = quality === 'high' ? 2.2 : 1.8;
      this.outline = new InkOutlineEffect({
        normalBuffer: normalPass?.texture ?? null,
        thickness: this.inkBase,
      });
      // (the scale today's look was drawn at: the old caps; phones keep theirs as is)
      this.inkAtScale = bootScale(quality, window.devicePixelRatio, true);
      this.fitInk();
    }
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.42 });
    // `?fx=bloom,tone,grade,sat,vig` limits the stack (debugging / perf triage).
    const fxParam = new URLSearchParams(window.location.search).get('fx');
    // Default look = clamp + vignette only. The tone/contrast/saturation/bloom
    // grade turned dark toon surfaces white on Apple GPUs, and the ungraded
    // image read better anyway (?diag=1 on an M4, tile C). ?fx=…,tone,grade,
    // sat,bloom brings stages back for experiments.
    // Low (phones) keeps just the ink: every full-screen pass costs there
    const want = (k: string) =>
      fxParam === null
        ? k === 'ink' || (k === 'vig' && quality !== 'low')
        : fxParam.split(',').includes(k);
    const effects: Effect[] = [
      // Clamp FIRST: on Apple GPUs the scene render can leave slightly negative
      // values in dark areas; NEUTRAL tone mapping's offset term
      // (x - 6.25x²) explodes for negative input and turns them near-white.
      // (?diag=1 on an M4: grade pass on → white, grade pass off → correct.)
      new ClampEffect(),
      want('bloom') ? this.bloom : null,
      want('tone') ? tone : null,
      want('grade') ? grade : null,
      want('sat') ? sat : null,
      want('vig') ? vignette : null,
    ].filter((e): e is NonNullable<typeof e> => e !== null);
    effects.push(new ClampEffect(fxParam?.split(',').includes('neg') === true));
    // Ink in its own pass (merged with the grading effects it got dropped)
    if (this.outline !== null && want('ink'))
      this.composer.addPass((this.inkPass = new EffectPass(this.camera, this.outline)));
    // On low the clamps alone don't earn a pass (8-bit buffers clamp anyway)
    if (effects.length > 0 && (quality !== 'low' || effects.length > 2))
      this.composer.addPass((this.gradePass = new EffectPass(this.camera, ...effects)));
    if (quality !== 'low') {
      this.composer.addPass(
        (this.aaPass = new EffectPass(
          this.camera,
          new SMAAEffect({ preset: quality === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }),
        )),
      );
    }
  }

  applyLevel(level: LevelData) {
    this.sunDir.copy(level.sun.direction).normalize();
    this.sun.color.copy(level.sun.color);
    // The toon ramp's lit band is already full-bright; tame the sun so
    // flat colours don't clip to white.
    this.sun.intensity = level.sun.intensity * (this.toon ? 0.26 : 1);
    this.scene.fog = new THREE.FogExp2(level.fog.color, level.fog.density);
    // Sky sun position is the direction TO the sun
    const toSun = this.sunDir.clone().negate();
    this.sky.material.uniforms.sunPosition.value.copy(toSun);
    this.hemi.color.copy(level.sky.zenith).lerp(new THREE.Color(0xffffff), 0.5);
    // Baked levels already contain bounce light; keep the hemi fill small.
    // Toon materials ignore the PMREM env, so ambient comes from the hemi
    this.hemi.intensity = this.toon ? (level.baked ? 0.3 : 0.45) : level.baked ? 0.12 : 0.45;
    this.buildEnvironment(level.baked ? 0.6 : 1.0, level.sky.zenith, level.sky.horizon);
  }

  /**
   * Bake a simple, NaN-safe gradient sky (+ sun disc + warm ground) into a
   * PMREM env map for PBR ambient + reflections. The analytic Sky shader is
   * only used for the visible backdrop: baked into PMREM it can emit NaNs
   * that turn every lit surface black.
   */
  private buildEnvironment(intensity: number, zenith: THREE.Color, horizon: THREE.Color) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 48, 24);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const ground = new THREE.Color(0x6a5d50);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 50;
      if (y >= 0) c.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
      else c.copy(horizon).lerp(ground, Math.min(1, -y * 4));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }),
    );
    envScene.add(dome);
    // Sun disc gives speculars a hot spot in the right direction
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 16, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(this.sun.color).multiplyScalar(30) }),
    );
    sun.position.copy(this.sunDir).multiplyScalar(-45);
    envScene.add(sun);
    this.envRT?.dispose();
    this.envRT = pmrem.fromScene(envScene, 0.03, 0.1, 200, { size: envMapSize() });
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = intensity;
    pmrem.dispose();
    geo.dispose();
    (dome.material as THREE.Material).dispose();
    sun.geometry.dispose();
    (sun.material as THREE.Material).dispose();
  }

  /** Keep the shadow frustum centred on the player, snapped to texels. */
  followShadow(center: THREE.Vector3) {
    if (!this.sun.castShadow) return;
    const ext = SHADOW_EXTENT[this.quality];
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const dist = 90;
    // Snap in light space to stop shimmering (scratch objects: runs every frame)
    const lightRot = this.shRot.lookAt(this.shZero, this.sunDir, this.shUp);
    const inv = this.shInv.copy(lightRot).invert();
    const c = this.shC.copy(center).applyMatrix4(inv);
    c.x = Math.round(c.x / texel) * texel;
    c.y = Math.round(c.y / texel) * texel;
    c.applyMatrix4(lightRot);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, -dist);
    this.sun.target.updateMatrixWorld();
  }

  private shRot = new THREE.Matrix4();
  private shInv = new THREE.Matrix4();
  private shC = new THREE.Vector3();
  private readonly shZero = new THREE.Vector3();
  private readonly shUp = new THREE.Vector3(0, 1, 0);

  /**
   * Apply a low-tier step-down state: render scale sets the pixel ratio (the
   * caller resizes), shadows off stops the sun casting (three recompiles the
   * lit materials once), post off renders straight to the screen.
   */
  /**
   * The ink is drawn in buffer pixels: keep its width on screen the same at
   * any render scale (1.5 on a Retina screen draws the lines it drew at 2).
   */
  private fitInk() {
    if (this.outline !== null && this.inkBase > 0 && this.quality !== 'low')
      this.outline.thickness = (this.inkBase * this.pixelRatio) / this.inkAtScale;
  }

  applyLite(s: LiteState) {
    if (s.scale !== this.lite.scale) {
      this.pixelRatio = s.scale;
      this.renderer.setPixelRatio(s.scale);
      this.fitInk();
    }
    if (s.shadows !== this.lite.shadows) this.sun.castShadow = s.shadows;
    // SMAA off: the pass before it draws to the screen instead (no relink)
    const aa = this.aaPass;
    if (aa !== null && s.aa !== undefined && aa.enabled !== s.aa) {
      aa.enabled = s.aa;
      const live = this.composer.passes.filter(p => p.enabled);
      for (const p of this.composer.passes) p.renderToScreen = false;
      if (live.length > 0) live[live.length - 1].renderToScreen = true;
    }
    // A new shadow map size reallocates the map; materials don't relink
    if (s.shadowMap !== undefined && s.shadowMap !== this.sun.shadow.mapSize.x) {
      this.sun.shadow.mapSize.set(s.shadowMap, s.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.lite = { ...s };
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.ao?.setSize(w * this.pixelRatio, h * this.pixelRatio);
  }

  /**
   * Run `fn` (a renderer.compile / compileAsync) with the render target the
   * frame really draws into. Through the composer that's a linear buffer,
   * and three keys programs by output colour space: compiling with no
   * target built the sRGB screen variants, which the frame never uses, so
   * every material still linked on first draw.
   */
  asDrawn<T>(fn: () => T): T {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rawRender || !this.lite.post ? null : this.composer.inputBuffer);
    try {
      return fn();
    } finally {
      r.setRenderTarget(prev);
    }
  }

  /** Draw nothing (an opaque menu covers the canvas: Game.coverGame). */
  hold = false;

  render(dt: number) {
    if (this.hold) return;
    if (this.rawRender || !this.lite.post) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.envRT?.dispose();
    this.renderer.dispose();
  }
}
