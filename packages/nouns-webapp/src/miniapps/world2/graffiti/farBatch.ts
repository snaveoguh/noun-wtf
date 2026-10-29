// ── Far graffiti cells as tiles in a few atlas pages (phones) ───────────
//
// See atlas.ts for why. Each page is one texture and one mesh of quads (one
// per tile, in world space). A cell's small canvas is copied into its tile
// with a sub-upload (texSubImage2D of a 64- or 128-wide canvas), never the
// whole page, and each page regenerates its mips at most once a frame. A
// cell drawn sharp (near the rider) uses its own mesh as before; its tile's
// quad collapses to a point meanwhile.

import * as THREE from 'three';

import {
  type AtlasLayout,
  collapseQuad,
  type Slot,
  slotAt,
  slotGlY,
  slotUv,
  tilesPerPage,
  writeQuad,
} from './atlas';

type V3 = { x: number; y: number; z: number };

interface Page {
  tex: THREE.DataTexture;
  mesh: THREE.Mesh;
  pos: THREE.BufferAttribute;
  used: number;
  geoDirty: boolean;
  boundsDirty: boolean;
}

/** Tile copies per frame (a burst of walls arriving spreads over frames). */
const BLITS_PER_FRAME = 48;

export class FarBatch {
  readonly group = new THREE.Group();
  private pages: Page[] = [];
  private next = 0;
  /** Tiles copied and ms spent copying, since load (?perf, tests). */
  readonly stats = { blits: 0, ms: 0 };
  /** Tiles waiting to be copied (slot number → its cell's canvas). */
  private queue = new Map<number, { slot: Slot; canvas: HTMLCanvasElement }>();
  /** Every tile's canvas, to copy them all again after a lost context. */
  private canvases = new Map<number, { slot: Slot; canvas: HTMLCanvasElement }>();
  private onRestored = () => {
    for (const [n, t] of this.canvases) this.queue.set(n, t);
  };

  constructor(
    private renderer: THREE.WebGLRenderer,
    readonly layout: AtlasLayout,
    private material: () => THREE.MeshStandardMaterial,
  ) {
    this.group.name = 'graffiti-far';
    renderer.domElement.addEventListener('webglcontextrestored', this.onRestored);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Tiles waiting to be copied. */
  get pending(): number {
    return this.queue.size;
  }

  /** A new tile (and its page, the first time one is needed). */
  alloc(): { n: number; slot: Slot } {
    const n = this.next++;
    const slot = slotAt(n, this.layout);
    while (this.pages.length <= slot.page) this.pages.push(this.makePage());
    const p = this.pages[slot.page];
    p.used = Math.max(p.used, slot.index + 1);
    p.mesh.geometry.setDrawRange(0, p.used * 6);
    return { n, slot };
  }

  /** Put tile `slot`'s quad on the wall (shown). */
  place(slot: Slot, origin: V3, u: V3, v: V3, n: V3, w: number, h: number, lift: number) {
    const p = this.pages[slot.page];
    writeQuad(p.pos.array as Float32Array, slot.index * 12, origin, u, v, n, w, h, lift);
    p.geoDirty = true;
    p.boundsDirty = true;
  }

  /** Hide tile `slot` (its cell is drawn sharp on its own mesh). */
  hide(slot: Slot, at: V3) {
    const p = this.pages[slot.page];
    collapseQuad(p.pos.array as Float32Array, slot.index * 12, at);
    p.geoDirty = true;
  }

  /** Copy `canvas` (tile-sized) into tile `n` on the next flush. */
  blit(n: number, slot: Slot, canvas: HTMLCanvasElement) {
    const t = { slot, canvas };
    this.queue.set(n, t);
    this.canvases.set(n, t);
  }

  /** Once a frame: copy queued tiles, regenerate touched pages' mips, push geometry. */
  flush() {
    if (this.queue.size > 0) {
      const t0 = performance.now();
      const byPage: { slot: Slot; canvas: HTMLCanvasElement }[][] = [];
      let k = 0;
      for (const [n, t] of this.queue) {
        if (k++ >= BLITS_PER_FRAME) break;
        this.queue.delete(n);
        // (drawn sharp now: copied when it's far again)
        if (t.canvas.width !== this.layout.tileW) continue;
        (byPage[t.slot.page] ??= []).push(t);
      }
      // Straight texSubImage2D, one bind and one mip build per page: three's
      // copyTextureToTexture reads back five GL parameters per call
      const gl = this.renderer.getContext();
      const state = this.renderer.state;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      byPage.forEach((tiles, page) => {
        const tex = this.pages[page].tex;
        const gt = (this.renderer.properties.get(tex) as { __webglTexture?: WebGLTexture })
          .__webglTexture;
        if (gt === undefined) return;
        state.bindTexture(gl.TEXTURE_2D, gt);
        for (const { slot, canvas } of tiles)
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            slot.x,
            slotGlY(slot, this.layout),
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            canvas,
          );
        gl.generateMipmap(gl.TEXTURE_2D);
        this.stats.blits += tiles.length;
      });
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      state.unbindTexture();
      this.stats.ms += performance.now() - t0;
    }
    for (const p of this.pages) {
      if (p.geoDirty) {
        p.pos.needsUpdate = true;
        p.geoDirty = false;
      }
      if (p.boundsDirty) {
        p.mesh.geometry.computeBoundingSphere();
        p.boundsDirty = false;
      }
    }
  }

  private makePage(): Page {
    const l = this.layout;
    const per = tilesPerPage(l);
    const tex = new THREE.DataTexture(null, l.pageW, l.pageW);
    // Blank until tiles are copied in (WebGL zero-fills the storage)
    tex.source.dataReady = false;
    tex.flipY = true;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(per * 12), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    const normal = new Float32Array(per * 12);
    const uv = new Float32Array(per * 8);
    const index = new Uint16Array(per * 6);
    const pageNo = this.pages.length;
    for (let i = 0; i < per; i++) {
      const [u0, v0, u1, v1] = slotUv(slotAt(pageNo * per + i, l), l);
      uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
      const b = i * 4;
      index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    geo.setAttribute('position', pos);
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    const mat = this.material();
    mat.map = tex;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `graffiti-page:${pageNo}`;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    // Allocate it now, with its mip levels (a first copy with mips off would make it 1 level)
    this.renderer.initTexture(tex);
    return { tex, mesh, pos, used: 0, geoDirty: false, boundsDirty: false };
  }

  /** A tile's normal (set once, when its cell gets the tile). */
  setNormal(slot: Slot, n: V3) {
    const p = this.pages[slot.page];
    const a = p.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    for (let i = 0; i < 4; i++) arr.set([n.x, n.y, n.z], slot.index * 12 + i * 3);
    a.needsUpdate = true;
  }

  dispose() {
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onRestored);
    for (const p of this.pages) {
      p.tex.dispose();
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.pages = [];
    this.queue.clear();
    this.canvases.clear();
    this.group.removeFromParent();
  }
}
