// NOUN BEATS, rendered off the audio thread: the worklet module is loaded
// into a fake AudioWorkletGlobalScope and its processor run block by block.

import { beforeAll, describe, expect, it } from 'vitest';

const SR = 22050;
const BLOCK = 128;

interface Port {
  postMessage(m: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}
interface Proc {
  port: Port;
  process(i: Float32Array[][], o: Float32Array[][]): boolean;
}
type Ctor = new (o?: { processorOptions?: { autoplay?: boolean; seed?: number } }) => Proc;

let registered: { name: string; ctor: Ctor } | null = null;
const sent: { type: string; name?: string; bpm?: number; swing?: number }[] = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = SR;
  g.registerProcessor = (name: string, ctor: Ctor) => {
    registered = { name, ctor };
  };
  g.AudioWorkletProcessor = class {
    port: Port = {
      postMessage: (m: unknown) => sent.push(m as (typeof sent)[number]),
      onmessage: null,
    };
  };
  // @ts-expect-error a worklet script, not a module: it registers itself
  await import('./radioWorklet');
});

function render(p: Proc, seconds: number) {
  const n = Math.ceil((seconds * SR) / BLOCK) * BLOCK;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += BLOCK) {
    const out = [[L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK)]];
    p.process([], out);
  }
  return { L, R };
}

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

describe('NOUN BEATS worklet', () => {
  it('registers the noun-radio processor at top level', () => {
    expect(registered?.name).toBe('noun-radio');
  });

  it('is silent until played, then makes boom-bap: 85-95 BPM, 56-62% swing, clean output', () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      sent.length = 0;
      const p = new registered!.ctor({ processorOptions: { seed } });
      expect(rms(render(p, 0.5).L)).toBe(0);

      p.port.onmessage?.({ data: { type: 'play', seed } });
      const { L, R } = render(p, 8);
      const song = sent.find(m => m.type === 'song')!;
      expect(song.name).toMatch(/\w+ \w+/);
      expect(song.bpm).toBeGreaterThanOrEqual(85);
      expect(song.bpm).toBeLessThanOrEqual(95);
      expect(song.swing).toBeGreaterThanOrEqual(56);
      expect(song.swing).toBeLessThanOrEqual(62);

      const tail = L.subarray(2 * SR);
      expect(rms(tail), `seed ${seed}`).toBeGreaterThan(0.02);
      expect(rms(R.subarray(2 * SR))).toBeGreaterThan(0.02);
      let peak = 0;
      for (const x of L) peak = Number.isFinite(x) ? Math.max(peak, Math.abs(x)) : Infinity;
      expect(peak).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  it('stop fades to silence, next starts a fresh song', () => {
    sent.length = 0;
    const p = new registered!.ctor({ processorOptions: { autoplay: true, seed: 5 } });
    render(p, 2);
    p.port.onmessage?.({ data: { type: 'next', seed: 6 } });
    render(p, 1.5);
    expect(sent.filter(m => m.type === 'song').length).toBe(2);
    p.port.onmessage?.({ data: { type: 'stop' } });
    render(p, 4);
    expect(rms(render(p, 0.5).L)).toBe(0);
  });
});
