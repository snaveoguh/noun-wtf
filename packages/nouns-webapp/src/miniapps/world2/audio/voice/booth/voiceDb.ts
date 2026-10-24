// ── Voice Booth storage: IndexedDB, this browser only ────────────────────
//
// Everything the booth records lives here first, so it works offline and
// without sign-in, and the player's own rider uses it straight away:
//   clips   callout recordings, by line key (clips.ts), with their trim/level
//   train   "Train my voice" sentences (never uploaded)
//   model   a voice model the player trained and loaded (.onnx + .onnx.json,
//           never uploaded)
// A browser without IndexedDB (some private modes) gets an in-memory stand-in:
// the booth works for the session and says so.

import type { ClipShape } from './clips';

export interface StoredClip extends ClipShape {
  /** Line key (callouts) or prompt id (training). */
  key: string;
  blob: Blob;
  mime: string;
  at: number;
  /** When this exact recording was uploaded (0 = not shared yet). */
  uploadedAt: number;
}

export interface StoredModel {
  key: 'model';
  onnx: Blob;
  config: string;
  name: string;
  at: number;
}

type StoreName = 'clips' | 'train' | 'model';
const DB = 'noun-world-voice';
const VERSION = 1;

let dbp: Promise<IDBDatabase | null> | null = null;
const memory: Record<StoreName, Map<string, unknown>> = {
  clips: new Map(),
  train: new Map(),
  model: new Map(),
};

/** IndexedDB is usable here (false: memory only, gone on reload). */
export let persistent = true;

function open(): Promise<IDBDatabase | null> {
  dbp ??= new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['clips', 'train', 'model'])
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        persistent = false;
        resolve(null);
      };
      req.onblocked = () => {
        persistent = false;
        resolve(null);
      };
    } catch {
      persistent = false;
      resolve(null);
    }
  });
  return dbp;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return open().then(
    db =>
      new Promise<T>((resolve, reject) => {
        if (db === null) return reject(new Error('no db'));
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error ?? new Error('idb error'));
        tx.onabort = () => reject(tx.error ?? new Error('idb aborted'));
      }),
  );
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  try {
    return await run<T[]>(store, 'readonly', s => s.getAll());
  } catch {
    return [...memory[store].values()] as T[];
  }
}

export async function get<T>(store: StoreName, key: string): Promise<T | null> {
  try {
    return ((await run<T | undefined>(store, 'readonly', s => s.get(key))) ?? null) as T | null;
  } catch {
    return (memory[store].get(key) as T | undefined) ?? null;
  }
}

export async function put<T extends { key: string }>(store: StoreName, v: T): Promise<void> {
  memory[store].set(v.key, v);
  try {
    await run(store, 'readwrite', s => s.put(v));
  } catch {
    // memory only
  }
}

export async function remove(store: StoreName, key: string): Promise<void> {
  memory[store].delete(key);
  try {
    await run(store, 'readwrite', s => s.delete(key));
  } catch {
    // memory only
  }
}

export async function clear(store: StoreName): Promise<void> {
  memory[store].clear();
  try {
    await run(store, 'readwrite', s => s.clear());
  } catch {
    // memory only
  }
}
