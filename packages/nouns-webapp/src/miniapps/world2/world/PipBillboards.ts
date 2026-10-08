// ── Pip3 billboards: the plaza mural + posters cycle through 60r90's GIFs ──
//
// Same Giphy channel feed as /pip3 (via the noun.wtf API). Each GIF is played
// through Giphy's MP4 rendition as a VideoTexture (smooth, cheap, CORS-safe),
// swapping to the next one every few seconds.

import * as THREE from 'three';

const CHANNEL_ID = '19207767'; // 60r90 — same as src/pages/Pip3Page
const API_BASE =
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';
const mp4Url = (id: string) => `https://media.giphy.com/media/${id}/giphy.mp4`;

/** Decal materials in plaza.glb that become screens (mural first = hero). */
const SCREEN_MATERIAL = /^(mural|poster_\d+)__/i;
const CYCLE_SECONDS = 9;

async function fetchGifIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < 200; offset += 50) {
    try {
      const res = await fetch(
        `${API_BASE}/api/pip3-gifs?channel=${CHANNEL_ID}&offset=${offset}&limit=50`,
      );
      if (!res.ok) break;
      const data = (await res.json()) as { results?: { id: string }[]; next?: unknown };
      for (const r of data.results ?? []) ids.push(r.id);
      if (data.next === undefined || data.next === null || data.next === false) break;
    } catch {
      break;
    }
  }
  return ids;
}

interface Screen {
  material: THREE.MeshBasicMaterial;
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  next: number;
}

export class PipBillboards {
  private screens: Screen[] = [];
  private ids: string[] = [];
  private cursor = 0;
  private elapsed = 0;
  private disposed = false;

  /** Find screen materials under the level root and start the feed. */
  async attach(levelRoot: THREE.Object3D) {
    // Screens are swapped to unlit materials: the GIFs are black line art on
    // white and should read exactly like that — no sun, no shadow, no toon band.
    const mats = new Map<string, THREE.MeshBasicMaterial>();
    const targets: { mesh: THREE.Mesh; index: number; key: string }[] = [];
    levelRoot.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((m, index) => {
        if (SCREEN_MATERIAL.test(m.name)) targets.push({ mesh, index, key: m.uuid });
      });
    });
    if (targets.length === 0) return;
    for (const t of targets) {
      if (!mats.has(t.key)) {
        mats.set(t.key, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      }
    }
    const ids = await fetchGifIds();
    if (this.disposed || ids.length === 0) return;
    // Shuffle so every visit shows a different mix
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    this.ids = ids;
    for (const t of targets) {
      const m = mats.get(t.key)!;
      if (Array.isArray(t.mesh.material)) t.mesh.material[t.index] = m;
      else t.mesh.material = m;
    }
    let k = 0;
    for (const material of mats.values()) {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false; // glTF UV convention
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.NearestFilter; // keep the low-res GIF crunch
      texture.generateMipmaps = false;
      material.map = texture;
      material.needsUpdate = true;
      const screen: Screen = { material, video, texture, next: (k * 3) % CYCLE_SECONDS };
      this.screens.push(screen);
      this.load(screen);
      k++;
    }
  }

  private load(s: Screen) {
    if (this.ids.length === 0) return;
    const id = this.ids[this.cursor % this.ids.length];
    this.cursor++;
    s.video.src = mp4Url(id);
    void s.video.play().catch(() => {
      // Autoplay blocked until a gesture; retry on next cycle
    });
  }

  update(dt: number) {
    if (this.screens.length === 0) return;
    this.elapsed += dt;
    for (const s of this.screens) {
      s.next -= dt;
      if (s.next <= 0) {
        s.next = CYCLE_SECONDS + Math.random() * 3;
        this.load(s);
      } else if (s.video.paused && s.video.readyState >= 2) {
        void s.video.play().catch(() => undefined);
      }
    }
  }

  dispose() {
    this.disposed = true;
    for (const s of this.screens) {
      s.video.pause();
      s.video.removeAttribute('src');
      s.video.load();
      s.texture.dispose();
    }
    this.screens = [];
  }
}
