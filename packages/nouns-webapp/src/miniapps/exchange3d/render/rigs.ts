// ── 3D Grand Exchange: full rigged Nouns near the camera ────────────────
//
// world2's NounCharacter (skinned body, 3D head, the walk / wave / dance /
// celebrate clips), only for the traders lod.pickRigs chose. Characters are
// kept per trader (cache up to `keep`), so a trader stepping in and out of
// range doesn't rebuild every time; building is limited per frame because
// it's the expensive bit.

import type { Trader } from '../sim/crowd';

import * as THREE from 'three';

import { seedKey } from '../../world2/character/NounAppearance';
import {
  loadCharacterAssets,
  NounCharacter,
  type CharacterAssets,
} from '../../world2/character/NounCharacter';
import { toonify } from '../../world2/render/Toon';

export type RigAct = 'idle' | 'walk' | 'run' | 'wave' | 'celebrate' | 'dance';

interface Rig {
  ch: NounCharacter;
  key: string;
  act: RigAct | '';
  used: number;
}

export class RigPool {
  readonly group = new THREE.Group();
  private assets: CharacterAssets | null = null;
  private rigs = new Map<number, Rig>();
  private frame = 0;
  failed = false;

  constructor(private readonly keep: number) {
    this.group.name = 'gx3d-rigs';
    NounCharacter.castShadows = false;
    loadCharacterAssets()
      .then(a => {
        if (a.gltf === null) this.failed = true;
        else this.assets = a;
      })
      .catch(() => (this.failed = true));
  }

  get ready() {
    return this.assets !== null;
  }

  get count() {
    let n = 0;
    for (const r of this.rigs.values()) if (r.ch.root.visible) n++;
    return n;
  }

  /** Has trader i a visible rig this frame? */
  has(i: number) {
    const r = this.rigs.get(i);
    return r !== undefined && r.ch.root.visible;
  }

  /**
   * Show rigs for `want` (trader indices), build at most `budget` new ones,
   * pose them from the traders. Returns the set actually rigged (traders
   * still waiting for a build stay instanced).
   */
  sync(
    want: ReadonlySet<number>,
    traders: readonly Trader[],
    act: (t: Trader) => { act: RigAct; speed: number },
    dt: number,
    budget: number,
  ): Set<number> {
    this.frame++;
    const shown = new Set<number>();
    for (const [i, r] of this.rigs) if (!want.has(i)) r.ch.root.visible = false;
    if (this.assets === null) return shown;
    let built = 0;
    for (const i of want) {
      const t = traders[i];
      if (t === undefined) continue;
      const key = seedKey(t.seed);
      let r = this.rigs.get(i);
      if (r !== undefined && r.key !== key) {
        this.drop(i);
        r = undefined;
      }
      if (r === undefined) {
        if (built >= budget) continue;
        built++;
        r = this.build(t, key);
        this.rigs.set(i, r);
      }
      r.used = this.frame;
      const ch = r.ch;
      ch.root.visible = true;
      ch.root.position.set(t.x, t.y, t.z);
      ch.root.rotation.set(0, t.heading, 0);
      const a = act(t);
      if (a.act !== r.act) {
        ch.play({
          clip: a.act,
          fade: 0.2,
          once: a.act === 'wave' || a.act === 'celebrate',
        });
        r.act = a.act;
      }
      if (a.act === 'walk' || a.act === 'run')
        ch.play({ clip: a.act, timeScale: Math.max(0.6, a.speed / 1.3) });
      ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
      shown.add(i);
    }
    this.evict();
    return shown;
  }

  private build(t: Trader, key: string): Rig {
    const ch = new NounCharacter(t.seed, this.assets!);
    ch.setBoardType('skate');
    ch.board.visible = false;
    toonify(ch.root);
    ch.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    this.group.add(ch.root);
    return { ch, key, act: '', used: this.frame };
  }

  private drop(i: number) {
    const r = this.rigs.get(i);
    if (r === undefined) return;
    this.rigs.delete(i);
    this.group.remove(r.ch.root);
    r.ch.dispose();
  }

  /** Keep at most `keep` built rigs: drop the longest unused. */
  private evict() {
    if (this.rigs.size <= this.keep) return;
    const old = [...this.rigs.entries()]
      .filter(([, r]) => !r.ch.root.visible)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [i] of old) {
      if (this.rigs.size <= this.keep) break;
      this.drop(i);
    }
  }

  dispose() {
    for (const i of [...this.rigs.keys()]) this.drop(i);
  }
}
