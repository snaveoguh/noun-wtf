import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { PITCH_11, PITCH_5, PITCH_7, STADIUM, type PitchSpec, type SimState } from '../contract';

import { FootballCamera } from './camera';
import {
  broadcastShot,
  broadcastZoom,
  celebrationShot,
  GANTRY_Y,
  highShot,
  playerShot,
  replayShot,
  ROOF_MARGIN,
  setPieceShot,
  walkoutShot,
  type FrameCtx,
  type Shot,
} from './camFraming';
import { createMockMatch } from './mock';

function camOf(s: Shot, aspect: number) {
  const c = new THREE.PerspectiveCamera(s.fov, aspect, 0.1, 1000);
  c.position.set(s.pos.x, s.pos.y, s.pos.z);
  c.lookAt(s.look.x, s.look.y, s.look.z);
  c.updateMatrixWorld();
  return c;
}

/** NDC of a pitch point through a shot. */
function ndc(s: Shot, aspect: number, x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z).project(camOf(s, aspect));
}

const onScreen = (v: THREE.Vector3, m = 0.92) => v.z < 1 && Math.abs(v.x) < m && Math.abs(v.y) < m;

const ASPECTS = [16 / 9, 4 / 3, 390 / 844, 21 / 9];

describe('broadcast framing', () => {
  it('keeps the focus on screen anywhere on every pitch and aspect', () => {
    for (const pitch of [PITCH_11, PITCH_7, PITCH_5] as PitchSpec[])
      for (const aspect of ASPECTS)
        for (const stand of [-1, 1] as const) {
          const ctx: FrameCtx = { pitch, aspect, stand };
          for (let x = -pitch.width / 2; x <= pitch.width / 2; x += pitch.width / 6)
            for (let z = -pitch.length / 2; z <= pitch.length / 2; z += pitch.length / 8)
              for (const zoom of [0, 0.5, 1]) {
                const s = broadcastShot(x, z, zoom, ctx);
                const v = ndc(s, aspect, x, 0.2, z);
                expect(onScreen(v, 0.6), `${pitch.length} a${aspect.toFixed(2)} ${x},${z}`).toBe(
                  true,
                );
              }
        }
  });

  it('never shows the far stand roof rim at the top of the frame', () => {
    for (const aspect of ASPECTS)
      for (const stand of [-1, 1] as const) {
        const ctx: FrameCtx = { pitch: PITCH_11, aspect, stand };
        for (const x of [-34, 0, 34])
          for (const z of [-52, 0, 52])
            for (const zoom of [0, 1]) {
              const s = broadcastShot(x, z, zoom, ctx);
              const c = camOf(s, aspect);
              // The top-centre ray of the frame, where it reaches the far wall
              const dir = new THREE.Vector3(0, 1, 0.5).unproject(c).sub(c.position).normalize();
              const farX = -stand * STADIUM.halfX;
              const t = (farX - c.position.x) / dir.x;
              expect(t).toBeGreaterThan(0);
              const y = c.position.y + dir.y * t;
              expect(y, `${x},${z} zoom ${zoom}`).toBeLessThan(STADIUM.height - ROOF_MARGIN + 0.5);
            }
      }
  });

  it('sits on the gantry and frames tighter in the box', () => {
    const ctx: FrameCtx = { pitch: PITCH_11, aspect: 16 / 9, stand: -1 };
    const s = broadcastShot(0, 0, 0.3, ctx);
    expect(s.pos.x).toBeLessThan(-PITCH_11.width / 2);
    expect(s.pos.y).toBe(GANTRY_Y);
    expect(broadcastZoom(0, 0.1, 45, 3, PITCH_11)).toBeGreaterThan(
      broadcastZoom(0, 0.1, 0, 3, PITCH_11),
    );
    // A fast high ball opens it up
    expect(broadcastZoom(0, 8, 45, 30, PITCH_11)).toBeLessThan(
      broadcastZoom(0, 0.1, 45, 3, PITCH_11),
    );
    expect(broadcastShot(0, 45, 1, ctx).fov).toBeLessThan(broadcastShot(0, 45, 0, ctx).fov);
  });
});

describe('other shots', () => {
  const ctx: FrameCtx = { pitch: PITCH_11, aspect: 16 / 9, stand: -1 };
  it('player cam sits behind the player and sees them', () => {
    for (const attack of [1, -1] as const) {
      const s = playerShot(5, 10, attack, ctx);
      expect(Math.sign(10 - s.pos.z)).toBe(attack);
      expect(onScreen(ndc(s, 16 / 9, 5, 1, 10))).toBe(true);
    }
  });
  it('high cam sees the width of the pitch', () => {
    const s = highShot(0, ctx);
    for (const x of [-34, 34]) expect(onScreen(ndc(s, 16 / 9, x, 0, 0), 1)).toBe(true);
  });
  it('cinematic + replay shots keep their subject in frame', () => {
    for (let t = 0; t < 30; t += 3.7)
      expect(onScreen(ndc(walkoutShot(t, ctx), 16 / 9, 0, 1, 0))).toBe(true);
    for (const yaw of [0, 1, 2.5, -2]) {
      const s = celebrationShot(-30, 50, yaw, 4, ctx);
      expect(onScreen(ndc(s, 16 / 9, -30, 1.3, 50))).toBe(true);
    }
    const sp = setPieceShot(-34, 52.5, 52.5, ctx);
    expect(onScreen(ndc(sp, 16 / 9, -34, 0.1, 52.5))).toBe(true);
    for (const angle of ['goalcam', 'tele'] as const)
      for (const [bx, by, bz] of [
        [0, 1, 40],
        [3, 2, 52],
        [-20, 0.1, 30],
      ]) {
        const s = replayShot(angle, bx, by, bz, 52.5, ctx);
        expect(onScreen(ndc(s, 16 / 9, bx, by, bz)), `${angle} ${bx},${bz}`).toBe(true);
      }
  });
});

describe('the director on a live (mock) match', () => {
  it('keeps the ball on screen through the whole scripted move, no snaps', () => {
    const m = createMockMatch();
    const cam = new FootballCamera(PITCH_11, -1);
    let prev: { x: number; y: number; z: number } | null = null;
    let worst = 0;
    let offFrames = 0;
    let frames = 0;
    let lastShot = cam.shot;
    let since = 99;
    for (let i = 0; i < 28 * 30; i++) {
      m.step(1 / 30);
      const s: SimState = m.state();
      const shot = cam.update(
        1 / 30,
        s,
        { controlled: null, scorer: 't0p9', time: i / 30 },
        16 / 9,
      );
      if (prev !== null)
        worst = Math.max(
          worst,
          Math.hypot(shot.pos.x - prev.x, shot.pos.y - prev.y, shot.pos.z - prev.z),
        );
      prev = { ...shot.pos };
      // The ball, while it's in play and the broadcast cam is up (once the
      // glide back from a cinematic shot has settled)
      if (cam.shot !== lastShot) {
        lastShot = cam.shot;
        since = 0;
      }
      since += 1 / 30;
      if (cam.shot === 'broadcast' && s.phase === 'live' && since > 1.5) {
        frames++;
        if (!onScreen(ndc(shot, 16 / 9, s.ball.x, s.ball.y, s.ball.z), 0.95)) offFrames++;
      }
    }
    expect(frames).toBeGreaterThan(200);
    expect(offFrames).toBe(0);
    // No camera jump bigger than a couple of metres a frame (glides, not cuts)
    expect(worst).toBeLessThan(2.5);
  });

  it('cuts in to the celebration during a goal and glides back', () => {
    const m = createMockMatch();
    const cam = new FootballCamera(PITCH_11, -1);
    const seen = new Set<string>();
    for (let i = 0; i < 17 * 30; i++) {
      m.step(1 / 30);
      cam.update(1 / 30, m.state(), { controlled: null, scorer: 't0p9', time: i / 30 }, 16 / 9);
      seen.add(cam.shot);
    }
    expect(seen.has('celebration')).toBe(true);
    expect(seen.has('broadcast')).toBe(true);
  });
});
