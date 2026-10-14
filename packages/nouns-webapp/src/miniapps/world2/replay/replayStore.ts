// ── Record rides kept across reloads (IndexedDB) ──
//
// The ride behind every record the server answered (saved or refused) is
// kept here, so REPLAY and APPEAL still work after a reload. Bounded: the
// last MAX_RUNS rides, each at most PROOF_SAMPLES samples (≈ 480 KB). Best
// effort: no IndexedDB (private mode, tests) just means no history.

import type { ProvedKey, RideRun } from '../net/Stats';

const DB = 'noun-world-replays';
const STORE = 'runs';
const MAX_RUNS = 12;
const MAX_FLOATS = 20_000 * 6;

interface Row {
  id: string;
  at: number;
  savedAt: number;
  buf: ArrayBuffer;
  key?: ProvedKey;
  value?: number;
  status?: 'saved' | 'refused';
  reason?: string;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function all(db: IDBDatabase): Promise<Row[]> {
  return new Promise(resolve => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as Row[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Keep a record ride (the newest MAX_RUNS stay). */
export async function saveRun(run: RideRun): Promise<void> {
  if (run.samples.length > MAX_FLOATS) return;
  const db = await open();
  if (!db) return;
  const rows = await all(db);
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      // Same ride saved again (another record from it): one row, latest result
      const row: Row = {
        id: `${run.id}:${run.key ?? ''}`,
        at: run.at,
        savedAt: Date.now(),
        buf: run.samples.slice().buffer,
        key: run.key,
        value: run.value,
        status: run.status,
        reason: run.reason,
      };
      st.put(row);
      const old = rows
        .filter(r => r.id !== row.id)
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(MAX_RUNS - 1);
      for (const r of old) st.delete(r.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

/** Kept record rides, newest first. */
export async function loadRuns(): Promise<RideRun[]> {
  const db = await open();
  if (!db) return [];
  const rows = await all(db);
  db.close();
  return rows
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(r => ({
      id: r.id,
      at: r.at,
      samples: new Float32Array(r.buf),
      ...(r.key ? { key: r.key } : {}),
      ...(r.value !== undefined ? { value: r.value } : {}),
      ...(r.status ? { status: r.status } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
    }));
}
