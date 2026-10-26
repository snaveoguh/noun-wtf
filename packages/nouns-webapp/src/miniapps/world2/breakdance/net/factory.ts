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
import type { Game } from '../../Game';
import type { BattleConfig, BattleSimFactory, BattleView, SimEvent, SimState } from '../contract';
import type { BreakHudStore } from '../view/hudStore';
import type * as THREE from 'three';

import { StubSim } from './stubSim';
import { StubBattleView } from './stubView';

/** The one-line swap: false once breakdance/sim and breakdance/view are in. */
const USE_STUBS = false;

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
type ViewModule = {
  createBattleView?: (game: Game) => BattleView;
  hudOf?: (v: BattleView) => BreakHudStore | null;
};

/** The view as net/ holds it: a BattleView, plus the real view's HUD store and audio unlock. */
export interface NetBattleView extends BattleView {
  /** The real view's HUD store (null while the stub stands in). */
  hud(): BreakHudStore | null;
  /** Unlock / start the battle audio (call from a user gesture). */
  startAudio(): void;
}

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

export function createView(deps: BreakViewDeps, game: Game): NetBattleView {
  void preloadBreakView();
  const make = (): BattleView | null => viewMod?.createBattleView?.(game) ?? null;
  // The real view if it's here; otherwise the stub stands in, then hands over to it
  let cur: BattleView = (USE_STUBS ? null : make()) ?? new StubBattleView(deps);
  let mounted: { config: BattleConfig; at: Parameters<BattleView['mount']>[1] } | null = null;
  let local: string | null = null;
  let gone = false;
  if (!USE_STUBS && cur instanceof StubBattleView)
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
    hud: () => viewMod?.hudOf?.(cur) ?? null,
    startAudio() {
      (cur as BattleView & { startAudio?: () => void }).startAudio?.();
    },
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
