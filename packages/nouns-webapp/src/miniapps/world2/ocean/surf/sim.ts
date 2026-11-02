// ── Surfing, swimming and wading (pure: no three.js, no game) ────────────
//
// One state machine for a rider in the sea, stepped on the real wave field
// through a SeaQuery (production: ocean/sea.ts; tests: a straight coast
// over the same waves.ts maths).
//
//   off ─(water > knee)─▶ wade ─(chest deep)─▶ swim         (no board)
//                                         └──▶ paddle       (a board)
//   paddle ─(Q)─▶ duck ─▶ paddle              duck under a breaking wave
//   paddle ─(on the face, fast enough: CATCH)─(jump)─▶ pop ─▶ ride
//   ride ─(up the face to the lip fast, jump)─▶ air ─(lands square)─▶ ride
//   ride / pop / air ─(the lip, pearling, a bad landing)─▶ wipeout ─▶ paddle
//   ride ─(off the back, out of speed, too shallow)─▶ paddle / wade
//
// The board is a point on the surface with gravity down the slope, planing
// drag against the water's own (orbital) motion, and rails that turn its
// velocity toward where it points (a carve bleeds a little speed). Catching
// isn't scripted: paddle on the face, gravity does the rest; the wave
// carries you while you keep your line on its face, and it peels (+a) so
// you have to go down the line to stay ahead of the curl.

import type { SeaPoint } from '../sea';

import { wrap } from '../waves';

import { BOARDS, type BoardId, type BoardSpec } from './boards';

export type WaterPhase =
  | 'off'
  | 'wade'
  | 'swim'
  | 'paddle'
  | 'duck'
  | 'pop'
  | 'ride'
  | 'air'
  | 'wipeout';

export interface SeaQuery {
  /** The sea at (x, z) right now (null: no sea here). */
  at(x: number, z: number, out: SeaPoint): SeaPoint | null;
  /** Ground under the water (the seabed, the beach). */
  ground(x: number, z: number): number;
}

export interface WaterInput {
  /** Stick: x = right, y = forward. */
  moveX: number;
  moveY: number;
  camYaw: number;
  /** Pop up / paddle-sprint / air (pressed this step). */
  jump: boolean;
  /** Duck dive (pressed this step) and held (grab in the air). */
  duck: boolean;
  duckHeld: boolean;
  sprint: boolean;
}

export const blankInput = (): WaterInput => ({
  moveX: 0,
  moveY: 0,
  camYaw: 0,
  jump: false,
  duck: false,
  duckHeld: false,
  sprint: false,
});

export type WaterEvent =
  | { type: 'enter' }
  | { type: 'exit' }
  | { type: 'catch' }
  | { type: 'pop' }
  | { type: 'duck' }
  | { type: 'splash'; k: number }
  | { type: 'trick'; name: string; points: number }
  | { type: 'running'; points: number }
  | { type: 'bank' }
  | { type: 'bail'; why: 'lip' | 'pearl' | 'landing' | 'closeout' }
  | { type: 'air' }
  | { type: 'land'; clean: boolean };

export const WATER = {
  g: 9.81,
  /** Water depth at the rider: wade in / swim in / back to wading / out. */
  wadeIn: 0.35,
  swimIn: 1.05,
  swimOut: 0.8,
  out: 0.18,
  /** Ride / prone onto sand this shallow: step off. */
  ground: 0.45,
  /** Wading speed (m/s) and sprint. */
  wade: 2.1,
  wadeSprint: 3.0,
  /** Swimming speed (m/s) and sprint. */
  swim: 1.35,
  swimSprint: 2.1,
  /** Where the body floats (y under the surface). */
  swimDepth: 0.55,
  /** Prone planing drag (per m) and rail grip (rad/s). */
  proneDrag: 0.11,
  proneTurn: 1.7,
  /** Standing rail grip: velocity turns toward the nose this fast (rad/s). */
  grip: 7.5,
  /** Fraction of the speed a full radian of carve costs. */
  carveLoss: 0.2,
  /** Pumping on the face (m/s²). */
  pump: 1.1,
  /** The face's drive: rate toward the trim speed (/s) and its cap (m/s²). */
  drive: 1.4,
  driveMax: 4.8,
  /** The whitewater's shove on a prone board (m/s² at full foam). */
  whitewater: 22,
  /** Duck dive (s, depth under the surface). */
  duckTime: 0.95,
  duckDepth: 1.3,
  /** Wipeout tumble (s). */
  wipeTime: 2.1,
  /** Catch: seconds on the face fast enough before it's yours. */
  catchHold: 0.18,
  /** Seconds after the catch to pop before you're just belly-riding. */
  popWindow: 1.6,
  /** Surface lift (m/s up) that launches an air at the lip. */
  airLift: 2.3,
  /** Fixed physics step. */
  step: 1 / 60,
} as const;

export interface WaterState {
  phase: WaterPhase;
  /** Seconds in this phase. */
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Heading (yaw: forward = (sin, cos)). */
  yaw: number;
  /** The board you carry (null: swimming). */
  board: BoardId | null;
  /** −1..1 carve lean (anim), 0..1 crouch. */
  lean: number;
  crouch: number;
  /** Stroke phase (paddling / swimming / walking anim). */
  stroke: number;
  /** Sat up on the board, waiting. */
  sit: number;
  /** Catch: seconds on the face fast enough; `ready` once it's yours. */
  caught: number;
  ready: boolean;
  /** Air: yaw turned, grab held. */
  airSpin: number;
  airGrab: number;
  /** Carve tracking: yaw turned this carve, its time, where it began. */
  carve: number;
  carveT: number;
  carvePm: number;
  /** Barrel time this ride (s). */
  barrel: number;
  /** Ride time and what's been scored this ride. */
  rideT: number;
  scored: number;
  /** Last surface sample (y) for the lift. */
  lastSy: number;
  /** Why the last wipeout. */
  why: string;
  /** Last sea sample at the rider (HUD). */
  phi: number;
  broken: number;
  c: number;
}

export function newWater(board: BoardId | null = null): WaterState {
  return {
    phase: 'off',
    t: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    board,
    lean: 0,
    crouch: 0,
    stroke: 0,
    sit: 0,
    caught: 0,
    ready: false,
    airSpin: 0,
    airGrab: 0,
    carve: 0,
    carveT: 0,
    carvePm: 0,
    barrel: 0,
    rideT: 0,
    scored: 0,
    lastSy: 0,
    why: '',
    phi: 0,
    broken: 0,
    c: 6,
  };
}

const TAU = Math.PI * 2;
const sea0 = (): SeaPoint => ({
  y: 0,
  d0: 0,
  a: 0,
  phi: 0,
  A: 0,
  k: 0.1,
  c: 6,
  depth: 0,
  ratio: 0,
  broken: 0,
  foam: 0,
  flow: 0,
  sx: 0,
  sz: 1,
  ax: 1,
  az: 0,
  d: 0,
  bed: 0,
});
const _s = sea0();
const _t = sea0();
const slope = { x: 0, z: 0 };

function slopeAt(q: SeaQuery, x: number, z: number) {
  const e = 0.4;
  const a = q.at(x + e, z, _t)?.y;
  const b = q.at(x - e, z, _t)?.y;
  const c = q.at(x, z + e, _t)?.y;
  const d = q.at(x, z - e, _t)?.y;
  slope.x = a !== undefined && b !== undefined ? (a - b) / (2 * e) : 0;
  slope.z = c !== undefined && d !== undefined ? (c - d) / (2 * e) : 0;
  return slope;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const angleDiff = (a: number, b: number) => {
  let d = a - b;
  d -= TAU * Math.round(d / TAU);
  return d;
};

function go(s: WaterState, phase: WaterPhase) {
  s.phase = phase;
  s.t = 0;
}

/** Enter the water from the land (the game calls this when the depth says so). */
export function enterWater(
  s: WaterState,
  x: number,
  y: number,
  z: number,
  vx: number,
  vz: number,
  yaw: number,
) {
  s.x = x;
  s.y = y;
  s.z = z;
  s.vx = vx;
  s.vy = 0;
  s.vz = vz;
  s.yaw = yaw;
  s.caught = 0;
  s.ready = false;
  go(s, 'wade');
}

/** Water depth at the rider's spot (surface − ground), and the sample in `_s`. */
function depthAt(q: SeaQuery, x: number, z: number): number {
  const p = q.at(x, z, _s);
  if (p === null) return -1;
  return p.y - q.ground(x, z);
}

/**
 * Step the rider `dt` seconds (internally in WATER.step slices). Events go
 * into `ev`. Returns false when the rider is out of the water (phase 'off':
 * the game's own walking takes over).
 */
export function stepWater(
  s: WaterState,
  inp: WaterInput,
  q: SeaQuery,
  dt: number,
  ev: WaterEvent[],
): boolean {
  let left = Math.min(dt, 0.25);
  while (left > 1e-6) {
    const h = Math.min(WATER.step, left);
    left -= h;
    sub(s, inp, q, h, ev);
    // presses count once per frame
    inp = inp.jump || inp.duck ? { ...inp, jump: false, duck: false } : inp;
    if (s.phase === 'off') return false;
  }
  return s.phase !== 'off';
}

function sub(s: WaterState, inp: WaterInput, q: SeaQuery, dt: number, ev: WaterEvent[]) {
  s.t += dt;
  const depth = depthAt(q, s.x, s.z);
  const sp = _s;
  if (depth < 0) {
    // off the edge of the sea (or it went away): back on land
    if (s.phase !== 'off') {
      bank(s, ev);
      go(s, 'off');
      ev.push({ type: 'exit' });
    }
    return;
  }
  s.phi = sp.phi;
  s.broken = sp.broken;
  s.c = sp.c;
  const spec = s.board !== null ? BOARDS[s.board] : null;
  switch (s.phase) {
    case 'off':
      if (depth > WATER.wadeIn) {
        go(s, 'wade');
        ev.push({ type: 'enter' });
      }
      return;
    case 'wade':
      if (depth < WATER.out) {
        go(s, 'off');
        ev.push({ type: 'exit' });
        return;
      }
      if (depth > WATER.swimIn) {
        if (spec !== null) {
          go(s, 'paddle');
          // lie down facing out to sea if you're heading that way
        } else go(s, 'swim');
        ev.push({ type: 'splash', k: 0.4 });
        return wadeStep(s, inp, q, dt, depth);
      }
      return wadeStep(s, inp, q, dt, depth);
    case 'swim':
      if (depth < WATER.swimOut) return go(s, 'wade');
      return swimStep(s, inp, q, dt);
    case 'duck':
      return duckStep(s, inp, q, dt, spec!);
    case 'paddle':
      if (depth < WATER.swimOut) return go(s, 'wade');
      return boardStep(s, inp, q, dt, spec!, true, ev);
    case 'pop':
    case 'ride':
      if (depth < WATER.ground) {
        bank(s, ev);
        ev.push({ type: 'splash', k: 0.3 });
        return go(s, 'wade');
      }
      return boardStep(s, inp, q, dt, spec!, false, ev);
    case 'air':
      return airStep(s, inp, q, dt, spec!, ev);
    case 'wipeout':
      return wipeStep(s, q, dt, depth);
  }
}

function bank(s: WaterState, ev: WaterEvent[]) {
  if (s.barrel > 0.35) {
    ev.push({ type: 'trick', name: `Barrel ${s.barrel.toFixed(1)}s`, points: Math.round(400 * s.barrel) });
  }
  s.barrel = 0;
  if (s.scored > 0 || s.rideT > 2) ev.push({ type: 'bank' });
  s.scored = 0;
  s.rideT = 0;
}

function wipeout(s: WaterState, ev: WaterEvent[], why: 'lip' | 'pearl' | 'landing' | 'closeout') {
  s.barrel = 0;
  s.scored = 0;
  s.rideT = 0;
  s.why = why;
  s.ready = false;
  s.caught = 0;
  go(s, 'wipeout');
  ev.push({ type: 'bail', why });
  ev.push({ type: 'splash', k: 1 });
}

/** Camera-relative move direction (unit or zero) and its magnitude. */
function moveDir(inp: WaterInput, out: { x: number; z: number }) {
  const fx = Math.sin(inp.camYaw);
  const fz = Math.cos(inp.camYaw);
  const mx = fx * inp.moveY - fz * inp.moveX;
  const mz = fz * inp.moveY + fx * inp.moveX;
  const m = Math.min(1, Math.hypot(inp.moveX, inp.moveY));
  const l = Math.hypot(mx, mz);
  out.x = l > 1e-4 ? mx / l : 0;
  out.z = l > 1e-4 ? mz / l : 0;
  return m;
}

const _m = { x: 0, z: 0 };

function wadeStep(s: WaterState, inp: WaterInput, q: SeaQuery, dt: number, depth: number) {
  const sp = _s;
  const m = moveDir(inp, _m);
  const drag = 1 - Math.min(0.55, depth * 0.45);
  const top = (inp.sprint ? WATER.wadeSprint : WATER.wade) * drag;
  const tx = _m.x * top * m;
  const tz = _m.z * top * m;
  const k = 1 - Math.exp(-6 * dt);
  s.vx += (tx - s.vx) * k;
  s.vz += (tz - s.vz) * k;
  // the bore shoves you about
  s.vx += sp.sx * sp.flow * 0.35 * dt * 4 * sp.foam;
  s.vz += sp.sz * sp.flow * 0.35 * dt * 4 * sp.foam;
  if (m > 0.05) s.yaw = s.yaw + angleDiff(Math.atan2(_m.x, _m.z), s.yaw) * (1 - Math.exp(-10 * dt));
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.y = q.ground(s.x, s.z);
  s.vy = 0;
  s.stroke += Math.hypot(s.vx, s.vz) * dt * 1.6;
  s.lean = 0;
  s.sit = 0;
}

function swimStep(s: WaterState, inp: WaterInput, q: SeaQuery, dt: number) {
  const sp = _s;
  const m = moveDir(inp, _m);
  const top = inp.sprint ? WATER.swimSprint : WATER.swim;
  const k = 1 - Math.exp(-2.5 * dt);
  s.vx += (_m.x * top * m - s.vx) * k;
  s.vz += (_m.z * top * m - s.vz) * k;
  // carried by the water (the bore throws you in)
  const push = sp.flow * (0.25 + sp.foam * sp.broken * 0.9);
  s.x += (s.vx + sp.sx * push) * dt;
  s.z += (s.vz + sp.sz * push) * dt;
  if (m > 0.05) s.yaw += angleDiff(Math.atan2(_m.x, _m.z), s.yaw) * (1 - Math.exp(-5 * dt));
  const p = q.at(s.x, s.z, _s);
  s.y = (p?.y ?? s.y) - WATER.swimDepth;
  s.vy = 0;
  s.stroke += dt * (m > 0.05 ? (inp.sprint ? 7 : 4.6) : 1.2);
  if (inp.duck) {
    go(s, 'duck');
  }
}

function duckStep(s: WaterState, inp: WaterInput, q: SeaQuery, dt: number, spec: BoardSpec | null) {
  // under the water: the wave rolls over, nothing pushes you
  const keep = Math.exp(-0.4 * dt);
  s.vx *= keep;
  s.vz *= keep;
  if (spec !== null && inp.moveY > 0.2) {
    const h = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
    s.vx += h.x * 1.2 * dt;
    s.vz += h.z * 1.2 * dt;
  }
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const p = q.at(s.x, s.z, _s);
  const k = Math.sin(Math.min(1, s.t / WATER.duckTime) * Math.PI);
  s.y = (p?.y ?? s.y) - (spec !== null ? 0 : WATER.swimDepth) - WATER.duckDepth * k;
  s.stroke += dt * 2;
  if (s.t >= WATER.duckTime) go(s, spec !== null ? 'paddle' : 'swim');
}

function wipeStep(s: WaterState, q: SeaQuery, dt: number, depth: number) {
  const sp = _s;
  // tumbled toward the beach by the whitewater, then you come up
  const push = sp.flow * (0.6 + sp.foam) * (1 - s.t / WATER.wipeTime);
  const keep = Math.exp(-2.2 * dt);
  s.vx = s.vx * keep + sp.sx * push * 0.5 * dt * 10;
  s.vz = s.vz * keep + sp.sz * push * 0.5 * dt * 10;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const p = q.at(s.x, s.z, _s);
  const k = Math.sin(Math.min(1, s.t / WATER.wipeTime) * Math.PI);
  s.y = Math.max(q.ground(s.x, s.z) + 0.2, (p?.y ?? s.y) - 0.5 - 0.9 * k);
  s.vy = 0;
  s.stroke += dt * 9;
  if (s.t >= WATER.wipeTime) {
    // face back out to sea
    s.yaw = Math.atan2(-sp.sx, -sp.sz);
    s.vx = 0;
    s.vz = 0;
    if (depth < WATER.swimOut) go(s, 'wade');
    else go(s, s.board !== null ? 'paddle' : 'swim');
  }
}

function boardStep(
  s: WaterState,
  inp: WaterInput,
  q: SeaQuery,
  dt: number,
  spec: BoardSpec,
  prone: boolean,
  ev: WaterEvent[],
) {
  const sp = _s;
  const hx = Math.sin(s.yaw);
  const hz = Math.cos(s.yaw);
  const sl = slopeAt(q, s.x, s.z);
  const g = WATER.g;
  // the water's own motion: orbital + the bore
  const wx = sp.sx * sp.flow;
  const wz = sp.sz * sp.flow;
  // (a prone board in the foamy inside mostly rides the whitewater, not the slope)
  const gk = prone ? 1 - 0.6 * sp.broken : 1;
  let ax = -g * sl.x * gk;
  let az = -g * sl.z * gk;
  const rx = s.vx - wx;
  const rz = s.vz - wz;
  const rl = Math.hypot(rx, rz);
  const standing = !prone && s.phase === 'ride';
  const drag = prone || s.phase === 'pop' ? WATER.proneDrag : spec.drag;
  // a stall (S) digs the tail in
  const stall = standing && inp.moveY < -0.3 ? 3.2 : 1;
  ax -= drag * stall * rl * rx;
  az -= drag * stall * rl * rz;
  // facing down the slope ("on the face"): + = the slope pushes the nose on
  const along = -(sl.x * hx + sl.z * hz);
  const pm = wrap(sp.phi);
  // On the unbroken face the wave drives the board (its water climbs the
  // face under you): toward the board's trim speed standing, toward the
  // wave's own speed once a prone board has caught it
  const smag = Math.hypot(sl.x, sl.z);
  const front = pm > Math.PI + 0.35 && pm < TAU - 0.08;
  const F = front ? smooth(0.02, 0.09, smag) * (1 - smooth(0.45, 0.85, sp.broken)) : 0;
  const caughtProne = prone && (s.ready || s.caught > 0);
  if (F > 0 && (!prone || caughtProne)) {
    const target = prone ? sp.c * 1.02 : spec.face;
    const vh = s.vx * hx + s.vz * hz;
    if (vh < target) {
      const a = Math.min(WATER.driveMax, (target - vh) * WATER.drive) * F;
      ax += hx * a;
      az += hz * a;
    }
  }
  if (prone) {
    // paddling: toward your paddling speed through the water
    const top = inp.sprint ? spec.sprint : spec.paddle;
    const vh = rx * hx + rz * hz;
    if (inp.moveY > 0.1 && vh < top) {
      const thrust = Math.min(2.4, (top - vh) * 1.5) * Math.min(1, inp.moveY * 1.4);
      ax += hx * thrust;
      az += hz * thrust;
    }
    // sit up and wait: brakes, and the board points where you look
    if (inp.moveY < -0.3) {
      ax -= s.vx * 1.5;
      az -= s.vz * 1.5;
    }
    // the whitewater shoves you back toward the beach (duck under it)
    // (only the front of it: once it's rolled past, the foam behind is harmless)
    const hit = pm > TAU - 1.4 || pm < 0.35 ? sp.broken * sp.foam : 0;
    if (hit > 0.25 && !caughtProne) {
      // toward the bore's own speed (it can't throw you faster than it goes)
      const vS = s.vx * sp.sx + s.vz * sp.sz;
      const want = sp.c * 0.75;
      if (vS < want) {
        const a = Math.min(WATER.whitewater, (want - vS) * 5) * (hit - 0.25);
        ax += sp.sx * a;
        az += sp.sz * a;
      }
    }
    s.yaw -= inp.moveX * WATER.proneTurn * dt;
    s.stroke += dt * (inp.moveY > 0.1 ? (inp.sprint ? 6.2 : 4.4) : 0);
    const still = Math.hypot(s.vx, s.vz) < 0.5 && Math.abs(inp.moveY) < 0.1;
    s.sit += ((still || inp.moveY < -0.3 ? 1 : 0) - s.sit) * (1 - Math.exp(-3 * dt));
    if (inp.duck) {
      go(s, 'duck');
      ev.push({ type: 'duck' });
      return;
    }
    // the catch: on the face, going with it, nearly its speed
    const vShore = s.vx * sp.sx + s.vz * sp.sz;
    const onFace = along > 0.04 && pm > Math.PI;
    if (onFace && vShore > sp.c * spec.catchFrac && sp.depth > 0.6) {
      s.caught += dt;
      if (s.caught > WATER.catchHold && !s.ready) {
        s.ready = true;
        ev.push({ type: 'catch' });
      }
    } else if (!s.ready) s.caught = Math.max(0, s.caught - dt * 2);
    if (s.ready) {
      s.caught += dt;
      const lost = vShore < sp.c * spec.catchFrac * 0.6;
      if (inp.jump) {
        go(s, 'pop');
        s.ready = false;
        s.caught = 0;
        s.sit = 0;
        ev.push({ type: 'pop' });
      } else if (lost || s.caught > WATER.popWindow + WATER.catchHold) {
        s.ready = false;
        s.caught = 0;
      }
    }
  } else {
    // standing: steer, pump on the face, crouch into turns
    const steer = inp.moveX;
    const v = Math.hypot(s.vx, s.vz);
    const rate = spec.turn * (1.15 - 0.35 * Math.min(1, v / 14));
    const dy = -steer * rate * dt * (s.phase === 'pop' ? 0.3 : 1);
    s.yaw += dy;
    s.lean += (steer - s.lean) * (1 - Math.exp(-8 * dt));
    s.crouch += ((Math.abs(steer) > 0.3 || inp.duckHeld ? 1 : 0.3) - s.crouch) * (1 - Math.exp(-6 * dt));
    if (s.phase === 'ride' && inp.moveY > 0.3 && Math.abs(along) > 0.08) {
      ax += hx * WATER.pump * inp.moveY;
      az += hz * WATER.pump * inp.moveY;
    }
    trackCarve(s, dy, pm, sp, ev, dt);
  }
  s.vx += ax * dt;
  s.vz += az * dt;
  // rails: planing forward, the velocity turns toward the nose (a carve
  // costs a little speed); otherwise they only bite on sideways slip
  const v = Math.hypot(s.vx, s.vz);
  const vf = s.vx * hx + s.vz * hz;
  if (v > 0.05) {
    const va = Math.atan2(s.vx, s.vz);
    const off = angleDiff(s.yaw, va);
    if (Math.abs(off) > 2.2 && standing && v > 2) {
      // sideways / backwards at speed: the rail catches
      return wipeout(s, ev, 'closeout');
    }
    if (!prone && vf > 0.5) {
      const grip = WATER.grip * dt;
      const turn = Math.max(-grip, Math.min(grip, off));
      const nv = v * (1 - WATER.carveLoss * Math.abs(turn));
      s.vx = Math.sin(va + turn) * nv;
      s.vz = Math.cos(va + turn) * nv;
    } else {
      const k = Math.exp(-(prone ? 3 : 6) * dt);
      const lx = s.vx - vf * hx;
      const lz = s.vz - vf * hz;
      s.vx = vf * hx + lx * k;
      s.vz = vf * hz + lz * k;
    }
  }
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const p = q.at(s.x, s.z, _s);
  const sy = p?.y ?? s.y;
  const lift = (sy - s.lastSy) / dt;
  s.lastSy = sy;
  s.y = sy;
  s.vy = lift;
  if (s.phase === 'pop') {
    // nose-diving off a steep drop (late pops pearl)
    if (along > 0.62 && sp.broken > 0.35) return wipeout(s, ev, 'pearl');
    if (s.t >= spec.pop) {
      go(s, 'ride');
      s.rideT = 0;
      s.lastSy = sy;
    }
    return;
  }
  if (!standing) return;
  s.rideT += dt;
  const vnow = Math.hypot(s.vx, s.vz);
  // the lip: on the top of a breaking wave, in front of the crest
  const nearCrest = pm > TAU - 1.05 || pm < 0.35;
  if (sp.broken > 0.62 && nearCrest && sp.foam > 0.55) return wipeout(s, ev, 'lip');
  // in the tube: the wave beside you (back along the crest) is breaking, you aren't
  if (pm > TAU - 1.4 && pm < TAU - 0.25 && sp.broken < 0.4) {
    // back along the crest = toward smaller a (it peels to +a)
    const a0 = sp.a;
    let ba = q.at(s.x - sp.sz * 6, s.z + sp.sx * 6, _t);
    if (ba !== null && ba.a > a0) ba = q.at(s.x + sp.sz * 6, s.z - sp.sx * 6, _t);
    if (ba !== null && ba.broken > 0.6) {
      s.barrel += dt;
      ev.push({ type: 'running', points: 60 * dt });
    }
  }
  // trim points while you're flying down the line
  if (vnow > 7) {
    ev.push({ type: 'running', points: 8 * dt });
    s.scored += 8 * dt;
  }
  // an air off the lip: moving up it fast, at the crest
  const upFace = -(sl.x * s.vx + sl.z * s.vz) < 0;
  if (nearCrest && lift > WATER.airLift && upFace && (inp.jump || lift > WATER.airLift * 1.9)) {
    s.vy = lift * spec.air + (inp.jump ? 2.4 : 0) * spec.air;
    s.airSpin = 0;
    s.airGrab = 0;
    go(s, 'air');
    ev.push({ type: 'air' });
    return;
  }
  // lost it: behind the crest and slower than the wave, or out of speed
  const vShore = s.vx * sp.sx + s.vz * sp.sz;
  if ((pm < Math.PI && pm > 0.5 && vShore < sp.c * 0.7) || vnow < 1.1) {
    bank(s, ev);
    s.sit = 0;
    go(s, 'paddle');
  }
}

/** Carves: bottom turns, cutbacks, snaps (scored when the turn ends). */
function trackCarve(s: WaterState, dy: number, pm: number, sp: SeaPoint, ev: WaterEvent[], dt: number) {
  if (s.phase !== 'ride') return;
  const v = Math.hypot(s.vx, s.vz);
  const sameWay = s.carve === 0 || Math.sign(dy) === Math.sign(s.carve);
  if (Math.abs(dy) > 1e-5 && sameWay && v > 3.5) {
    if (s.carve === 0) {
      s.carveT = 0;
      s.carvePm = pm;
    }
    s.carve += dy;
    s.carveT += dt;
    return;
  }
  const turn = Math.abs(s.carve);
  const t = s.carveT;
  const start = s.carvePm;
  s.carve = Math.abs(dy) > 1e-5 && v > 3.5 ? dy : 0;
  s.carveT = 0;
  s.carvePm = pm;
  if (t > 2.6) return;
  let name = '';
  let pts = 0;
  if (turn > 3.6) {
    name = 'Roundhouse Cutback';
    pts = 500;
  } else if (turn > 2.4) {
    name = 'Cutback';
    pts = 300;
  } else if (turn > 1.1 && t < 0.7 && (start > TAU - 1.3 || start < 0.3)) {
    name = sp.broken > 0.4 ? 'Re-entry' : 'Snap';
    pts = sp.broken > 0.4 ? 350 : 250;
  } else if (turn > 1.0 && start > Math.PI && start < TAU - 1.6) {
    name = 'Bottom Turn';
    pts = 150;
  }
  if (pts > 0) {
    s.scored += pts;
    ev.push({ type: 'trick', name, points: pts });
  }
}

function airStep(s: WaterState, inp: WaterInput, q: SeaQuery, dt: number, spec: BoardSpec, ev: WaterEvent[]) {
  s.vy -= WATER.g * dt;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.y += s.vy * dt;
  const dy = -inp.moveX * 5.2 * dt;
  s.yaw += dy;
  s.airSpin += dy;
  if (inp.duckHeld) s.airGrab += dt;
  s.crouch += ((inp.duckHeld ? 1 : 0.6) - s.crouch) * (1 - Math.exp(-8 * dt));
  const p = q.at(s.x, s.z, _s);
  if (p === null) return;
  if (s.y > p.y || s.vy > 0) return;
  // splashdown
  s.y = p.y;
  s.lastSy = p.y;
  const va = Math.atan2(s.vx, s.vz);
  const off = Math.abs(angleDiff(s.yaw, va));
  const spin = Math.abs(s.airSpin);
  const halves = Math.round(spin / Math.PI);
  const reverse = off > 2.3;
  if (off > 0.95 && !reverse) {
    ev.push({ type: 'land', clean: false });
    return wipeout(s, ev, 'landing');
  }
  if (reverse) {
    // landed backwards: spin round (the reverse)
    s.yaw = va;
  }
  const deg = Math.max(0, halves) * 180;
  let name = reverse ? 'Air Reverse' : deg >= 360 ? `Air ${deg}` : 'Air';
  if (s.airGrab > 0.25) name = `${name} Grab`;
  const pts = Math.round((300 + deg * 1.4 + (s.airGrab > 0.25 ? 150 : 0)) * spec.air);
  s.scored += pts;
  ev.push({ type: 'trick', name, points: pts });
  ev.push({ type: 'land', clean: true });
  ev.push({ type: 'splash', k: 0.6 });
  s.vy = 0;
  go(s, 'ride');
}
