// ── Mission characters in the world: standing Nouns with props + name tags ──
//
// Every character is a NounCharacter built from a real Noun's on-chain seed
// (defs.ts), standing at a fixed spot (the same for everyone), turning to
// face you and waving when you walk up. Props are a handful of plain meshes
// (the Oracle's kitchen table and cookies, the courier's parcel, the
// Keymaker's key board, the door at the bottom of the Noggle Bowl).
//
// Far-off characters (Noun Jersey, the bowl) are only built once you're
// within a few hundred metres and the ground under them has streamed in.

import type { NpcDef } from './defs';

import * as THREE from 'three';

import { type NounSeed } from '../character/NounAppearance';
import { NounCharacter, type CharacterAssets } from '../character/NounCharacter';
import { inkExcluded, toonify } from '../render/Toon';

const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();

export const seedOf = (s: readonly number[]): NounSeed => ({
  background: s[0]!,
  body: s[1]!,
  accessory: s[2]!,
  head: s[3]!,
  glasses: s[4]!,
});

export interface NpcHost {
  scene: THREE.Scene;
  assets: CharacterAssets;
  labelLayer: HTMLElement;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  toon: boolean;
}

/** Talk range (m). */
export const TALK_R = 3.6;
const LABEL_DIST = 70;
const DRAW_DIST = 260;

export class StandingNpc {
  readonly root = new THREE.Group();
  readonly chars: NounCharacter[] = [];
  readonly label: HTMLDivElement;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  /** Something waiting for you here (a "!" on the tag). */
  flag = false;
  /** Kinematic riders (the Twins) drive their own characters. */
  driven = false;
  /**
   * A cutscene's direction (cutscene/CutscenePlayer): face a point and hold a
   * clip instead of the usual turn-and-wave. Null = normal behaviour.
   */
  direct: { look: THREE.Vector3 | null; clip: string | null } | null = null;
  private glowSprite: THREE.Sprite | null = null;
  private glowLocal = new THREE.Vector3();
  private glowK = 0;
  private glowTarget = 0;
  private fixedProps: THREE.Object3D | null = null;
  private waveT = 0;
  private waved = false;
  private lastFlag: boolean | null = null;
  private t = Math.random() * 10;

  constructor(
    readonly def: NpcDef,
    private host: NpcHost,
    opts: {
      props?: THREE.Object3D | null;
      /** Props stay where `placeProps` puts them instead of following the character. */
      fixedProps?: boolean;
      board?: boolean;
      spread?: number;
    } = {},
  ) {
    def.seeds.forEach((s, i) => {
      const ch = new NounCharacter(seedOf(s), host.assets);
      ch.setBoardType('skate');
      ch.board.visible = opts.board === true;
      ch.setWeight(def.weight ?? 0);
      if (host.toon) toonify(ch.root);
      ch.root.position.x = (i - (def.seeds.length - 1) / 2) * (opts.spread ?? 1.3);
      this.root.add(ch.root);
      this.chars.push(ch);
    });
    if (opts.props) {
      if (host.toon) toonify(opts.props);
      if (opts.fixedProps === true) {
        this.fixedProps = opts.props;
        host.scene.add(opts.props);
      } else this.root.add(opts.props);
    }
    host.scene.add(this.root);
    const label = document.createElement('div');
    label.className = 'w2-nametag w2-npctag';
    label.style.display = 'none';
    this.label = label;
    this.renderLabel();
    host.labelLayer.appendChild(label);
  }

  private renderLabel() {
    const ids = this.def.nouns.map(n => `#${n}`).join(' + ');
    const bang = this.flag ? '<b class="w2-npcbang">!</b> ' : '';
    this.label.innerHTML = `<span>${bang}${this.def.name} <i>Noun ${ids}</i></span>`;
    this.lastFlag = this.flag;
  }

  /** Put fixed props (the Twins' start banner) in the world; they don't ride along. */
  placeProps(x: number, y: number, z: number, yaw: number) {
    if (this.fixedProps === null) return;
    this.fixedProps.position.set(x, y, z);
    this.fixedProps.quaternion.setFromAxisAngle(Y, yaw);
  }

  /** Characters face the root's forward (undo any turn towards the player). */
  faceForward() {
    for (const ch of this.chars) ch.root.quaternion.identity();
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromAxisAngle(Y, yaw);
  }

  update(dt: number, player: THREE.Vector3) {
    this.t += dt;
    const cam = this.host.camera;
    const d = cam.position.distanceTo(this.pos);
    this.root.visible = d < DRAW_DIST;
    if (this.flag !== this.lastFlag) this.renderLabel();
    // Label
    let show = d < LABEL_DIST;
    if (show) {
      const v = _p.copy(this.pos);
      v.y += 2.15;
      v.project(cam);
      show = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      if (show) {
        const w = this.host.canvas.clientWidth;
        const h = this.host.canvas.clientHeight;
        this.label.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      }
    }
    const disp = show ? 'block' : 'none';
    if (this.label.style.display !== disp) this.label.style.display = disp;
    this.updateGlow(dt);
    if (!this.root.visible || this.driven) return;
    const dir = this.direct;
    if (dir !== null) {
      for (const ch of this.chars) {
        if (dir.look !== null) {
          const want = Math.atan2(dir.look.x - this.pos.x, dir.look.z - this.pos.z) - this.yaw;
          _q.setFromAxisAngle(Y, want);
          ch.root.quaternion.slerp(_q, 1 - Math.exp(-5 * dt));
        }
        ch.play({ clip: dir.clip ?? 'idle', fade: 0.3 });
        ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
      }
      return;
    }
    // Face the player when they're close, wave once
    const dx = player.x - this.pos.x;
    const dz = player.z - this.pos.z;
    const near = dx * dx + dz * dz < 9 * 9;
    if (near && !this.waved) {
      this.waved = true;
      this.waveT = 2.4;
    } else if (!near && dx * dx + dz * dz > 14 * 14) this.waved = false;
    this.waveT -= dt;
    for (const ch of this.chars) {
      const want = near ? Math.atan2(dx, dz) - this.yaw : 0;
      _q.setFromAxisAngle(Y, want);
      ch.root.quaternion.slerp(_q, 1 - Math.exp(-4 * dt));
      ch.play({ clip: this.waveT > 0 ? 'wave' : 'idle', fade: 0.3 });
      ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
    }
  }

  /** Light the crystal ball (the Oracle's head) towards k (0..1); it eases there. */
  glowTo(k: number) {
    this.glowTarget = Math.max(0, Math.min(1, k));
    if (this.glowTarget > 0 && this.glowSprite === null) this.makeGlow();
  }

  private makeGlow() {
    const head = this.chars[0]?.head;
    const box = new THREE.Box3();
    this.root.updateMatrixWorld(true);
    if (head) box.setFromObject(head);
    if (box.isEmpty()) this.glowLocal.set(0, 1.8, 0);
    else this.root.worldToLocal(box.getCenter(this.glowLocal));
    const tex = canvasTex(128, 128, c => {
      const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(190,150,255,0.85)');
      g.addColorStop(0.6, 'rgba(110,80,255,0.25)');
      g.addColorStop(1, 'rgba(80,40,200,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    });
    const m = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // A halo over the whole ball, not hidden inside it
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const sp = new THREE.Sprite(m);
    sp.renderOrder = 5;
    inkExcluded.add(sp);
    this.host.scene.add(sp);
    this.glowSprite = sp;
  }

  private updateGlow(dt: number) {
    const sp = this.glowSprite;
    if (sp === null) return;
    this.glowK += (this.glowTarget - this.glowK) * (1 - Math.exp(-2.2 * dt));
    const k = this.glowK;
    sp.visible = k > 0.01 && this.root.visible;
    if (!sp.visible) return;
    sp.position.copy(this.glowLocal);
    this.root.localToWorld(sp.position);
    const pulse = 1 + 0.08 * Math.sin(this.t * 5.3) + 0.04 * Math.sin(this.t * 13.1);
    sp.scale.setScalar(2.4 * pulse * (0.6 + 0.4 * k));
    (sp.material as THREE.SpriteMaterial).opacity = 0.7 * k;
  }

  /** Feet within talk range? */
  inRange(p: THREE.Vector3, r = TALK_R) {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < r && Math.abs(p.y - this.pos.y) < 3;
  }

  dispose() {
    if (this.glowSprite !== null) {
      this.host.scene.remove(this.glowSprite);
      inkExcluded.delete(this.glowSprite);
      const m = this.glowSprite.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.dispose();
      this.glowSprite = null;
    }
    for (const ch of this.chars) ch.dispose();
    this.host.scene.remove(this.root);
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || this.chars.some(c => isUnder(o, c.root))) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.label.remove();
  }
}

function isUnder(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p !== null; p = p.parent) if (p === root) return true;
  return false;
}

// ── Props ──────────────────────────────────────────────────────────────

const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  if (c) draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A painted sign board on two legs, text facing +Z. */
function sign(lines: string[], opts: { w?: number; h?: number; bg?: string; fg?: string } = {}) {
  const g = new THREE.Group();
  const w = opts.w ?? 1.5;
  const h = opts.h ?? 0.8;
  const tex = canvasTex(512, Math.round((512 * h) / w), c => {
    const W = c.canvas.width;
    const H = c.canvas.height;
    c.fillStyle = opts.bg ?? '#111';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = opts.fg ?? '#ffd400';
    c.lineWidth = 10;
    c.strokeRect(10, 10, W - 20, H - 20);
    c.fillStyle = opts.fg ?? '#ffd400';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    lines.forEach((l, i) => {
      const big = i === 0;
      c.font = `${big ? 'bold 62px' : '38px'} system-ui, sans-serif`;
      c.fillText(l, W / 2, (H * (i + 1)) / (lines.length + 1) + (big ? -4 : 6));
    });
  });
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  board.position.y = 1.15 + h / 2;
  g.add(board);
  const wood = mat(0x5a3b22);
  g.add(box(0.06, 1.2 + h, 0.06, wood, -w / 2 + 0.1, (1.2 + h) / 2, -0.03));
  g.add(box(0.06, 1.2 + h, 0.06, wood, w / 2 - 0.1, (1.2 + h) / 2, -0.03));
  inkExcluded.add(board);
  return g;
}

/** The Oracle's kitchen: table, gingham cloth, a plate of cookies, a teapot, a chair, her sign. */
export function oracleProps(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(0x6b4a2b);
  // Table in front of her (she stands at the origin facing +Z)
  const tz = 0.85;
  const cloth = canvasTex(128, 128, c => {
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++) {
        c.fillStyle = (i + j) % 2 === 0 ? '#e9e4d8' : '#2f8f4e';
        c.fillRect(i * 16, j * 16, 16, 16);
      }
  });
  cloth.wrapS = cloth.wrapT = THREE.RepeatWrapping;
  cloth.repeat.set(2, 1.2);
  g.add(box(1.5, 0.05, 0.85, mat(0xffffff, { map: cloth }), 0, 0.78, tz));
  for (const [lx, lz] of [
    [-0.68, tz - 0.36],
    [0.68, tz - 0.36],
    [-0.68, tz + 0.36],
    [0.68, tz + 0.36],
  ] as const)
    g.add(box(0.07, 0.76, 0.07, wood, lx, 0.38, lz));
  // Plate + cookies (chocolate chips as dark dots)
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.025, 20), mat(0xf4f1ea));
  plate.position.set(-0.25, 0.82, tz + 0.05);
  g.add(plate);
  const dough = mat(0xc98a42);
  const chip = mat(0x3a2414);
  const cookieGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.022, 14);
  const chipGeo = new THREE.SphereGeometry(0.012, 5, 4);
  const spots: [number, number, number][] = [
    [-0.31, 0.845, tz + 0.02],
    [-0.19, 0.845, tz + 0.1],
    [-0.22, 0.845, tz - 0.06],
    [-0.27, 0.868, tz + 0.04],
  ];
  for (const [x, y, z] of spots) {
    const ck = new THREE.Mesh(cookieGeo, dough);
    ck.position.set(x, y, z);
    ck.rotation.z = (x * 13) % 0.2;
    ck.castShadow = true;
    g.add(ck);
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(chipGeo, chip);
      c.position.set(x + Math.cos(k * 1.9) * 0.04, y + 0.012, z + Math.sin(k * 1.9) * 0.04);
      g.add(c);
    }
  }
  // Teapot-ish: a squat sphere, a lid knob, a spout
  const pot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10), mat(0x2b2b2b));
  pot.scale.y = 0.8;
  pot.position.set(0.3, 0.89, tz);
  g.add(pot);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.14, 8), mat(0x2b2b2b));
  spout.position.set(0.42, 0.92, tz);
  spout.rotation.z = -0.9;
  g.add(spout);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.07, 12), mat(0xf4f1ea));
  cup.position.set(0.08, 0.84, tz + 0.2);
  g.add(cup);
  // A chair for visitors, across the table
  const chair = new THREE.Group();
  chair.add(box(0.45, 0.05, 0.45, wood, 0, 0.46, 0));
  for (const [lx, lz] of [
    [-0.19, -0.19],
    [0.19, -0.19],
    [-0.19, 0.19],
    [0.19, 0.19],
  ] as const)
    chair.add(box(0.05, 0.46, 0.05, wood, lx, 0.23, lz));
  chair.add(box(0.45, 0.5, 0.05, wood, 0, 0.73, 0.2));
  // (set off to the side, so it never hides her)
  chair.position.set(1.15, 0, tz + 0.35);
  chair.rotation.y = -1.2;
  g.add(chair);
  // Her sign, to her right, angled toward visitors
  const s = sign(['⌐◨-◨ ORACLE', 'know thyself'], { w: 1.4, h: 0.7, bg: '#14110d', fg: '#ffd400' });
  s.position.set(-1.6, 0, 0.5);
  s.rotation.y = 0.45;
  g.add(s);
  return g;
}

/** The Keymaker's board of keys. */
export function keymakerProps(): THREE.Group {
  const g = new THREE.Group();
  const board = box(1.2, 0.9, 0.05, mat(0x3c2a1a), 0, 1.4, -0.6);
  g.add(board);
  const brass = mat(0xc9a23a, { metalness: 0.7, roughness: 0.35 });
  const ring = new THREE.TorusGeometry(0.05, 0.012, 6, 14);
  for (let i = 0; i < 12; i++) {
    const x = -0.45 + (i % 6) * 0.18;
    const y = 1.62 - Math.floor(i / 6) * 0.42;
    const r = new THREE.Mesh(ring, brass);
    r.position.set(x, y, -0.56);
    g.add(r);
    g.add(box(0.025, 0.2, 0.012, brass, x, y - 0.15, -0.56));
    g.add(box(0.05, 0.025, 0.012, brass, x + 0.02, y - 0.22 + (i % 3) * 0.03, -0.56));
  }
  g.add(box(0.06, 1.85, 0.06, mat(0x3c2a1a), -0.55, 0.92, -0.62));
  g.add(box(0.06, 1.85, 0.06, mat(0x3c2a1a), 0.55, 0.92, -0.62));
  return g;
}

/** The courier's parcel (on the ground beside them). */
export function parcelProps(): THREE.Group {
  const g = new THREE.Group();
  const card = mat(0xb98b55);
  g.add(box(0.55, 0.4, 0.45, card, 0.9, 0.2, 0.2));
  g.add(box(0.56, 0.05, 0.08, mat(0xe9d9b5), 0.9, 0.4, 0.2));
  g.add(box(0.4, 0.3, 0.35, card, 0.95, 0.55, 0.2));
  return g;
}

/** The Twins' start line: a chequered banner across two poles. */
export function twinsProps(): THREE.Group {
  const g = new THREE.Group();
  const tex = canvasTex(256, 64, c => {
    for (let i = 0; i < 16; i++)
      for (let j = 0; j < 4; j++) {
        c.fillStyle = (i + j) % 2 === 0 ? '#111' : '#fff';
        c.fillRect(i * 16, j * 16, 16, 16);
      }
  });
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 0.6),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  // Across the alley (the Twins stand side by side along local x)
  banner.position.set(0, 3.1, -0.6);
  g.add(banner);
  inkExcluded.add(banner);
  const pole = mat(0xd0d0d0, { metalness: 0.5, roughness: 0.4 });
  g.add(box(0.08, 3.4, 0.08, pole, -2.3, 1.7, -0.6));
  g.add(box(0.08, 3.4, 0.08, pole, 2.3, 1.7, -0.6));
  return g;
}

/** The deepest door: a free-standing frame whose inside is a dark red glow. */
export function doorProp(): { group: THREE.Group; glow: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  const frame = mat(0x2a1b12);
  g.add(box(0.15, 2.5, 0.2, frame, -0.68, 1.25, 0));
  g.add(box(0.15, 2.5, 0.2, frame, 0.68, 1.25, 0));
  g.add(box(1.5, 0.16, 0.2, frame, 0, 2.55, 0));
  const glow = new THREE.MeshBasicMaterial({
    color: 0x9a0f1c,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 2.42), glow);
  inner.position.y = 1.23;
  g.add(inner);
  inkExcluded.add(inner);
  const s = sign(['⌀', 'the deepest door'], { w: 0.9, h: 0.45, bg: '#0a0a0a', fg: '#c81d25' });
  s.position.set(1.4, 0, 0.3);
  s.rotation.y = -0.3;
  s.scale.setScalar(0.8);
  g.add(s);
  return { group: g, glow };
}
