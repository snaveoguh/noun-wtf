// ── NOUN TAXI on the wire: the optional `tx` pose-blob key (pure) ─────────
//
// While you're on a taxi shift, or carrying a hitchhiker in any car, your
// pose blob carries `tx: [state, dest]`:
//   state  0 on shift, cab empty (the light's on: for hire)
//          1 a fare aboard
//          2 a hitchhiker aboard
//   dest   where they're going (a destination name, ≤ 24 chars), '' if none.
// The car itself goes out as before (vh 'car' + cr, cars/netCar.ts). Others
// put "🚕 → DRY GULCH" under your name tag. Older clients ignore `tx`.

export interface TaxiWire {
  state: 0 | 1 | 2;
  dest: string;
}

const DEST_RE = /^[\w !&',.?-]{0,24}$/;

export function encodeTaxi(t: TaxiWire): [number, string] {
  const dest = t.dest
    .toUpperCase()
    .replace(/[^\w !&',.?-]/g, '')
    .slice(0, 24);
  return [t.state, dest];
}

export function decodeTaxi(v: unknown): TaxiWire | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [s, d] = v as unknown[];
  if (s !== 0 && s !== 1 && s !== 2) return null;
  if (typeof d !== 'string' || !DEST_RE.test(d)) return null;
  return { state: s, dest: d };
}

/** The line under a remote rider's name tag. */
export function taxiTag(t: TaxiWire | null): string {
  if (t === null) return '';
  if (t.state === 0) return '🚕 FOR HIRE';
  const icon = t.state === 1 ? '🚕' : '👍';
  return t.dest === '' ? icon : `${icon} → ${t.dest}`;
}
