// ── Pipe: the Noun who lives on the mural bench ──────────────────────────
//
// A `head-pipe` Noun (traits looked up by filename, never by index) sat on
// seat 0, chilling: legs out, the inner arm along the backrest, a slow head
// bob, a puff from the pipe now and then, and a line in a bubble when you
// walk up or sit down. Built lazily (a build is a hitch) once you're near,
// posed only when the camera is near, hidden far off.

import type {
  CharacterAssets,
  NounCharacter as NounCharacterT,
} from '../../character/NounCharacter';
import type { Particles } from '../../render/Particles';

import { ImageData } from '@noundry/nouns-assets';
import * as THREE from 'three';

import { type NounSeed } from '../../character/NounAppearance';
import { NounCharacter, turnBone } from '../../character/NounCharacter';
import { poseSit } from '../../interiors/pose';
import { toonify } from '../../render/Toon';

import { BENCH, type BenchSite } from './place';
import { PIPE_SEAT, seatSpot } from './rules';

/** Build within this of the rider (m); pose within this of the camera; hide past HIDE. */
const BUILD_NEAR = 70;
const POSE_NEAR = 45;
const HIDE_FAR = 110;
const HIDE_FAR_LOW = 60;
/** Say hello when the rider comes this close (m), at most once per HELLO_EVERY s. */
const HELLO_NEAR = 6;
const HELLO_EVERY = 45;
/** The bubble's life (s). */
const SAY_FOR = 5.5;

type Kind = 'hello' | 'sit' | 'muse' | 'bye';

export const LINES: Record<Kind, readonly string[]> = {
  hello: [
    'ah. you came for the show too.',
    'best seat on the plaza. pull up.',
    'shh. this one loops.',
    'sit. the gifs are better sitting.',
  ],
  sit: [
    'watch. here it comes...',
    "nice. don't talk during the good bit.",
    'every nine seconds a new one. i count them.',
    'comfy, right? the city can wait.',
  ],
  muse: [
    "i've been here since the plaza was built.",
    'some days it plays the same one twice. those are good days.',
    'pipe? no. i AM the pipe.',
    'the van does a 99 with a flake if you ask nice.',
  ],
  bye: ['later.', 'come back for the next one.', 'keep it smooth.'],
};

/** A line of `kind` (`r` in [0, 1)), never the same as `last`. */
export function pickLine(kind: Kind, r: number, last: string | null): string {
  const list = LINES[kind];
  let i = Math.floor(r * list.length) % list.length;
  if (list[i] === last) i = (i + 1) % list.length;
  return list[i]!;
}

/** The trait index whose art filename is `name` (fallback 0). */
function trait(key: 'bodies' | 'accessories' | 'heads' | 'glasses', name: string): number {
  const list = (ImageData.images as Record<string, { filename: string }[]>)[key] ?? [];
  const i = list.findIndex(t => t.filename === name);
  return i < 0 ? 0 : i;
}

/** Pipe's seed: by filename, so it survives the art set growing. */
export function pipeSeed(): NounSeed {
  return {
    background: 0,
    body: trait('bodies', 'body-teal'),
    accessory: trait('accessories', 'accessory-hoodiestrings-uneven'),
    head: trait('heads', 'head-pipe'),
    glasses: trait('glasses', 'glasses-square-black'),
  };
}

export interface PipeOpts {
  scene: THREE.Scene;
  assets: () => CharacterAssets | null;
  toon: boolean;
  low: boolean;
  labelLayer: HTMLElement;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  particles: Particles;
}

interface RigBones {
  neck: THREE.Object3D | null;
  upperL: THREE.Object3D | null;
  foreL: THREE.Object3D | null;
  shinL: THREE.Object3D | null;
  shinR: THREE.Object3D | null;
  footL: THREE.Object3D | null;
  footR: THREE.Object3D | null;
}

const _side = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const UP = new THREE.Vector3(0, 1, 0);

export class PipeHead {
  ch: NounCharacterT | null = null;
  private bones: RigBones | null = null;
  private t = Math.random() * 10;
  private puffIn = 2;
  private label: HTMLDivElement | null = null;
  private line: string | null = null;
  private lineLeft = 0;
  private helloAt = -Infinity;
  private museIn = 22;
  private near = false;

  constructor(
    private readonly site: BenchSite,
    private readonly o: PipeOpts,
  ) {}

  /** Say something (bubble over his head). */
  say(kind: Kind) {
    this.line = pickLine(kind, Math.random(), this.line);
    this.lineLeft = SAY_FOR;
  }

  /** `seated`: the local rider is sat on the bench with him. */
  update(dt: number, rider: THREE.Vector3, seated: boolean) {
    const s = this.site;
    const dr = Math.hypot(rider.x - s.x, rider.z - s.z);
    if (this.ch === null) {
      if (dr > BUILD_NEAR) return;
      this.build();
      if (this.ch === null) return;
    }
    const ch = this.ch;
    const eye = this.o.camera.position;
    const de = Math.hypot(eye.x - s.x, eye.z - s.z);
    const visible = de < (this.o.low ? HIDE_FAR_LOW : HIDE_FAR);
    if (ch.root.visible !== visible) ch.root.visible = visible;
    this.t += dt;
    // Hello / musings
    const now = this.t;
    const close = dr < HELLO_NEAR;
    if (close && !this.near && now - this.helloAt > HELLO_EVERY && !seated) {
      this.helloAt = now;
      this.say('hello');
    }
    this.near = close;
    if (seated) {
      this.museIn -= dt;
      if (this.museIn <= 0) {
        this.museIn = 24 + Math.random() * 14;
        this.say('muse');
      }
    } else this.museIn = 22;
    this.lineLeft = Math.max(0, this.lineLeft - dt);
    if (!visible || de > POSE_NEAR) {
      this.placeLabel(false);
      return;
    }
    this.pose(dt);
    // A puff from the pipe now and then
    this.puffIn -= dt;
    if (this.puffIn <= 0) {
      this.puffIn = 2.4 + Math.random() * 2.2;
      if (ch.head !== null) {
        _box.setFromObject(ch.head);
        // The bowl: the top of the head, a little forward
        ch.root.getWorldDirection(_fwd);
        _v.set((_box.min.x + _box.max.x) / 2, _box.max.y + 0.04, (_box.min.z + _box.max.z) / 2);
        _v.addScaledVector(_fwd, 0.12);
        this.o.particles.smokeAt(_v, 3);
      }
    }
    this.placeLabel(de < 28);
  }

  private build() {
    const assets = this.o.assets();
    if (assets === null) return;
    const ch = new NounCharacter(pipeSeed(), assets);
    ch.setBoardType('skate');
    ch.board.visible = false;
    if (this.o.toon) toonify(ch.root);
    if (this.o.low) ch.setCastShadows(false);
    ch.root.name = 'BenchPipe';
    this.o.scene.add(ch.root);
    this.ch = ch;
    const find = (n: string) => {
      let hit: THREE.Object3D | null = null;
      ch.body.traverse(x => {
        if (hit === null && x.name.replace(/[.:_]/g, '').toLowerCase() === n) hit = x;
      });
      return hit as THREE.Object3D | null;
    };
    this.bones = {
      neck: find('neck'),
      upperL: find('upperarml'),
      foreL: find('forearml'),
      shinL: find('shinl'),
      shinR: find('shinr'),
      footL: find('footl'),
      footR: find('footr'),
    };
    const label = document.createElement('div');
    label.className = 'w2-nametag';
    label.style.display = 'none';
    label.dataset.bench = 'pipe';
    this.o.labelLayer.appendChild(label);
    this.label = label;
  }

  private pose(dt: number) {
    const ch = this.ch!;
    const s = this.site;
    const at = seatSpot(s, PIPE_SEAT);
    ch.root.position.set(at.x, s.y, at.z);
    ch.root.quaternion.setFromAxisAngle(UP, at.yaw);
    ch.play({ clip: 'idle', fade: 0.3 });
    ch.update(dt, { lean: 0, travelled: 0 });
    poseSit(ch, s.y, s.y + BENCH.seatH, 1);
    const b = this.bones;
    if (b === null) return;
    ch.root.getWorldQuaternion(_q);
    _side.set(1, 0, 0).applyQuaternion(_q);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    // Legs out, ankles relaxed
    for (const sh of [b.shinL, b.shinR]) if (sh !== null) turnBone(sh, _side, -0.95);
    for (const f of [b.footL, b.footR]) if (f !== null) turnBone(f, _side, 0.35);
    // The inner arm (his left, toward the middle of the bench) along the backrest
    if (b.upperL !== null) {
      turnBone(b.upperL, _side, 0.55); // off the lap
      turnBone(b.upperL, _fwd, 1.25); // out sideways
      turnBone(b.upperL, UP, 0.5); // and back, over the rail
    }
    if (b.foreL !== null) turnBone(b.foreL, _fwd, -0.55);
    // A slow nod, a little sway
    if (b.neck !== null) {
      const beat = (this.t * 84) / 60;
      const nod = Math.abs(Math.sin(beat * Math.PI));
      turnBone(b.neck, _side, 0.03 + 0.07 * nod);
      turnBone(b.neck, _fwd, 0.05 * Math.sin(this.t * 0.4));
    }
  }

  private placeLabel(show: boolean) {
    const l = this.label;
    const ch = this.ch;
    if (l === null || ch === null) return;
    const talking = this.lineLeft > 0 && this.line !== null;
    if (!show || !talking) {
      if (l.style.display !== 'none') l.style.display = 'none';
      return;
    }
    _v.set(ch.root.position.x, ch.root.position.y + 2.15, ch.root.position.z).project(
      this.o.camera,
    );
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) {
      if (l.style.display !== 'none') l.style.display = 'none';
      return;
    }
    const w = this.o.canvas.clientWidth;
    const h = this.o.canvas.clientHeight;
    const html = `<div class="w2-said">${escape(this.line!)}</div><span style="font-size:11px">pipe <i style="font-style:normal;font-size:9px;opacity:.65;letter-spacing:.05em">NPC</i></span>`;
    if (l.dataset.html !== html) {
      l.innerHTML = html;
      l.dataset.html = html;
    }
    l.style.transform = `translate(-50%, -100%) translate(${Math.round(((_v.x + 1) / 2) * w)}px, ${Math.round(((1 - _v.y) / 2) * h)}px)`;
    if (l.style.display !== 'block') l.style.display = 'block';
  }

  dispose() {
    this.label?.remove();
    this.label = null;
    if (this.ch !== null) {
      this.ch.root.removeFromParent();
      this.ch.dispose();
      this.ch = null;
    }
  }
}

function escape(s: string): string {
  return s.replace(/["&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
