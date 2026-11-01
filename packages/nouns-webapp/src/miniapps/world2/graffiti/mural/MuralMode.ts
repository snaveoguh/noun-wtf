// ── Mural mode (Game side): the camera squares up to a wall you face ────
//
// Enter from a wall in front of you (the MURAL button, or ` on a keyboard).
// The skate camera hands over through its `rig` to a camera on the wall's
// normal looking straight at it (framing.ts), the rider is hidden and gets
// a neutral input frame every tick (it stops reacting to anything), and the
// overlay (MuralUi.tsx) turns pointers into paint, pan and zoom through the
// methods here. Paint goes straight into Graffiti's pen path (penBegin /
// penSample / penEnd), one raycast per pen sample from this camera, kept to
// the wall's own plane. Leaving hands the camera back; you're where you were.

import type { InputFrame } from '../../core/Input';
import type { Game } from '../../Game';

import * as THREE from 'three';

import {
  clampView,
  FIT_VIEW,
  fitHeight,
  lerpView,
  MURAL_FOV,
  type MuralView,
  panBy,
  seatCentre,
  viewPose,
  type WallFrame,
  zoomAbout,
} from './framing';

/** Entering / FIT ease, seconds. */
const EASE_IN = 0.55;
const EASE_FIT = 0.3;
/** How far a wall may be from you to open on it (m). */
const REACH = 6;

export interface MuralState {
  active: boolean;
  /** The camera has arrived (painting waits for it). */
  ready: boolean;
  view: MuralView;
  fitH: number;
  /** World u / v of the frame centre (the grid lines up with the wall cells). */
  centreU: number;
  centreV: number;
  /** A wall in front of you right now (the MURAL button shows). */
  canEnter: boolean;
  note: string | null;
}

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();

/** Neutral input: the rider stands still and nothing presses. */
export function muteInput(f: InputFrame) {
  f.moveX = f.moveY = f.lookX = f.lookY = f.stickX = f.stickY = 0;
  f.push = f.pushPressed = f.brake = f.crouch = f.manual = f.noseManual = false;
  f.grabL = f.grabR = f.sprint = f.jumpPressed = f.boardTogglePressed = false;
  f.cameraTogglePressed = f.micPressed = f.respawnPressed = false;
  f.emotePressed = 0;
  f.spray = f.colorCyclePressed = false;
  f.sizeStep = 0;
  f.wheel = 0;
  f.digitPressed = -1;
  f.undoPressed = f.pickPressed = f.duck = f.duckPressed = f.boostPressed = false;
  f.tricks.length = 0;
}

export class MuralMode {
  state: MuralState = {
    active: false,
    ready: false,
    view: FIT_VIEW,
    fitH: 3.2,
    centreU: 0,
    centreV: 0,
    canEnter: false,
    note: null,
  };

  private frame: WallFrame | null = null;
  private planeD = 0;
  private readonly rig = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: MURAL_FOV };
  private from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 70 };
  /** Easing: t counts up to `dur`, from `fromView` (or the skate camera) to the view. */
  private ease = { t: 0, dur: 0, fromView: FIT_VIEW, camera: false };
  private probeClock = 0;
  private listeners = new Set<() => void>();
  private painting = false;
  /** Board to step off of on the next frame (entering while riding). */
  private stepOff = false;
  private readonly accept = (p: THREE.Vector3, n: THREE.Vector3) => {
    const f = this.frame;
    if (f === null) return false;
    const fn = f.n as THREE.Vector3;
    return n.dot(fn) > 0.94 && Math.abs(fn.dot(p) - this.planeD) < 0.3;
  };

  constructor(private game: Game) {}

  get active() {
    return this.state.active;
  }

  /** Where the view is centred (graffiti sharpens cells round it). */
  get focus(): THREE.Vector3 | null {
    return this.state.active ? this.rig.look : null;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getState = () => this.state;

  private set(patch: Partial<MuralState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Somewhere a mural can happen (the can works, nothing else owns the frame). */
  private allowed(): boolean {
    const g = this.game;
    return (
      g.graffiti !== null &&
      !g.interiors.inside &&
      !g.missions.ud.active &&
      !g.van2.driving &&
      !g.cars.inCar &&
      !g.dragon.riding &&
      !g.hoops.active &&
      !g.breaks.active &&
      !g.pool.active &&
      !g.freestyle.active &&
      !g.cutscene.active
    );
  }

  /** The wall you're facing: what the crosshair is on, else straight ahead of you. */
  private probe(): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    const g = this.game;
    const gr = g.graffiti;
    if (gr === null) return null;
    const p = g.player.pos;
    const aim = gr.aim;
    if (aim !== null && aim.point.distanceTo(p) < REACH) return aim;
    const cam = g.gfx.camera;
    cam.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-6) return null;
    _dir.normalize();
    for (const h of [1.2, 0.6, 1.9]) {
      _from.set(p.x, p.y + h, p.z);
      const hit = g.world.raycast(_from, _dir, REACH);
      if (hit !== null && Math.abs(hit.normal.y) < 0.85) return hit;
    }
    return null;
  }

  toggle() {
    if (this.state.active) this.exit();
    else this.enter();
  }

  enter(): boolean {
    const g = this.game;
    const gr = g.graffiti;
    if (gr === null || !this.allowed()) {
      this.set({ note: "can't paint here" });
      return false;
    }
    const hit = this.probe();
    if (hit === null) {
      this.set({ note: 'face a wall to paint a mural' });
      return false;
    }
    const { n, u, v } = gr.wallBasis(hit.normal);
    const cam = g.gfx.camera;
    const aspect = cam.aspect > 0 ? cam.aspect : 1;
    const fitH = fitHeight(aspect);
    const vertical = Math.abs(n.y) < 0.5;
    const centre = hit.point.clone();
    centre.y = seatCentre(centre.y, g.player.pos.y, fitH, vertical);
    // Sit just off the paint, so the view centre is on the wall face
    this.frame = { centre, n, u, v };
    this.planeD = n.dot(hit.point);
    this.from.pos.copy(cam.position);
    cam.getWorldDirection(_a);
    this.from.look.copy(cam.position).addScaledVector(_a, 5);
    this.from.fov = cam.fov;
    this.ease = { t: 0, dur: EASE_IN, fromView: FIT_VIEW, camera: true };
    this.stepOff = g.player.mode === 'board';
    cam.up.copy(v);
    g.cam.rig = this.rig;
    gr.muralAim = true;
    this.painting = false;
    document.body.setAttribute('data-mural', '');
    this.set({
      active: true,
      ready: false,
      view: FIT_VIEW,
      fitH,
      centreU: u.dot(centre),
      centreV: v.dot(centre),
      note: null,
    });
    this.place(0);
    return true;
  }

  exit() {
    if (!this.state.active) return;
    const g = this.game;
    const gr = g.graffiti;
    if (gr !== null) {
      if (this.painting) gr.penEnd();
      gr.muralAim = false;
      gr.hoverRay(null, null);
      gr.flush();
    }
    this.painting = false;
    if (g.cam.rig === this.rig) g.cam.rig = null;
    g.gfx.camera.up.set(0, 1, 0);
    if (g.me !== null) g.me.root.visible = true;
    document.body.removeAttribute('data-mural');
    this.frame = null;
    this.set({ active: false, ready: false });
  }

  /**
   * Every frame, right after input is read: mute the rider, keep the camera
   * on the wall, and close if something else takes over.
   */
  tick(dt: number, input: InputFrame) {
    if (!this.state.active) {
      // Is there a wall to open on? (the touch MURAL button), 5× a second
      this.probeClock -= dt;
      if (this.probeClock <= 0) {
        this.probeClock = 0.2;
        const can = this.allowed() && this.game.player.speed < 3 && this.probe() !== null;
        if (can !== this.state.canEnter) this.set({ canEnter: can });
      }
      return;
    }
    if (!this.allowed()) {
      this.exit();
      return;
    }
    muteInput(input);
    if (this.stepOff) {
      input.boardTogglePressed = true;
      this.stepOff = false;
    }
    if (this.game.me !== null) this.game.me.root.visible = false;
    this.place(dt);
  }

  private place(dt: number) {
    const f = this.frame;
    if (f === null) return;
    const cam = this.game.gfx.camera;
    const aspect = cam.aspect > 0 ? cam.aspect : 1;
    const e = this.ease;
    let view = this.state.view;
    let k = 1;
    if (e.dur > 0) {
      e.t = Math.min(e.dur, e.t + dt);
      k = e.t / e.dur;
      if (!e.camera) view = lerpView(e.fromView, this.state.view, k);
    }
    const pose = viewPose(f, view, aspect, this.state.fitH);
    this.rig.pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
    this.rig.look.set(pose.look.x, pose.look.y, pose.look.z);
    this.rig.fov = MURAL_FOV;
    if (e.camera && k < 1) {
      // Fly in from the skate camera (smoothstep)
      const s = k * k * (3 - 2 * k);
      this.rig.pos.lerpVectors(this.from.pos, this.rig.pos, s);
      this.rig.look.lerpVectors(this.from.look, this.rig.look, s);
      this.rig.fov = this.from.fov + (MURAL_FOV - this.from.fov) * s;
      cam.up
        .set(0, 1, 0)
        .lerp(f.v as THREE.Vector3, s)
        .normalize();
    } else cam.up.copy(f.v as THREE.Vector3);
    if (e.dur > 0 && e.t >= e.dur) {
      e.dur = 0;
      if (!this.state.ready) this.set({ ready: true });
    }
  }

  // ── Called by the overlay (screen px inside the game canvas) ────────────

  private rayAt(px: number, py: number) {
    const el = this.game.gfx.renderer.domElement;
    const r = el.getBoundingClientRect();
    _ndc.set(((px - r.left) / r.width) * 2 - 1, 1 - ((py - r.top) / r.height) * 2);
    const cam = this.game.gfx.camera;
    cam.updateMatrixWorld();
    _ray.setFromCamera(_ndc, cam);
    return _ray.ray;
  }

  private size() {
    const r = this.game.gfx.renderer.domElement.getBoundingClientRect();
    return { w: r.width || 1, h: r.height || 1, left: r.left, top: r.top };
  }

  paintStart(px: number, py: number, r: number) {
    const g = this.game.graffiti;
    if (g === null || !this.state.ready) return;
    g.penBegin();
    this.painting = true;
    this.paintMove(px, py, r);
  }

  paintMove(px: number, py: number, r: number) {
    const g = this.game.graffiti;
    if (g === null || !this.painting) return;
    const ray = this.rayAt(px, py);
    g.penSample(ray.origin, ray.direction, r, this.accept);
    g.hoverRay(ray.origin, ray.direction);
  }

  paintEnd() {
    if (!this.painting) return;
    this.painting = false;
    this.game.graffiti?.penEnd();
  }

  paintCancel() {
    if (!this.painting) return;
    this.painting = false;
    this.game.graffiti?.penCancel();
  }

  /** Pen hovering (or the mouse moving): the nozzle cursor follows it. */
  hover(px: number | null, py: number | null) {
    const g = this.game.graffiti;
    if (g === null) return;
    if (px === null || py === null) g.hoverRay(null, null);
    else {
      const ray = this.rayAt(px, py);
      g.hoverRay(ray.origin, ray.direction);
    }
  }

  /** Eyedropper at a screen point. */
  pick(px: number, py: number): boolean {
    const g = this.game.graffiti;
    if (g === null) return false;
    const ray = this.rayAt(px, py);
    return g.pickRay(ray.origin, ray.direction);
  }

  pan(dx: number, dy: number) {
    if (!this.state.ready) return;
    const { w, h } = this.size();
    this.set({ view: panBy(this.state.view, dx, dy, w, h, this.state.fitH) });
  }

  zoom(factor: number, px: number, py: number) {
    if (!this.state.ready) return;
    const { w, h, left, top } = this.size();
    this.set({
      view: zoomAbout(this.state.view, factor, px - left, py - top, w, h, this.state.fitH),
    });
  }

  /** Ease to a view (FIT, a zoom level). */
  goTo(view: MuralView) {
    this.ease = { t: 0, dur: EASE_FIT, fromView: this.state.view, camera: false };
    this.set({ view: clampView(view) });
  }

  fit() {
    this.goTo(FIT_VIEW);
  }

  setZoom(zoom: number) {
    this.goTo({ ...this.state.view, zoom });
  }

  clearNote() {
    if (this.state.note !== null) this.set({ note: null });
  }
}
