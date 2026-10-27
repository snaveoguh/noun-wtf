// ── 3D Grand Exchange: the multiplayer wire format (pure) ────────────────
//
// Players in the Exchange share their own PartyServer room (EXCHANGE_ROOM,
// on the same worker as Noun World), so the plaza's traffic isn't mixed in.
// The deployed relay only forwards whitelisted `world:move` fields, so we
// pack exactly like world2/net/Net.ts does:
//   x, y        → world X, Z          airborneY    → world Y
//   flipRotation → yaw                seedKey      → the rider's Noun
//   state       → a JSON blob (v: 2, so it reads as a Noun World pose):
//     a   anim ('idle' | 'walk' | 'run')   m 'foot'   sp speed   n name
//     w   build weight (-1 … 1)            q yaw as a quaternion (Net.ts)
//   and, new for the Exchange (older clients ignore unknown keys):
//     gt  your public exchange tag ('r:…', the masked tag the order book
//         and the floor feed already show; never the raw rider id)
//     go  [seq, toTag]: "I just sent toTag an offer" (they refresh now)
// No worker change is needed: the relay passes `state` through untouched.

export const EXCHANGE_ROOM = 'noun-world-v2-exchange';
export const SEND_HZ = 10;

export type PeerAnim = 'idle' | 'walk' | 'run';

export interface PeerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: PeerAnim;
  speed: number;
  name: string;
  seedKey: string;
  weight: number;
  /** Their public exchange tag ('' when they didn't send one). */
  tag: string;
  /** Their last offer ping, if any. */
  ping: { seq: number; to: string } | null;
}

const TAG_RE = /^r:[\da-z]{1,12}$/;
const SEED_RE = /^\d{1,4}-\d{1,4}-\d{1,4}-\d{1,4}-\d{1,4}$/;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const isTag = (v: unknown): v is string => typeof v === 'string' && TAG_RE.test(v);

/** The `world:move` message for my pose. */
export function packMove(p: PeerPose): string {
  const h = p.yaw / 2;
  const blob: Record<string, unknown> = {
    v: 2,
    gx: 1,
    q: [0, r3(Math.sin(h)), 0, r3(Math.cos(h))],
    a: p.anim,
    m: 'foot',
    sp: r3(p.speed),
    n: p.name.slice(0, 24),
    w: r3(Math.max(-1, Math.min(1, p.weight))),
    ...(isTag(p.tag) ? { gt: p.tag } : {}),
    ...(p.ping !== null && isTag(p.ping.to) ? { go: [p.ping.seq, p.ping.to] } : {}),
  };
  return JSON.stringify({
    type: 'world:move',
    x: r3(p.x),
    y: r3(p.z),
    airborneY: r3(p.y),
    flipRotation: r3(p.yaw),
    direction: 'down',
    state: JSON.stringify(blob),
    hp: 100,
    nounId: 0,
    seedKey: SEED_RE.test(p.seedKey) ? p.seedKey : '0-0-0-0-0',
    scaleX: 1,
    attackType: null,
    attackTimer: 0,
  });
}

/** A relayed `world:player` (or a `world:sync` entry) → a pose; null if it isn't an Exchange walker. */
export function parseMove(d: Record<string, unknown>): PeerPose | null {
  if (typeof d.state !== 'string' || !d.state.startsWith('{') || d.state.length > 2000) return null;
  let blob: Record<string, unknown>;
  try {
    blob = JSON.parse(d.state) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (blob.v !== 2 || blob.gx !== 1) return null;
  const anim: PeerAnim = blob.a === 'walk' || blob.a === 'run' ? blob.a : 'idle';
  let ping: PeerPose['ping'] = null;
  if (Array.isArray(blob.go) && blob.go.length >= 2) {
    const [seq, to] = blob.go as unknown[];
    if (typeof seq === 'number' && Number.isInteger(seq) && isTag(to)) ping = { seq, to };
  }
  const seedKey =
    typeof d.seedKey === 'string' && SEED_RE.test(d.seedKey) ? d.seedKey : '0-0-0-0-0';
  return {
    x: num(d.x),
    y: Math.max(-2, Math.min(20, num(d.airborneY))),
    z: num(d.y),
    yaw: num(d.flipRotation),
    anim,
    speed: Math.max(0, Math.min(20, num(blob.sp))),
    name: String(blob.n ?? '')
      .replace(/[\u0000-\u001f]/g, '')
      .slice(0, 24),
    seedKey,
    weight: Math.max(-1, Math.min(1, num(blob.w))),
    tag: isTag(blob.gt) ? blob.gt : '',
    ping,
  };
}

/** A remote player's recent poses, played back a little in the past. */
export class PeerBuffer {
  private s: { t: number; p: PeerPose }[] = [];
  last = 0;

  push(t: number, p: PeerPose) {
    this.s.push({ t, p });
    if (this.s.length > 8) this.s.shift();
    this.last = t;
  }

  get latest(): PeerPose | null {
    return this.s[this.s.length - 1]?.p ?? null;
  }

  /** The pose at time `t` (interpolated; yaw the short way round). */
  sample(t: number): PeerPose | null {
    const s = this.s;
    if (s.length === 0) return null;
    if (t <= s[0]!.t) return s[0]!.p;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i]!;
      const b = s[i + 1]!;
      if (t >= a.t && t <= b.t) {
        const k = (t - a.t) / Math.max(1, b.t - a.t);
        let dy = b.p.yaw - a.p.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        return {
          ...b.p,
          x: a.p.x + (b.p.x - a.p.x) * k,
          y: a.p.y + (b.p.y - a.p.y) * k,
          z: a.p.z + (b.p.z - a.p.z) * k,
          yaw: a.p.yaw + dy * k,
        };
      }
    }
    return s[s.length - 1]!.p;
  }
}
