import type { ChatterHost } from './ChatterSystem';
import type { TtsEngine } from '../../audio/voice/TtsEngine';
import type { VoiceHandle, VoiceLine } from '../../audio/voice/VoiceBox';

import { describe, expect, it } from 'vitest';

import { ChatterSystem } from './ChatterSystem';

/** A fake house engine: loads after `loadS`, synthesizes instantly. */
class FakeEngine {
  status = { state: 'idle' as 'idle' | 'loading' | 'ready' | 'failed' };
  cached = new Set<string>();
  synths: string[] = [];
  forgot: string[] = [];
  disposed = false;
  loads = 0;
  constructor(
    private clock: { t: number },
    private loadS = 1,
    private fail = false,
  ) {}
  private readyAt = Infinity;
  get ready() {
    if (this.status.state === 'loading' && this.clock.t >= this.readyAt)
      this.status.state = this.fail ? 'failed' : 'ready';
    return this.status.state === 'ready';
  }
  load() {
    if (this.status.state !== 'idle') return;
    this.loads++;
    this.status.state = 'loading';
    this.readyAt = this.clock.t + this.loadS;
  }
  synth(_ctx: unknown, text: string) {
    this.synths.push(text);
    this.cached.add(text);
    return Promise.resolve(null);
  }
  peek(text: string) {
    return this.cached.has(text) ? ({} as AudioBuffer) : null;
  }
  forget(text: string) {
    this.forgot.push(text);
    this.cached.delete(text);
  }
  dispose() {
    this.disposed = true;
    this.status.state = 'idle';
  }
}

function rig(
  opts: { realOn?: boolean; mode?: 'auto' | 'on' | 'off'; coarse?: boolean; fail?: boolean } = {},
) {
  const clock = { t: 0 };
  const store = new Map<string, string>();
  const spoken: { line: VoiceLine; at: number; stopped: boolean }[] = [];
  const shared = new FakeEngine(clock, 0.5);
  const made: FakeEngine[] = [];
  let radio = false;
  const ctx = {
    get currentTime() {
      return clock.t;
    },
  } as AudioContext;
  const host: ChatterHost = {
    speak(line) {
      const rec = { line, at: clock.t, stopped: false };
      spoken.push(rec);
      const h: VoiceHandle = {
        plan: { total: 2 } as VoiceHandle['plan'],
        startedAt: clock.t,
        stretch: 1,
        stop: () => {
          rec.stopped = true;
        },
      };
      return h;
    },
    audioCtx: () => ctx,
    sharedHouse: () => {
      shared.load();
      return shared.ready ? (shared as unknown as TtsEngine) : null;
    },
    makeHouse: () => {
      const e = new FakeEngine(clock, 1, opts.fail);
      made.push(e);
      return e as unknown as TtsEngine;
    },
    plan: () => ({
      mode: opts.mode ?? 'auto',
      device: { coarse: opts.coarse ?? false, saveData: false },
      weak: false,
      realOn: opts.realOn ?? true,
    }),
    radioOn: () => radio,
    places: () => [{ id: 'town:cowboy', name: 'Dry Gulch', kind: 'town', style: 'cowboy' }],
    tod: () => 'night',
    now: () => clock.t,
    get: k => store.get(k) ?? null,
    set: (k, v) => void store.set(k, v),
  };
  const c = new ChatterSystem(host, 99);
  const run = (s: number) => {
    for (let i = 0; i < s * 10; i++) {
      clock.t += 0.1;
      c.tick();
    }
  };
  return {
    c,
    clock,
    spoken,
    shared,
    made,
    store,
    run,
    setRadio: (v: boolean) => {
      radio = v;
    },
  };
}

const chatLines = <T extends { line: VoiceLine }>(s: T[]): T[] =>
  s.filter(x => (x.line.gain ?? 0) < 0.9);

describe('ChatterSystem', () => {
  it('talks continuously in the house voice, never the same line twice', () => {
    const r = rig();
    r.c.start({ speaker: 'passenger', seed: [1, 2, 3, 4, 5], name: 'PIP', dest: 'DRY GULCH' });
    r.run(120);
    const lines = chatLines(r.spoken);
    expect(lines.length).toBeGreaterThan(25);
    expect(new Set(lines.map(l => l.line.text)).size).toBe(lines.length);
    // after the house is ready, every line goes to it with the speaker's tuning
    const house = lines.filter(l => l.line.engine !== undefined);
    expect(house.length).toBeGreaterThan(lines.length - 3);
    expect(house[0]!.line.tts!.speaker).toBe(0);
    // lines don't overlap: each starts after the last one's 2 s
    for (let i = 1; i < lines.length; i++)
      expect(lines[i]!.at - lines[i - 1]!.at).toBeGreaterThanOrEqual(2);
    // played lines are dropped from the engine's cache
    expect(r.shared.forgot.length).toBeGreaterThan(20);
  });

  it('pre-synthesizes the next line in the background', () => {
    const r = rig();
    r.c.start({ speaker: 'cabbie', seed: [7], name: 'MOSS' });
    r.run(20);
    const said = chatLines(r.spoken).map(s => s.line.text);
    expect(said.length).toBeGreaterThan(2);
    for (const t of said.slice(1)) expect(r.shared.synths).toContain(t);
  });

  it('goes quiet while the radio is on, and picks up after', () => {
    const r = rig();
    r.c.start({ speaker: 'passenger', seed: [3], name: 'DOT' });
    r.run(10);
    const before = chatLines(r.spoken).length;
    expect(before).toBeGreaterThan(0);
    r.setRadio(true);
    r.run(0.2);
    expect(r.spoken.at(-1)!.stopped).toBe(true); // the line was cut
    expect(r.c.ui?.state).toBe('radio');
    const during = chatLines(r.spoken).length;
    r.run(30);
    expect(chatLines(r.spoken).length).toBe(during);
    r.setRadio(false);
    r.run(6);
    expect(chatLines(r.spoken).length).toBeGreaterThan(during);
    expect(r.c.ui?.state).toBe('talk');
  });

  it('mute holds it, is remembered, and hides the words', () => {
    const r = rig();
    r.c.start({ speaker: 'passenger', seed: [3], name: 'DOT' });
    r.run(5);
    r.c.setMuted(true);
    expect(r.store.get('noun-taxi-chatter-muted')).toBe('1');
    const n = r.spoken.length;
    r.run(20);
    expect(r.spoken.length).toBe(n);
    expect(r.c.ui?.muted).toBe(true);
    // a new system (next visit) starts muted
    const r2 = rig();
    r2.store.set('noun-taxi-chatter-muted', '1');
    const c2 = new ChatterSystem(
      { ...(r2.c as unknown as { host: ChatterHost }).host, get: k => r2.store.get(k) ?? null },
      1,
    );
    expect(c2.muted).toBe(true);
    // and muted shouts say nothing either
    r.c.event('WOOO!');
    expect(r.spoken.length).toBe(n);
  });

  it('an event line interrupts, then the chatter resumes', () => {
    const r = rig();
    r.c.start({ speaker: 'passenger', seed: [4], name: 'GUS' });
    r.run(4);
    const cut = r.spoken.at(-1)!;
    expect(r.c.event('OW!')).toBe(true);
    expect(cut.stopped).toBe(true);
    const shout = r.spoken.at(-1)!;
    expect(shout.line.text).toBe('OW!');
    expect(shout.line.engine).toBeDefined(); // same (house) voice
    expect(shout.line.tts!.rate).toBeGreaterThan(cut.line.tts!.rate); // hyped
    r.run(1);
    expect(r.spoken.at(-1)).toBe(shout); // not talked over
    r.run(6);
    expect(r.spoken.at(-1)!.line.text).not.toBe('OW!');
  });

  it("event() says no when nobody's talking (the caller voices it)", () => {
    const r = rig();
    expect(r.c.event('TAXI!')).toBe(false);
  });

  it('touch device: loads a private house for the ride, babbles meanwhile, frees it after', () => {
    const r = rig({ realOn: false, coarse: true });
    r.c.start({ speaker: 'passenger', seed: [5], name: 'TILLY' });
    expect(r.made.length).toBe(1);
    expect(r.c.ui?.voice).toBe('loading');
    r.run(3);
    const first = chatLines(r.spoken)[0]!;
    // the first line came before the house was ready? then it used the seed voice
    if (first.at < 1) expect(first.line.engine).toBeUndefined();
    r.run(15);
    expect(chatLines(r.spoken).some(s => s.line.engine !== undefined)).toBe(true);
    expect(r.c.ui?.voice).toBe('house');
    r.c.stop();
    expect(r.made[0]!.disposed).toBe(false); // kept a while (the next fare)
    r.run(31);
    expect(r.made[0]!.disposed).toBe(true);
    expect(r.c.voiceLoad.private).toBe(false);
    // hopping into the next cab within the window reuses it
    const r2 = rig({ realOn: false, coarse: true });
    r2.c.start({ speaker: 'passenger', seed: [5] });
    r2.run(3);
    r2.c.stop();
    r2.run(10);
    r2.c.start({ speaker: 'passenger', seed: [6] });
    expect(r2.made.length).toBe(1);
    expect(r2.made[0]!.disposed).toBe(false);
  });

  it('shared house (desktop) is never disposed', () => {
    const r = rig();
    r.c.start({ speaker: 'passenger', seed: [5] });
    r.run(5);
    r.c.stop();
    r.run(60);
    expect(r.shared.disposed).toBe(false);
    expect(r.made.length).toBe(0);
  });

  it('a house that fails to load falls back to the seed voice for good', () => {
    const r = rig({ realOn: false, coarse: true, fail: true });
    r.c.start({ speaker: 'passenger', seed: [5] });
    r.run(20);
    expect(chatLines(r.spoken).every(s => s.line.engine === undefined)).toBe(true);
    expect(r.c.ui?.voice).toBe('fallback');
    r.c.stop();
    r.c.start({ speaker: 'passenger', seed: [6] });
    expect(r.made.length).toBe(1); // not retried
  });

  it('voices off in settings: never loads the house', () => {
    const r = rig({ realOn: false, mode: 'off' });
    r.c.start({ speaker: 'passenger', seed: [5] });
    r.run(10);
    expect(r.made.length).toBe(0);
    expect(r.shared.loads).toBe(0);
    expect(chatLines(r.spoken).length).toBeGreaterThan(0);
  });

  it('stop() cuts the line and forgets the queued one', () => {
    const r = rig();
    r.c.start({ speaker: 'passenger', seed: [5] });
    r.run(4);
    const last = r.spoken.at(-1)!;
    r.c.stop();
    expect(last.stopped).toBe(true);
    expect(r.c.ui).toBeNull();
    const n = r.spoken.length;
    r.run(10);
    expect(r.spoken.length).toBe(n);
  });

  it('driving banter follows a stunt', () => {
    const r = rig();
    r.c.start({ speaker: 'passenger', seed: [5] });
    r.run(3);
    for (let i = 0; i < 10; i++) {
      r.c.note('crash');
      r.run(5);
    }
    expect(r.c.gen.count).toBeGreaterThan(5);
    expect(r.c.log.transcript.join(' ')).toMatch(/wall|bump|neck|list|crashed/i);
  });
});
