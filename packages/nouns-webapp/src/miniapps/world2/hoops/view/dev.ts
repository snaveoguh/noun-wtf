// ── Dev harness: the view on the mock stream, inside a running Game ─────
//
//   const d = await (await import('/src/miniapps/world2/hoops/view/dev.ts')).hoopsDemo(window.__w2)
//   d.seek(20.1); d.render()
//
// Builds a HoopsView on the Noun Jersey court, mounts HoopsHud over the
// canvas and lets you scrub the scripted reel (mock.ts). Not shipped
// anywhere; for tests, screenshots and poking at it from the console.

import type { Game } from '../../Game';

import { createElement } from 'react';

import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';

import { SIM_DT } from '../contract';

import { jerseyCourtToWorld } from './frame';
import { HoopsHud } from './HoopsHud';
import { createMockStream } from './mock';

import { HoopsView, type HoopsCameraMode } from './index';

export async function hoopsDemo(
  g: Game,
  opts: { touch?: boolean; quality?: 'low' | 'medium' | 'high'; camera?: HoopsCameraMode } = {},
) {
  const map = jerseyCourtToWorld();
  if (map === null || g.assets === null) throw new Error('noun jersey / assets not ready');
  const stream = createMockStream();
  // The game's own name-tag layer (private on Game)
  const labelLayer = (g as unknown as { labelLayer: HTMLElement }).labelLayer;
  const view = new HoopsView({
    scene: g.gfx.scene,
    camera: g.gfx.camera,
    renderer: g.gfx.renderer,
    assets: g.assets,
    quality: opts.quality ?? g.gfx.quality,
    toon: g.gfx.toon,
    labelLayer,
    courtToWorld: map,
    config: stream.config,
    audio:
      g.audio.ctx !== null && g.audio.master !== null
        ? { ctx: g.audio.ctx, out: g.audio.master }
        : null,
  });
  view.setLocal('me');
  if (opts.camera !== undefined) view.setCameraMode(opts.camera);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:60;pointer-events:none';
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let lastInput = '';
  root.render(
    createElement(HoopsHud, {
      view,
      touch: opts.touch,
      onInput: i => {
        lastInput = JSON.stringify(i);
      },
    }),
  );
  let t = 0;
  const centre = new THREE.Vector3();
  const api = {
    view,
    stream,
    get t() {
      return t;
    },
    get lastInput() {
      return lastInput;
    },
    /** Feed states up to time `to` (s) at real-time pacing, no rendering. */
    seek(to: number) {
      while (t < to) {
        t += SIM_DT;
        view.update(SIM_DT, stream.at(t));
      }
    },
    /** Advance `secs` of wall time (in `n` frames) without rendering. */
    play(secs: number, fps = 60) {
      const n = Math.round(secs * fps);
      for (let i = 0; i < n; i++) {
        t += 1 / fps;
        view.update(1 / fps, stream.at(Math.min(t, stream.duration)));
      }
    },
    render() {
      const c = map(0, 0, 0, { x: 0, y: 0, z: 0 });
      centre.set(c.x, c.y, c.z);
      g.gfx.followShadow(centre);
      g.gfx.render(1 / 60);
    },
    dispose() {
      root.unmount();
      host.remove();
      view.dispose();
    },
  };
  return api;
}
