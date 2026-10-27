// ── 3D Grand Exchange: real people on the floor (your rider + other players) ─
//
// Full world2 NounCharacters (the same Noun, build and clips as in Noun
// World), one per real person: you, and every other player in the Exchange
// room (net/). They aren't part of the crowd LOD: there are only ever a
// handful, and a person should never turn into an impostor.

import type { NounSeed } from '../../world2/character/NounAppearance';
import type { PeerAnim } from '../net/wire';

import * as THREE from 'three';

import { parseSeedKey, seedKey } from '../../world2/character/NounAppearance';
import {
  loadCharacterAssets,
  NounCharacter,
  type CharacterAssets,
} from '../../world2/character/NounCharacter';
import { toonify } from '../../world2/render/Toon';

export interface WalkerLook {
  seed: NounSeed;
  weight: number;
  /** Outfit wire key (world2/character/outfit.ts); '' = the Noun's default. */
  outfit: string;
}

/** One person's character: build once, then pose it every frame. */
export class WalkerRig {
  ch: NounCharacter | null = null;
  private act: PeerAnim | '' = '';
  private key = '';

  constructor(
    private readonly group: THREE.Group,
    public assets: CharacterAssets | null,
  ) {}

  /** (Re)build for this look; cheap when unchanged. */
  setLook(look: WalkerLook) {
    if (this.assets === null) return;
    const key = `${seedKey(look.seed)}|${look.weight.toFixed(2)}`;
    if (key === this.key && this.ch !== null) {
      this.ch.setOutfitWire(look.outfit); // cheap when unchanged
      return;
    }
    this.key = key;
    this.drop();
    const ch = new NounCharacter(look.seed, this.assets);
    ch.setBoardType('skate');
    ch.board.visible = false;
    ch.setWeight(look.weight);
    ch.setOutfitWire(look.outfit);
    toonify(ch.root);
    ch.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    this.group.add(ch.root);
    this.ch = ch;
    this.act = '';
  }

  pose(x: number, y: number, z: number, yaw: number, anim: PeerAnim, speed: number, dt: number) {
    const ch = this.ch;
    if (ch === null) return;
    ch.root.visible = true;
    ch.root.position.set(x, y, z);
    ch.root.rotation.set(0, yaw, 0);
    if (anim !== this.act) {
      ch.play({ clip: anim, fade: 0.2 });
      this.act = anim;
    }
    if (anim !== 'idle')
      ch.play({ clip: anim, timeScale: Math.max(0.6, speed / (anim === 'run' ? 4.5 : 1.6)) });
    ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
  }

  hide() {
    if (this.ch !== null) this.ch.root.visible = false;
  }

  private drop() {
    if (this.ch === null) return;
    this.group.remove(this.ch.root);
    this.ch.dispose();
    this.ch = null;
  }

  dispose() {
    this.drop();
  }
}

/** Your rider and the other players' characters, sharing one group. */
export class Walkers {
  readonly group = new THREE.Group();
  private assets: CharacterAssets | null = null;
  readonly me: WalkerRig;
  private peers = new Map<string, WalkerRig>();
  private pending: WalkerLook | null = null;

  constructor() {
    this.group.name = 'gx3d-walkers';
    this.me = new WalkerRig(this.group, null);
    loadCharacterAssets()
      .then(a => {
        if (a.gltf === null) return;
        this.assets = a;
        // Build my rig now the GLB is here
        this.me.assets = a;
        if (this.pending !== null) this.me.setLook(this.pending);
      })
      .catch(() => undefined);
  }

  get ready() {
    return this.assets !== null;
  }

  setMyLook(look: WalkerLook) {
    this.pending = look;
    this.me.setLook(look);
  }

  /** A peer's rig (built on first use, once the GLB is in). */
  peer(id: string, seedKeyStr: string, weight: number, outfit: string): WalkerRig | null {
    if (this.assets === null) return null;
    let r = this.peers.get(id);
    if (r === undefined) {
      r = new WalkerRig(this.group, this.assets);
      this.peers.set(id, r);
    }
    r.setLook({
      seed: parseSeedKey(seedKeyStr) ?? {
        background: 0,
        body: 0,
        accessory: 0,
        head: 0,
        glasses: 0,
      },
      weight,
      outfit,
    });
    return r;
  }

  /** Drop the rigs of peers not in `keep`. */
  prune(keep: ReadonlySet<string>) {
    for (const [id, r] of this.peers)
      if (!keep.has(id)) {
        r.dispose();
        this.peers.delete(id);
      }
  }

  dispose() {
    this.me.dispose();
    for (const r of this.peers.values()) r.dispose();
    this.peers.clear();
  }
}
