// ── The plaza mural as a framed billboard ───────────────────────────────
//
// Replaces the baked `mural__` decal (a fixed 14 × 8.7 m quad every clip
// was stretched onto) with a screen sized to the current clip's own aspect
// (billboardFit.ts) inside a chunky black frame on struts (billboardFrame.ts).
// The decal stays visible until the first clip's size is known, so a feed
// that never loads leaves the plaza as it was.
//
// Draws: screen 1 + frame 1, the hidden decal −1.

import type { CollisionWorld } from '../physics/Collision';

import * as THREE from 'three';

import { toonify } from '../render/Toon';

import {
  type ScreenRect,
  type WallExtent,
  type WallRect,
  fitScreen,
  sameRect,
  scanEdge,
} from './billboardFit';
import { FRAME, buildFrameCollider, buildFrameGeometry, screenZ } from './billboardFrame';

const COLLIDER_ID = 'billboard:mural';
/** Clear wall left between the frame and the roofline / the wall's ends. */
const MARGIN = 0.35;

export interface MuralBillboardOpts {
  world?: CollisionWorld;
  toon?: boolean;
  /** Frame casts a real-time shadow (off on 'low'). */
  shadows?: boolean;
}

/** The decal's quad in world space: origin on the wall at the quad's centre. */
export interface WallQuad {
  origin: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  normal: THREE.Vector3;
  rect: WallRect;
}

/** The plaza's mural decal mesh under `root` (its `mural__` material), or null. */
export function findMuralDecal(root: THREE.Object3D): THREE.Mesh | null {
  let hit: THREE.Mesh | null = null;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (hit !== null || m.isMesh !== true) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some(x => /^mural__/i.test(x.name))) hit = m;
  });
  return hit;
}

/** A wall decal's quad in world space (the mural's: the billboard and the bench use it). */
export function quadOf(mesh: THREE.Mesh): WallQuad | null {
  const pos = mesh.geometry.attributes.position;
  const nrm = mesh.geometry.attributes.normal;
  if (pos === undefined || pos.count < 3) return null;
  mesh.updateWorldMatrix(true, false);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++)
    pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  const normal = new THREE.Vector3();
  if (nrm !== undefined) {
    normal.fromBufferAttribute(nrm, 0).transformDirection(mesh.matrixWorld);
  } else {
    normal
      .subVectors(pts[1], pts[0])
      .cross(new THREE.Vector3().subVectors(pts[2], pts[0]))
      .normalize();
  }
  // A wall: keep the normal horizontal, world up as up
  normal.y = 0;
  if (normal.lengthSq() < 1e-6) return null;
  normal.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  let u0 = Infinity;
  let u1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const centre = new THREE.Vector3();
  for (const p of pts) centre.add(p);
  centre.divideScalar(pts.length);
  for (const p of pts) {
    const u = p.clone().sub(centre).dot(right);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  // Origin: the wall point under the quad's centre at height 0
  const origin = centre.clone().addScaledVector(right, (u0 + u1) / 2);
  origin.y = 0;
  return {
    origin,
    right,
    up,
    normal,
    rect: { u: 0, width: u1 - u0, bottom: y0, top: y1 },
  };
}

/** Measure the wall round the quad in the collision world (null: no wall found). */
function measureWall(world: CollisionWorld, q: WallQuad): WallExtent | null {
  const back = 1.5;
  const dir = q.normal.clone().negate();
  const o = new THREE.Vector3();
  const hit = (u: number, y: number) => {
    o.copy(q.origin).addScaledVector(q.right, u).addScaledVector(q.normal, back);
    o.y = y;
    const h = world.raycast(o, dir, back * 2);
    return h !== null && Math.abs(h.distance - back) < 0.4;
  };
  const r = q.rect;
  const mid = (r.bottom + r.top) / 2;
  if (!hit(0, mid)) return null;
  let top = Infinity;
  for (const u of [-r.width * 0.45, 0, r.width * 0.45]) {
    if (!hit(u, r.top - 0.2)) continue;
    top = Math.min(
      top,
      scanEdge(y => hit(u, y), r.top - 0.2, 0.25, r.top + 25),
    );
  }
  if (!Number.isFinite(top)) top = r.top;
  const left = scanEdge(u => hit(u, mid), 0, -0.25, -40);
  const right = scanEdge(u => hit(u, mid), 0, 0.25, 40);
  return { top, left, right };
}

export class MuralBillboard {
  readonly group = new THREE.Group();
  private readonly screen: THREE.Mesh;
  private readonly frame: THREE.Mesh;
  private rect: ScreenRect | null = null;
  private shown = false;
  private readonly wall: WallExtent | null;
  private readonly world: CollisionWorld | undefined;

  private constructor(
    private readonly quad: WallQuad,
    private readonly hideDecal: () => void,
    material: THREE.MeshBasicMaterial,
    opts: MuralBillboardOpts,
  ) {
    this.world = opts.world;
    this.wall = opts.world !== undefined ? measureWall(opts.world, quad) : null;
    const basis = new THREE.Matrix4().makeBasis(quad.right, quad.up, quad.normal);
    this.group.quaternion.setFromRotationMatrix(basis);
    this.group.position.copy(quad.origin);
    this.group.name = 'MuralBillboard';
    this.group.visible = false;

    const plane = new THREE.PlaneGeometry(1, 1);
    // The screen texture keeps glTF's flipY = false (shared code path with
    // the posters): flip the plane's v instead
    const uv = plane.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.screen = new THREE.Mesh(plane, material);
    this.screen.name = 'MuralScreen';
    this.screen.position.z = screenZ();

    const frameMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
    });
    this.frame = new THREE.Mesh(new THREE.BufferGeometry(), frameMat);
    this.frame.name = 'MuralFrame';
    this.frame.castShadow = opts.shadows === true;
    this.frame.receiveShadow = true;
    this.group.add(this.screen, this.frame);
    if (opts.toon === true) toonify(this.frame);
  }

  /** Billboard for the mural decal `mesh` (material slot `index`), or null. */
  static create(
    mesh: THREE.Mesh,
    index: number,
    material: THREE.MeshBasicMaterial,
    opts: MuralBillboardOpts,
  ): MuralBillboard | null {
    const quad = quadOf(mesh);
    if (quad === null) return null;
    const hide = () => {
      if (Array.isArray(mesh.material)) {
        const m = mesh.material[index].clone();
        m.visible = false;
        mesh.material[index] = m;
      } else {
        mesh.visible = false;
      }
    };
    return new MuralBillboard(quad, hide, material, opts);
  }

  /** World centre of the screen area (for the play-within distance). */
  centre(): THREE.Vector3 {
    const r = this.quad.rect;
    return this.quad.origin.clone().setY((r.bottom + r.top) / 2);
  }

  /** The current screen rectangle (wall frame), null until the first clip. */
  get current(): ScreenRect | null {
    return this.rect;
  }

  /** Size the screen + frame to a clip of `aspect` (width / height). */
  fit(aspect: number) {
    const rect = fitScreen(this.quad.rect, aspect, this.wall, {
      border: FRAME.border,
      margin: MARGIN,
    });
    if (!this.shown) {
      this.shown = true;
      this.hideDecal();
      this.group.visible = true;
    }
    if (sameRect(this.rect, rect)) return;
    this.rect = rect;
    this.screen.scale.set(rect.width, rect.height, 1);
    this.screen.position.set(rect.u, rect.bottom + rect.height / 2, screenZ());
    this.frame.geometry.dispose();
    this.frame.geometry = buildFrameGeometry(rect);
    if (this.world !== undefined) {
      this.group.updateMatrixWorld(true);
      const col = buildFrameCollider(rect).applyMatrix4(this.group.matrixWorld);
      this.world.setDynamic(COLLIDER_ID, col);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.screen.geometry.dispose();
    this.frame.geometry.dispose();
    (this.frame.material as THREE.Material).dispose();
    this.world?.setDynamic(COLLIDER_ID, null);
  }
}
