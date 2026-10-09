// ── Renderer, lighting, sky + post-processing stack ─────────────────────

import type { LevelData } from '../world/Level';

import { N8AOPostPass } from 'n8ao';
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

import { ClampEffect, InkOutlineEffect, inkExcluded } from './Toon';

export type Quality = 'low' | 'medium' | 'high';

const SHADOW_EXTENT = { low: 18, medium: 24, high: 30 };
const SHADOW_SIZE = { low: 1024, medium: 2048, high: 4096 };

export class Graphics {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  /** Exposed for ?diag=1 */
  inkPass: EffectPass | null = null;
  /** Bypass the composer entirely (?diag=1) */
  rawRender = false;
  gradePass: EffectPass | null = null;
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
    this.pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1,
    );
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated in r183 (silently remapped to PCF, which
    // left early-compiled shaders with mismatched shadow samplers).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);

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
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
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
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
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
      this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      const c = this.ao.configuration;
      c.aoRadius = 1.6;
      c.distanceFalloff = 0.6;
      c.intensity = this.toon ? 1.3 : 2.2;
      c.aoSamples = quality === 'high' ? 16 : 8;
      c.denoiseSamples = quality === 'high' ? 8 : 4;
      c.halfRes = quality !== 'high';
      c.depthAwareUpsampling = true;
      c.gammaCorrection = false;
      c.color = new THREE.Color(0x0b0d18);
      this.composer.addPass(this.ao);
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
      this.outline = new InkOutlineEffect({
        normalBuffer: normalPass?.texture ?? null,
        thickness: quality === 'high' ? 2.2 : 1.8,
      });
    }
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.42 });
    // `?fx=bloom,tone,grade,sat,vig` limits the stack (debugging / perf triage).
    const fxParam = new URLSearchParams(window.location.search).get('fx');
    const want = (k: string) => fxParam === null || fxParam.split(',').includes(k);
    const effects: Effect[] = [
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
    if (effects.length > 0)
      this.composer.addPass((this.gradePass = new EffectPass(this.camera, ...effects)));
    this.composer.addPass(
      new EffectPass(
        this.camera,
        new SMAAEffect({ preset: quality === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }),
      ),
    );
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
    this.envRT = pmrem.fromScene(envScene, 0.03, 0.1, 200);
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
    const ext = SHADOW_EXTENT[this.quality];
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const dist = 90;
    // Snap in light space to stop shimmering
    const lightRot = new THREE.Matrix4().lookAt(
      new THREE.Vector3(),
      this.sunDir,
      new THREE.Vector3(0, 1, 0),
    );
    const inv = lightRot.clone().invert();
    const c = center.clone().applyMatrix4(inv);
    c.x = Math.round(c.x / texel) * texel;
    c.y = Math.round(c.y / texel) * texel;
    c.applyMatrix4(lightRot);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, -dist);
    this.sun.target.updateMatrixWorld();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.ao?.setSize(w * this.pixelRatio, h * this.pixelRatio);
  }

  render(dt: number) {
    if (this.rawRender) {
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
