// ── NOUN PARKOUR in the scene: gates, course props, the ghost ────────────

import type { CourseProp, Route } from './routes';
import type { CollisionWorld } from '../../physics/Collision';
import type { GhostFrame } from '../sim/route';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { NounCharacter, type CharacterAssets } from '../../character/NounCharacter';
import { ANIM_BY_CODE, NO_ANIM, type PkAnim } from '../contract';
import { ParkourRig } from '../view/ParkourRig';

const COURSE_COLLIDER = 'parkour-course';

// ── Checkpoint gates ────────────────────────────────────────────────────

/**
 * A ring standing where you pass, a beam of light up through it so it reads
 * from rooftops away, and a number. The next gate is bright, the one after
 * it faint, the rest hidden.
 */
export class Gates {
  readonly group = new THREE.Group();
  private gates: {
    root: THREE.Group;
    ring: THREE.Mesh;
    beam: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    beamMat: THREE.MeshBasicMaterial;
  }[] = [];
  private t = 0;
  private next = 0;

  constructor(route: Route) {
    this.group.name = 'parkour-gates';
    const col = new THREE.Color(route.color);
    const cps = route.checkpoints;
    cps.forEach((c, i) => {
      const root = new THREE.Group();
      root.position.set(c.x, c.y, c.z);
      // Face along the route (from the previous checkpoint / the start)
      const prev = i === 0 ? route.start : cps[i - 1];
      root.rotation.y = Math.atan2(c.x - prev.x, c.z - prev.z);
      const last = i === cps.length - 1;
      const mat = new THREE.MeshBasicMaterial({
        color: last ? 0xffd400 : col,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(c.r * 0.92, 0.09, 8, 40), mat);
      root.add(ring);
      const beamMat = new THREE.MeshBasicMaterial({
        color: last ? 0xffd400 : col,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 12, 1, true), beamMat);
      beam.position.y = 30 - c.r;
      root.add(beam);
      this.group.add(root);
      this.gates.push({ root, ring, beam, mat, beamMat });
    });
    this.setNext(0);
  }

  setNext(i: number) {
    this.next = i;
    this.gates.forEach((g, k) => {
      g.root.visible = k === i || k === i + 1;
      g.mat.opacity = k === i ? 0.95 : 0.3;
      g.beamMat.opacity = k === i ? 0.22 : 0.06;
    });
  }

  update(dt: number) {
    this.t += dt;
    const g = this.gates[this.next];
    if (g === undefined) return;
    const s = 1 + Math.sin(this.t * 5) * 0.06;
    g.ring.scale.set(s, s, s);
    g.ring.rotation.z += dt * 0.8;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}

// ── Course props ────────────────────────────────────────────────────────

/** Builds a route's props in the scene and adds them to the collision while it runs. */
export class CourseProps {
  readonly group = new THREE.Group();
  private hasCollider = false;

  constructor(
    props: CourseProp[],
    private world: CollisionWorld,
  ) {
    this.group.name = 'parkour-props';
    const geos: THREE.BufferGeometry[] = [];
    const wood = new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x3a3f4a,
      roughness: 0.4,
      metalness: 0.6,
    });
    for (const p of props) {
      let mesh: THREE.Mesh;
      if (p.k === 'box') {
        const mat =
          p.color !== undefined
            ? new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.7 })
            : wood;
        mesh = new THREE.Mesh(new THREE.BoxGeometry(p.sx, p.sy, p.sz), mat);
        mesh.position.set(p.x, p.y, p.z);
        mesh.rotation.y = p.ry ?? 0;
      } else {
        const h = p.y1 - p.y0;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.r ?? 0.07, p.r ?? 0.07, h, 10), metal);
        mesh.position.set(p.x, p.y0 + h / 2, p.z);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      mesh.updateMatrixWorld(true);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', mesh.geometry.attributes.position.clone());
      if (mesh.geometry.index !== null) g.setIndex(mesh.geometry.index.clone());
      g.applyMatrix4(mesh.matrixWorld);
      geos.push(g.index !== null ? g.toNonIndexed() : g);
    }
    if (geos.length > 0) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (merged !== null) {
        world.setDynamic(COURSE_COLLIDER, merged);
        this.hasCollider = true;
      }
    }
  }

  dispose() {
    if (this.hasCollider) this.world.setDynamic(COURSE_COLLIDER, null);
    this.group.removeFromParent();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}

// ── The ghost ───────────────────────────────────────────────────────────

/** Your best run: a see-through Noun replaying it, parkour poses and all. */
export class Ghost {
  readonly ch: NounCharacter;
  private rig: ParkourRig;
  private last = new THREE.Vector3();
  private hasLast = false;
  private anim: PkAnim = { ...NO_ANIM };

  constructor(seed: ConstructorParameters<typeof NounCharacter>[0], assets: CharacterAssets) {
    this.ch = new NounCharacter(seed, assets);
    this.ch.board.visible = false;
    this.ch.setCastShadows(false);
    this.ch.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const ghosted = mats.map(mt => {
        const c = mt.clone() as THREE.MeshStandardMaterial;
        c.transparent = true;
        c.opacity = 0.38;
        c.depthWrite = false;
        if (c.color !== undefined) c.color.lerp(new THREE.Color(0x7fe7ff), 0.55);
        if (c.emissive !== undefined) c.emissive.set(0x1a6f88);
        return c;
      });
      m.material = Array.isArray(m.material) ? ghosted : ghosted[0];
      m.renderOrder = 2;
    });
    this.rig = new ParkourRig(this.ch);
  }

  show(dt: number, f: GhostFrame | null) {
    const r = this.ch.root;
    r.visible = f !== null;
    if (f === null) {
      this.hasLast = false;
      return;
    }
    r.position.set(f.x, f.y, f.z);
    r.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw);
    const speed = this.hasLast && dt > 0 ? this.last.distanceTo(r.position) / dt : 0;
    this.last.copy(r.position);
    this.hasLast = true;
    // The recorder stores code × side (a right-hand wall run is negative)
    const kind = ANIM_BY_CODE[Math.abs(f.anim)] ?? 'none';
    this.anim.kind = kind;
    this.anim.phase = f.phase;
    this.anim.side = f.anim < 0 ? -1 : 1;
    this.anim.amt = kind === 'climb' ? 1 : 0;
    const clip = speed > 5.6 ? 'sprint' : speed > 2.6 ? 'run' : speed > 0.3 ? 'walk' : 'idle';
    this.ch.play({ clip, fade: 0.2 });
    this.ch.update(dt, { lean: 0, travelled: 0, riding: false });
    this.rig.update(dt, this.anim);
  }

  dispose() {
    this.ch.root.removeFromParent();
    this.ch.dispose();
  }
}
