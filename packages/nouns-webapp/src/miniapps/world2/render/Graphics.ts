// ── Renderer, lighting, sky + post-processing stack ─────────────────────

import type { LevelData } from '../world/Level';

import { N8AOPostPass } from 'n8ao';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type Quality = 'low' | 'medium' | 'high';

const SHADOW_EXTENT = { low: 18, medium: 24, high: 30 };
const SHADOW_SIZE = { low: 1024, medium: 2048, high: 4096 };

export class Graphics {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  quality: Quality;
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
    this.renderer.shadowMap.type = quality === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

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
    if (quality !== 'low') {
      this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      const c = this.ao.configuration;
      c.aoRadius = 1.6;
      c.distanceFalloff = 0.6;
      c.intensity = 2.2;
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
      luminanceThreshold: 0.92,
      luminanceSmoothing: 0.2,
      radius: 0.7,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const grade = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
    const sat = new HueSaturationEffect({ saturation: 0.12 });
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.42 });
    this.composer.addPass(new EffectPass(this.camera, this.bloom, tone, grade, sat, vignette));
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
    this.sun.intensity = level.sun.intensity;
    this.scene.fog = new THREE.FogExp2(level.fog.color, level.fog.density);
    // Sky sun position is the direction TO the sun
    const toSun = this.sunDir.clone().negate();
    this.sky.material.uniforms.sunPosition.value.copy(toSun);
    this.hemi.color.copy(level.sky.zenith).lerp(new THREE.Color(0xffffff), 0.5);
    // Baked levels already contain bounce light; keep the hemi fill small.
    this.hemi.intensity = level.baked ? 0.12 : 0.45;
    this.buildEnvironment(level.baked ? 0.6 : 1.0);
  }

  /** Render the sky into a PMREM env map for PBR reflections + ambient. */
  private buildEnvironment(intensity: number) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky = new Sky();
    sky.scale.setScalar(60);
    const src = this.sky.material.uniforms;
    const dst = sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'])
      dst[k].value = src[k].value;
    dst.sunPosition.value.copy(src.sunPosition.value);
    envScene.add(sky);
    // Warm ground bounce so undersides aren't sky-blue
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2 - 0.02),
      new THREE.MeshBasicMaterial({ color: 0x5a5046, side: THREE.BackSide }),
    );
    envScene.add(ground);
    this.envRT?.dispose();
    this.envRT = pmrem.fromScene(envScene, 0.02, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = intensity;
    pmrem.dispose();
    sky.material.dispose();
    ground.geometry.dispose();
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
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.envRT?.dispose();
    this.renderer.dispose();
  }
}
