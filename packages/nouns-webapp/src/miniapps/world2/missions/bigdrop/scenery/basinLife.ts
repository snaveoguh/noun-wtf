// ── The Big Drop basin: wildlife and woods on the snowfield ─────────────
//
// A PeakSystem, awake only once you're out on the basin at the bottom
// (terrainBasin.ts). Herds of Noun beasts (basinLifeSim.ts, models in
// animals.ts) wander the snow round you and bolt when a rider, you or an
// NPC, comes through; and stands of snowy pines, snags and boulders dot the
// valleys (the slope's forest stops where the race line does). One
// InstancedMesh per animal kind and per tree kind; instance matrices are
// relative to an anchor (peak coordinates) that's re-placed in local space
// every frame, so the floating origin never has to touch them.

import type { PeakCtx, PeakSystem } from '../contract';

import * as THREE from 'three';

import { toonify } from '../../../render/Toon';
import { hash2, vnoise } from '../../../world/mountain/config';
import { PEAK, peakHeight, peakNormal } from '../../peakTerrain';
import { basinPack } from '../basinRiderSim';
import { BASIN, basinRolling, basinWeight } from '../terrainBasin';
import { coneDepth } from '../terrainPeak';

import { animalGeometry } from './animals';
import {
  ANIMAL_KINDS,
  type AnimalKind,
  type Herd,
  herdGone,
  LIFE,
  spawnHerd,
  stepHerd,
} from './basinLifeSim';
import { deadGeometry, pineGeometry, rockGeometry, sceneryMaterial } from './models';

/** Animals drawn per kind at most. */
const CAP = 48;
/** Trees: grid cell (m), radius round the player (m), re-placed after moving this far (m). */
const TREE = { cell: 55, radius: { low: 700, medium: 1000, high: 1300 }, moveBy: 180, cap: 1400 };
const TREE_KINDS = 3;
const SEED = 0x6c696665;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _n = { x: 0, y: 1, z: 0 };
const _up = new THREE.Vector3();
const AY = new THREE.Vector3(0, 1, 0);

class BasinLife implements PeakSystem {
  private root = new THREE.Group();
  private herds: Herd[] = [];
  private beasts: Record<AnimalKind, THREE.InstancedMesh>;
  private trees: THREE.InstancedMesh[] = [];
  private mats: THREE.Material[] = [];
  /** Peak coordinates the instance matrices are relative to. */
  private anchor = new THREE.Vector3(Infinity, 0, 0);
  private treesAt = new THREE.Vector3(Infinity, 0, 0);
  private awake = false;
  private riders: number[] = [];

  constructor(private ctx: PeakCtx) {
    this.root.name = 'BigDropBasinLife';
    ctx.group.add(this.root);
    const mat = this.material('BigDropBeasts');
    const mk = (kind: AnimalKind) => {
      const m = new THREE.InstancedMesh(animalGeometry(kind), mat, CAP);
      m.name = `BigDropBeasts_${kind}`;
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      this.root.add(m);
      return m;
    };
    this.beasts = { yak: mk('yak'), hare: mk('hare'), penguin: mk('penguin') };
    const tmat = this.material('BigDropBasinTrees');
    const geos = [pineGeometry(true), deadGeometry(), rockGeometry()];
    for (let k = 0; k < TREE_KINDS; k++) {
      const m = new THREE.InstancedMesh(geos[k]!, tmat, TREE.cap);
      m.name = `BigDropBasinTrees_${k}`;
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = k !== 2;
      this.root.add(m);
      this.trees.push(m);
    }
    this.root.visible = false;
  }

  private material(name: string): THREE.Material {
    const mat = sceneryMaterial(name);
    let out: THREE.Material = mat;
    if (this.ctx.toon) {
      // toonify swaps materials per mesh; convert once through a stand-in
      const probe = new THREE.Mesh(new THREE.BoxGeometry(), mat);
      toonify(probe);
      out = probe.material as THREE.Material;
      probe.geometry.dispose();
    }
    this.mats.push(out);
    return out;
  }

  update(dt: number) {
    const ctx = this.ctx;
    const rp = ctx.riderPeak;
    const out = Math.hypot(rp.x, rp.z) - PEAK.pad;
    const awake = out > BASIN.start + 3000;
    if (awake !== this.awake) {
      this.awake = awake;
      this.root.visible = awake;
      this.herds.length = 0;
      this.treesAt.set(Infinity, 0, 0);
      this.anchor.set(Infinity, 0, 0);
    }
    if (!awake) return;
    const p = ctx.game.player;
    const pv = Math.hypot(p.vel.x, p.vel.z);
    const phd = pv > 1 ? Math.atan2(p.vel.x, p.vel.z) : Math.atan2(p.fwd.x, p.fwd.z);
    // Re-anchor (and re-place the trees) after moving far enough
    if (Math.hypot(rp.x - this.treesAt.x, rp.z - this.treesAt.z) > TREE.moveBy) {
      this.anchor.set(rp.x, peakHeight(rp.x, rp.z), rp.z);
      this.treesAt.copy(this.anchor);
      this.placeTrees();
    }
    ctx.toLocal(this.anchor.x, this.anchor.y, this.anchor.z, this.root.position);
    // Herds: top up each kind, recycle the ones left behind
    const want = LIFE.herds[ctx.quality];
    const initial = this.herds.length === 0;
    this.herds = this.herds.filter(h => !herdGone(h, rp.x, rp.z));
    for (const kind of ANIMAL_KINDS) {
      let have = 0;
      for (const h of this.herds) if (h.kind === kind) have++;
      for (; have < want; have++)
        this.herds.push(spawnHerd(kind, rp.x, rp.z, phd, Math.random, initial));
    }
    // Who's riding through: the player and the NPC pack
    const r = this.riders;
    r.length = 0;
    r.push(rp.x, rp.z, pv);
    for (const v of basinPack) r.push(v);
    for (const h of this.herds) stepHerd(h, Math.min(dt, 0.1), r, Math.random);
    this.drawBeasts();
  }

  private drawBeasts() {
    const a = this.anchor;
    const counts: Record<AnimalKind, number> = { yak: 0, hare: 0, penguin: 0 };
    for (const h of this.herds)
      for (const m of h.members) {
        const mesh = this.beasts[m.kind];
        const i = counts[m.kind];
        if (i >= CAP) continue;
        counts[m.kind] = i + 1;
        const y = peakHeight(m.x, m.z);
        let lift = 0;
        let roll = 0;
        let pitch = 0;
        const run = Math.min(1, m.sp / 4);
        if (m.kind === 'hare') lift = Math.abs(Math.sin(m.phase)) * (0.15 + 0.6 * run);
        else if (m.kind === 'yak') {
          lift = Math.abs(Math.sin(m.phase)) * 0.12 * (0.3 + run);
          pitch = Math.sin(m.phase * 2) * 0.05 * run;
        } else if (m.fright > 0 && m.sp > 2.5) {
          // Penguins flop onto their bellies and toboggan
          pitch = Math.PI / 2 - 0.15;
          lift = 0.32;
        } else roll = Math.sin(m.phase) * 0.18;
        // Stand on the snow (its tilt, a little)
        peakNormal(m.x, m.z, _n);
        _up.set(_n.x, _n.y, _n.z);
        _q.setFromUnitVectors(AY, _up).slerp(_qa.identity(), 0.4);
        _e.set(pitch, m.hd, roll, 'YXZ');
        _qa.setFromEuler(_e);
        _q.multiply(_qa);
        _p.set(m.x - a.x, y + lift - a.y, m.z - a.z);
        _s.setScalar(m.quirk);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
      }
    for (const kind of ANIMAL_KINDS) {
      const mesh = this.beasts[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Stands of trees round the anchor: clumped by noise, off the kickers, never on top of you. */
  private placeTrees() {
    const a = this.anchor;
    const R = TREE.radius[this.ctx.quality];
    const C = TREE.cell;
    const counts = [0, 0, 0];
    const i0 = Math.floor((a.x - R) / C);
    const i1 = Math.floor((a.x + R) / C);
    const j0 = Math.floor((a.z - R) / C);
    const j1 = Math.floor((a.z + R) / C);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.15 + 0.7 * hash2(i, j, SEED + 1)) * C;
        const z = (j + 0.15 + 0.7 * hash2(i, j, SEED + 2)) * C;
        if (Math.hypot(x - a.x, z - a.z) > R) continue;
        // Groves: dense in some valleys, empty snowfield in between
        const grove = vnoise(x / 900, z / 900, SEED + 3);
        if (hash2(i, j, SEED + 4) > 0.22 + 0.9 * grove) continue;
        const s = Math.hypot(x, z) - PEAK.pad;
        if (basinWeight(s) < 0.3) continue;
        const base = -coneDepth(s) + basinWeight(s) * basinRolling(x, z);
        const y = peakHeight(x, z);
        // Not on a kicker (the surface is above the plain snowfield there)
        if (Math.abs(y - base) > 0.01) continue;
        const u = hash2(i, j, SEED + 5);
        const k = u < 0.78 ? 0 : u < 0.9 ? 1 : 2;
        if (counts[k]! >= TREE.cap) continue;
        const sc = k === 2 ? 1 + 2.5 * hash2(i, j, SEED + 6) : 0.8 + 0.9 * hash2(i, j, SEED + 6);
        _q.setFromAxisAngle(AY, hash2(i, j, SEED + 7) * Math.PI * 2);
        _p.set(x - a.x, y - a.y - (k === 2 ? 0.3 * sc : 0.4), z - a.z);
        _s.setScalar(sc);
        _m.compose(_p, _q, _s);
        this.trees[k]!.setMatrixAt(counts[k]!, _m);
        counts[k]!++;
      }
    for (let k = 0; k < TREE_KINDS; k++) {
      const m = this.trees[k]!;
      m.count = counts[k]!;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const m of Object.values(this.beasts)) {
      m.geometry.dispose();
      m.dispose();
    }
    for (const m of this.trees) {
      m.geometry.dispose();
      m.dispose();
    }
    for (const m of this.mats) {
      (m.userData.toonSrc as THREE.Material | undefined)?.dispose();
      m.dispose();
    }
  }
}

export const makeBasinLife = (ctx: PeakCtx): PeakSystem => new BasinLife(ctx);
