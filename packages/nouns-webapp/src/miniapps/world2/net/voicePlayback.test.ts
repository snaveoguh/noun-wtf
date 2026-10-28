import { describe, expect, it } from 'vitest';

import { PlaybackGate, UNLOCK_EVENTS, type Playable } from './voicePlayback';

/** An <audio> stand-in that refuses play() until `allow` is set. */
function fakeAudio() {
  const el = {
    paused: true,
    allow: false,
    calls: 0,
    play() {
      el.calls++;
      if (!el.allow) return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      el.paused = false;
      return Promise.resolve();
    },
  };
  return el;
}

describe('PlaybackGate', () => {
  it('marks a refused element blocked and clears it once a retry plays', async () => {
    const gate = new PlaybackGate();
    const a = fakeAudio();
    expect(await gate.play(a)).toBe(false);
    expect(gate.blockedCount).toBe(1);
    // a gesture that still doesn't unlock (e.g. pointerdown on iOS)
    await gate.retry([a]);
    expect(gate.blockedCount).toBe(1);
    a.allow = true;
    expect(await gate.retry([a])).toEqual([true]);
    expect(gate.blockedCount).toBe(0);
    expect(a.paused).toBe(false);
  });

  it('retries only paused elements', async () => {
    const gate = new PlaybackGate();
    const playing = fakeAudio();
    playing.allow = true;
    await gate.play(playing);
    const n = playing.calls;
    const stuck = fakeAudio();
    await gate.play(stuck);
    stuck.allow = true;
    await gate.retry([playing, stuck]);
    expect(playing.calls).toBe(n);
    expect(gate.blockedCount).toBe(0);
  });

  it('every late-joined voice recovers on one gesture', async () => {
    const gate = new PlaybackGate();
    const els = [fakeAudio(), fakeAudio(), fakeAudio()];
    for (const e of els) await gate.play(e);
    expect(gate.blockedCount).toBe(3);
    for (const e of els) e.allow = true;
    await gate.retry(els);
    expect(gate.blockedCount).toBe(0);
  });

  it("doesn't count a superseded play() (AbortError) as blocked", async () => {
    const gate = new PlaybackGate();
    const el: Playable = {
      paused: true,
      play: () => Promise.reject(new DOMException('replaced', 'AbortError')),
    };
    await gate.play(el);
    expect(gate.blockedCount).toBe(0);
  });

  it('forget drops a removed element', async () => {
    const gate = new PlaybackGate();
    const a = fakeAudio();
    await gate.play(a);
    gate.forget(a);
    expect(gate.blockedCount).toBe(0);
  });

  it('unlocks on events that carry activation on touch screens, not pointerdown', () => {
    expect(UNLOCK_EVENTS).toContain('touchend');
    expect(UNLOCK_EVENTS).toContain('click');
    expect(UNLOCK_EVENTS).not.toContain('pointerdown' as never);
  });
});
