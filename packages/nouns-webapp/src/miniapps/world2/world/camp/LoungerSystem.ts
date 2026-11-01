// ── CAMP's loungers at runtime: build, pose, talk (loungers.ts is the plan) ──
//
// Two real Nouns, built lazily (one a frame: a head build is a hitch) once
// you're near CAMP, posed every frame from loungers.ts on top of the idle
// clip, and hidden again when you're far. Walk up and they say a line.

import type { CampLayout } from './layout';
import type { CampSite } from './site';
import type { Game } from '../../Game';

import { ImageData } from '@noundry/nouns-assets';
import * as THREE from 'three';

import { NounCharacter, turnBone } from '../../character/NounCharacter';
import { poseSit } from '../../interiors/pose';
import { toonify } from '../../render/Toon';

import {
  boredPose,
  coinPose,
  LOUNGERS,
  loungerSpots,
  TALK_R,
  type LoungerDef,
  type LoungerSpot,
} from './loungers';
import { toWorld } from './site';

const Y = new THREE.Vector3(0, 1, 0);
const _ax = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

type Bones = Record<
  | 'head'
  | 'spine'
  | 'upperarmL'
  | 'upperarmR'
  | 'forearmL'
  | 'forearmR'
  | 'handL'
  | 'shinL'
  | 'shinR',
  THREE.Object3D | null
>;

interface Lounger {
  def: LoungerDef;
  spot: LoungerSpot;
  ch: NounCharacter | null;
  bones: Bones | null;
  /** The note in flight / the wad in hand (coin head only). */
  wad: THREE.Mesh | null;
  note: THREE.Mesh | null;
  /** Their own clock offset, so the two don't move in step. */
  t0: number;
  /** Talked this visit (resets when you walk away). */
  said: boolean;
}

const idx = (list: { filename: string }[], name: string) =>
  Math.max(
    0,
    list.findIndex(x => x.filename === name),
  );

function seedOf(d: LoungerDef) {
  const im = ImageData.images as Record<string, { filename: string }[]>;
  return {
    background: 0,
    body: idx(im.bodies!, d.body),
    accessory: idx(im.accessories!, d.accessory),
    head: idx(im.heads!, d.head),
    glasses: idx(im.glasses!, d.glasses),
  };
}

function findBones(ch: NounCharacter): Bones {
  const want: Record<string, keyof Bones> = {
    head: 'head',
    spine: 'spine',
    upperarml: 'upperarmL',
    upperarmr: 'upperarmR',
    forearml: 'forearmL',
    forearmr: 'forearmR',
    handl: 'handL',
    shinl: 'shinL',
    shinr: 'shinR',
  };
  const b = {} as Bones;
  for (const k of Object.values(want)) b[k] = null;
  ch.body.traverse(o => {
    const k = want[o.name.replace(/[.:_]/g, '').toLowerCase()];
    if (k !== undefined && b[k] === null) b[k] = o;
  });
  return b;
}

export class Loungers {
  private list: Lounger[];
  private shown = false;

  constructor(
    private readonly game: Game,
    private readonly site: CampSite,
    layout: CampLayout,
  ) {
    const spots = loungerSpots(layout);
    this.list = LOUNGERS.flatMap((def, i) => {
      const spot = spots.find(s => s.id === def.id);
      return spot === undefined
        ? []
        : [{ def, spot, ch: null, bones: null, wad: null, note: null, t0: i * 3.7, said: false }];
    });
  }

  /** Every frame CAMP is near (`near`): build one a frame, pose, talk. Far: hide. */
  update(dt: number, t: number, near: boolean, inside: boolean) {
    const g = this.game;
    if (!near) {
      if (this.shown) for (const l of this.list) if (l.ch !== null) l.ch.root.visible = false;
      this.shown = false;
      return;
    }
    this.shown = true;
    let built = false;
    const p = g.player.pos;
    for (const l of this.list) {
      if (l.ch === null) {
        if (built || g.assets === null) continue;
        this.build(l);
        built = true;
        continue;
      }
      l.ch.root.visible = true;
      this.pose(l, dt, t + l.t0);
      // A line as you walk up, once a visit
      const [hx, , hz] = toWorld(this.site, l.spot.x, 0, l.spot.z);
      const d = Math.hypot(p.x - hx, p.z - hz);
      if (inside && d < TALK_R && !l.said) {
        l.said = true;
        const line = l.def.lines[Math.floor(Math.random() * l.def.lines.length)]!;
        g.hud = {
          ...g.hud,
          toast: { text: `${l.def.name}: ${line}`, tag: 'camp', at: performance.now() },
        };
      } else if (d > TALK_R * 2.5) l.said = false;
    }
  }

  private build(l: Lounger) {
    const g = this.game;
    const ch = new NounCharacter(seedOf(l.def), g.assets!);
    ch.setBoardType('skate');
    ch.board.visible = false;
    if (g.gfx.toon) toonify(ch.root);
    if (g.gfx.quality === 'low') ch.setCastShadows(false);
    g.gfx.scene.add(ch.root);
    l.ch = ch;
    l.bones = findBones(ch);
    if (l.def.id === 'coin' && l.bones.handL !== null) {
      // The wad in the left hand, a note flicked off it into the right
      const mat = new THREE.MeshLambertMaterial({ color: 0x7fb069 });
      const wad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.08), mat);
      const note = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.004, 0.07), mat);
      if (g.gfx.toon) {
        toonify(wad);
        toonify(note);
      }
      g.gfx.scene.add(wad, note);
      l.wad = wad;
      l.note = note;
    }
  }

  private pose(l: Lounger, dt: number, t: number) {
    const ch = l.ch!;
    const b = l.bones!;
    const s = this.site;
    const [x, y0, z] = toWorld(s, l.spot.x, 0, l.spot.z);
    ch.root.position.set(x, y0, z);
    ch.root.quaternion.setFromAxisAngle(Y, l.spot.yaw);
    ch.play({ clip: 'idle', fade: 0.3 });
    ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
    poseSit(ch, y0, y0 + l.spot.seatY, 1);
    // The character's own side axis (its +X), for nods and arm swings
    ch.root.getWorldQuaternion(_q);
    const side = _ax.set(1, 0, 0).applyQuaternion(_q);
    if (l.def.id === 'coin') {
      const c = coinPose(t);
      if (b.head !== null) turnBone(b.head, side, c.headDown);
      if (b.upperarmL !== null) turnBone(b.upperarmL, side, c.holdUpper);
      if (b.forearmL !== null) turnBone(b.forearmL, side, c.holdFore);
      if (b.upperarmR !== null) turnBone(b.upperarmR, side, c.flickUpper);
      if (b.forearmR !== null) turnBone(b.forearmR, side, c.flickFore);
      if (b.handL !== null && l.wad !== null && l.note !== null) {
        b.handL.getWorldPosition(_v);
        l.wad.position.copy(_v);
        l.wad.quaternion.copy(_q);
        l.note.visible = c.note !== null;
        if (c.note !== null) {
          // Off the top of the wad toward the right side, a little arc
          const k = c.note;
          l.note.position.copy(_v).addScaledVector(side, 0.3 * k);
          l.note.position.y += 0.05 + 0.08 * Math.sin(k * Math.PI);
          l.note.quaternion.copy(_q);
        }
      }
    } else {
      const m = boredPose(t);
      if (b.shinL !== null) turnBone(b.shinL, side, m.shinL);
      if (b.shinR !== null) turnBone(b.shinR, side, m.shinR);
      if (b.spine !== null) turnBone(b.spine, side, m.slump);
      if (b.head !== null) {
        turnBone(b.head, Y, m.headYaw);
        turnBone(b.head, side, m.headDown);
      }
      // Hands flat on the counter beside them, shoulders up on a sigh
      if (b.upperarmL !== null) turnBone(b.upperarmL, side, -0.2 - m.shrug);
      if (b.upperarmR !== null) turnBone(b.upperarmR, side, -0.2 - m.shrug);
    }
  }

  dispose() {
    const g = this.game;
    for (const l of this.list) {
      if (l.ch !== null) g.gfx.scene.remove(l.ch.root);
      if (l.wad !== null) g.gfx.scene.remove(l.wad);
      if (l.note !== null) g.gfx.scene.remove(l.note);
    }
  }
}
