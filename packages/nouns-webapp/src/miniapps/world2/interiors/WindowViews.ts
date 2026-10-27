// ── The real view out of the windows ──────────────────────────────────────
//
// Each window of the room gets a small render target and a camera standing
// where that window is on the real building (windowMath.ts), looking out.
// The caller renders the actual city into it (with the world shown and the
// outdoor light and fog back for that one render); a pane in front of the
// painted window art shows the result, with a faint glass sheet and a hint
// of parallax. All are rendered on entry; after that one window refreshes
// every REFRESH_S / count seconds, only while it's in view, so riders, the
// van and the time of day go by. Low quality keeps the entry snapshot.

import type { BuildingDoor } from './contract';
import type { Decor, Layout } from './layout';

import * as THREE from 'three';

import { parallaxRect, windowPose } from './windowMath';

/** Each window gets a new view about this often (s). */
export const REFRESH_S = 2;
/** View height (px); width follows the window's shape. */
const VIEW_H = 256;
const VIEW_W_MAX = 512;
/** Vertical field of view of a window camera (deg): wider than the pane shows, for parallax. */
const FOV = 58;

/** Renders the city (as seen from outside) into `target` through `camera`. */
export type RenderOutside = (
  camera: THREE.PerspectiveCamera,
  target: THREE.WebGLRenderTarget,
) => void;

interface View {
  decor: Decor;
  camera: THREE.PerspectiveCamera;
  target: THREE.WebGLRenderTarget;
  pane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  uv: THREE.BufferAttribute;
  w: number;
  h: number;
  /** Rendered at least once. */
  fresh: boolean;
}

export class WindowViews {
  /** Panes and glass, in the room frame (add under the room group). */
  readonly group = new THREE.Group();
  readonly views: View[] = [];
  /** Last render's cost (ms) and how many renders so far. */
  lastMs = 0;
  renders = 0;
  private t = 0;
  private next = 0;
  private glassMat = new THREE.MeshBasicMaterial({
    color: 0xcfe8ff,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
  });
  private glassGeos: THREE.BufferGeometry[] = [];

  constructor(door: Pick<BuildingDoor, 'x' | 'y' | 'z' | 'yaw' | 'footprint'>, l: Layout) {
    this.group.name = 'Interior:windows';
    for (const d of l.decor) {
      if (d.type !== 'window') continue;
      const pose = windowPose(door, l, d);
      const aspect = d.w / d.h;
      const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.3, 1600);
      camera.position.set(pose.x, pose.y, pose.z);
      camera.lookAt(pose.x + Math.sin(pose.yaw), pose.y, pose.z + Math.cos(pose.yaw));
      camera.updateMatrixWorld(true);
      const w = Math.min(VIEW_W_MAX, Math.round(VIEW_H * aspect));
      const target = new THREE.WebGLRenderTarget(w, VIEW_H, {
        type: THREE.HalfFloatType,
        depthBuffer: true,
      });
      target.texture.name = 'InteriorWindowView';
      const geo = new THREE.PlaneGeometry(d.w, d.h);
      const pane = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ map: target.texture, fog: false }),
      );
      pane.name = 'Interior:windowView';
      // On the wall like the window decor (build.ts decorFrame), in front of the painted view
      placeOnWall(pane, d, l, 0.018);
      pane.visible = false; // until its first render
      this.group.add(pane);
      const glassGeo = new THREE.PlaneGeometry(d.w, d.h);
      this.glassGeos.push(glassGeo);
      const glass = new THREE.Mesh(glassGeo, this.glassMat);
      glass.name = 'Interior:windowGlass';
      placeOnWall(glass, d, l, 0.055);
      glass.renderOrder = 2;
      this.group.add(glass);
      this.views.push({
        decor: d,
        camera,
        target,
        pane,
        uv: geo.attributes.uv as THREE.BufferAttribute,
        w: d.w,
        h: d.h,
        fresh: false,
      });
    }
  }

  /** Render every window now (on entry). */
  renderAll(render: RenderOutside) {
    for (const v of this.views) this.renderOne(v, render);
  }

  /**
   * Per frame: slide the views with the viewer, and (unless `refresh` is
   * off) re-render the next window that's on screen when its turn comes.
   */
  update(dt: number, viewer: THREE.Camera, render: RenderOutside, refresh: boolean) {
    const n = this.views.length;
    if (n === 0) return;
    this.group.updateMatrixWorld();
    for (const v of this.views) this.slide(v, viewer);
    if (!refresh) return;
    this.t += dt;
    if (this.t < REFRESH_S / n) return;
    this.t = 0;
    _frustum.setFromProjectionMatrix(
      _m.multiplyMatrices(viewer.projectionMatrix, viewer.matrixWorldInverse),
    );
    for (let k = 0; k < n; k++) {
      const v = this.views[(this.next + k) % n]!;
      v.pane.geometry.computeBoundingSphere();
      _sphere.copy(v.pane.geometry.boundingSphere!).applyMatrix4(v.pane.matrixWorld);
      if (!_frustum.intersectsSphere(_sphere)) continue;
      this.renderOne(v, render);
      this.next = (this.next + k + 1) % n;
      return;
    }
  }

  private renderOne(v: View, render: RenderOutside) {
    const t0 = performance.now();
    render(v.camera, v.target);
    this.lastMs = performance.now() - t0;
    this.renders++;
    v.fresh = true;
    v.pane.visible = true;
  }

  /** Show the part of the view a viewer here would see through the frame. */
  private slide(v: View, viewer: THREE.Camera) {
    _inv.copy(v.pane.matrixWorld).invert();
    _p.setFromMatrixPosition(viewer.matrixWorld).applyMatrix4(_inv);
    const [u0, v0, u1, v1] = parallaxRect(_p.x, _p.y, _p.z);
    // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
    v.uv.setXY(0, u0, v1);
    v.uv.setXY(1, u1, v1);
    v.uv.setXY(2, u0, v0);
    v.uv.setXY(3, u1, v0);
    v.uv.needsUpdate = true;
  }

  dispose() {
    for (const v of this.views) {
      v.target.dispose();
      v.pane.geometry.dispose();
      v.pane.material.dispose();
    }
    for (const g of this.glassGeos) g.dispose();
    this.glassMat.dispose();
    this.group.removeFromParent();
    this.views.length = 0;
  }
}

const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _inv = new THREE.Matrix4();
const _p = new THREE.Vector3();

/** Put a plane (facing +z) on a room wall like build.ts's decorFrame, `off` metres out. */
function placeOnWall(o: THREE.Object3D, d: Decor, l: Layout, off: number) {
  switch (d.wall) {
    case 'n':
      o.position.set(d.at, d.y, l.d - off);
      o.rotation.y = Math.PI;
      break;
    case 's':
      o.position.set(d.at, d.y, off);
      break;
    case 'e':
      o.position.set(l.w / 2 - off, d.y, d.at);
      o.rotation.y = -Math.PI / 2;
      break;
    default:
      o.position.set(-l.w / 2 + off, d.y, d.at);
      o.rotation.y = Math.PI / 2;
  }
}
