// ── The aiming guide: line to first contact, ghost ball, where they go ──
//
// Flat strips on the cloth (always readable, any camera): the cue ball's
// path to the first thing it meets, a ring for the ghost ball, then the
// object ball's line and the cue ball's tangent line (a stun read). Pro
// mode (and the hard CPU's frames) cuts it short: a stub of the aim line,
// no ghost, no object line. Plus pocket rings for calling the 8, and the
// ball-in-hand ring under the cue ball.

import type { AimHit } from '../sim/aim';

import * as THREE from 'three';

import { POCKETS, R } from '../sim/table';

const UP = 0.0012;

function strip(color: number, opacity: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 5;
  mesh.visible = false;
  return mesh;
}

function ring(r0: number, r1: number, color: number, opacity: number): THREE.Mesh {
  const g = new THREE.RingGeometry(r0, r1, 28).rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 5;
  mesh.visible = false;
  return mesh;
}

export class AimGuide {
  readonly group = new THREE.Group();
  private aimLine = strip(0xffffff, 0.75);
  private objLine = strip(0xffe14d, 0.85);
  private cueLine = strip(0xffffff, 0.35);
  private railLine = strip(0xffffff, 0.35);
  private ghost = ring(R * 0.86, R, 0xffffff, 0.9);
  private hand = ring(R * 1.15, R * 1.45, 0x6cf0ff, 0.9);
  private pockets: THREE.Mesh[] = [];
  private feltY: number;

  constructor(feltY: number) {
    this.feltY = feltY;
    this.group.name = 'pool-guide';
    for (const m of [
      this.aimLine,
      this.objLine,
      this.cueLine,
      this.railLine,
      this.ghost,
      this.hand,
    ])
      this.group.add(m);
    for (const p of POCKETS) {
      const m = ring(0.05, 0.062, 0xffe14d, 0.95);
      m.position.set(p.aim.x + p.nx * 0.02, feltY + 0.05, p.aim.y + p.ny * 0.02);
      this.pockets.push(m);
      this.group.add(m);
    }
  }

  /** Every mesh (so the ink pass can skip them). */
  meshes(): THREE.Object3D[] {
    return [...this.group.children];
  }

  private line(m: THREE.Mesh, ax: number, az: number, bx: number, bz: number, w: number) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-4) {
      m.visible = false;
      return;
    }
    m.visible = true;
    m.position.set(ax, this.feltY + UP, az);
    m.rotation.set(0, -Math.atan2(dz, dx), 0);
    m.scale.set(len, 1, w);
  }

  /** Show the read for a cue ball at (cx, cz) aimed along (dx, dz). */
  show(
    cx: number,
    cz: number,
    dx: number,
    dz: number,
    hit: AimHit | null,
    pro: boolean,
    objectAt: { x: number; y: number } | null,
  ) {
    const w = 0.0045;
    const reach = hit?.t ?? 2.4;
    const len = pro ? Math.min(reach, 0.32) : reach;
    this.line(this.aimLine, cx, cz, cx + dx * len, cz + dz * len, w);
    this.objLine.visible = false;
    this.cueLine.visible = false;
    this.railLine.visible = false;
    this.ghost.visible = false;
    if (pro || hit === null) return;
    if (hit.kind === 'ball') {
      this.ghost.visible = true;
      this.ghost.position.set(hit.ghost.x, this.feltY + UP, hit.ghost.y);
      if (objectAt !== null) {
        const ol = 0.34 * Math.max(0.25, Math.cos(hit.cut));
        this.line(
          this.objLine,
          objectAt.x,
          objectAt.y,
          objectAt.x + hit.obj.x * ol,
          objectAt.y + hit.obj.y * ol,
          w * 1.2,
        );
      }
      if (hit.cue.x !== 0 || hit.cue.y !== 0) {
        const cl = 0.18 * Math.sin(hit.cut);
        this.line(
          this.cueLine,
          hit.ghost.x,
          hit.ghost.y,
          hit.ghost.x + hit.cue.x * cl,
          hit.ghost.y + hit.cue.y * cl,
          w,
        );
      }
    } else {
      this.ghost.visible = true;
      this.ghost.position.set(hit.at.x, this.feltY + UP, hit.at.y);
      this.line(
        this.railLine,
        hit.at.x,
        hit.at.y,
        hit.at.x + hit.out.x * 0.25,
        hit.at.y + hit.out.y * 0.25,
        w,
      );
    }
  }

  hideAim() {
    for (const m of [this.aimLine, this.objLine, this.cueLine, this.railLine, this.ghost])
      m.visible = false;
  }

  /** The ball-in-hand ring under the cue ball (red when the spot's no good). */
  showHand(x: number, z: number, ok: boolean | null) {
    if (ok === null) {
      this.hand.visible = false;
      return;
    }
    this.hand.visible = true;
    this.hand.position.set(x, this.feltY + UP, z);
    (this.hand.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x6cf0ff : 0xff4a3d);
  }

  /** Pocket rings while calling the 8: `called` lit, the rest dim; null hides them. */
  showPockets(called: number | null, on: boolean, t: number) {
    this.pockets.forEach((m, i) => {
      m.visible = on;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = i === called ? 0.95 : 0.3;
      const s = i === called ? 1 + Math.sin(t * 6) * 0.08 : 1;
      m.scale.set(s, 1, s);
    });
  }

  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.group.removeFromParent();
  }
}
