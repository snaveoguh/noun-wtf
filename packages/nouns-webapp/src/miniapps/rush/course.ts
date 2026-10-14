// ── Noun Rush course: one long run, five zones, pure data + rules ──────
//
// Distance `s` runs from the start gate (0) to past the dance floor; the
// world maps it to z = -s. `x` is across the track (0 = centre line).
//
//   SNOW     snowboard down the mountain, dodge pines, hit the kickers
//   TOWN     pick a ride by lane: car / motorbike / tractor
//   GRASS    rides parked at the gate, run fast, jump the hurdles
//   AIRPORT  pick a lane again: helicopter or plane, take off
//   SKY      fly through rings over the sea, land on the dance floor
//   FINISH   the dance floor

export type Zone = 'snow' | 'town' | 'grass' | 'airport' | 'sky' | 'finish';
export type Ride = 'foot' | 'board' | 'car' | 'moto' | 'tractor' | 'heli' | 'plane';

export const TRACK_W = 24;
export const HALF_W = TRACK_W / 2;

export const ZONES: { zone: Zone; from: number; to: number; label: string }[] = [
  { zone: 'snow', from: 0, to: 400, label: 'SNOW MOUNTAIN' },
  { zone: 'town', from: 400, to: 760, label: 'NOUN TOWN' },
  { zone: 'grass', from: 760, to: 1000, label: 'THE GRASS' },
  { zone: 'airport', from: 1000, to: 1100, label: 'NOUN AIRPORT' },
  { zone: 'sky', from: 1100, to: 1420, label: 'THE SKY' },
  { zone: 'finish', from: 1420, to: 1520, label: 'DANCE FLOOR' },
];

/** Where the ride stalls / gates sit. */
export const VEHICLE_GATE = 430;
export const PARK_GATE = 770;
export const HANGAR_GATE = 1040;
export const TAKEOFF_END = 1110;
export const LANDING_START = 1370;
export const FINISH_LINE = 1420;
export const COURSE_END = 1500;

/** Cruising height over the sea (relative to y = 0). */
export const CRUISE_Y = 22;
export const SEA_Y = -22;

export function zoneAt(s: number): Zone {
  for (const z of ZONES) if (s < z.to) return z.zone;
  return 'finish';
}

export function zoneLabel(z: Zone): string {
  return ZONES.find(q => q.zone === z)?.label ?? '';
}

const SNOW_TOP = 130;

/** Height of the ridable surface (the sky zone has none: the sea is far below). */
export function groundY(s: number, x: number): number {
  if (s < 400) {
    const t = Math.max(0, s);
    // Steep at the top, easing out onto the town flat
    const u = t / 400;
    const base = SNOW_TOP * (1 - u) * (1 - u * 0.35);
    const moguls = Math.sin(t * 0.21) * Math.cos(x * 0.45) * 0.6 * (1 - u);
    return base + moguls;
  }
  if (s < 760) return 0;
  if (s < 1000)
    return Math.sin((s - 760) * 0.05) * 1.2 * Math.min(1, (s - 760) / 30, (1000 - s) / 30);
  if (s < 1100) return 0;
  if (s < FINISH_LINE - 20) return SEA_Y;
  return 0;
}

/** Slope along the track (for snowboard speed + rider lean). */
export function slopeAt(s: number): number {
  return (groundY(s - 1, 0) - groundY(s + 1, 0)) / 2;
}

/** Scenery height off the track: mountains, a flat town, hills, the sea. */
export function terrainY(s: number, x: number): number {
  const ax = Math.abs(x);
  const off = Math.max(0, ax - HALF_W - 2);
  if (s < 400) {
    const g = groundY(s, Math.sign(x) * Math.min(ax, HALF_W));
    // Gentle banks by the run, real mountains further out
    const far = Math.max(0, off - 25);
    return g + off * 0.25 + far * far * 0.006 + Math.sin(s * 0.03 + x * 0.08) * off * 0.15;
  }
  if (s < 760) return 0;
  if (s < 1000) return groundY(s, 0) + Math.sin(s * 0.04 + x * 0.1) * Math.min(off, 20) * 0.25;
  if (s < 1110) return 0;
  if (s < FINISH_LINE - 30) return SEA_Y;
  return s < COURSE_END ? (ax < 40 ? 0 : SEA_Y) : SEA_Y;
}

export interface RideSpec {
  label: string;
  speed: number;
  steer: number;
  /** Smashes through cones and bins instead of crashing. */
  ram: boolean;
  flies: boolean;
}

export const RIDES: Record<Ride, RideSpec> = {
  foot: { label: 'RUNNING', speed: 17, steer: 11, ram: false, flies: false },
  board: { label: 'SNOWBOARD', speed: 22, steer: 12, ram: false, flies: false },
  car: { label: 'CAR', speed: 31, steer: 10, ram: false, flies: false },
  moto: { label: 'MOTORBIKE', speed: 33, steer: 13, ram: false, flies: false },
  tractor: { label: 'TRACTOR', speed: 25, steer: 9, ram: true, flies: false },
  heli: { label: 'HELICOPTER', speed: 31, steer: 14, ram: false, flies: true },
  plane: { label: 'PLANE', speed: 36, steer: 10, ram: false, flies: true },
};

/** Lanes at the ride stalls, left to right. */
export const TOWN_LANES: Ride[] = ['car', 'moto', 'tractor'];
export const SKY_LANES: Ride[] = ['heli', 'plane'];

export function laneRide(lanes: Ride[], x: number): Ride {
  const t = (x + HALF_W) / TRACK_W;
  const i = Math.min(lanes.length - 1, Math.max(0, Math.floor(t * lanes.length)));
  return lanes[i]!;
}

export function laneCentre(lanes: Ride[], i: number): number {
  return -HALF_W + (TRACK_W / lanes.length) * (i + 0.5);
}

/** What you ride at distance s, given the ride you picked at each stall. */
export function rideFor(s: number, town: Ride, sky: Ride): Ride {
  if (s < 400) return 'board';
  if (s < VEHICLE_GATE) return 'foot';
  if (s < PARK_GATE) return town;
  if (s < HANGAR_GATE) return 'foot';
  if (s < FINISH_LINE) return sky;
  return 'foot';
}

// ── Things on the course ────────────────────────────────────────────

export type ObstacleKind = 'pine' | 'rock' | 'cone' | 'bin' | 'hurdle' | 'balloon';
export interface Obstacle {
  kind: ObstacleKind;
  s: number;
  x: number;
  /** Hit radius across / along the track. */
  r: number;
  /** Top of the obstacle above its base (jump over it if you're higher). */
  h: number;
  /** Base height (balloons float). */
  y: number;
  /** Rams knock it flying; then it's gone. */
  smashed: boolean;
}

export type PickupKind = 'fanta' | 'orange';
export interface Pickup {
  kind: PickupKind;
  s: number;
  x: number;
  y: number;
  /** Seconds until it's back (0 = there). */
  gone: number;
}

export interface Ring {
  s: number;
  x: number;
  y: number;
}

export interface Kicker {
  s: number;
  x: number;
  w: number;
}

export interface Course {
  obstacles: Obstacle[];
  pickups: Pickup[];
  rings: Ring[];
  kickers: Kicker[];
}

/** Deterministic PRNG so every race gets the same mountain. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCourse(seed = 2026): Course {
  const rnd = mulberry32(seed);
  const across = (pad = 1.5) => -HALF_W + pad + rnd() * (TRACK_W - pad * 2);
  const obstacles: Obstacle[] = [];
  const pickups: Pickup[] = [];
  const rings: Ring[] = [];
  const kickers: Kicker[] = [];

  // Snow: pines and rocks, never a full wall
  for (let s = 40; s < 385; s += 11 + rnd() * 9) {
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const pine = rnd() < 0.75;
      obstacles.push({
        smashed: false,
        kind: pine ? 'pine' : 'rock',
        s: s + rnd() * 4,
        x: across(),
        r: pine ? 0.9 : 1.1,
        h: pine ? 7 : 1.2,
        y: 0,
      });
    }
  }
  for (const s of [90, 175, 260, 345]) kickers.push({ s, x: across(5), w: 6 });

  // Town: cones and bins, cleared stall zone
  for (let s = VEHICLE_GATE + 30; s < 745; s += 13 + rnd() * 10) {
    const cone = rnd() < 0.65;
    obstacles.push({
      smashed: false,
      kind: cone ? 'cone' : 'bin',
      s,
      x: across(),
      r: cone ? 0.55 : 0.8,
      h: cone ? 0.8 : 1.3,
      y: 0,
    });
  }

  // Grass: hurdle rows with one gap — jump or find the hole
  for (let s = PARK_GATE + 35; s < 985; s += 32) {
    const gap = Math.floor(rnd() * 4);
    for (let i = 0; i < 4; i++) {
      if (i === gap) continue;
      obstacles.push({
        smashed: false,
        kind: 'hurdle',
        s,
        x: -HALF_W + 3 + i * 6,
        r: 3,
        h: 1,
        y: 0,
      });
    }
  }

  // Sky: rings to thread, hot-air balloons to dodge
  for (let s = TAKEOFF_END + 25; s < LANDING_START - 10; s += 24) {
    rings.push({ s, x: across(4), y: CRUISE_Y - 8 + rnd() * 16 });
  }
  for (let s = TAKEOFF_END + 40; s < LANDING_START - 20; s += 37 + rnd() * 20) {
    obstacles.push({
      smashed: false,
      kind: 'balloon',
      s,
      x: across(3),
      r: 2.6,
      h: 6,
      y: CRUISE_Y - 6 + rnd() * 10,
    });
  }

  // Fanta (boost) and oranges (points) all the way along
  for (let s = 25; s < FINISH_LINE - 15; s += 9 + rnd() * 8) {
    const z = zoneAt(s);
    if (Math.abs(s - VEHICLE_GATE) < 18 || Math.abs(s - HANGAR_GATE) < 18) continue;
    const fanta = rnd() < 0.22;
    const flying = z === 'sky' || (z === 'airport' && s > HANGAR_GATE + 20);
    const y = flying ? CRUISE_Y - 6 + rnd() * 12 : 1.1;
    const x = across(2);
    if (!fanta && rnd() < 0.5) {
      // little line of oranges
      for (let k = 0; k < 4; k++) pickups.push({ kind: 'orange', s: s + k * 2.2, x, y, gone: 0 });
      s += 6;
    } else pickups.push({ kind: fanta ? 'fanta' : 'orange', s, x, y, gone: 0 });
  }

  return { obstacles, pickups, rings, kickers };
}

// ── Racers ──────────────────────────────────────────────────────────

export interface Racer {
  id: number;
  name: string;
  human: boolean;
  s: number;
  x: number;
  y: number;
  vy: number;
  vx: number;
  speed: number;
  ride: Ride;
  town: Ride;
  sky: Ride;
  grounded: boolean;
  /** Seconds left knocked silly (punched or crashed). */
  stun: number;
  boost: number;
  punchCd: number;
  /** Seconds since the last punch thrown (for the swing pose). */
  punchT: number;
  oranges: number;
  finished: boolean;
  finishTime: number;
  place: number;
  /** AI only. */
  skill: number;
  lane: number;
  aggro: number;
  /** Air time for kickers / hurdles (pose). */
  air: number;
  /** Where on the dance floor this racer ends up. */
  danceX: number;
  danceS: number;
}

export function newRacer(id: number, name: string, human: boolean, x: number, skill = 1): Racer {
  return {
    id,
    name,
    human,
    s: -2 - (id % 2) * 2,
    x,
    y: groundY(0, x),
    vy: 0,
    vx: 0,
    speed: 0,
    ride: 'board',
    town: 'car',
    sky: 'plane',
    grounded: true,
    stun: 0,
    boost: 0,
    punchCd: 0,
    punchT: 9,
    oranges: 0,
    finished: false,
    finishTime: 0,
    place: 0,
    skill,
    lane: x,
    aggro: 0,
    air: 0,
    danceX: 0,
    danceS: FINISH_LINE + 30,
  };
}

export interface Controls {
  steer: number;
  /** -1 brake … +1 sprint */
  throttle: number;
  /** Fliers: +1 climb, -1 dive */
  climb: number;
  jump: boolean;
  punch: boolean;
}

export const NO_CONTROLS: Controls = { steer: 0, throttle: 0, climb: 0, jump: false, punch: false };

export interface RaceEvent {
  kind:
    | 'pickup'
    | 'crash'
    | 'punch'
    | 'punched'
    | 'ring'
    | 'ride'
    | 'finish'
    | 'zone'
    | 'kicker'
    | 'smash';
  racer: Racer;
  other?: Racer;
  text?: string;
}

const GRAV = 26;
const BOOST_MUL = 1.45;
const PUNCH_RANGE_X = 2.4;
const PUNCH_RANGE_S = 3.2;

/** Advance the race by dt. Returns what happened (for sounds, flashes, HUD). */
export function stepRace(
  racers: Racer[],
  course: Course,
  controls: Map<number, Controls>,
  dt: number,
  clock: number,
): RaceEvent[] {
  const ev: RaceEvent[] = [];
  for (const p of course.pickups) if (p.gone > 0) p.gone = Math.max(0, p.gone - dt);

  for (const r of racers) {
    const c = controls.get(r.id) ?? NO_CONTROLS;
    const prevS = r.s;
    const prevZone = zoneAt(prevS);

    const ride = rideFor(r.s, r.town, r.sky);
    if (ride !== r.ride) {
      r.ride = ride;
      ev.push({ kind: 'ride', racer: r, text: RIDES[ride].label });
    }
    const spec = RIDES[r.ride];

    r.stun = Math.max(0, r.stun - dt);
    r.boost = Math.max(0, r.boost - dt);
    r.punchCd = Math.max(0, r.punchCd - dt);
    r.punchT += dt;

    // Speed
    let target = spec.speed;
    if (r.ride === 'board') target += Math.max(0, slopeAt(r.s)) * 22;
    if (!r.human) target *= r.skill;
    target *= 1 + c.throttle * (c.throttle > 0 ? 0.12 : 0.45);
    if (r.boost > 0) target *= BOOST_MUL;
    if (r.stun > 0) target *= 0.25;
    if (r.finished) target = Math.max(0, Math.min(target, (r.danceS - r.s) * 2.5));
    const accel = r.stun > 0 ? 30 : target > r.speed ? 14 : 22;
    r.speed += Math.sign(target - r.speed) * Math.min(Math.abs(target - r.speed), accel * dt);
    r.s += r.speed * dt;
    // The lane you cross each stall in picks your ride
    if (prevS < VEHICLE_GATE && r.s >= VEHICLE_GATE) r.town = laneRide(TOWN_LANES, r.x);
    if (prevS < HANGAR_GATE && r.s >= HANGAR_GATE) r.sky = laneRide(SKY_LANES, r.x);

    // Steering
    const steerTarget = (r.stun > 0 ? 0 : c.steer) * spec.steer;
    r.vx += (steerTarget - r.vx) * Math.min(1, dt * 8);
    r.x += r.vx * dt;
    const halfW = r.finished ? 30 : HALF_W - 0.6;
    if (r.finished) r.x += (r.danceX - r.x) * Math.min(1, dt * 1.5);
    if (Math.abs(r.x) > halfW) {
      r.x = Math.sign(r.x) * halfW;
      r.vx = 0;
    }

    // Vertical
    if (spec.flies) {
      let want: number;
      if (r.s < TAKEOFF_END) {
        // Rolling down the runway, then climb out
        const t = Math.max(0, (r.s - HANGAR_GATE - 15) / (TAKEOFF_END - HANGAR_GATE - 15));
        want = t * t * CRUISE_Y;
        r.y += (want - r.y) * Math.min(1, dt * 4);
      } else if (r.s > LANDING_START) {
        const t = Math.min(1, (r.s - LANDING_START) / (FINISH_LINE - LANDING_START));
        want = (1 - t) * Math.max(4, r.y);
        r.y += (want - r.y) * Math.min(1, dt * 3);
      } else {
        const climbRate = r.ride === 'heli' ? 13 : 10;
        r.y += c.climb * climbRate * dt;
        r.y = Math.min(CRUISE_Y + 16, Math.max(CRUISE_Y - 14, r.y));
      }
      r.vy = 0;
      r.grounded = r.y < 0.05;
      r.air = 0;
    } else {
      const g = groundY(r.s, r.x);
      if (r.grounded) {
        if (c.jump && r.stun <= 0) {
          r.vy = r.ride === 'board' ? 10 : r.ride === 'foot' ? 9.5 : 8;
          r.grounded = false;
          r.y = Math.max(r.y, g) + 0.05;
        } else {
          r.y = g;
          r.vy = 0;
        }
        // Kickers launch you
        for (const k of course.kickers) {
          if (prevS < k.s && r.s >= k.s && Math.abs(r.x - k.x) < k.w / 2) {
            r.vy = 13 + r.speed * 0.15;
            r.grounded = false;
            ev.push({ kind: 'kicker', racer: r });
          }
        }
      }
      if (!r.grounded) {
        r.vy -= GRAV * dt;
        r.y += r.vy * dt;
        r.air += dt;
        if (r.y <= g) {
          r.y = g;
          r.vy = 0;
          r.grounded = true;
          r.air = 0;
        }
      }
    }

    // Obstacles
    if (r.stun <= 0 && !r.finished) {
      for (const o of course.obstacles) {
        if (o.smashed) continue;
        if (Math.abs(o.s - r.s) > o.r + 0.6 || Math.abs(o.x - r.x) > o.r + 0.5) continue;
        const base = o.kind === 'balloon' ? o.y : groundY(o.s, o.x);
        const feet = r.y;
        if (o.kind !== 'balloon' && feet > base + o.h) continue; // cleared it
        if (o.kind === 'balloon' && (feet > base + o.h || feet + 3 < base)) continue;
        if (spec.ram && (o.kind === 'cone' || o.kind === 'bin')) {
          o.smashed = true;
          ev.push({ kind: 'smash', racer: r });
          continue;
        }
        r.stun = o.kind === 'hurdle' || o.kind === 'cone' ? 0.6 : 1.1;
        r.speed *= 0.35;
        r.boost = 0;
        ev.push({ kind: 'crash', racer: r, text: o.kind });
        break;
      }
    }

    // Pickups
    for (const p of course.pickups) {
      if (p.gone > 0) continue;
      const py = p.y + (p.y > 3 ? 0 : groundY(p.s, p.x));
      if (Math.abs(p.s - r.s) > 1.6 || Math.abs(p.x - r.x) > 1.4) continue;
      if (Math.abs(py - (r.y + 1)) > (spec.flies ? 3 : 2.2)) continue;
      p.gone = p.kind === 'fanta' ? 8 : 12;
      if (p.kind === 'fanta') r.boost = 2.6;
      else r.oranges++;
      ev.push({ kind: 'pickup', racer: r, text: p.kind });
    }

    // Rings
    if (spec.flies) {
      for (const g of course.rings) {
        if (prevS < g.s && r.s >= g.s && Math.hypot(r.x - g.x, r.y - g.y) < 4.2) {
          r.boost = Math.max(r.boost, 1.6);
          ev.push({ kind: 'ring', racer: r });
        }
      }
    }

    // Finish
    if (!r.finished && r.s >= FINISH_LINE) {
      r.finished = true;
      r.finishTime = clock;
      r.place = racers.filter(o => o.finished).length;
      // Line up on the dance floor in finishing order
      const spot = r.place - 1;
      r.danceX = (spot - (racers.length - 1) / 2) * 4.2;
      r.danceS = FINISH_LINE + 34 - (spot % 2) * 3;
      ev.push({ kind: 'finish', racer: r });
    }

    const z = zoneAt(r.s);
    if (z !== prevZone) ev.push({ kind: 'zone', racer: r, text: zoneLabel(z) });
  }

  // Punches: a jab knocks whoever's next to you silly
  for (const r of racers) {
    const c = controls.get(r.id) ?? NO_CONTROLS;
    if (!c.punch || r.punchCd > 0 || r.stun > 0 || r.finished) continue;
    r.punchCd = 0.8;
    r.punchT = 0;
    let hit: Racer | undefined;
    let best = Infinity;
    for (const o of racers) {
      if (o === r || o.finished || o.stun > 0.3) continue;
      const ds = Math.abs(o.s - r.s);
      const dx = Math.abs(o.x - r.x);
      const dy = Math.abs(o.y - r.y);
      if (ds < PUNCH_RANGE_S && dx < PUNCH_RANGE_X && dy < 2.5 && ds + dx < best) {
        best = ds + dx;
        hit = o;
      }
    }
    if (hit !== undefined) {
      hit.stun = 1.2;
      hit.speed *= 0.4;
      hit.boost = 0;
      hit.vx = Math.sign(hit.x - r.x || 1) * 9;
      ev.push({ kind: 'punch', racer: r, other: hit });
    }
  }

  return ev;
}

/** Race order: finishers by place, then by distance. */
export function standings(racers: Racer[]): Racer[] {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.place - b.place;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.s - a.s;
  });
}

// ── Rival AI ────────────────────────────────────────────────────────

export function aiControls(
  r: Racer,
  racers: Racer[],
  course: Course,
  clock: number,
  rnd: () => number,
): Controls {
  const c: Controls = { steer: 0, throttle: 0, climb: 0, jump: false, punch: false };
  if (r.finished) return c;
  const spec = RIDES[r.ride];

  // Lane plan: aim for the stall lane before each gate
  let laneX = r.lane + Math.sin(clock * 0.3 + r.id * 1.7) * 4;
  if (r.s > VEHICLE_GATE - 70 && r.s < VEHICLE_GATE) laneX = laneCentre(TOWN_LANES, r.id % 3);
  if (r.s > HANGAR_GATE - 60 && r.s < HANGAR_GATE) laneX = laneCentre(SKY_LANES, r.id % 2);

  // Dodge whatever's ahead
  let dodge = 0;
  for (const o of course.obstacles) {
    if (o.smashed) continue;
    const ahead = o.s - r.s;
    if (ahead < 0 || ahead > 16) continue;
    if (spec.ram && (o.kind === 'cone' || o.kind === 'bin')) continue;
    if (o.kind === 'hurdle') continue; // jumped, below
    if (o.kind === 'balloon' && Math.abs(o.y + 3 - r.y) > 5) continue;
    const dx = r.x - o.x;
    if (Math.abs(dx) < o.r + 1.6) dodge += Math.sign(dx || (r.id % 2 ? 1 : -1)) * (1 - ahead / 16);
  }

  // Fliers chase the next ring
  let targetY = CRUISE_Y;
  if (spec.flies) {
    const ring = course.rings.find(g => g.s > r.s + 2 && g.s < r.s + 40);
    if (ring !== undefined) {
      laneX = ring.x;
      targetY = ring.y;
    }
    c.climb = Math.max(-1, Math.min(1, (targetY - r.y) * 0.3));
  }

  const want = laneX + dodge * 6;
  c.steer = Math.max(-1, Math.min(1, (want - r.x) * 0.35));

  // Jump hurdles (and sometimes fluff it)
  if (r.grounded && !spec.flies) {
    for (const o of course.obstacles) {
      if (o.kind !== 'hurdle') continue;
      const ahead = o.s - r.s;
      if (ahead > 2.5 && ahead < 4.2 && Math.abs(o.x - r.x) < o.r + 0.5) {
        if (rnd() < 0.82 + r.skill * 0.1) c.jump = true;
      }
    }
  }

  // Rubber band: stay in the hunt, don't run away with it
  const human = racers.find(o => o.human);
  if (human !== undefined) {
    const gap = r.s - human.s;
    c.throttle = gap > 40 ? -0.25 : gap < -30 ? 1 : 0.2;
  }

  // Throw a punch at whoever's alongside, now and then
  if (clock > r.aggro && clock > 4) {
    for (const o of racers) {
      if (o === r || o.finished) continue;
      if (Math.abs(o.s - r.s) < 2.5 && Math.abs(o.x - r.x) < 2.2 && rnd() < 0.03) {
        c.punch = true;
        r.aggro = clock + 2.5 + rnd() * 2;
        break;
      }
    }
  }
  return c;
}
