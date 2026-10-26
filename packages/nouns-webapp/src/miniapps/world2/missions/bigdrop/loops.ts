// ── The Big Drop: loop-de-loops on the race line (a PeakSystem) ─────────
//
// Every 'loop' feature on the track gets a giant ice-and-Nouns-red loop
// (loopMesh.ts) streamed in 4 km ahead of the rider and dropped 1 km
// behind. Roll into its funnel on the board, anywhere across the lane and
// at any speed, and the loop takes the rider over through Player.ride: the
// pure ride (loopPath.ts) carries them round the circle with energy
// conserved and their up turned to the deck (upside down over the top),
// while the camera cuts to a loop cam off the side of the lane. Out the
// bottom it hands back on the pad at the speed the energy gives, a trick
// in the combo. Too slow over the top they fall off into the air (the
// camera holds on the drop); slower still they roll back out the way
// they came.
//
// The pad: until the terrain carves a flat pad under each loop, the frame
// is fitted to the bare snow (peakHeight). Switching to the terrain's own
// pad helper is the one line at PAD_HEIGHT.

import type { Feature, PeakCtx, PeakSystem, PeakSystemFactory } from './contract';

import * as THREE from 'three';

import { toonify } from '../../render/Toon';
import { addTrick } from '../../skate/Tricks';
import { peakHeight } from '../peakTerrain';

import { buildLoopGeometry } from './loopMesh';
import {
  LoopRide,
  catchBlend,
  framePoint,
  funnelAt,
  frameDir,
  laneAt,
  loopFrame,
  loopShape,
  newSample,
  toFrame,
  type LoopFrame,
  type LoopShape,
} from './loopPath';
import { featuresIn } from './track';

/** The snow under a loop (peak coordinates). Swap for the terrain's pad helper when it lands. */
const PAD_HEIGHT: (x: number, z: number) => number = peakHeight;

/** Stream loops this far ahead of / behind the rider along the track (m). */
const AHEAD = 4000;
const BEHIND = 1000;
/** Re-query the track once the rider has moved this far along it (m). */
const REQUERY = 60;
/** Caught only this close to the deck plane (m): not when flying high over it. */
const CATCH_Y = 5;
/** …and only rolling down the line at least this fast (m/s). */
const CATCH_SPEED = 1;
/** The catch zone: the first this fraction of the approach (the funnel's wide end). */
const CATCH_ZONE = 0.4;
/** The loop cam: this far out past the near tower, and up the line (m). */
const RIG_SIDE = 4;
const RIG_BACK = 10;
/** Camera after falling off: how long the loop cam holds (s). */
const FALL_HOLD = 2.2;
const TRICK = {
  1: { name: 'Loop-de-loop', points: 1500 },
  2: { name: 'Double Loop', points: 4000 },
};

interface Live {
  f: Feature;
  shape: LoopShape;
  frame: LoopFrame;
  root: THREE.Group;
  solid: THREE.Mesh;
  neon: THREE.Mesh;
  collider: THREE.BufferGeometry;
  towerX: [number, number];
}

interface Riding {
  live: Live;
  ride: LoopRide;
  respawns: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = { x: 0, y: 0, z: 0 };
const _q = { x: 0, y: 0, z: 0 };
const _m = new THREE.Matrix4();

export const createLoops: PeakSystemFactory = (ctx: PeakCtx): PeakSystem => {
  const game = ctx.game;
  const player = game.player;
  const live = new Map<string, Live>();
  let wanted: Feature[] = [];
  let queriedAt = NaN;
  let riding: Riding | null = null;
  const sample = newSample();
  const rig = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 62 };
  let rigOn = false;
  let fallHold = 0;
  let fallLoop: Live | null = null;

  const solidMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    metalness: 0.05,
    // A little self-light keeps the red red on the shaded side
    emissive: 0x3a3a40,
  });
  solidMat.name = 'BigDropLoop';
  const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  neonMat.name = 'BigDropLoopNeon';

  /** Every material the loops drew with (toonify swaps in converted copies). */
  const mats = new Set<THREE.Material>([solidMat, neonMat]);
  const segs = ctx.quality === 'low' ? 56 : 96;

  function build(f: Feature): Live {
    const shape = loopShape(f);
    const frame = loopFrame(f, PAD_HEIGHT);
    const { b: fb, n: fn, t: ft } = frame;
    const geo = buildLoopGeometry(shape, segs, {
      up: new THREE.Vector3(fb.y, fn.y, ft.y),
      depth: (x, y, z) => {
        framePoint(frame, x, y, z, _p);
        return _p.y - PAD_HEIGHT(_p.x, _p.z);
      },
    });
    const root = new THREE.Group();
    root.name = `BigDropLoop:${f.id}`;
    const solid = new THREE.Mesh(geo.solid, solidMat);
    solid.castShadow = true;
    solid.receiveShadow = true;
    const neon = new THREE.Mesh(geo.neon, neonMat);
    root.add(solid, neon);
    if (ctx.toon) toonify(root);
    for (const m of [solid.material, neon.material]) mats.add(m as THREE.Material);
    const { b, n, t } = frame;
    _m.makeBasis(_v.set(b.x, b.y, b.z), _w.set(n.x, n.y, n.z), new THREE.Vector3(t.x, t.y, t.z));
    root.quaternion.setFromRotationMatrix(_m);
    ctx.toLocal(frame.e.x, frame.e.y, frame.e.z, root.position);
    ctx.group.add(root);
    // Collider: the same triangles turned into peak axes, relative to the loop's origin
    const collider = geo.collider;
    collider.applyMatrix4(_m);
    ctx.setCollider(`loop:${f.id}`, collider, new THREE.Vector3(frame.e.x, frame.e.y, frame.e.z));
    return {
      f,
      shape,
      frame,
      root,
      solid,
      neon,
      collider,
      towerX: geo.towerX,
    };
  }

  function drop(l: Live) {
    ctx.group.remove(l.root);
    l.solid.geometry.dispose();
    l.neon.geometry.dispose();
    ctx.setCollider(`loop:${l.f.id}`, null);
    l.collider.dispose();
    live.delete(l.f.id);
    if (fallLoop === l) fallLoop = null;
  }

  // ── Putting the rider where the ride says ──

  /** Peak point of a loop-local point → local coordinates. */
  function localOf(l: Live, x: number, y: number, z: number, out: THREE.Vector3) {
    framePoint(l.frame, x, y, z, _p);
    return ctx.toLocal(_p.x, _p.y, _p.z, out);
  }

  function dirOf(l: Live, x: number, y: number, z: number, out: THREE.Vector3) {
    frameDir(l.frame, x, y, z, _p);
    return out.set(_p.x, _p.y, _p.z);
  }

  function place(r: Riding) {
    const l = r.live;
    const s = r.ride.sample(sample);
    const v = r.ride.v;
    localOf(l, s.px, s.py, s.pz, player.pos);
    dirOf(l, s.tx, s.ty, s.tz, _v);
    player.vel.copy(_v).multiplyScalar(v);
    player.fwd.copy(_v).multiplyScalar(v >= 0 ? 1 : -1);
    dirOf(l, s.cx, s.cy, s.cz, player.up);
    player.state = 'ground';
  }

  /**
   * The loop cam: off the side of the lane, tracking the rider round the
   * circle from a little inside it and looking across at them, so the
   * whole loop turns behind them (and they're upside down over the top).
   */
  function aimRig(l: Live) {
    const sh = l.shape;
    ctx.toPeak(player.pos.x, player.pos.y, player.pos.z, _v);
    toFrame(l.frame, _v.x, _v.y, _v.z, _q);
    // Beside the near tower, a third of the way in toward the circle's middle
    const x = l.towerX[0] - RIG_SIDE;
    const y = _q.y + (sh.R - _q.y) * 0.3;
    const z = _q.z * 0.7 - RIG_BACK;
    localOf(l, x, Math.max(3, y), z, rig.pos);
    rig.look.copy(player.pos);
    rig.fov = 60;
    game.cam.rig = rig;
    rigOn = true;
  }

  function releaseRig() {
    if (rigOn && game.cam.rig === rig) game.cam.rig = null;
    rigOn = false;
  }

  function finish(r: Riding) {
    const l = r.live;
    const st = r.ride.status;
    const sh = l.shape;
    riding = null;
    if (st === 'exit') {
      // Back on the pad, down the line, at the speed the energy gives
      const t = l.frame.t;
      const v = r.ride.v;
      r.ride.sample(sample);
      localOf(l, sample.px, 0, sample.pz, player.pos);
      player.vel.set(t.x, t.y, t.z).multiplyScalar(v);
      player.fwd.set(t.x, t.y, t.z);
      dirOf(l, 0, 1, 0, player.up);
      player.state = 'ground';
      player.sinceLand = 0;
      player.lastLandImpact = 0;
      const trick = TRICK[sh.turns];
      addTrick(player.combo, trick.name, trick.points);
      player.events.push({ type: 'trick', name: trick.name, points: trick.points });
      releaseRig();
    } else if (st === 'fall') {
      // Off the deck into the air, still moving along it
      place(r);
      player.state = 'air';
      player.airTime = 0;
      player.airYaw = 0;
      player.vertLip = false;
      player.flip = null;
      player.flipDone = null;
      player.grab = null;
      // Hold the wide shot while they drop
      fallHold = FALL_HOLD;
      fallLoop = l;
    } else if (st === 'back') {
      // Rolled back out of the funnel, facing back up the line
      place(r);
      const t = l.frame.t;
      player.fwd.set(-t.x, -t.y, -t.z);
      dirOf(l, 0, 1, 0, player.up);
      releaseRig();
    } else releaseRig();
  }

  /**
   * Is the rider in a loop's funnel (on the board, on or just over the snow,
   * heading down the line)? Then take them. A zone rather than a line, so a
   * rider skipping over the moguls at 500 km/h can't hop the catch.
   */
  function tryCatch(): boolean {
    const p = player;
    if (p.state === 'grind' || p.state === 'bail') return false;
    ctx.toPeak(p.pos.x, p.pos.y, p.pos.z, _v);
    for (const l of live.values()) {
      const sh = l.shape;
      toFrame(l.frame, _v.x, _v.y, _v.z, _q);
      const u0 = _q.z + sh.approach;
      if (u0 < 0 || u0 > sh.approach * CATCH_ZONE) continue;
      const fun = funnelAt(sh, u0);
      if (Math.abs(_q.x - fun.x) > fun.half + 1) continue;
      if (_q.y > CATCH_Y || _q.y < -CATCH_Y) continue;
      const t = l.frame.t;
      const vt = p.vel.x * t.x + p.vel.y * t.y + p.vel.z * t.z;
      if (vt < CATCH_SPEED) continue;
      // The offset from the path that keeps the rider exactly where they are now
      const k = catchBlend(sh, u0);
      const { b, n } = l.frame;
      const ride = new LoopRide(
        sh,
        b.y,
        n.y,
        t.y,
        p.tuning.gravity,
        u0,
        vt,
        (_q.x - laneAt(sh, 0)) / k,
        _q.y / k,
      );
      riding = { live: l, ride, respawns: p.respawns };
      fallHold = 0;
      place(riding);
      return true;
    }
    return false;
  }

  /** Player.ride: the loop's turn at the board physics, every substep while loops are near. */
  const hook = (dt: number): boolean => {
    const r = riding;
    if (r === null) return tryCatch();
    if (player.respawns !== r.respawns || player.mode !== 'board') {
      riding = null;
      releaseRig();
      return false;
    }
    const st = r.ride.step(dt);
    if (st !== 'ride') {
      finish(r);
      return true;
    }
    place(r);
    // Cut to the wide shot as the circle comes up
    if (r.ride.u > r.live.shape.approach * 0.55) aimRig(r.live);
    return true;
  };

  function stream() {
    const s = ctx.riderPeak.z;
    if (!(Math.abs(s - queriedAt) < REQUERY)) {
      queriedAt = s;
      wanted = featuresIn(s - BEHIND, s + AHEAD).filter(f => f.kind === 'loop');
      for (const l of [...live.values()])
        if (riding?.live !== l && fallLoop !== l && !wanted.some(f => f.id === l.f.id)) drop(l);
    }
    // At most one new loop a frame, nearest first
    let best: Feature | null = null;
    for (const f of wanted)
      if (!live.has(f.id) && (best === null || Math.abs(f.s - s) < Math.abs(best.s - s))) best = f;
    if (best !== null) live.set(best.id, build(best));
  }

  return {
    update(dt) {
      stream();
      for (const l of live.values())
        ctx.toLocal(l.frame.e.x, l.frame.e.y, l.frame.e.z, l.root.position);
      // Ride the loops while there are any near (never take the hook from someone else)
      if (live.size > 0) {
        if (player.ride === null) player.ride = hook;
      } else if (player.ride === hook && riding === null) player.ride = null;
      // After a fall: keep the wide shot on the rider for a moment
      if (riding === null && fallHold > 0) {
        fallHold -= dt;
        const l = fallLoop;
        if (l === null || fallHold <= 0 || player.state === 'ground') {
          fallHold = 0;
          fallLoop = null;
          releaseRig();
        } else aimRig(l);
      }
    },
    rebase() {
      for (const l of live.values())
        ctx.toLocal(l.frame.e.x, l.frame.e.y, l.frame.e.z, l.root.position);
    },
    dispose() {
      riding = null;
      releaseRig();
      if (player.ride === hook) player.ride = null;
      for (const l of [...live.values()]) drop(l);
      for (const m of mats) m.dispose();
      mats.clear();
    },
  };
};
