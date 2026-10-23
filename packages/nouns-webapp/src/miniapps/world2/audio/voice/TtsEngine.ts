// ── Real voices, main-thread side: lazy worker, queue, per-line cache ─────
//
// Nothing loads until `load()` (VoiceBox calls it the first time a line is
// spoken with real voices allowed, i.e. after the player has interacted and
// audio is unlocked). Until the worker says `ready`, VoiceBox keeps babbling.
//
// One synthesis is in flight at a time; lines someone is waiting to hear
// ('now') jump the queue ahead of background pre-warming ('bg'). Results are
// cached per (voice, text) as AudioBuffers, so a repeated line or a
// pre-warmed callout plays instantly.

import type { TtsOut } from './ttsProtocol';

import {
  lineKey,
  modelScales,
  PIPER_CONFIG_URL,
  PIPER_MODEL_URL,
  sentenceGap,
  type TtsVoice,
} from './ttsVoice';

export type TtsState = 'idle' | 'loading' | 'ready' | 'failed';

export interface TtsStatus {
  state: TtsState;
  /** Model bytes downloaded so far / total (while loading). */
  loaded: number;
  total: number;
  /** Load time (ms), model size, whether it came from Cache Storage. */
  loadMs: number;
  bytes: number;
  cached: boolean;
  error: string;
}

/** Dev / browser checks: what has been synthesized. */
export interface TtsLog {
  synths: number;
  hits: number;
  fails: number;
  /** Last line: synthesis time (ms) and audio length (s). */
  lastMs: number;
  lastDur: number;
  lastText: string;
  totalMs: number;
}

interface Job {
  id: number;
  key: string;
  text: string;
  voice: TtsVoice;
  prio: 'now' | 'bg';
  ctx: BaseAudioContext;
  resolve: (b: AudioBuffer | null) => void;
}

const MAX_CACHED = 200;

export class TtsEngine {
  status: TtsStatus = {
    state: 'idle',
    loaded: 0,
    total: 0,
    loadMs: 0,
    bytes: 0,
    cached: false,
    error: '',
  };
  readonly log: TtsLog = {
    synths: 0,
    hits: 0,
    fails: 0,
    lastMs: 0,
    lastDur: 0,
    lastText: '',
    totalMs: 0,
  };
  private worker: Worker | null = null;
  private listeners = new Set<() => void>();
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private done = new Map<string, AudioBuffer>();
  private queue: Job[] = [];
  private busy: Job | null = null;
  private nextId = 1;
  private readyWaiters: (() => void)[] = [];

  constructor(private makeWorker: () => Worker = defaultWorker) {}

  get ready(): boolean {
    return this.status.state === 'ready';
  }

  /** Start loading (once). Safe to call every frame. */
  load() {
    if (this.status.state === 'loading' || this.status.state === 'ready') return;
    let w: Worker;
    try {
      w = this.makeWorker();
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'no worker');
      return;
    }
    this.worker = w;
    this.set({ state: 'loading', error: '', loaded: 0 });
    w.onmessage = (e: MessageEvent<TtsOut>) => this.onMessage(e.data);
    w.onerror = e => this.fail(e.message || 'worker error');
    w.postMessage({ t: 'init', modelUrl: PIPER_MODEL_URL, configUrl: PIPER_CONFIG_URL });
  }

  /** Resolves when ready (or never, if it fails: race it with a timeout). */
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise(r => this.readyWaiters.push(r));
  }

  /** A line's audio if it's already synthesized. */
  peek(text: string, voice: TtsVoice): AudioBuffer | null {
    return this.done.get(lineKey(text, voice)) ?? null;
  }

  /** Synthesize a line (cached). null if voices failed or the line can't be said. */
  synth(
    ctx: BaseAudioContext,
    text: string,
    voice: TtsVoice,
    prio: 'now' | 'bg' = 'now',
  ): Promise<AudioBuffer | null> {
    const key = lineKey(text, voice);
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.log.hits++;
      // Promote a queued background job to the front
      if (prio === 'now') {
        const j = this.queue.find(q => q.key === key);
        if (j !== undefined && j.prio === 'bg') {
          j.prio = 'now';
          this.queue = [j, ...this.queue.filter(q => q !== j)];
        }
      }
      return hit;
    }
    if (this.status.state === 'failed') return Promise.resolve(null);
    const p = new Promise<AudioBuffer | null>(resolve => {
      const job: Job = { id: this.nextId++, key, text, voice, prio, ctx, resolve };
      if (prio === 'now') {
        const i = this.queue.findIndex(q => q.prio === 'bg');
        if (i < 0) this.queue.push(job);
        else this.queue.splice(i, 0, job);
      } else this.queue.push(job);
    });
    this.cache.set(key, p);
    if (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined && oldest !== key) {
        this.cache.delete(oldest);
        this.done.delete(oldest);
      }
    }
    this.pump();
    return p;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getStatus = (): TtsStatus => this.status;

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const j of this.queue) j.resolve(null);
    this.queue = [];
    this.busy?.resolve(null);
    this.busy = null;
    if (this.status.state !== 'failed') this.set({ state: 'idle' });
  }

  private pump() {
    if (this.busy !== null || !this.ready || this.worker === null) return;
    const job = this.queue.shift();
    if (job === undefined) return;
    this.busy = job;
    this.worker.postMessage({
      t: 'synth',
      id: job.id,
      text: job.text,
      speaker: job.voice.speaker,
      scales: modelScales(job.voice),
      gap: sentenceGap(job.voice),
    });
  }

  private onMessage(m: TtsOut) {
    switch (m.t) {
      case 'progress':
        this.set({ loaded: m.loaded, total: m.total });
        break;
      case 'ready':
        this.set({ state: 'ready', loadMs: m.ms, bytes: m.bytes, cached: m.cached });
        for (const r of this.readyWaiters.splice(0)) r();
        this.pump();
        break;
      case 'error':
        this.fail(m.message);
        break;
      case 'audio': {
        const job = this.busy;
        this.busy = null;
        if (job !== null && job.id === m.id) {
          let buf: AudioBuffer | null = null;
          if (m.pcm.length > 0) {
            buf = job.ctx.createBuffer(1, m.pcm.length, m.sampleRate);
            buf.copyToChannel(m.pcm as Float32Array<ArrayBuffer>, 0);
            this.done.set(job.key, buf);
          }
          this.log.synths++;
          this.log.lastMs = m.ms;
          this.log.totalMs += m.ms;
          this.log.lastDur = buf?.duration ?? 0;
          this.log.lastText = job.text.slice(0, 60);
          job.resolve(buf);
        }
        this.pump();
        break;
      }
      case 'fail': {
        const job = this.busy;
        this.busy = null;
        this.log.fails++;
        if (job !== null) {
          this.cache.delete(job.key);
          job.resolve(null);
        }
        this.pump();
        break;
      }
    }
  }

  private fail(message: string) {
    this.worker?.terminate();
    this.worker = null;
    this.set({ state: 'failed', error: message });
    for (const j of this.queue) j.resolve(null);
    this.queue = [];
    this.busy?.resolve(null);
    this.busy = null;
    this.cache.clear();
  }

  private set(patch: Partial<TtsStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l();
  }
}

function defaultWorker(): Worker {
  return new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
}
