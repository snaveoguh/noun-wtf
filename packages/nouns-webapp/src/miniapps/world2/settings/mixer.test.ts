import type { AudioLevels } from './store';

import { describe, expect, it, vi } from 'vitest';

import { AudioMixer, busGain, nodeGains, sliderToGain } from './mixer';

const L = (p: Partial<AudioLevels> = {}): AudioLevels => ({
  master: 1,
  sfx: 1,
  radio: 1,
  voice: 1,
  npc: 1,
  muted: false,
  ...p,
});

describe('bus math', () => {
  it('slider → gain is squared and clamped', () => {
    expect(sliderToGain(1)).toBe(1);
    expect(sliderToGain(0)).toBe(0);
    expect(sliderToGain(0.5)).toBeCloseTo(0.25);
    expect(sliderToGain(2)).toBe(1);
    expect(sliderToGain(-1)).toBe(0);
    expect(sliderToGain(NaN)).toBe(0);
  });

  it('defaults are unity (the existing mix is unchanged)', () => {
    expect(nodeGains(L())).toEqual({ master: 1, sfx: 1, radio: 1, voice: 1, npc: 1 });
  });

  it('end-to-end gain is master × bus', () => {
    const l = L({ master: 0.5, radio: 0.5 });
    expect(busGain(l, 'radio')).toBeCloseTo(0.0625);
    expect(busGain(l, 'sfx')).toBeCloseTo(0.25);
  });

  it('mute zeroes the master only (bus levels are kept)', () => {
    const g = nodeGains(L({ muted: true, sfx: 0.8 }));
    expect(g.master).toBe(0);
    expect(g.sfx).toBeCloseTo(0.64);
    expect(busGain(L({ muted: true }), 'voice')).toBe(0);
  });
});

/** Just enough of an AudioContext for the graph. */
function fakeCtx(state: AudioContextState = 'suspended') {
  const made: { gain: { value: number } & Record<string, unknown>; to: unknown[] }[] = [];
  const destination = { name: 'dest' };
  const ctx = {
    state,
    currentTime: 0,
    destination,
    createGain() {
      const node = {
        gain: {
          value: 1,
          cancelScheduledValues: vi.fn(),
          setTargetAtTime: vi.fn(function (this: { value: number }, v: number) {
            this.value = v;
          }),
        },
        to: [] as unknown[],
        connect(n: unknown) {
          node.to.push(n);
          return n;
        },
      };
      made.push(node);
      return node;
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, made, destination };
}

describe('AudioMixer', () => {
  it('builds sfx / radio / voice / npc → master → destination', () => {
    const { ctx, made, destination } = fakeCtx();
    const m = new AudioMixer().attach(ctx);
    expect(made).toHaveLength(5);
    const n = m.nodes!;
    expect((n.master as unknown as { to: unknown[] }).to).toEqual([destination]);
    for (const b of ['sfx', 'radio', 'voice', 'npc'] as const)
      expect((n[b] as unknown as { to: unknown[] }).to).toEqual([n.master]);
    expect(m.bus('radio')).toBe(n.radio);
    // attaching again is a no-op
    m.attach(ctx);
    expect(made).toHaveLength(5);
  });

  it('levels set before attach apply when the graph is built', () => {
    const { ctx } = fakeCtx();
    const m = new AudioMixer();
    expect(m.bus('sfx')).toBeNull();
    m.set(L({ sfx: 0.5, muted: true }));
    m.attach(ctx);
    expect(m.nodes!.sfx.gain.value).toBeCloseTo(0.25);
    expect(m.nodes!.master.gain.value).toBe(0);
  });

  it('set() writes node gains, notifies, and gain() reports end-to-end', () => {
    const { ctx } = fakeCtx('running');
    const m = new AudioMixer().attach(ctx);
    const fn = vi.fn();
    m.onChange(fn);
    m.set(L({ master: 0.5, radio: 0.4 }));
    expect(m.nodes!.master.gain.value).toBeCloseTo(0.25);
    expect(m.nodes!.radio.gain.value).toBeCloseTo(0.16);
    expect(m.nodes!.master.gain.setTargetAtTime).toHaveBeenCalled();
    expect(m.gain('radio')).toBeCloseTo(0.04);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
