// ── Integration points: the sim and the view hoops mode runs ────────────
//
// createSim → hoops/sim's HoopsSim. createView → hoops/view's HoopsView,
// adapted to the HoopsViewLike shape HoopsMode drives: `update(dt, state,
// events)` every frame (the view owns the camera while hoops runs) and
// `dispose()`. The view's React HUD (score bug, shot meter, callouts,
// touch overlay) is mounted into the HUD layer HoopsUi provides; its touch
// stick arrives in court space and goes straight into the input reader.
//
// The view (court dressing, ballers, HUD: the bulk of hoops) is its own
// chunk, so the world doesn't download it until someone heads for a game.
// preloadHoopsView() starts the fetch (HoopsMode calls it on the court);
// a view created before it lands draws nothing and swaps in on arrival.

import type { GameConfig, HoopsSimApi } from '../contract';
import type { HoopsViewLike, HoopsViewOptions } from './stubView';

import { createElement } from 'react';

import { createRoot } from 'react-dom/client';

import { HoopsSim } from '../sim';

import { StubView } from './stubView';

type ViewModule = typeof import('../view');
type HudModule = typeof import('../view/HoopsHud');

let loaded: { view: ViewModule; hud: HudModule } | null = null;
let loading: Promise<{ view: ViewModule; hud: HudModule }> | null = null;

/** Fetch the hoops view chunk (once). */
export function preloadHoopsView(): Promise<{ view: ViewModule; hud: HudModule }> {
  loading ??= Promise.all([import('../view'), import('../view/HoopsHud')]).then(([view, hud]) => {
    loaded = { view, hud };
    return loaded;
  });
  return loading;
}

export function createSim(config: GameConfig): HoopsSimApi {
  return new HoopsSim(config);
}

export function createView(opts: HoopsViewOptions): HoopsViewLike {
  // Without the renderer or the character assets (tests, a failed asset
  // load) fall back to the capsule view rather than not drawing the game
  if (opts.renderer === undefined || opts.assets === null) return new StubView(opts);
  if (loaded !== null) return buildView(opts, loaded.view, loaded.hud);
  // Not here yet: stand in until the chunk arrives, then hand over
  let inner: HoopsViewLike | null = null;
  let disposed = false;
  void preloadHoopsView().then(m => {
    if (!disposed) inner = buildView(opts, m.view, m.hud);
  });
  return {
    update(dt, state, events) {
      inner?.update(dt, state, events);
    },
    dispose() {
      disposed = true;
      inner?.dispose();
    },
  };
}

function buildView(opts: HoopsViewOptions, V: ViewModule, H: HudModule): HoopsViewLike {
  const renderer = opts.renderer!;
  const assets = opts.assets!;
  const view = new V.HoopsView({
    scene: opts.scene,
    camera: opts.camera,
    renderer,
    assets,
    quality: opts.quality ?? 'medium',
    toon: opts.toon,
    labelLayer: opts.labelLayer ?? opts.hudLayer,
    courtToWorld: (x, y, z, out) => opts.court.toWorld(x, y, z, out),
    config: opts.config,
    audio:
      opts.audio !== null
        ? { ctx: opts.audio, out: opts.audioOut ?? opts.audio.destination }
        : null,
  });
  view.setLocal(opts.me);

  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  opts.hudLayer.appendChild(host);
  const root = createRoot(host);
  const touch = opts.touch;
  root.render(
    createElement(H.HoopsHud, {
      view,
      // HoopsUi's results card has the rematch / leave flow (and host waits)
      showFinal: false,
      onInput:
        opts.me === null
          ? undefined
          : input => {
              touch.courtX = input.moveX;
              touch.courtZ = input.moveZ;
              touch.shoot = input.shoot;
              touch.pass = input.pass;
              touch.move = input.move;
              touch.sprint = input.sprint;
              touch.call = input.call;
            },
    }),
  );

  let started = false;
  return {
    update(dt, state, events) {
      if (!started) {
        started = true;
        view.startAudio();
      }
      // Always explicit (even empty): the view stops auto-playing state.events
      view.playEvents(events, state.tick);
      view.update(dt, state);
    },
    dispose() {
      root.unmount();
      host.remove();
      view.dispose();
    },
  };
}
