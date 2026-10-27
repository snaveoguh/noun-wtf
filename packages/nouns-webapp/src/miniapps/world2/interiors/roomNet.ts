// ── Who's in the room with you (multiplayer indoors) ─────────────────────
//
// A room is built in the pocket over its door (`POCKET_Y`, origin
// `(door.x, POCKET_Y, door.z)`), and the door's position and id are the same
// on every client, so a rider's world position inside is already in a frame
// everyone shares: room-local = pos − origin (`toRoom`). What the street
// position can't say is which room and which floor, so the pose blob carries,
// only while inside:
//   in  [doorId, level, seat]   seat = the ground floor's seat index, −1 standing
// Riders are drawn only where you are: in the street, those with no `in`; in
// a room, those with the same door and floor. Older clients ignore `in` and
// keep drawing someone inside 4 km over their door, as before.

export interface RoomKey {
  door: string;
  level: number;
  /** Sat on this ground-floor seat (`Layout.seats`), −1 = standing. */
  seat: number;
}

export type RoomWire = [string, number, number];

const DOOR_RE = /^[\w#./:\-]{1,80}$/;
const MAX_LEVEL = 40;
const MAX_SEAT = 255;

export function encodeRoom(k: RoomKey): RoomWire {
  return [k.door, k.level, k.seat];
}

/** A blob's `in` → the room (null: not inside, or anything malformed). */
export function decodeRoom(v: unknown): RoomKey | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [door, level, seat] = v as unknown[];
  if (typeof door !== 'string' || !DOOR_RE.test(door)) return null;
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > MAX_LEVEL)
    return null;
  const s =
    typeof seat === 'number' && Number.isInteger(seat) && seat >= 0 && seat <= MAX_SEAT ? seat : -1;
  return { door, level, seat: s };
}

/** Whether a rider in `them` is drawn for a viewer in `me` (null = the street). */
export function sameSpace(me: RoomKey | null, them: RoomKey | null): boolean {
  if (me === null || them === null) return me === them;
  return me.door === them.door && me.level === them.level;
}

/** A seated rider's spot: on the seat, a touch back, facing its way (room frame). */
export function seatSpot(seat: { x: number; z: number; yaw: number }): {
  x: number;
  z: number;
  yaw: number;
} {
  return {
    x: seat.x - Math.sin(seat.yaw) * 0.08,
    z: seat.z - Math.cos(seat.yaw) * 0.08,
    yaw: seat.yaw,
  };
}
