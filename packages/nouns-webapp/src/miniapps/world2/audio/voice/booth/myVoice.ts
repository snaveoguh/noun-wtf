// ── The player's own voice: one live store over voiceDb ──────────────────
//
// The booth writes through this; the game reads it (and is told when it
// changes), so a line recorded in the booth is what the rider says next.
// useSyncExternalStore-friendly: `get()` returns a new snapshot per change.

import type { ClipShape } from './clips';

import { getAll, get, persistent, put, remove, type StoredClip, type StoredModel } from './voiceDb';

export interface ModelInfo {
  name: string;
  bytes: number;
  at: number;
}

export interface MyVoiceState {
  ready: boolean;
  /** IndexedDB works (false: this session only). */
  persistent: boolean;
  clips: ReadonlyMap<string, StoredClip>;
  train: ReadonlyMap<string, StoredClip>;
  model: ModelInfo | null;
}

class MyVoiceStore {
  private state: MyVoiceState = {
    ready: false,
    persistent: true,
    clips: new Map(),
    train: new Map(),
    model: null,
  };
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;

  get = (): MyVoiceState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    void this.load();
    return () => this.listeners.delete(fn);
  };

  /** Read everything from IndexedDB (once). */
  load(): Promise<void> {
    this.loading ??= (async () => {
      const [clips, train, model] = await Promise.all([
        getAll<StoredClip>('clips'),
        getAll<StoredClip>('train'),
        get<StoredModel>('model', 'model'),
      ]);
      this.set({
        ready: true,
        persistent,
        clips: new Map(clips.map(c => [c.key, c])),
        train: new Map(train.map(c => [c.key, c])),
        model: model === null ? null : { name: model.name, bytes: model.onnx.size, at: model.at },
      });
    })();
    return this.loading;
  }

  async saveClip(kind: 'clips' | 'train', key: string, blob: Blob, mime: string, s: ClipShape) {
    const rec: StoredClip = { key, blob, mime, ...s, at: Date.now(), uploadedAt: 0 };
    await put(kind, rec);
    const next = new Map(this.state[kind]);
    next.set(key, rec);
    this.set({ [kind]: next });
  }

  async markUploaded(key: string, at: number) {
    const c = this.state.clips.get(key);
    if (c === undefined) return;
    const rec = { ...c, uploadedAt: at };
    await put('clips', rec);
    const next = new Map(this.state.clips);
    next.set(key, rec);
    this.set({ clips: next });
  }

  async deleteClip(kind: 'clips' | 'train', key: string) {
    await remove(kind, key);
    const next = new Map(this.state[kind]);
    next.delete(key);
    this.set({ [kind]: next });
  }

  async setModel(onnx: Blob, config: string, name: string) {
    const m: StoredModel = { key: 'model', onnx, config, name, at: Date.now() };
    await put('model', m);
    this.set({ model: { name, bytes: onnx.size, at: m.at } });
  }

  async clearModel() {
    await remove('model', 'model');
    this.set({ model: null });
  }

  /** The stored model's bytes + config (for the TTS worker). */
  async modelData(): Promise<{ model: ArrayBuffer; config: string } | null> {
    const m = await get<StoredModel>('model', 'model');
    if (m === null) return null;
    return { model: await m.onnx.arrayBuffer(), config: m.config };
  }

  private set(patch: Partial<MyVoiceState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

export const myVoice = new MyVoiceStore();
