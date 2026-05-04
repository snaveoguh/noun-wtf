/**
 * BerryOS virtual filesystem.
 *
 * In-memory tree of folders + files keyed by absolute POSIX-style path.
 * Used by Finder, the Desktop, and any app that wants to show / accept
 * file-shaped data (proposals, nouns, app launchers).
 *
 * Persistence: the structural metadata (path / name / type / icon /
 * mime / size / metadata + small content blobs) is mirrored into
 * localStorage under `berry.vfs`. Anything with a `content` larger than
 * 100KB or marked as `ephemeral` is dropped from the snapshot so we
 * don't blow the storage quota.
 *
 * The seeded directory layout intentionally mirrors classic Mac OS:
 *   /Applications/  — registry-driven, double-click → app:launching
 *   /Desktop/       — empty user dropzone
 *   /Documents/Nouns/      — recent nouns (.noun files)
 *   /Documents/Proposals/  — active proposals (.prop files)
 *   /Trash/         — soft-deleted items
 */

import { berryBus } from './eventBus';
import { createStore } from './externalStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BerryFileType = 'file' | 'folder';

export interface BerryFile {
  path: string;
  name: string;
  type: BerryFileType;
  mimeType?: string;
  size?: number;
  content?: unknown;
  icon?: string;
  createdAt: number;
  modifiedAt: number;
  metadata?: Record<string, unknown>;
  /** True for synthesized entries we shouldn't persist verbatim. */
  ephemeral?: boolean;
}

interface VfsState {
  /** Map of path → file. Folders are entries too (`type === 'folder'`). */
  entries: Map<string, BerryFile>;
}

// ---------------------------------------------------------------------------
// Path helpers — normalise every input to a leading-slash, trailing-no-slash
// form (root is `'/'`).
// ---------------------------------------------------------------------------

export function normalizePath(p: string): string {
  if (!p) return '/';
  let out = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!out.startsWith('/')) out = '/' + out;
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

export function dirname(p: string): string {
  const norm = normalizePath(p);
  if (norm === '/') return '/';
  const idx = norm.lastIndexOf('/');
  return idx <= 0 ? '/' : norm.slice(0, idx);
}

export function basename(p: string): string {
  const norm = normalizePath(p);
  if (norm === '/') return '/';
  return norm.slice(norm.lastIndexOf('/') + 1);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'berry.vfs';
const MAX_PERSISTED_CONTENT = 100 * 1024; // 100KB per blob

function readPersisted(): Map<string, BerryFile> {
  if (typeof localStorage === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const m = new Map<string, BerryFile>();
    for (const entry of parsed) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as BerryFile).path === 'string'
      ) {
        m.set((entry as BerryFile).path, entry as BerryFile);
      }
    }
    return m;
  } catch {
    return new Map();
  }
}

function persist(entries: Map<string, BerryFile>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const arr: BerryFile[] = [];
    for (const file of entries.values()) {
      if (file.ephemeral) continue;
      let content = file.content;
      if (typeof content === 'string' && content.length > MAX_PERSISTED_CONTENT) {
        content = content.slice(0, MAX_PERSISTED_CONTENT) + '\n…[truncated]';
      } else if (content && typeof content !== 'string') {
        // Try to JSON-serialise small structured content; drop big stuff.
        try {
          const json = JSON.stringify(content);
          if (json.length > MAX_PERSISTED_CONTENT) content = undefined;
        } catch {
          content = undefined;
        }
      }
      arr.push({ ...file, content });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // Quota errors / disabled storage — silent.
  }
}

// ---------------------------------------------------------------------------
// Store + helpers
// ---------------------------------------------------------------------------

const SEEDED_FOLDERS: readonly string[] = [
  '/',
  '/Applications',
  '/Desktop',
  '/Documents',
  '/Documents/Nouns',
  '/Documents/Proposals',
  '/Trash',
];

function seedFolders(map: Map<string, BerryFile>): Map<string, BerryFile> {
  const now = Date.now();
  for (const path of SEEDED_FOLDERS) {
    if (!map.has(path)) {
      map.set(path, {
        path,
        name: path === '/' ? '/' : basename(path),
        type: 'folder',
        icon: path === '/Trash' ? '🗑️' : '📁',
        createdAt: now,
        modifiedAt: now,
      });
    }
  }
  return map;
}

const initialEntries = seedFolders(readPersisted());

export const vfsStore = createStore<VfsState>({ entries: initialEntries });

function commit(next: Map<string, BerryFile>): void {
  vfsStore.setState({ entries: next });
  persist(next);
}

// ---------------------------------------------------------------------------
// Imperative API
// ---------------------------------------------------------------------------

function ensureParentExists(path: string): void {
  const parent = dirname(path);
  if (parent === '/') return;
  const entries = vfsStore.getState().entries;
  if (!entries.has(parent)) {
    // Recursively create missing parent folders.
    vfs.mkdir(parent);
  }
}

export const vfs = {
  ls(path: string): BerryFile[] {
    const target = normalizePath(path);
    const entries = vfsStore.getState().entries;
    const out: BerryFile[] = [];
    for (const [p, file] of entries) {
      if (p === target) continue;
      if (dirname(p) === target) out.push(file);
    }
    return out.sort((a, b) => {
      // Folders first, then alpha.
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },

  read(path: string): BerryFile | null {
    return vfsStore.getState().entries.get(normalizePath(path)) ?? null;
  },

  exists(path: string): boolean {
    return vfsStore.getState().entries.has(normalizePath(path));
  },

  write(
    path: string,
    content: unknown,
    extra: Partial<Omit<BerryFile, 'path' | 'name' | 'type' | 'createdAt'>> = {},
  ): BerryFile {
    const norm = normalizePath(path);
    ensureParentExists(norm);
    const entries = new Map(vfsStore.getState().entries);
    const existing = entries.get(norm);
    const now = Date.now();
    const size =
      typeof content === 'string'
        ? content.length
        : content !== undefined
          ? JSON.stringify(content).length
          : 0;
    const file: BerryFile = {
      path: norm,
      name: basename(norm),
      type: 'file',
      content,
      size,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
      ...extra,
    };
    entries.set(norm, file);
    commit(entries);
    berryBus.emit(existing ? 'fs:modified' : 'fs:created', { file });
    return file;
  },

  mkdir(path: string, extra: Partial<Pick<BerryFile, 'icon' | 'metadata'>> = {}): BerryFile {
    const norm = normalizePath(path);
    if (norm === '/') {
      const root = vfsStore.getState().entries.get('/');
      if (root) return root;
    }
    ensureParentExists(norm);
    const entries = new Map(vfsStore.getState().entries);
    const existing = entries.get(norm);
    if (existing && existing.type === 'folder') return existing;
    const now = Date.now();
    const folder: BerryFile = {
      path: norm,
      name: basename(norm),
      type: 'folder',
      icon: '📁',
      createdAt: now,
      modifiedAt: now,
      ...extra,
    };
    entries.set(norm, folder);
    commit(entries);
    berryBus.emit('fs:created', { file: folder });
    return folder;
  },

  /**
   * Remove an entry. By default soft-deletes into `/Trash/` (preserves the
   * source basename, replaces collisions). Pass `permanent: true` to drop
   * outright.
   */
  rm(path: string, opts: { permanent?: boolean } = {}): void {
    const norm = normalizePath(path);
    if (norm === '/') return; // can't delete root
    const entries = new Map(vfsStore.getState().entries);
    const target = entries.get(norm);
    if (!target) return;

    if (opts.permanent || norm.startsWith('/Trash/')) {
      // Permanent delete: drop the entry and any descendants.
      for (const p of Array.from(entries.keys())) {
        if (p === norm || p.startsWith(norm + '/')) entries.delete(p);
      }
      commit(entries);
      berryBus.emit('fs:deleted', { path: norm, toTrash: false });
      return;
    }

    // Soft-delete to /Trash, picking a unique destination name.
    let trashPath = `/Trash/${target.name}`;
    let i = 2;
    while (entries.has(trashPath)) {
      trashPath = `/Trash/${target.name} (${i})`;
      i += 1;
    }
    // Move target + descendants under the trash path.
    const replacements: Array<[string, BerryFile]> = [];
    for (const [p, f] of entries) {
      if (p === norm) {
        replacements.push([trashPath, { ...f, path: trashPath, name: basename(trashPath) }]);
      } else if (p.startsWith(norm + '/')) {
        const newPath = trashPath + p.slice(norm.length);
        replacements.push([newPath, { ...f, path: newPath }]);
      }
    }
    for (const p of Array.from(entries.keys())) {
      if (p === norm || p.startsWith(norm + '/')) entries.delete(p);
    }
    for (const [p, f] of replacements) entries.set(p, f);
    commit(entries);
    berryBus.emit('fs:deleted', { path: norm, toTrash: true });
    berryBus.emit('fs:moved', { from: norm, to: trashPath });
  },

  emptyTrash(): void {
    const entries = new Map(vfsStore.getState().entries);
    for (const p of Array.from(entries.keys())) {
      if (p === '/Trash') continue;
      if (p === '/Trash/' || p.startsWith('/Trash/')) entries.delete(p);
    }
    commit(entries);
    berryBus.emit('fs:deleted', { path: '/Trash/*', toTrash: false });
  },

  mv(from: string, to: string): boolean {
    const fromN = normalizePath(from);
    const toN = normalizePath(to);
    if (fromN === toN) return false;
    const entries = new Map(vfsStore.getState().entries);
    const target = entries.get(fromN);
    if (!target) return false;
    if (entries.has(toN)) return false;
    ensureParentExists(toN);

    const replacements: Array<[string, BerryFile]> = [];
    for (const [p, f] of entries) {
      if (p === fromN) {
        replacements.push([toN, { ...f, path: toN, name: basename(toN) }]);
      } else if (p.startsWith(fromN + '/')) {
        const newPath = toN + p.slice(fromN.length);
        replacements.push([newPath, { ...f, path: newPath }]);
      }
    }
    for (const p of Array.from(entries.keys())) {
      if (p === fromN || p.startsWith(fromN + '/')) entries.delete(p);
    }
    for (const [p, f] of replacements) entries.set(p, f);
    commit(entries);
    berryBus.emit('fs:moved', { from: fromN, to: toN });
    return true;
  },

  /**
   * Bulk-replace synthesized entries under a given folder. Used by the seed
   * helpers to keep `/Applications/` / `/Documents/Nouns/` / etc. in sync
   * with live data without disturbing user-created files in those folders.
   */
  replaceSynthesized(folderPath: string, files: BerryFile[]): void {
    const folder = normalizePath(folderPath);
    const entries = new Map(vfsStore.getState().entries);
    for (const [p, f] of Array.from(entries.entries())) {
      if (dirname(p) === folder && f.metadata?.synthesized === true) {
        entries.delete(p);
      }
    }
    for (const f of files) {
      const path = normalizePath(`${folder}/${f.name}`);
      entries.set(path, {
        ...f,
        path,
        metadata: { ...(f.metadata ?? {}), synthesized: true },
      });
    }
    commit(entries);
  },
};

// ---------------------------------------------------------------------------
// React selector hook used by Finder + Desktop.
// ---------------------------------------------------------------------------

export function useVfsListing(path: string): BerryFile[] {
  // Re-derive on every store change — `vfs.ls` is O(entries) which is fine
  // for a few hundred files. If this ever becomes a hot path we'd index by
  // parent folder.
  const entries = vfsStore.useSelector(s => s.entries);
  const target = normalizePath(path);
  const out: BerryFile[] = [];
  for (const [p, file] of entries) {
    if (p === target) continue;
    if (dirname(p) === target) out.push(file);
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function useVfsFile(path: string): BerryFile | null {
  return vfsStore.useSelector(s => s.entries.get(normalizePath(path)) ?? null);
}
