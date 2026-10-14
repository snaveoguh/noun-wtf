// ── Game mixer: one WebAudio gain per bus ────────────────────────────────
//
//   SkateAudio master ─ comp ─┐                (skate SFX, graffiti hiss,
//                             ├─ sfx  ──┐        hoops one-shots + crowd)
//   PirateRadio out ──────────┤         │
//   NOUN FM direct/spatial ───┴─ radio ─┼─ master ─ destination
//                                voice ─┘   (mute-all zeroes this one)
//
// Sounds keep their own internal gains; the mixer only scales whole buses.
// Outputs that never enter WebAudio (NOUN FM's YouTube iframe and unrouted
// <audio>, the browser-voice ident, WebRTC voice <audio> elements) read
// `gain(bus)` instead, through `onChange`.

import type { AudioLevels } from './store';

export const BUSES = ['sfx', 'radio', 'voice'] as const;
export type Bus = (typeof BUSES)[number];

/** Slider position (0..1) → linear gain. Squared so the bottom half of the slider is usable. */
export function sliderToGain(x: number): number {
  const c = Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
  return c * c;
}

/** Gains for each node of the graph. */
export function nodeGains(l: AudioLevels): { master: number } & Record<Bus, number> {
  return {
    master: l.muted ? 0 : sliderToGain(l.master),
    sfx: sliderToGain(l.sfx),
    radio: sliderToGain(l.radio),
    voice: sliderToGain(l.voice),
  };
}

/** End-to-end gain of one bus (master × bus), for outputs outside the graph. */
export function busGain(l: AudioLevels, bus: Bus): number {
  const g = nodeGains(l);
  return g.master * g[bus];
}

const DEFAULT_LEVELS: AudioLevels = { master: 1, sfx: 1, radio: 1, voice: 1, muted: false };

export class AudioMixer {
  levels: AudioLevels = { ...DEFAULT_LEVELS };
  ctx: BaseAudioContext | null = null;
  /** The graph's nodes (null until `attach`). Exposed for dev checks. */
  nodes: ({ master: GainNode } & Record<Bus, GainNode>) | null = null;
  private listeners = new Set<() => void>();

  /** Build the graph on a context (once; later calls are no-ops). */
  attach(ctx: BaseAudioContext): this {
    if (this.ctx === ctx && this.nodes !== null) return this;
    this.ctx = ctx;
    const g = nodeGains(this.levels);
    const master = ctx.createGain();
    master.gain.value = g.master;
    master.connect(ctx.destination);
    const mk = (b: Bus) => {
      const n = ctx.createGain();
      n.gain.value = g[b];
      n.connect(master);
      return n;
    };
    this.nodes = { master, sfx: mk('sfx'), radio: mk('radio'), voice: mk('voice') };
    return this;
  }

  /** The node a source on `bus` should connect to (null before `attach`). */
  bus(b: Bus): AudioNode | null {
    return this.nodes?.[b] ?? null;
  }

  /** End-to-end gain for outputs that can't join the graph. */
  gain(b: Bus): number {
    return busGain(this.levels, b);
  }

  set(levels: AudioLevels) {
    this.levels = { ...levels };
    const n = this.nodes;
    const ctx = this.ctx;
    if (n !== null && ctx !== null) {
      const g = nodeGains(this.levels);
      const t = ctx.currentTime;
      // Short ramp: no zipper noise while dragging a slider
      // (a suspended context's clock is frozen, so set the value outright)
      const running = ctx.state === 'running';
      for (const k of ['master', ...BUSES] as const) {
        n[k].gain.cancelScheduledValues(t);
        if (running) n[k].gain.setTargetAtTime(g[k], t, 0.02);
        else n[k].gain.value = g[k];
      }
    }
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
