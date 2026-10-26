// ── Integration points: the sim and the view break mode runs ────────────
//
// createSim → breakdance/sim's createBattleSim, createView → breakdance/view's
// createBattleView, each picked up automatically when its index.ts exists
// (import.meta.glob: a missing file is just an empty match, so this compiles
// and runs before either lands). Until integration the stubs run anyway:
// flip USE_STUBS to false, the one-line swap.
//
// The view is its own chunk (like hoops/view), fetched when someone walks up
// to the cypher (preloadBreakView). A view created before it lands draws the
// stub and hands over on arrival.

import type { CharacterAssets } from '../../character/NounCharacter';
import type { BattleConfig, BattleSimFactory, BattleView, SimEvent, SimState } from '../contract';
import type * as THREE from 'three';

import { StubSim } from './stubSim';
import { StubBattleView } from './stubView';

/** The one-line swap: false once breakdance/sim and breakdance/view are in. */
const USE_STUBS = true;

/** What net/ hands the view (the real createBattleView takes this). */
export interface BreakViewDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer?: THREE.WebGLRenderer;
  /** DOM layer over the canvas for the HUD (pointer-events none; buttons opt in). */
  hudLayer: HTMLElement | null;
  /** Name tags. */
  labelLayer?: HTMLElement;
  assets: CharacterAssets | null;
  toon?: boolean;
  quality?: 'low' | 'medium' | 'high';
  audio: AudioContext | null;
  audioOut?: AudioNode | null;
}

type SimModule = { createBattleSim?: BattleSimFactory };
type ViewModule = { createBattleView?: (deps: BreakViewDeps) => BattleView };

const sims = import.meta.glob<SimModule>('../sim/index.ts', { eager: true });
const views = import.meta.glob<ViewModule>('../view/index.ts');

export const createSim: BattleSimFactory = config => {
  const real = USE_STUBS ? undefined : Object.values(sims)[0]?.createBattleSim;
  return real ? real(config) : new StubSim(config);
};

let viewMod: ViewModule | null = null;
let loading: Promise<ViewModule | null> | null = null;

/** Fetch the view chunk (once); resolves null while the stubs are in use. */
export function preloadBreakView(): Promise<ViewModule | null> {
  const load = Object.values(views)[0];
  if (USE_STUBS || load === undefined) return Promise.resolve(null);
  loading ??= load().then(
    m => (viewMod = m),
    () => null,
  );
  return loading;
}

export function createView(deps: BreakViewDeps): BattleView {
  void preloadBreakView();
  const make = (): BattleView | null => viewMod?.createBattleView?.(deps) ?? null;
  const ready = USE_STUBS ? null : make();
  if (ready !== null) return ready;
  // Not here (yet): the stub stands in, then hands over to the real one
  let cur: BattleView = new StubBattleView(deps);
  let mounted: { config: BattleConfig; at: Parameters<BattleView['mount']>[1] } | null = null;
  let local: string | null = null;
  let gone = false;
  if (!USE_STUBS)
    void preloadBreakView().then(() => {
      const real = gone ? null : make();
      if (real === null) return;
      if (mounted !== null) {
        cur.unmount();
        real.mount(mounted.config, mounted.at);
      }
      real.setLocal(local);
      cur = real;
    });
  return {
    mount(config, at) {
      mounted = { config, at };
      cur.mount(config, at);
    },
    update(dt: number, state: SimState, events: readonly SimEvent[]) {
      cur.update(dt, state, events);
    },
    setLocal(id) {
      local = id;
      cur.setLocal(id);
    },
    unmount() {
      gone = true;
      mounted = null;
      cur.unmount();
    },
  };
}
