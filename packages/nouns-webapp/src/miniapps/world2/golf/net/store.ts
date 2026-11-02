// ── Noun Golf: local bests (this browser only) ───────────────────────────
//
// A round is a local thing (no physics proof for the stats server, like
// NOUN PARKOUR's time trials): the best completed card per course and set
// of holes, plus a few lifetime counts. Key `noun-golf-v1:<course>:<set>`.

export interface GolfBest {
  /** Strokes for the set, its par, the card (per hole), when. */
  strokes: number;
  par: number;
  card: number[];
  at: number;
  name?: string;
}

export interface GolfLife {
  rounds: number;
  holesInOne: number;
  birdies: number;
  eagles: number;
}

const PREFIX = 'noun-golf-v1';

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** "all", "front", "back", "19" or the hole list. */
export function setKey(holes: number[]): string {
  const s = holes.join(',');
  if (holes.length === 19 && holes[0] === 1) return 'all';
  if (s === '1,2,3,4,5,6,7,8,9') return 'front';
  if (s === '10,11,12,13,14,15,16,17,18') return 'back';
  if (s === '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18') return '18';
  return s;
}

export function readBest(course: string, holes: number[]): GolfBest | null {
  try {
    const raw = ls()?.getItem(`${PREFIX}:${course}:${setKey(holes)}`);
    if (raw == null) return null;
    const b = JSON.parse(raw) as GolfBest;
    return typeof b.strokes === 'number' && Array.isArray(b.card) ? b : null;
  } catch {
    return null;
  }
}

/** Save if it beats the best (fewer strokes); returns true when it's a new best. */
export function saveBest(course: string, holes: number[], b: GolfBest): boolean {
  const old = readBest(course, holes);
  if (old !== null && old.strokes <= b.strokes) return false;
  try {
    ls()?.setItem(`${PREFIX}:${course}:${setKey(holes)}`, JSON.stringify(b));
  } catch {
    // storage full / blocked: the best just isn't kept
  }
  return true;
}

export function readLife(): GolfLife {
  try {
    const raw = ls()?.getItem(`${PREFIX}:life`);
    if (raw != null) return { rounds: 0, holesInOne: 0, birdies: 0, eagles: 0, ...JSON.parse(raw) };
  } catch {
    // fall through
  }
  return { rounds: 0, holesInOne: 0, birdies: 0, eagles: 0 };
}

export function bumpLife(d: Partial<GolfLife>): GolfLife {
  const l = readLife();
  const n: GolfLife = {
    rounds: l.rounds + (d.rounds ?? 0),
    holesInOne: l.holesInOne + (d.holesInOne ?? 0),
    birdies: l.birdies + (d.birdies ?? 0),
    eagles: l.eagles + (d.eagles ?? 0),
  };
  try {
    ls()?.setItem(`${PREFIX}:life`, JSON.stringify(n));
  } catch {
    // ignore
  }
  return n;
}
