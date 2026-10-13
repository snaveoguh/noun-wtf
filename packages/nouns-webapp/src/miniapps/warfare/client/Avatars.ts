// ── Nouns on the field: rigged NounCharacters holding paint blasters ───
//
// Reuses world2's NounCharacter (rig, voxel head, toon materials) with the
// board hidden. Arms are posed with a small two-bone IK so both hands hold
// the blaster along the aim direction; paint hits stick to the body as
// blobs in the shooter's colour; getting splatted pops the Noun in a
// burst of paint.

import type { PlayerState } from '../sim/types';
import type { WeaponId } from '../sim/weapons';

import * as THREE from 'three';

import { parseSeedKey, randomSeed } from '@/miniapps/world2/character/NounAppearance';
import { NounCharacter, type CharacterAssets } from '@/miniapps/world2/character/NounCharacter';
import { toonify } from '@/miniapps/world2/render/Toon';

import { bodyHeight } from '../sim/physics';

import { buildBlaster, type Blaster } from './Blasters';

/** World2's rider is ~2.13 m with head; our arena Nouns are ~1.8 m. */
export const AVATAR_SCALE = 0.85;

const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _A = new THREE.Vector3();
const _B = new THREE.Vector3();
const _C = new THREE.Vector3();
const _N = new THREE.Vector3();
const _M = new THREE.Vector3();
const _E = new THREE.Vector3();
const _aimQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();

function aimBone(bone: THREE.Object3D, child: THREE.Object3D, worldDir: THREE.Vector3) {
  const parent = bone.parent;
  if (parent === null) return;
  bone.getWorldPosition(_pa);
  child.getWorldPosition(_pb);
  _dir.subVectors(_pb, _pa);
  if (_dir.lengthSq() < 1e-8) return;
  _dir.normalize();
  _qa.setFromUnitVectors(_dir, worldDir);
  parent.getWorldQuaternion(_qb);
  const inv = _qb.clone().invert();
  bone.quaternion.premultiply(_qb).premultiply(_qa).premultiply(inv);
  bone.updateMatrixWorld(true);
}

function twoBone(
  upper: THREE.Object3D,
  mid: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
) {
  upper.getWorldPosition(_A);
  mid.getWorldPosition(_B);
  end.getWorldPosition(_C);
  const l1 = _A.distanceTo(_B);
  const l2 = _B.distanceTo(_C);
  _N.subVectors(target, _A);
  const raw = _N.length();
  if (raw < 1e-5 || l1 < 1e-5 || l2 < 1e-5) return;
  _N.divideScalar(raw);
  const d = THREE.MathUtils.clamp(raw, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _M.copy(pole).addScaledVector(_N, -pole.dot(_N));
  if (_M.lengthSq() < 1e-8) _M.set(0, -1, 0);
  _M.normalize();
  _E.copy(_N).multiplyScalar(cosA).addScaledVector(_M, sinA).normalize();
  aimBone(upper, mid, _E);
  mid.getWorldPosition(_B);
  _E.subVectors(target, _B).normalize();
  aimBone(mid, end, _E);
}

interface Arm {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
}

const blobGeo = new THREE.SphereGeometry(1, 8, 6);

export class Avatar {
  readonly id: number;
  root = new THREE.Group();
  char: NounCharacter;
  private arms: { l: Arm | null; r: Arm | null } = { l: null, r: null };
  private gun: Blaster | null = null;
  private gunId: WeaponId | null = null;
  private guns = new Map<WeaponId, Blaster>();
  private blobs: THREE.Mesh[] = [];
  private blobMats = new Map<number, THREE.Material>();
  label: HTMLDivElement;
  private color: number;
  private anim = '';
  private popT = -1;
  /** Interpolated feet position from the last two ticks. */
  readonly prev = new THREE.Vector3();
  readonly cur = new THREE.Vector3();
  private prevYaw = 0;
  private curYaw = 0;
  visibleLabel = false;

  constructor(
    p: PlayerState,
    assets: CharacterAssets,
    labelLayer: HTMLElement,
    toon: boolean,
    teamLabel: boolean,
  ) {
    this.id = p.id;
    this.color = p.color;
    this.char = new NounCharacter(parseSeedKey(p.look) ?? randomSeed(), assets);
    this.char.board.visible = false;
    this.char.root.scale.setScalar(AVATAR_SCALE);
    if (toon) toonify(this.char.root);
    this.root.add(this.char.root);
    this.char.root.traverse(o => {
      o.castShadow = true;
    });
    const find = (n: string): THREE.Object3D | null => {
      let hit: THREE.Object3D | null = null;
      this.char.root.traverse(o => {
        if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === n) hit = o;
      });
      return hit;
    };
    for (const s of ['l', 'r'] as const) {
      const upper = find(`upperarm${s}`);
      const fore = find(`forearm${s}`);
      const hand = find(`hand${s}`);
      if (upper !== null && fore !== null && hand !== null) this.arms[s] = { upper, fore, hand };
    }
    this.label = document.createElement('div');
    this.label.className = 'wf-nametag';
    const hex = `#${p.color.toString(16).padStart(6, '0')}`;
    this.label.innerHTML = `<span style="border-color:${hex}">${teamLabel ? '▲ ' : ''}${escapeHtml(p.name)}</span>`;
    this.label.style.display = 'none';
    labelLayer.appendChild(this.label);
    this.cur.set(p.x, p.y, p.z);
    this.prev.copy(this.cur);
    this.curYaw = this.prevYaw = p.yaw;
    this.setWeapon(p.weapon, toon);
  }

  setWeapon(w: WeaponId, toon = true) {
    if (this.gunId === w) return;
    if (this.gun !== null) this.root.remove(this.gun.group);
    let g = this.guns.get(w);
    if (g === undefined) {
      g = buildBlaster(w, this.color, toon);
      g.group.scale.setScalar(1.25);
      this.guns.set(w, g);
    }
    this.gun = g;
    this.gunId = w;
    this.root.add(g.group);
  }

  /** Record the authoritative position after a sim tick. */
  tick(p: PlayerState) {
    this.prev.copy(this.cur);
    this.prevYaw = this.curYaw;
    this.cur.set(p.x, p.y, p.z);
    this.curYaw = p.yaw;
    if (this.prev.distanceToSquared(this.cur) > 9) this.prev.copy(this.cur); // teleport / respawn
  }

  addPaint(p: PlayerState, wx: number, wy: number, wz: number, color: number) {
    let mat = this.blobMats.get(color);
    if (mat === undefined) {
      mat = new THREE.MeshToonMaterial({
        color,
        emissive: new THREE.Color(color).multiplyScalar(0.15),
      });
      this.blobMats.set(color, mat);
    }
    const m = new THREE.Mesh(blobGeo, mat);
    // Into root-local space (root carries position + yaw)
    _v.set(wx, wy, wz);
    this.root.worldToLocal(_v);
    // Pull toward the body axis so blobs sit on the surface
    const h = bodyHeight(p);
    const r = Math.hypot(_v.x, _v.z);
    const want = _v.y > h * 0.55 ? 0.45 : 0.24;
    if (r > 0.01) {
      _v.x *= want / r;
      _v.z *= want / r;
    }
    m.position.copy(_v);
    const s = 0.07 + Math.random() * 0.07;
    m.scale.set(s * 1.4, s, s * 1.4);
    m.lookAt(_v.x * 3, _v.y, _v.z * 3);
    this.root.add(m);
    this.blobs.push(m);
    if (this.blobs.length > 18) {
      const old = this.blobs.shift()!;
      this.root.remove(old);
    }
  }

  clearPaint() {
    for (const b of this.blobs) this.root.remove(b);
    this.blobs = [];
  }

  /** Splatted: pop out of existence. */
  pop() {
    this.popT = 0;
  }

  update(p: PlayerState, alpha: number, dt: number, showSelf: boolean) {
    const alive = p.alive;
    if (!alive && this.popT < 0) this.popT = 0;
    if (alive && this.popT >= 0) {
      this.popT = -1;
      this.clearPaint();
    }
    if (this.popT >= 0) {
      this.popT += dt;
      const k = Math.max(0, 1 - this.popT / 0.18);
      this.root.scale.setScalar(Math.max(0.001, k * (1 + this.popT * 3)));
      this.root.visible = k > 0 && showSelf;
      this.label.style.display = 'none';
      return;
    }
    this.root.visible = showSelf;
    this.root.scale.setScalar(1);
    _v.lerpVectors(this.prev, this.cur, alpha);
    this.root.position.copy(_v);
    let dy = this.curYaw - this.prevYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const yaw = this.prevYaw + dy * alpha;
    this.root.rotation.set(0, yaw, 0);
    // Character faces +Z; our yaw 0 looks down −Z
    this.char.root.rotation.y = Math.PI;
    const crouchK = p.crouched ? 0.72 : 1;
    this.char.root.scale.set(AVATAR_SCALE, AVATAR_SCALE * crouchK, AVATAR_SCALE);
    this.setWeapon(p.weapon);
    if (!showSelf) return;

    // Animation from velocity
    const sp = Math.hypot(p.vx, p.vz);
    const fwd = -Math.sin(p.yaw) * p.vx - Math.cos(p.yaw) * p.vz;
    let clip = 'idle';
    let ts = 1;
    if (!p.grounded) clip = 'jump_air';
    else if (sp > 7.6) {
      clip = 'sprint';
      ts = sp / 8.8;
    } else if (sp > 4.6) {
      clip = 'run';
      ts = sp / 6.2;
    } else if (sp > 0.4) {
      clip = 'walk';
      ts = Math.min(2.2, sp / 2.2);
    }
    if (fwd < -0.5 && clip !== 'idle' && clip !== 'jump_air') ts = -Math.abs(ts);
    if (clip !== this.anim) {
      this.char.play({ clip, fade: 0.15, timeScale: ts });
      this.anim = clip;
    } else this.char.play({ clip, timeScale: ts });
    this.char.update(dt, { lean: 0, travelled: 0, riding: false, grounded: p.grounded });

    // Aim: arms + blaster follow yaw/pitch
    this.root.updateMatrixWorld(true);
    _euler.set(p.pitch, yaw, 0, 'YXZ');
    _aimQ.setFromEuler(_euler);
    const dir = _N.set(0, 0, -1).applyQuaternion(_aimQ).clone();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_aimQ);
    const up = new THREE.Vector3(0, 1, 0);
    const chest = new THREE.Vector3().copy(this.root.position);
    chest.y += bodyHeight(p) * 0.55 * (p.crouched ? 0.9 : 1);
    const handR = chest
      .clone()
      .addScaledVector(dir, 0.36)
      .addScaledVector(right, 0.16)
      .addScaledVector(up, -0.04);
    const handL = chest
      .clone()
      .addScaledVector(dir, 0.62)
      .addScaledVector(right, 0.04)
      .addScaledVector(up, -0.02);
    // Character's right arm is its −X side (glTF faces +Z, left = +X)
    if (this.arms.r !== null)
      twoBone(
        this.arms.r.upper,
        this.arms.r.fore,
        this.arms.r.hand,
        handR,
        right.clone().addScaledVector(up, -0.6),
      );
    if (this.arms.l !== null)
      twoBone(
        this.arms.l.upper,
        this.arms.l.fore,
        this.arms.l.hand,
        handL,
        right.clone().negate().addScaledVector(up, -0.6),
      );
    if (this.gun !== null) {
      // Grip at the right hand, barrel along the aim
      const g = this.gun.group;
      const wp = handR.clone();
      this.root.worldToLocal(wp);
      g.position.copy(wp);
      _qb.setFromEuler(new THREE.Euler(0, yaw, 0));
      g.quaternion.copy(_qb.invert().multiply(_aimQ));
    }
  }

  placeLabel(cam: THREE.Camera, w: number, h: number, show: boolean, p: PlayerState) {
    if (!show || !p.alive) {
      if (this.visibleLabel) {
        this.label.style.display = 'none';
        this.visibleLabel = false;
      }
      return;
    }
    _v.copy(this.root.position);
    _v.y += bodyHeight(p) + 0.35;
    _v.project(cam);
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) {
      if (this.visibleLabel) {
        this.label.style.display = 'none';
        this.visibleLabel = false;
      }
      return;
    }
    const x = (_v.x * 0.5 + 0.5) * w;
    const y = (-_v.y * 0.5 + 0.5) * h;
    this.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    if (!this.visibleLabel) {
      this.label.style.display = 'block';
      this.visibleLabel = true;
    }
  }

  dispose() {
    this.label.remove();
    this.char.dispose();
    for (const m of this.blobMats.values()) m.dispose();
  }
}

function escapeHtml(s: string) {
  return s.replace(
    /["&'<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
