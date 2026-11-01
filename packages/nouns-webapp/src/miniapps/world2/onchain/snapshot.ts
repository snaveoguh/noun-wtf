// Noun World snapshots: graffiti pieces and leaderboard rows as files, a
// Merkle tree over them, and the manifest that NounWorldLedger.commit points
// at. Pure: the job (scripts/onchain/snapshot.ts) does the fetching,
// uploading and committing; the /onchain page uses the same code to check a
// piece against a version.
//
// A snapshot is a directory:
//   manifest.json        { v, game, kind, builtAt, root, count, leaves: [{ key, content, file }], … }
//   p/<contentHash>.json one file per leaf (a graffiti piece or a board row)
// Every leaf commits to (kind, key, contentHash); see merkle.ts.

import { sha256, stringToBytes, type Hex } from 'viem';

import { decodeTag, MAX_TAG_CHARS, validTag } from '../graffiti/strokes';

import { canonical } from './canonical';
import { KIND, type SnapshotKind } from './contract';
import { buildTree, contentHash, leafHash, type MerkleTree } from './merkle';

export const SNAPSHOT_VERSION = 1;
export const GAME = 'noun-world';
export const MANIFEST_FILE = 'manifest.json';
export const LEAF_ENCODING =
  'leaf = keccak256(bytes.concat(keccak256(abi.encode(uint8 kind, string key, bytes32 keccak256(utf8(canonicalJSON(file))))))); pairs hashed sorted';

// ── Graffiti ────────────────────────────────────────────────────────────

/** A stored tag as world-graffiti keeps it. */
export interface StoredTag {
  d: string;
  /** ms since epoch, when the store first saw it (0 = unknown, e.g. a PartyKit carry-over). */
  at?: number;
}

export interface WallSurface {
  /** Wall plane normal (2 dp), its distance along it, and the 6 × 3 m cell. */
  normal: [number, number, number];
  d: number;
  cell: [number, number];
}

export interface GraffitiPiece {
  v: number;
  type: 'graffiti';
  key: string;
  level: string;
  wallId: string;
  surface: WallSurface;
  /** g3 = strokes (current), g2 = legacy dabs. */
  format: 'g3' | 'g2';
  /** The tag exactly as the game draws it (graffiti/strokes.ts decodes it). */
  data: string;
  /** g3: the tag's public id, hash48 of its author's private nonce. */
  tagId?: string;
  /** g3: strokes the author has since taken down (undo). */
  hidden?: number[];
  strokes: number;
  createdAt: number;
}

// level|nx,ny,nz|d|cu|cv
const WALL_RE =
  /^(plaza|park)\|(-?\d+\.\d{2}),(-?\d+\.\d{2}),(-?\d+\.\d{2})\|(-?\d+\.\d{2})\|(-?\d+)\|(-?\d+)$/;

export function parseWall(wallId: string): { level: string; surface: WallSurface } | null {
  const m = WALL_RE.exec(wallId);
  if (m === null) return null;
  const n = (s: string) => Number(s);
  return {
    level: m[1],
    surface: { normal: [n(m[2]), n(m[3]), n(m[4])], d: n(m[5]), cell: [n(m[6]), n(m[7])] },
  };
}

/** Same 24-hex hash world-graffiti files each tag under (`t/<wall>/<hash>`). */
export const tagHash = (d: string) => sha256(stringToBytes(d)).slice(2, 26);

/**
 * Every piece on every wall, as the game would draw it: g3 stroke tags and
 * legacy g2 dab tags are pieces; g3r undo tags aren't, they fold into the
 * piece they hide strokes of (`hidden`), and their nonce is never published.
 * Tags the game's own validator refuses are skipped.
 */
export function graffitiPieces(walls: Record<string, StoredTag[]>): GraffitiPiece[] {
  const out: GraffitiPiece[] = [];
  for (const wallId of Object.keys(walls).sort()) {
    const where = parseWall(wallId);
    if (where === null) continue;
    const tags = walls[wallId].filter(t => typeof t?.d === 'string' && t.d.length <= MAX_TAG_CHARS);
    const hidden = new Map<string, Set<number>>();
    for (const t of tags) {
      const dec = decodeTag(t.d);
      if (dec?.kind !== 'remove') continue;
      const set = hidden.get(dec.removal.id) ?? new Set<number>();
      for (const i of dec.removal.indices) set.add(i);
      hidden.set(dec.removal.id, set);
    }
    const seen = new Set<string>();
    for (const t of tags) {
      if (!validTag(t.d)) continue;
      const dec = decodeTag(t.d);
      if (dec === null || dec.kind === 'remove') continue;
      const key = `${wallId}/${tagHash(t.d)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const base = {
        v: SNAPSHOT_VERSION,
        type: 'graffiti' as const,
        key,
        level: where.level,
        wallId,
        surface: where.surface,
        data: t.d,
        createdAt: Number.isFinite(t.at) ? Math.max(0, Math.round(t.at!)) : 0,
      };
      if (dec.kind === 'strokes') {
        const n = dec.tag.strokes.length;
        const h = [...(hidden.get(dec.tag.id) ?? [])].filter(i => i < n).sort((a, b) => a - b);
        out.push({
          ...base,
          format: 'g3',
          tagId: dec.tag.id,
          ...(h.length > 0 ? { hidden: h } : {}),
          strokes: n,
        });
      } else {
        out.push({ ...base, format: 'g2', strokes: dec.dabs.length });
      }
    }
  }
  return out;
}

// ── Records ─────────────────────────────────────────────────────────────

/** A leaderboard row as world-stats GET serves it. */
export interface BoardRow {
  name: string;
  value: number;
  addr?: string;
  title?: string;
  label?: string;
  at?: number;
}

export interface StatsBoards {
  riders?: number;
  sessions?: number;
  boards: Record<string, BoardRow[]>;
}

export interface RecordRow {
  v: number;
  type: 'record';
  key: string;
  metric: string;
  rank: number;
  name: string;
  value: number;
  addr?: string;
  title?: string;
  label?: string;
}

const METRIC_RE = /^[A-Za-z]{1,16}$/;

/**
 * Every public board row (top 100 per metric, the same rows the game's
 * leaderboards show: display name, linked address, value; never a rider id).
 * The row's "last seen" time is left out so a rider just playing doesn't
 * change their record's leaf.
 */
export function recordRows(stats: StatsBoards): RecordRow[] {
  const out: RecordRow[] = [];
  for (const metric of Object.keys(stats.boards ?? {}).sort()) {
    if (!METRIC_RE.test(metric)) continue;
    const rows = stats.boards[metric];
    if (!Array.isArray(rows)) continue;
    const used = new Set<string>();
    rows.forEach((r, i) => {
      if (typeof r?.name !== 'string' || typeof r.value !== 'number' || !Number.isFinite(r.value))
        return;
      const who = typeof r.addr === 'string' && r.addr ? r.addr.toLowerCase() : `name:${r.name}`;
      let key = `${metric}/${who}`;
      for (let n = 2; used.has(key); n++) key = `${metric}/${who}#${n}`;
      used.add(key);
      out.push({
        v: SNAPSHOT_VERSION,
        type: 'record',
        key,
        metric,
        rank: i + 1,
        name: r.name,
        value: r.value,
        ...(typeof r.addr === 'string' && r.addr ? { addr: r.addr } : {}),
        ...(typeof r.title === 'string' ? { title: r.title } : {}),
        ...(typeof r.label === 'string' ? { label: r.label } : {}),
      });
    });
  }
  return out;
}

// ── Snapshot ────────────────────────────────────────────────────────────

export interface ManifestLeaf {
  key: string;
  /** keccak256 of the file's canonical JSON. */
  content: Hex;
  /** Path of the file inside the snapshot directory. */
  file: string;
  /** What to search it by: a graffiti piece's tag id, a record's rider name. */
  label?: string;
}

export interface Manifest {
  v: number;
  game: string;
  kind: SnapshotKind;
  kindId: number;
  builtAt: string;
  root: Hex;
  count: number;
  leafEncoding: string;
  leaves: ManifestLeaf[];
  /** Extra context (counts), not committed to by the root. */
  meta?: Record<string, number | string>;
}

export interface SnapshotFile {
  path: string;
  body: string;
}

export interface Snapshot {
  kind: SnapshotKind;
  root: Hex;
  tree: MerkleTree;
  manifest: Manifest;
  /** Every file to upload, manifest.json last. */
  files: SnapshotFile[];
}

export const leafFile = (content: Hex) => `p/${content.slice(2)}.json`;

/** Build the files, tree and manifest for one kind. Null when there's nothing in it. */
export function buildSnapshot(
  kind: SnapshotKind,
  items: { key: string }[],
  builtAt: Date,
  meta?: Record<string, number | string>,
): Snapshot | null {
  if (items.length === 0) return null;
  const k = KIND[kind];
  const byKey = new Map<string, { key: string }>();
  for (const it of items) if (!byKey.has(it.key)) byKey.set(it.key, it);
  const leaves: ManifestLeaf[] = [];
  const files: SnapshotFile[] = [];
  const written = new Set<string>();
  for (const key of [...byKey.keys()].sort()) {
    const item = byKey.get(key)!;
    const content = contentHash(item);
    const file = leafFile(content);
    const it = item as { tagId?: unknown; name?: unknown };
    const label =
      typeof it.tagId === 'string' ? it.tagId : typeof it.name === 'string' ? it.name : undefined;
    leaves.push({ key, content, file, ...(label !== undefined ? { label } : {}) });
    if (!written.has(file)) {
      written.add(file);
      files.push({ path: file, body: canonical(item) });
    }
  }
  const tree = buildTree(leaves.map(l => leafHash(k, l.key, l.content)));
  const manifest: Manifest = {
    v: SNAPSHOT_VERSION,
    game: GAME,
    kind,
    kindId: k,
    builtAt: builtAt.toISOString(),
    root: tree.root,
    count: leaves.length,
    leafEncoding: LEAF_ENCODING,
    leaves,
    ...(meta ? { meta } : {}),
  };
  files.push({ path: MANIFEST_FILE, body: JSON.stringify(manifest) });
  return { kind, root: tree.root, tree, manifest, files };
}

// ── Checking a manifest (used by the /onchain page) ─────────────────────

export interface ManifestCheck {
  ok: boolean;
  root: Hex | null;
  tree: MerkleTree | null;
  reason?: string;
}

/** Rebuild the tree from a manifest's leaves and compare it with a root from the chain. */
export function checkManifest(m: unknown, chainRoot: Hex): ManifestCheck {
  const man = m as Partial<Manifest> | null;
  if (!man || man.game !== GAME || !Array.isArray(man.leaves) || typeof man.kindId !== 'number')
    return { ok: false, root: null, tree: null, reason: 'not a Noun World manifest' };
  try {
    const tree = buildTree(
      man.leaves.map(l => leafHash(man.kindId!, String(l.key), l.content as Hex)),
    );
    const ok = tree.root.toLowerCase() === chainRoot.toLowerCase();
    return {
      ok,
      root: tree.root,
      tree,
      ...(ok ? {} : { reason: "manifest leaves don't match the on-chain root" }),
    };
  } catch (e) {
    return { ok: false, root: null, tree: null, reason: (e as Error).message };
  }
}
