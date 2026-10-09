// ── The pond: a real three.js scene along the bottom of the desk ────────
//
// The camera renders only a strip of a *virtual full-screen frame*
// (setViewOffset), with the horizon pinned to the top of the strip. Every open
// NounOS window gets an invisible-to-you proxy plane placed so it projects
// exactly onto its DOM rect; the planar-reflection water (three's Water, fed
// with Noun World's procedural water normals) mirrors those planes, so the
// pond genuinely reflects whatever you have open. Reeds, cattails, lily pads,
// boulders (Noun World's rock generator) and fireflies sit in the water;
// clicking the water throws out ripple rings.

import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';

import { createBoulder } from '@/miniapps/world2/nature/Rocks';
import { softSpotTexture, waterNormalTexture } from '@/miniapps/world2/nature/textures';

export const POND_FRACTION = 0.26;
/** Extra band above the waterline so the far shore + reed tips can show. */
export const POND_BAND = 70;
export const pondHeight = () => Math.max(150, Math.round(window.innerHeight * POND_FRACTION));

const CAM_H = 3.2; // camera height above the water (m)
const FOV = 38;
/** half-width (m) of the view at distance |z|, from the real strip aspect */
const viewHalf = (z: number) => {
  const H2 = 2 * (window.innerHeight - pondHeight());
  return (
    Math.abs(z) *
    Math.tan(THREE.MathUtils.degToRad(FOV / 2)) *
    (window.innerWidth / Math.max(1, H2))
  );
};
const ACID = new THREE.Color('#d4ff3a');

interface Proxy {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  key: string;
}

interface Ring {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  t0: number;
  delay: number;
}

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Window silhouette for the reflection: body, frame, title bar, text lines. */
function proxyTexture(focused: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16171b';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#2a2b30';
  g.fillRect(0, 0, 256, 22);
  g.fillStyle = 'rgba(236,235,228,.28)';
  for (let y = 40; y < 240; y += 14) {
    const w = 60 + ((y * 37) % 150);
    g.fillRect(14, y, w, 4);
  }
  if (focused) {
    g.fillStyle = '#d4ff3a';
    g.beginPath();
    g.arc(14, 11, 4, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Pond {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 3000);
  private water: Water;
  private proxies = new Map<string, Proxy>();
  private rings: Ring[] = [];
  private reeds: THREE.Mesh;
  private reedUniforms = { uTime: { value: 0 } };
  private pads = new THREE.Group();
  private rocks = new THREE.Group();
  private flies: THREE.Points;
  private flySeeds: Float32Array;
  private texFocused = proxyTexture(true);
  private texIdle = proxyTexture(false);
  private texPoster: THREE.Texture | null = null;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private W = 1;
  private H2 = 1;
  private yh = 1; // screen y of the waterline
  private strip = 1;
  private k = 1; // px per metre on the proxy plane
  private D = 100; // proxy plane distance
  private raf = 0;
  private last = 0;
  private t = 0;
  active = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.fog = new THREE.FogExp2(0x050a0c, 0.0016);
    this.camera.position.set(0, CAM_H, 0);
    this.camera.lookAt(0, CAM_H, -1);

    // Lights: cold moon from behind-left, dim teal sky fill
    const moon = new THREE.DirectionalLight(0xcfe6ff, 2.6);
    moon.position.set(-30, 40, -60);
    this.scene.add(moon, new THREE.HemisphereLight(0x5d8a96, 0x0a0d0e, 1.9));

    this.scene.add(this.buildSky());
    this.scene.add(this.buildFarShore());

    // Water: planar reflection + Noun World normals
    const normals = waterNormalTexture();
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
    this.water = new Water(new THREE.PlaneGeometry(6000, 6000), {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: normals,
      sunDirection: moon.position.clone().normalize(),
      sunColor: 0xd8ffe8,
      waterColor: 0x03161b,
      distortionScale: 3.4,
      fog: true,
    });
    this.water.rotation.x = -Math.PI / 2;
    (this.water.material.uniforms.size as { value: number }).value = 3.2;
    this.scene.add(this.water);

    this.reeds = this.buildReeds();
    this.scene.add(this.reeds, this.pads, this.rocks);
    this.buildPads();
    this.buildRocks();

    // Fireflies
    const n = 40;
    const r = rand(77);
    const pos = new Float32Array(n * 3);
    this.flySeeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this.flySeeds.set([(r() - 0.5) * 60, 0.4 + r() * 2.2, -6 - r() * 50, r() * 10], i * 4);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.flies = new THREE.Points(
      fg,
      new THREE.PointsMaterial({
        size: 0.35,
        map: softSpotTexture(),
        color: ACID,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.scene.add(this.flies);

    this.layout();
    window.addEventListener('resize', this.layout);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ── scene pieces ────────────────────────────────────────────────────

  private buildSky() {
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 horizon = vec3(0.05, 0.16, 0.18);
          vec3 mid = vec3(0.012, 0.03, 0.04);
          vec3 zen = vec3(0.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.12, h));
          c = mix(c, zen, smoothstep(0.12, 0.6, h));
          // moon glow
          vec3 md = normalize(vec3(-0.35, 0.42, -0.84));
          float g = max(dot(normalize(vDir), md), 0.0);
          c += vec3(0.75, 0.95, 0.85) * (pow(g, 900.0) * 2.5 + pow(g, 24.0) * 0.08);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), m);
    sky.renderOrder = -1;
    return sky;
  }

  /** Low dark hills + a jagged treeline on the far bank, for depth. */
  private buildFarShore() {
    const pts: number[] = [];
    const R = 900;
    const segs = 180;
    const col = new THREE.Color(0x05090a);
    const geo = new THREE.BufferGeometry();
    const pos: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      // gentle rolling hills, no jagged noise (it read as glitchy in the mirror)
      const h0 = 7 + Math.sin(a0 * 3) * 3 + Math.sin(a0 * 7 + 1) * 1.5;
      const h1 = 7 + Math.sin(a1 * 3) * 3 + Math.sin(a1 * 7 + 1) * 1.5;
      pts.push(h0);
      const p = (a: number, h: number) => [Math.sin(a) * R, h, -Math.cos(a) * R] as const;
      pos.push(...p(a0, -2), ...p(a1, -2), ...p(a1, h1), ...p(a0, -2), ...p(a1, h1), ...p(a0, h0));
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
  }

  /** Reeds + cattails as one merged, wind-swayed mesh (vertex coloured). */
  private buildReeds() {
    const r = rand(0x991e5);
    const pos: number[] = [];
    const colr: number[] = [];
    const swayW: number[] = [];
    const green = new THREE.Color();
    const brown = new THREE.Color(0x4a2a12);
    const blade = (x: number, z: number, h: number, w: number, lean: number, cattail: boolean) => {
      const segs = 5;
      const yaw = r() * Math.PI;
      const cx = Math.cos(yaw);
      const sz = Math.sin(yaw);
      green.setHSL(0.25 + r() * 0.07, 0.5, 0.2 + r() * 0.16);
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        const ww0 = w * (1 - t0 * 0.85);
        const ww1 = w * (1 - t1 * 0.85);
        const bend0 = lean * t0 * t0 * h;
        const bend1 = lean * t1 * t1 * h;
        const y0 = -0.2 + t0 * h;
        const y1 = -0.2 + t1 * h;
        const a = [x - cx * ww0 + bend0, y0, z - sz * ww0];
        const b = [x + cx * ww0 + bend0, y0, z + sz * ww0];
        const c = [x + cx * ww1 + bend1, y1, z + sz * ww1];
        const d = [x - cx * ww1 + bend1, y1, z - sz * ww1];
        pos.push(...a, ...b, ...c, ...a, ...c, ...d);
        for (const tt of [t0, t0, t1, t0, t1, t1]) {
          const shade = 0.6 + tt * 0.5;
          colr.push(green.r * shade, green.g * shade, green.b * shade);
          swayW.push(tt * tt);
        }
      }
      if (cattail) {
        // a small brown box near the tip
        const hy = -0.2 + h * 0.8;
        const hx = x + lean * 0.64 * h;
        const s = w * 1.6;
        const L = h * 0.13;
        const box = new THREE.BoxGeometry(s, L, s).toNonIndexed();
        const p = box.attributes.position;
        for (let i = 0; i < p.count; i++) {
          pos.push(p.getX(i) + hx, p.getY(i) + hy, p.getZ(i) + z);
          colr.push(brown.r, brown.g, brown.b);
          swayW.push(0.64);
        }
      }
    };
    // Clumps near the left/right edges of the view, a few mid-pond islands
    const halfW = (z: number) => viewHalf(z) * 0.98;
    const clump = (side: number, z: number, n: number, tall: number) => {
      const edge = halfW(z) * side;
      for (let i = 0; i < n; i++) {
        const zz = z + (r() - 0.5) * 3;
        const xx = edge - side * r() * Math.abs(edge) * 0.18;
        blade(xx, zz, tall * (0.55 + r() * 0.6), 0.035 + r() * 0.03, (r() - 0.5) * 0.5, r() < 0.25);
      }
    };
    for (const z of [-7, -10, -14, -19]) {
      clump(-1, z, 34, 2.9);
      clump(1, z, 30, 2.7);
    }
    for (const [x, z, n] of [
      [-7, -26, 14],
      [9, -34, 12],
      [2, -48, 10],
    ] as const) {
      for (let i = 0; i < n; i++) {
        blade(
          x + (r() - 0.5) * 2.2,
          z + (r() - 0.5) * 2,
          2.2 * (0.5 + r() * 0.7),
          0.05,
          (r() - 0.5) * 0.4,
          r() < 0.3,
        );
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(swayW, 1));
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.reedUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float sway;\nuniform float uTime;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float ph = position.x * 0.7 + position.z * 0.45;
           transformed.x += sway * (sin(uTime * 1.3 + ph) * 0.16 + sin(uTime * 3.1 + ph * 2.0) * 0.04);
           transformed.z += sway * sin(uTime * 1.1 + ph * 1.3) * 0.08;`,
        );
    };
    return new THREE.Mesh(g, m);
  }

  private buildPads() {
    const r = rand(31);
    const padMat = new THREE.MeshLambertMaterial({ color: 0x2f7a3c, side: THREE.DoubleSide });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x7cc45a });
    const petal = new THREE.MeshLambertMaterial({ color: 0xff7ab8, emissive: 0x3a0a20 });
    for (let i = 0; i < 70; i++) {
      const z = -5 - r() * 60;
      const half = viewHalf(z);
      const x = (r() - 0.5) * 2 * half;
      const rad = 0.5 + r() * 0.8;
      const notch = 0.35;
      const g = new THREE.CircleGeometry(rad, 18, notch / 2, Math.PI * 2 - notch);
      g.rotateX(-Math.PI / 2);
      const pad = new THREE.Mesh(g, padMat);
      pad.position.set(x, 0.02, z);
      pad.rotation.y = r() * Math.PI * 2;
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(rad * 0.94, rad, 18, 1, notch / 2, Math.PI * 2 - notch).rotateX(
          -Math.PI / 2,
        ),
        rimMat,
      );
      rim.position.y = 0.004;
      pad.add(rim);
      pad.userData.bob = r() * 6;
      if (r() < 0.3) {
        for (let k = 0; k < 6; k++) {
          const p = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), petal);
          const a = (k / 6) * Math.PI * 2;
          p.position.set(Math.cos(a) * 0.06, 0.07, Math.sin(a) * 0.06);
          p.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
          pad.add(p);
        }
      }
      this.pads.add(pad);
    }
  }

  private buildRocks() {
    const r = rand(8);
    for (const [x, z, s] of [
      [-9.5, -12, 1.4],
      [-7.8, -13.5, 0.8],
      [10.5, -16, 1.6],
      [-14, -30, 2.2],
      [17, -38, 2.6],
    ] as const) {
      try {
        const b = createBoulder(s, Math.floor(r() * 9) + 1);
        b.position.set(x, -s * 0.35, z);
        b.rotation.y = r() * 6;
        b.castShadow = b.receiveShadow = false;
        this.rocks.add(b);
      } catch {
        // rock generator unavailable — the pond survives without
      }
    }
  }

  // ── layout / mapping ────────────────────────────────────────────────

  private layout = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.strip = pondHeight();
    this.yh = H - this.strip; // waterline
    this.W = W;
    this.H2 = 2 * this.yh; // virtual frame centred on the horizon
    const top = Math.max(0, this.yh - POND_BAND);
    const h = H - top;
    this.camera.aspect = W / this.H2;
    this.camera.setViewOffset(W, this.H2, 0, top, W, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, h, false);
    this.canvas.style.height = `${h}px`;
    // Proxy plane distance: its base meets the water 14% into the strip
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const basePx = this.strip * 0.14;
    this.k = basePx / CAM_H;
    this.D = this.H2 / 2 / (tanHalf * this.k);
  };

  /** Screen y of the waterline. */
  horizon() {
    return this.yh;
  }

  private syncProxies() {
    const seen = new Set<string>();
    const els = document.querySelectorAll<HTMLElement>('[data-nos-win], [data-nos-reflect]');
    for (const el of els) {
      const id = el.dataset.nosWin ?? `reflect:${el.dataset.nosReflect ?? ''}`;
      const poster = el.dataset.nosReflect === 'poster';
      if (el.classList.contains('is-sunk')) continue;
      const rc = el.getBoundingClientRect();
      if (rc.width < 2 || rc.top > this.yh) continue;
      seen.add(id);
      let p = this.proxies.get(id);
      if (!p) {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: this.texIdle, toneMapped: false, fog: false }),
        );
        p = { mesh, key: '' };
        this.proxies.set(id, p);
        this.scene.add(mesh);
      }
      const focused = el.classList.contains('is-focused');
      const key = poster ? 'p' : focused ? 'f' : 'i';
      if (poster && this.texPoster === null) {
        this.texPoster = new THREE.TextureLoader().load('/world2/cover-1200.webp');
        this.texPoster.colorSpace = THREE.SRGBColorSpace;
      }
      if (p.key !== key) {
        p.mesh.material.map = poster ? this.texPoster : focused ? this.texFocused : this.texIdle;
        p.mesh.material.needsUpdate = true;
        p.key = key;
      }
      const rank = Number(el.dataset.nosRank ?? 0);
      p.mesh.material.color.setScalar(poster ? 0.75 : Math.max(0.18, 0.62 - rank * 0.16));
      const bottom = Math.min(rc.bottom, this.yh + this.strip * 0.14);
      const cx = (rc.left + rc.right) / 2 - this.W / 2;
      const yTop = CAM_H + (this.yh - rc.top) / this.k;
      const yBot = Math.max(0.02, CAM_H + (this.yh - bottom) / this.k);
      p.mesh.position.set(cx / this.k, (yTop + yBot) / 2, -this.D);
      p.mesh.scale.set(rc.width / this.k, Math.max(0.01, yTop - yBot), 1);
      p.mesh.visible = true;
    }
    for (const [id, p] of this.proxies) {
      if (!seen.has(id)) p.mesh.visible = false;
    }
  }

  ripple(x: number, y: number, strength = 1) {
    const top = Math.max(0, this.yh - POND_BAND);
    const h = window.innerHeight - top;
    const ndc = new THREE.Vector2((x / this.W) * 2 - 1, -((y - top) / h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.plane, hit) === null) return;
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: ACID,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      mesh.position.copy(hit).setY(0.03);
      mesh.scale.setScalar(0.01);
      mesh.userData.s = strength;
      this.scene.add(mesh);
      this.rings.push({ mesh, t0: this.t, delay: i * 0.28 });
    }
    if (this.rings.length > 30) {
      const old = this.rings.splice(0, this.rings.length - 30);
      for (const o of old) this.disposeRing(o);
    }
  }

  private disposeRing(r: Ring) {
    this.scene.remove(r.mesh);
    r.mesh.geometry.dispose();
    r.mesh.material.dispose();
  }

  // ── loop ────────────────────────────────────────────────────────────

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.active || now - this.last < 32) return; // ~30fps, idle when hidden
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const t = this.t;
    (this.water.material.uniforms.time as { value: number }).value += dt * 0.35;
    this.reedUniforms.uTime.value = t;
    for (const pad of this.pads.children) {
      pad.position.y = 0.02 + Math.sin(t * 0.9 + (pad.userData.bob as number)) * 0.015;
      pad.rotation.y += Math.sin(t * 0.2 + (pad.userData.bob as number)) * 0.0006;
    }
    const pos = this.flies.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z, p] = this.flySeeds.subarray(i * 4, i * 4 + 4);
      pos.setXYZ(
        i,
        x + Math.sin(t * 0.3 + p) * 2.2,
        y + Math.sin(t * 0.7 + p * 2) * 0.35,
        z + Math.cos(t * 0.25 + p) * 1.6,
      );
    }
    pos.needsUpdate = true;
    (this.flies.material as THREE.PointsMaterial).opacity = 0.65 + Math.sin(t * 2.3) * 0.2;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const age = t - r.t0 - r.delay;
      if (age < 0) continue;
      if (age > 3.2) {
        this.disposeRing(r);
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(0.2 + age * 2.6);
      r.mesh.material.opacity = Math.max(0, 1 - age / 3.2) * 0.55 * (r.mesh.userData.s as number);
    }
    this.syncProxies();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.layout);
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose());
      else mat?.dispose();
    });
    this.texFocused.dispose();
    this.texIdle.dispose();
    this.renderer.dispose();
  }
}
