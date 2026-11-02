// ── Dev harness: the match view on the mock match, inside a running Game ──
//
//   const d = await window.__w2.footballDev()          // a pitch floating over the skater
//   await d.ready()                                    // every footballer built
//   d.seek(9.7); d.render()                            // scrub the mock + draw a frame
//   d.live()                                           // play it in real time
//   d.cam('player'); d.replay(); d.stopReplay()
//   const sheet = await window.__w2.footballDev({ sheet: true })   // one footballer per Action
//   d.perf()                                           // the view's costs + renderer info
//   d.dispose()
//
// Not shipped anywhere (Game.footballDev imports it on demand in dev builds).

import type { Game } from '../../Game';
import type { CamMode, SimState, StadiumViewApi } from '../contract';

import { createElement } from 'react';

import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';

import { warmHidden } from '../../render/shaderWarm';

import { FootballHud } from './FootballHud';
import { createMockMatch, createPoseSheet } from './mock';
import { StubStadium } from './stubStadium';

import { createFootballView } from './index';

export interface FootballDevOptions {
  /** The contact sheet: one footballer per Action on a grid. */
  sheet?: boolean;
  /** Phone settings (LOD, blob shadows). Defaults to the game's quality. */
  low?: boolean;
  /** Use this stadium instead of the stub. */
  stadium?: StadiumViewApi;
  /** Height over the skater (m). */
  lift?: number;
}

export async function footballDemo(g: Game, o: FootballDevOptions = {}) {
  const p = g.player.pos;
  const frame = {
    x: Math.round(p.x),
    y: Math.round(p.y + (o.lift ?? 260)),
    z: Math.round(p.z),
    yaw: 0,
  };
  const low = o.low ?? g.gfx.quality === 'low';
  const stadium = o.stadium ?? new StubStadium(frame);
  const gfx = g.gfx;
  const view = createFootballView(
    { frame, low },
    {
      scene: gfx.scene,
      stadium,
      assets: g.assets,
      toon: gfx.toon,
      shadows: !low,
      audio: () => g.audio.ctx,
      audioOut: () => g.audio.master,
      canvas: gfx.renderer.domElement,
      ink: gfx.outline,
      warm: obj => warmHidden(gfx.renderer, obj, gfx.camera, gfx.scene, f => gfx.asDrawn(f)),
    },
  );
  while (!view.buildStep()) await new Promise(r => setTimeout(r, 0));
  const mock = createMockMatch();
  const stand = view.cam.ctx.stand;
  const sheet = o.sheet === true ? createPoseSheet(7, 3.1, stand) : null;
  view.setMatch(sheet?.config ?? mock.config);
  view.setLocal('me');
  view.setLive(true);
  const meWas = g.me?.root.visible ?? true;
  if (g.me !== null) g.me.root.visible = false;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none';
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  root.render(createElement(FootballHud, { hud: view.hud, onSkipReplay: () => view.stopReplay() }));

  let prev: SimState = sheet?.state(0) ?? mock.state();
  let next: SimState = prev;
  let sheetT = 0;
  const cam = gfx.camera;
  /** Fixed camera for the sheet (pitch space). */
  let manual: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null =
    sheet !== null
      ? { pos: new THREE.Vector3(stand * 25, 9, 0), look: new THREE.Vector3(0, 0.6, 0), fov: 50 }
      : null;
  const centre = new THREE.Vector3(frame.x, frame.y, frame.z);
  const toWorld = (v: THREE.Vector3) => v.clone().applyMatrix4(view.root.matrixWorld);

  const tick = (dt: number) => {
    prev = next;
    if (sheet !== null) {
      sheetT += dt;
      next = sheet.state(sheetT);
    } else {
      const ev = mock.step(dt);
      next = mock.state();
      next.events = ev;
      view.events(ev, next);
    }
    view.draw(prev, next, 1, dt);
    if (manual !== null) {
      view.root.updateMatrixWorld();
      cam.position.copy(toWorld(manual.pos));
      cam.lookAt(toWorld(manual.look));
      cam.fov = manual.fov;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      // The view's LOD eye + frustum from this camera (it doesn't drive it).
      // The contact sheet never observes: every footballer posed every frame.
      if (sheet === null) view.observe(cam);
    } else view.camera(cam, dt, next);
  };

  let raf = 0;
  const g2 = g as unknown as { running: boolean; raf: number; frame: (n: number) => void };
  let tookOver = false;
  const api = {
    view,
    mock,
    sheet,
    stadium,
    frame,
    get state() {
      return next;
    },
    /** Build every footballer (one a frame, like the real thing). */
    async ready() {
      while (view.pending > 0) {
        view.buildStep();
        await new Promise(r => setTimeout(r, 16));
      }
      // The GLB heads land a moment later
      await new Promise(r => setTimeout(r, 1500));
    },
    /** Advance `secs` in `fps` steps (no rendering). */
    play(secs: number, fps = 30) {
      const n = Math.max(1, Math.round(secs * fps));
      for (let i = 0; i < n; i++) tick(1 / fps);
    },
    /** Run the mock to time `t` (s) from where it is. */
    seek(t: number, fps = 30) {
      const now = sheet !== null ? sheetT : mock.time;
      if (t > now) api.play(t - now, fps);
    },
    cam(mode: CamMode, focus?: string | null) {
      manual = null;
      view.setCamera(mode, focus);
    },
    /** Fix the camera (pitch space) for stills. */
    shot(pos: [number, number, number], look: [number, number, number], fov = 45) {
      manual = { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look), fov };
    },
    replay(seconds = 3.2) {
      return view.replay(seconds);
    },
    stopReplay() {
      view.stopReplay();
    },
    render() {
      if (manual !== null) {
        view.root.updateMatrixWorld();
        cam.position.copy(toWorld(manual.pos));
        cam.lookAt(toWorld(manual.look));
        cam.fov = manual.fov;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
      }
      gfx.followShadow(centre);
      gfx.render(1 / 60);
    },
    /** Screen px of each footballer's head top (contact sheet labels). */
    labels() {
      const w = gfx.renderer.domElement.clientWidth;
      const h = gfx.renderer.domElement.clientHeight;
      return [...view.footballers.values()].map(fb => {
        const v = fb.root.position
          .clone()
          .add(new THREE.Vector3(0, 2.5, 0))
          .applyMatrix4(view.root.matrixWorld)
          .project(cam);
        return {
          id: fb.f.id,
          name: fb.f.name,
          x: (v.x * 0.5 + 0.5) * w,
          y: (-v.y * 0.5 + 0.5) * h,
        };
      });
    },
    /** The view's costs + one whole frame's renderer counts (every pass). */
    perf() {
      const info = gfx.renderer.info;
      const auto = info.autoReset;
      info.autoReset = false;
      info.reset();
      api.render();
      const calls = info.render.calls;
      const tris = info.render.triangles;
      // The same frame without the match (footballers + ball): what the view adds
      view.root.visible = false;
      info.reset();
      api.render();
      const without = info.render.calls;
      const trisWithout = info.render.triangles;
      view.root.visible = true;
      info.autoReset = auto;
      return {
        ...view.stats,
        footballers: view.footballers.size,
        matchCalls: calls - without,
        matchTriangles: tris - trisWithout,
        calls,
        triangles: tris,
        programs: info.programs?.length ?? 0,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
      };
    },
    live() {
      tookOver = g2.running;
      g2.running = false;
      cancelAnimationFrame(g2.raf);
      let last = performance.now();
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        tick(dt);
        api.render();
      };
      raf = requestAnimationFrame(loop);
    },
    dispose() {
      cancelAnimationFrame(raf);
      root.unmount();
      host.remove();
      view.dispose();
      if (g.me !== null) g.me.root.visible = meWas;
      if (tookOver) {
        g2.running = true;
        g2.raf = requestAnimationFrame(g2.frame);
      }
    },
  };
  return api;
}
