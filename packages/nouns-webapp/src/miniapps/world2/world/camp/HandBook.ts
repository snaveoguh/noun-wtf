// ── A copy of MEME VALUE in the rider's hands (the opening's last beat) ───
//
// An open book held at chest height (reading.ts places it), its pages the
// book's own page images: a spread (two pages on one small canvas) and a
// turning page hinged on the spine (its front the old right page, its back
// the new left page). The rider's arms and head are posed onto it through
// the same PoseDriver parkour uses. Then it's tossed: it leaves the hands,
// tumbles and lies open on the floor, where it stays.

import type { V3 } from './intro';
import type { NounCharacter } from '../../character/NounCharacter';

import * as THREE from 'three';

import { stand, type PoseSpec } from '../../breakdance/view/pose';
import { PoseDriver } from '../../breakdance/view/rig';
import { textureDiet } from '../../render/textureDiet';

import { BOOK_AT, BOOK_TILT, riderToWorld, tossAt } from './reading';

const PAGE = 0.25;
/** The turning page's rest height over the spread (m). */
const LEAF_Y = 0.012;
const PAGE_URL = (n: number) => `/books/meme-value/sm/p${String(n).padStart(3, '0')}.webp`;

/** Reading: hands either side of the book at `at` (rider frame), head kept upright. */
function readingPose(at: V3): PoseSpec {
  const s = stand();
  const [bx, by, bz] = at;
  s.arms = [
    {
      at: new THREE.Vector3(bx + 0.17, by - 0.03, bz - 0.02),
      pole: new THREE.Vector3(1, -0.7, -0.3),
    },
    {
      at: new THREE.Vector3(bx - 0.17, by - 0.03, bz - 0.02),
      pole: new THREE.Vector3(-1, -0.7, -0.3),
    },
  ];
  // Upright: a Noun's head is up to ~1.8 m tall, so tipping it onto the
  // book swings its front edge a metre forward, straight into the shot
  s.spine.set(0, 0, 0);
  s.neck.set(0, 0, 0);
  return s;
}

export class HandBook {
  readonly group = new THREE.Group();
  private readonly spreadCanvas: HTMLCanvasElement;
  private readonly spreadTex: THREE.CanvasTexture;
  private readonly front: { c: HTMLCanvasElement; t: THREE.CanvasTexture };
  private readonly back: { c: HTMLCanvasElement; t: THREE.CanvasTexture };
  private readonly turn = new THREE.Group();
  private readonly pages = new Map<number, HTMLImageElement>();
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private driver: PoseDriver | null = null;
  private driverHead: THREE.Object3D | null = null;
  private readonly pose: PoseSpec;
  private readonly px: number;
  /** Where it lies once tossed (world), so it stays put. */
  private rest: { at: V3; yaw: number } | null = null;

  constructor(
    private readonly spreads: number[],
    private readonly floorY: number,
    /** Where it's held (rider frame): just in front of this rider's face. */
    private readonly at: V3 = BOOK_AT,
  ) {
    this.pose = readingPose(at);
    this.px = textureDiet.on ? 128 : 256;
    const mk = (w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return { c, t };
    };
    const sp = mk(this.px * 2, this.px);
    this.spreadCanvas = sp.c;
    this.spreadTex = sp.t;
    this.front = mk(this.px, this.px);
    this.back = mk(this.px, this.px);
    const basic = (map: THREE.Texture) => {
      const m = new THREE.MeshBasicMaterial({ map, toneMapped: false, color: 0xe8e4dc });
      this.mats.push(m);
      return m;
    };
    const plane = (w: number, h: number) => {
      const g = new THREE.PlaneGeometry(w, h);
      this.geos.push(g);
      return g;
    };
    // The open spread, face up in the book's frame (y up = out of the pages)
    const spread = new THREE.Mesh(plane(PAGE * 2, PAGE), basic(this.spreadTex));
    spread.rotation.x = -Math.PI / 2;
    spread.position.y = 0.003;
    // Covers under it (white, like the real copies), a spine
    const coverMat = new THREE.MeshBasicMaterial({ color: 0xf2f0ea });
    this.mats.push(coverMat);
    const coverGeo = new THREE.BoxGeometry(PAGE * 2 + 0.012, 0.012, PAGE + 0.012);
    this.geos.push(coverGeo);
    const cover = new THREE.Mesh(coverGeo, coverMat);
    cover.position.y = -0.004;
    // The turning page: hinged on the spine (x = 0), lying over the right page at rest
    const f = new THREE.Mesh(plane(PAGE, PAGE), basic(this.front.t));
    f.rotation.x = -Math.PI / 2;
    f.position.set(PAGE / 2, 0, 0);
    const b = new THREE.Mesh(plane(PAGE, PAGE), basic(this.back.t));
    b.rotation.set(Math.PI / 2, 0, Math.PI);
    b.position.set(PAGE / 2, 0, 0);
    this.turn.add(f, b);
    this.turn.visible = false;
    this.group.add(cover, spread, this.turn);
    this.group.name = 'CampHandBook';
    for (const m of this.group.children) (m as THREE.Mesh).castShadow = false;
    // Fetch every page it'll show (two per spread)
    for (const p of spreads)
      for (const n of [p, p + 1]) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => this.redraw();
        img.src = PAGE_URL(n);
        this.pages.set(n, img);
      }
    this.paintSpread(spreads[0]!, spreads[0]! + 1);
  }

  private page(c: CanvasRenderingContext2D, n: number, x: number) {
    const img = this.pages.get(n);
    c.fillStyle = '#fbfaf6';
    c.fillRect(x, 0, this.px, this.px);
    if (img !== undefined && img.complete && img.naturalWidth > 0)
      c.drawImage(img, x, 0, this.px, this.px);
  }

  private shown: [number, number] = [0, 0];
  private paintSpread(left: number, right: number) {
    this.shown = [left, right];
    const c = this.spreadCanvas.getContext('2d')!;
    this.page(c, left, 0);
    this.page(c, right, this.px);
    c.fillStyle = 'rgba(0,0,0,0.12)';
    c.fillRect(this.px - 2, 0, 4, this.px);
    this.spreadTex.needsUpdate = true;
  }

  private paintTurn(front: number, back: number) {
    this.page(this.front.c.getContext('2d')!, front, 0);
    this.page(this.back.c.getContext('2d')!, back, 0);
    this.front.t.needsUpdate = true;
    this.back.t.needsUpdate = true;
  }

  /** A page image arrived: repaint whatever's showing. */
  private redraw() {
    this.paintSpread(...this.shown);
  }

  /**
   * Held and read, `k` spreads in (k = 0…n−1), `turning` 0…1 through the
   * turn to spread k (or −1 when not turning). Poses the rider onto it.
   */
  hold(ch: NounCharacter, pos: V3, yaw: number, k: number, turning: number, dt: number) {
    // The page images: the spread underneath, and the turning leaf
    const cur = this.spreads[Math.max(0, k)]!;
    if (turning >= 0 && k > 0) {
      const prev = this.spreads[k - 1]!;
      if (this.shown[0] !== prev || this.shown[1] !== cur + 1) {
        this.paintSpread(prev, cur + 1);
        this.paintTurn(prev + 1, cur);
      }
      this.turn.visible = true;
      // Lift, over the spine, down onto the left (eased)
      const e = turning * turning * (3 - 2 * turning);
      this.turn.rotation.z = Math.PI * e;
      // Well clear of the spread underneath (a 2 mm gap flickered), and
      // lifting a little as it goes over
      this.turn.position.y = LEAF_Y + 0.03 * Math.sin(Math.PI * e);
    } else {
      if (this.shown[0] !== cur) this.paintSpread(cur, cur + 1);
      this.turn.visible = false;
    }
    // In the hands, tilted toward the face
    const at = riderToWorld(pos, yaw, ...this.at);
    this.group.position.set(...at);
    this.group.rotation.set(0, 0, 0);
    this.group.rotateY(yaw);
    this.group.rotateX(-BOOK_TILT);
    this.group.rotateY(Math.PI);
    this.poseRider(ch, dt, 1);
  }

  /** Tossed `t` s ago from a rider at `pos` facing `yaw`; returns true once it's lying still. */
  toss(ch: NounCharacter, pos: V3, yaw: number, t: number, dt: number): boolean {
    this.turn.visible = false;
    if (this.rest !== null) return true;
    const s = tossAt(t, this.at);
    const at = riderToWorld(pos, yaw, ...s.at);
    at[1] = this.floorY + s.at[1];
    this.group.position.set(...at);
    this.group.rotation.set(0, 0, 0);
    this.group.rotateY(yaw + s.spin * 2.4);
    // Tumbles over once and a half, landing open and face up
    this.group.rotateX(-BOOK_TILT * (1 - s.spin) + Math.PI * 2 * s.spin);
    this.group.rotateZ(0.5 * Math.sin(s.spin * Math.PI));
    // The arms let go over the first part of the throw
    this.poseRider(ch, dt, Math.max(0, 1 - t / 0.3));
    if (s.landed) {
      this.rest = { at, yaw: yaw + 2.4 };
      this.poseRider(ch, dt, 0);
      return true;
    }
    return false;
  }

  /** Straight to the floor (the shot was skipped). */
  drop(ch: NounCharacter | null, pos: V3, yaw: number) {
    if (this.rest === null) {
      const s = tossAt(99, this.at);
      const at = riderToWorld(pos, yaw, ...s.at);
      at[1] = this.floorY + s.at[1];
      this.rest = { at, yaw: yaw + 2.4 };
    }
    this.turn.visible = false;
    this.group.position.set(...this.rest.at);
    this.group.rotation.set(0, this.rest.yaw, 0);
    if (ch !== null) this.poseRider(ch, 0, 0);
  }

  private poseRider(ch: NounCharacter, dt: number, w: number) {
    if (!ch.hasRig) return;
    if (this.driver === null || this.driverHead !== ch.head) {
      this.driver = new PoseDriver(ch.root, ch.body, ch.body, ch.head);
      this.driverHead = ch.head;
    }
    if (!this.driver.ok) return;
    this.driver.drive(dt, [{ out: this.pose, w: 1 }], w);
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    for (const t of [this.spreadTex, this.front.t, this.back.t]) t.dispose();
    this.group.removeFromParent();
  }
}
