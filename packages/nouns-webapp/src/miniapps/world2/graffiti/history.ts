// ── Graffiti bookkeeping (pure: no three.js, no canvas) ─────────────────
//
// WallLog: every tag a wall has seen, in arrival order, plus the strokes
// that undo has taken down. The renderer redraws a wall from `items()`.
//
// SprayHistory: this player's own strokes. Strokes collect per wall into a
// pending tag (one private nonce each) until the spray pauses, then go out
// as one `g3:` tag per wall. Undo takes back the last gesture: strokes not
// sent yet are simply dropped, sent ones go out as a `g3r:` removal.

import {
  type Dab,
  decodeTag,
  encodeRemoval,
  encodeStrokes,
  hash48,
  newNonce,
  SOFT_TAG_BYTES,
  MAX_STROKES,
  type Stroke,
  strokeBytes,
} from './strokes';

export type DrawItem =
  | { kind: 'dabs'; dabs: Dab[]; seed: number }
  | { kind: 'stroke'; stroke: Stroke; seed: number };

function seedOf(s: string, i: number) {
  let h = 2166136261 ^ i;
  for (let k = 0; k < s.length; k += 7) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return h >>> 0;
}

type Entry =
  | { kind: 'dabs'; data: string; dabs: Dab[] }
  | { kind: 'strokes'; data: string; id: string; strokes: Stroke[] };

export type AddResult =
  | { action: 'skip' }
  | { action: 'draw'; items: DrawItem[] }
  | { action: 'redraw' };

export class WallLog {
  private entries: Entry[] = [];
  private seen = new Set<string>();
  /** `${tagId}:${strokeIndex}` taken down by their author. */
  private removed = new Set<string>();

  has(data: string) {
    return this.seen.has(data);
  }

  get count() {
    return this.entries.length;
  }

  add(data: string): AddResult {
    if (this.seen.has(data)) return { action: 'skip' };
    const dec = decodeTag(data);
    if (dec === null) return { action: 'skip' };
    this.seen.add(data);
    if (dec.kind === 'remove') {
      const { id, indices } = dec.removal;
      let hit = false;
      for (const i of indices) {
        const key = `${id}:${i}`;
        if (this.removed.has(key)) continue;
        this.removed.add(key);
        const e = this.entries.find(x => x.kind === 'strokes' && x.id === id);
        if (e !== undefined && e.kind === 'strokes' && i < e.strokes.length) hit = true;
      }
      return hit ? { action: 'redraw' } : { action: 'skip' };
    }
    const entry: Entry =
      dec.kind === 'dabs'
        ? { kind: 'dabs', data, dabs: dec.dabs }
        : { kind: 'strokes', data, id: dec.tag.id, strokes: dec.tag.strokes };
    this.entries.push(entry);
    return { action: 'draw', items: this.itemsOf(entry) };
  }

  private itemsOf(e: Entry): DrawItem[] {
    if (e.kind === 'dabs') return [{ kind: 'dabs', dabs: e.dabs, seed: seedOf(e.data, 0) }];
    const out: DrawItem[] = [];
    e.strokes.forEach((stroke, i) => {
      if (!this.removed.has(`${e.id}:${i}`))
        out.push({ kind: 'stroke', stroke, seed: seedOf(e.data, i) });
    });
    return out;
  }

  /** Everything still visible, oldest first. */
  items(): DrawItem[] {
    return this.entries.flatMap(e => this.itemsOf(e));
  }

  /** Smallest visible nozzle radius in mm (Infinity for spray dabs only). */
  finest(): number {
    let r = Infinity;
    for (const it of this.items()) if (it.kind === 'stroke') r = Math.min(r, it.stroke.r);
    return r;
  }
}

export interface LocalStroke {
  wallId: string;
  stroke: Stroke;
  seed: number;
  undone: boolean;
  /** Set once the stroke has gone out in a tag. */
  sent: { nonce: string; index: number } | null;
}

export interface Outgoing {
  wallId: string;
  data: string;
}

const MAX_UNDO = 60;

export class SprayHistory {
  private pending = new Map<string, LocalStroke[]>();
  private gestures: LocalStroke[][] = [];
  private current: LocalStroke[] | null = null;
  private seq = 0;

  beginGesture() {
    this.current = [];
  }

  endGesture() {
    if (this.current !== null && this.current.length > 0) {
      this.gestures.push(this.current);
      if (this.gestures.length > MAX_UNDO) this.gestures.shift();
    }
    this.current = null;
  }

  get canUndo() {
    return this.gestures.length > 0 || (this.current?.length ?? 0) > 0;
  }

  /** Record a finished stroke. Returns any tag that had to go out early. */
  addStroke(wallId: string, stroke: Stroke): { local: LocalStroke; out: Outgoing[] } {
    const local: LocalStroke = {
      wallId,
      stroke,
      seed: (this.seq++ * 2654435761) >>> 0,
      undone: false,
      sent: null,
    };
    let list = this.pending.get(wallId);
    if (list === undefined) {
      list = [];
      this.pending.set(wallId, list);
    }
    list.push(local);
    (this.current ?? (this.current = [])).push(local);
    const live = list.filter(s => !s.undone);
    const bytes = live.reduce((n, s) => n + strokeBytes(s.stroke), 7);
    const out = live.length >= MAX_STROKES || bytes > SOFT_TAG_BYTES ? this.flush(wallId) : [];
    return { local, out };
  }

  /** Strokes on this wall not sent yet (drawn on top of the wall's log). */
  pendingOn(wallId: string): LocalStroke[] {
    return (this.pending.get(wallId) ?? []).filter(s => !s.undone);
  }

  get hasPending() {
    return this.pending.size > 0;
  }

  /** Encode pending strokes into one tag per wall. */
  flush(only?: string): Outgoing[] {
    const out: Outgoing[] = [];
    for (const [wallId, list] of [...this.pending]) {
      if (only !== undefined && wallId !== only) continue;
      this.pending.delete(wallId);
      const live = list.filter(s => !s.undone);
      if (live.length === 0) continue;
      const nonce = newNonce();
      const data = encodeStrokes({ id: hash48(nonce), strokes: live.map(s => s.stroke) });
      live.forEach((s, index) => (s.sent = { nonce, index }));
      out.push({ wallId, data });
    }
    return out;
  }

  /**
   * Take back the last gesture. Returns the walls to redraw and the removal
   * tags to send for strokes that had already gone out.
   */
  undo(): { walls: Set<string>; out: Outgoing[] } {
    const walls = new Set<string>();
    const out: Outgoing[] = [];
    let g: LocalStroke[] | undefined;
    if (this.current !== null && this.current.length > 0) {
      g = this.current;
      this.current = [];
    } else g = this.gestures.pop();
    if (g === undefined) return { walls, out };
    const byTag = new Map<string, { wallId: string; nonce: string; idx: number[] }>();
    for (const s of g) {
      if (s.undone) continue;
      s.undone = true;
      walls.add(s.wallId);
      if (s.sent !== null) {
        const k = `${s.wallId}|${s.sent.nonce}`;
        const e = byTag.get(k) ?? { wallId: s.wallId, nonce: s.sent.nonce, idx: [] };
        e.idx.push(s.sent.index);
        byTag.set(k, e);
      }
    }
    for (const e of byTag.values())
      out.push({ wallId: e.wallId, data: encodeRemoval(e.nonce, e.idx) });
    return { walls, out };
  }
}
