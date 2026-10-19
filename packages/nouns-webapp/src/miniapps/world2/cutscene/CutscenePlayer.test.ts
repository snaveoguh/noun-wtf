import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { CutscenePlayer, type CutsceneHost, type Directable } from './CutscenePlayer';
import { sceneLength } from './scenes';

function fakeHost(over: Partial<CutsceneHost> = {}) {
  const camera = new THREE.PerspectiveCamera(70, 1.5, 0.1, 1000);
  camera.position.set(0, 3, 10);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const state = { ud: false, input: true, seen: [] as string[], cues: [] as string[] };
  const oracle: Directable & { glow: number } = {
    direct: null,
    glow: 0,
    glowTo(k: number) {
      this.glow = k;
    },
  };
  const speak = vi.fn(() => ({ stop: vi.fn() }));
  const host: CutsceneHost = {
    camera,
    stats: { suspended: false },
    setInput: on => (state.input = on),
    // The gameplay camera sits behind the rider
    liveCamera: () => {
      camera.position.set(0, 3, 10);
      camera.lookAt(0, 1, 0);
      camera.fov = 70;
      camera.updateMatrixWorld();
    },
    canPlay: () => true,
    suspendedAfter: () => state.ud,
    inputAfter: () => true,
    anchorOf: () => ({ x: 0, y: 0, z: 0, yaw: 0 }),
    rider: () => new THREE.Vector3(0, 0, 3),
    npc: who => (who === 'oracle' ? oracle : null),
    voice: { speak, stopAll: vi.fn() },
    sound: { play: vi.fn(), music: vi.fn(() => vi.fn()) },
    cue: name => {
      state.cues.push(name);
      if (name === 'enterUD') state.ud = true;
    },
    endCues: vi.fn(),
    reduceMotion: () => false,
    markSeen: id => state.seen.push(id),
    ...over,
  };
  return { host, state, oracle, speak, camera };
}

function run(p: CutscenePlayer, secs: number, dt = 1 / 30) {
  for (let t = 0; t < secs && p.active; t += dt) p.update(dt);
}

describe('CutscenePlayer', () => {
  it('suspends stats and input for the scene, restores both after', () => {
    const { host, state } = fakeHost();
    const p = new CutscenePlayer(host);
    expect(p.play('oracle')).toBe(true);
    expect(host.stats.suspended).toBe(true);
    expect(state.input).toBe(false);
    run(p, 3);
    expect(p.active).toBe(true);
    expect(host.stats.suspended).toBe(true);
    run(p, sceneLength('oracle') + 1);
    expect(p.active).toBe(false);
    expect(host.stats.suspended).toBe(false);
    expect(state.input).toBe(true);
    expect(state.seen).toEqual(['oracle']);
  });

  it('a scene that leaves you in the Upside Down leaves stats suspended', () => {
    const { host, state } = fakeHost();
    const p = new CutscenePlayer(host);
    p.play('door');
    run(p, sceneLength('door') + 1);
    expect(state.cues).toContain('enterUD');
    expect(host.stats.suspended).toBe(true);
  });

  it('hands back exactly at the gameplay camera (no cut out)', () => {
    const { host, camera } = fakeHost();
    const p = new CutscenePlayer(host);
    p.play('keymaker');
    // somewhere mid-scene the camera is elsewhere
    run(p, 4);
    expect(camera.position.distanceTo(new THREE.Vector3(0, 3, 10))).toBeGreaterThan(0.5);
    // last frame before the hand-back: right on the live pose
    const len = sceneLength('keymaker');
    while (p.active && p.t + 1 / 30 < len) p.update(1 / 30);
    p.update(len - p.t);
    expect(p.active).toBe(false);
    expect(camera.position.distanceTo(new THREE.Vector3(0, 3, 10))).toBeLessThan(1e-3);
  });

  it('speaks its lines and lights the crystal ball, then puts the cast back', () => {
    const { host, oracle, speak } = fakeHost();
    const p = new CutscenePlayer(host);
    p.play('oracle');
    run(p, 3);
    expect(speak).toHaveBeenCalled();
    expect(oracle.direct).not.toBeNull();
    run(p, 60);
    expect(oracle.direct).toBeNull();
    expect(oracle.glow).toBe(0);
  });

  it('skip: must-run cues still happen and play resumes within half a second', () => {
    const { host, state } = fakeHost();
    const p = new CutscenePlayer(host);
    p.play('door');
    run(p, 0.5);
    p.skip();
    expect(state.cues).toContain('enterUD');
    expect(host.voice.stopAll).toHaveBeenCalled();
    run(p, 0.5);
    expect(p.active).toBe(false);
    expect(host.stats.suspended).toBe(true); // in the Upside Down now
  });

  it('never starts when it cannot play (a replay running), queues on request', () => {
    let can = false;
    const { host } = fakeHost({ canPlay: () => can });
    const p = new CutscenePlayer(host);
    expect(p.play('one')).toBe(false);
    expect(host.stats.suspended).toBe(false);
    p.request('one');
    p.tick();
    expect(p.active).toBe(false);
    can = true;
    p.tick();
    expect(p.active).toBe(true);
    expect(p.id).toBe('one');
  });

  it('abort (a replay started) restores everything without the hand-back callback', () => {
    const { host, state } = fakeHost();
    const then = vi.fn();
    const p = new CutscenePlayer(host);
    p.play('oracle', { then });
    run(p, 1);
    p.abort();
    expect(p.active).toBe(false);
    expect(host.stats.suspended).toBe(false);
    expect(state.input).toBe(true);
    expect(then).not.toHaveBeenCalled();
  });

  it('journal replays change nothing in the world and set no seen-flag', () => {
    const { host, state } = fakeHost();
    const p = new CutscenePlayer(host);
    const then = vi.fn();
    p.play('door', { replay: true, then });
    expect(p.replay).toBe(true);
    run(p, 60);
    expect(state.seen).toEqual([]);
    expect(then).toHaveBeenCalledOnce();
    expect(host.endCues).toHaveBeenCalledWith(true);
  });

  it('The One freezes the world clock', () => {
    const { host } = fakeHost();
    const p = new CutscenePlayer(host);
    p.play('one');
    run(p, 1);
    expect(p.timeScale).toBe(0);
    expect(new CutscenePlayer(host).timeScale).toBe(1);
  });
});
