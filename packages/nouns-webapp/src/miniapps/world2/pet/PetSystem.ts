// ── CAMP pet, the game side ────────────────────────────────────────────────
//
// Before it's adopted, MOCHI naps on CAMP's fridge (layout.ts `pet`), a
// touch warm so it reads in the dark room; walk up to the fridge for the
// ADOPT prompt (E / tap), which opens the card (PetUi.tsx). Adopted, it's
// saved in this browser (store.ts) and spawns with you every load:
// following by context (follow.ts `chooseMode`) or how you asked (the card).
// Other players see it through the pose blob's `pt` (wire.ts) and place it
// themselves next to the rider they already draw.
//
// Costs: one skinned draw per pet (model.ts), no textures; remote pets
// aren't drawn past PET.drawFar, or when their rider isn't.

import type { NounCharacter } from '../character/NounCharacter';
import type { Game } from '../Game';
import type { RemotePlayer } from '../net/Net';

import * as THREE from 'three';

import { toonify } from '../render/Toon';

import { collisionPetWorld } from './collisionWorld';
import { PET, type FollowPref, type PetMode } from './contract';
import {
  chooseMode,
  newPetBody,
  poofTo,
  stepPet,
  type Owner,
  type PetBody,
  type PetWorld,
} from './follow';
import { applyPose, makePet, MOCHI, type PetRig } from './model';
import { checkPetName, DEFAULT_PET_NAME } from './name';
import { blendPose, poseFor, restPose, type PetPose } from './pose';
import { petSound } from './sound';
import { loadPet, savePet, type SavedPet } from './store';
import { decodePet, encodePet } from './wire';

export interface PetView {
  /** Near the fridge with no pet yet: ADOPT. */
  prompt: boolean;
  card: 'adopt' | 'edit' | null;
  adopted: boolean;
  name: string;
  follow: FollowPref;
  mode: PetMode;
}

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

interface Pet {
  rig: PetRig;
  body: PetBody;
  pose: PetPose;
  /** Happy spin: where in it (0..1) the last frame was. */
  t: number;
  shownPoof: number;
}

/** The top of a rider's head, measured off its head group (refreshed now and then: GLB heads load late). */
class HeadTop {
  private h = 1.3;
  private at = -1;
  private ch: NounCharacter | null = null;
  y(ch: NounCharacter, now: number): number {
    const head = ch.head;
    if (head === null) return ch.root.position.y + 1.75;
    head.getWorldPosition(_v);
    if (ch !== this.ch || now - this.at > 1.5) {
      this.ch = ch;
      this.at = now;
      const box = new THREE.Box3().setFromObject(head);
      if (!box.isEmpty()) this.h = box.max.y - _v.y;
    }
    return _v.y + this.h;
  }
}

export class PetSystem {
  private game: Game;
  private world: PetWorld | null = null;
  private saved: SavedPet | null = loadPet();
  private mine: Pet | null = null;
  private remotes = new Map<string, Pet & { head: HeadTop; lastSeen: number }>();
  private remoteMat: THREE.Material | null = null;
  private myHead = new HeadTop();
  private view_: PetView;
  private listeners = new Set<() => void>();
  private keyBound = false;
  private clock = 0;
  private soundAt = 0;
  private perched = false;
  /** Player.respawns last frame (a spawn / rescue / vehicle exit = a teleport). */
  private respawns = -1;

  constructor(game: Game) {
    this.game = game;
    this.view_ = this.makeView(false, null);
  }

  get view(): PetView {
    return this.view_;
  }

  get adopted(): boolean {
    return this.saved !== null;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private makeView(prompt: boolean, card: PetView['card']): PetView {
    return {
      prompt,
      card,
      adopted: this.saved !== null,
      name: this.saved?.name ?? DEFAULT_PET_NAME,
      follow: this.saved?.follow ?? 'auto',
      mode: this.mine?.body.mode ?? 'perch',
    };
  }

  private setView(prompt: boolean, card: PetView['card']) {
    const v = this.view_;
    const next = this.makeView(prompt, card);
    if (
      v.prompt === next.prompt &&
      v.card === next.card &&
      v.adopted === next.adopted &&
      v.name === next.name &&
      v.follow === next.follow
    )
      return;
    this.view_ = next;
    for (const l of this.listeners) l();
  }

  // ── The card ─────────────────────────────────────────────────────────

  openCard() {
    this.setView(false, this.saved === null ? 'adopt' : 'edit');
    petSound(this.game.sfx, 'squeak', 0.8);
  }

  closeCard() {
    this.setView(this.view_.prompt, null);
  }

  /** Adopt (or rename / change how it follows). Returns why not, or null. */
  commit(rawName: string, follow: FollowPref): 'empty' | 'blocked' | null {
    const nm = checkPetName(rawName);
    if (!nm.ok) return nm.why;
    const first = this.saved === null;
    this.saved = { v: 1, look: 'mochi', name: nm.name, follow, at: this.saved?.at ?? Date.now() };
    savePet(this.saved);
    this.game.net.pet = null; // re-sent next frame with the new name
    if (first && this.mine !== null) {
      // down off the fridge with a puff, straight to your side
      this.perched = false;
      this.setWarmth(0);
      const o = this.owner();
      if (o !== null && this.world !== null) {
        poofTo(this.mine.body, o, this.world);
        this.puff(this.mine);
      }
      petSound(this.game.sfx, 'adopt');
    } else petSound(this.game.sfx, 'happy', 0.7);
    this.setView(false, null);
    return null;
  }

  /** Back to the fridge (the card's small print). */
  release() {
    this.saved = null;
    try {
      localStorage.removeItem('noun-world-pet-v1');
    } catch {
      // storage blocked
    }
    this.game.net.pet = null;
    this.setView(false, null);
  }

  // ── Frame ────────────────────────────────────────────────────────────

  /** Once a frame, every branch of Game.step (minigames too: it sits and watches). */
  frame(dt: number) {
    const g = this.game;
    if (g.me === null || g.showroom) return;
    this.clock += dt;
    if (this.world === null) this.world = collisionPetWorld(g.world);
    if (!this.keyBound) {
      document.addEventListener('keydown', this.onKey, true);
      this.keyBound = true;
    }
    if (this.mine === null) {
      const rig = makePet(MOCHI);
      toonify(rig.mesh);
      rig.mesh.castShadow = true;
      g.gfx.scene.add(rig.mesh);
      this.mine = { rig, body: newPetBody(), pose: restPose(), t: 0, shownPoof: 0 };
      const o = this.owner();
      if (o !== null && this.saved !== null) poofTo(this.mine.body, o, this.world);
      this.mine.body.happy = 0;
      this.perched = this.saved === null;
      if (this.perched) this.setWarmth(0.24);
    }
    const pet = this.mine;
    let prompt = false;
    if (this.saved === null) prompt = this.onFridge(pet, dt);
    else this.follow(pet, dt);
    this.setView(prompt && this.view_.card === null, this.view_.card);
    this.send();
  }

  /** Not adopted yet: napping on the fridge, waking up when you come close. */
  private onFridge(pet: Pet, dt: number): boolean {
    const g = this.game;
    const perch = g.camp.petPerch();
    if (perch === null) {
      pet.rig.mesh.visible = false;
      return false;
    }
    if (!this.perched) {
      this.perched = true;
      this.setWarmth(0.24);
    }
    const p = g.player.pos;
    const near = Math.hypot(p.x - perch.x, p.z - perch.z);
    const inside = g.camp.inside(p.x, p.y, p.z) && !g.camp.view.intro;
    const b = pet.body;
    b.x = perch.x;
    b.y = perch.y;
    b.z = perch.z;
    b.mode = 'perch';
    // awake (sat up, watching you) when you're close; else asleep
    const awake = inside && near < 4.5;
    b.yaw = awake ? Math.atan2(p.x - perch.x, p.z - perch.z) : perch.yaw;
    b.gait = awake ? 'perch' : 'sleep';
    if (awake && this.clock - this.soundAt > 5 + Math.random() * 4) {
      this.soundAt = this.clock;
      petSound(g.sfx, 'squeak', 0.5);
    }
    if (!awake && inside && near < 7 && this.clock - this.soundAt > 6) {
      this.soundAt = this.clock;
      petSound(g.sfx, 'snore', 0.5);
    }
    this.draw(pet, dt, true);
    return inside && near < PET.adoptReach && !g.paused && !g.pool.active;
  }

  /** The rider this frame, or null (no character yet). */
  private owner(): Owner | null {
    const g = this.game;
    const me = g.me;
    if (me === null) return null;
    const p = g.player;
    let fx: number;
    let fz: number;
    if (p.mode === 'foot') {
      fx = Math.sin(p.footYaw);
      fz = Math.cos(p.footYaw);
    } else {
      _f.set(p.fwd.x, 0, p.fwd.z);
      if (_f.lengthSq() < 1e-6) _f.set(0, 0, 1);
      _f.normalize();
      fx = _f.x;
      fz = _f.z;
    }
    return {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z,
      fx,
      fz,
      speed: p.speed,
      grounded: p.mode === 'foot' ? p.footGrounded : p.state !== 'air',
      onBoard: p.mode === 'board',
      headTop: this.myHead.y(me, this.clock),
    };
  }

  private follow(pet: Pet, dt: number) {
    const g = this.game;
    if (this.perched) {
      this.perched = false;
      this.setWarmth(0);
    }
    const o = this.owner();
    if (o === null || this.world === null) return;
    const vehicle = g.cars.inCar || g.van2.driving || g.dragon.riding;
    const ctx = {
      vehicle,
      busy:
        g.hoops.active ||
        g.breaks.active ||
        g.pool.active ||
        g.freestyle.active ||
        g.mural.active ||
        g.hideseek.inGame ||
        g.bench.seated ||
        g.parkour.course.active,
      away:
        g.missions.ud.active ||
        (g.player.sky?.active ?? false) ||
        g.cutscene.active ||
        g.replay.active ||
        g.camp.view.intro,
      parkour: g.parkour.motor.busy,
    };
    let mode = chooseMode(ctx, this.saved?.follow ?? 'auto', o);
    // A respawn / rescue / vehicle exit: a teleport (the jump check covers the rest)
    const spawns = g.player.respawns;
    const teleported = this.respawns >= 0 && spawns !== this.respawns;
    this.respawns = spawns;
    const b = pet.body;
    if (teleported && mode !== 'away' && mode !== 'ride') b.mode = 'away';
    if (mode === 'ride') {
      this.ride(pet, o);
      b.mode = 'ride';
      b.gait = 'ride';
    } else {
      const before = b.mode;
      const ev = stepPet(b, o, mode, this.world, dt);
      if (ev === 'poof') this.puff(pet);
      if (ev === 'poof' || ev === 'happy')
        petSound(g.sfx, before === 'away' ? 'poof' : 'happy', 0.8);
      else if (ev === 'hop') petSound(g.sfx, 'hop', 0.5);
      else if (ev === 'sleep') petSound(g.sfx, 'snore', 0.5);
      if (b.gait === 'sleep' && this.clock - this.soundAt > 4) {
        this.soundAt = this.clock;
        petSound(g.sfx, 'snore', 0.35);
      }
      mode = b.mode;
    }
    pet.rig.mesh.visible = mode !== 'away';
    this.draw(pet, dt, false);
  }

  /** In a car or on the dragon: on your head; in the van: up on its roof. */
  private ride(pet: Pet, o: Owner) {
    const g = this.game;
    const b = pet.body;
    if (g.van2.driving) {
      const h = g.van2.heading;
      b.x = o.x - Math.sin(h) * 0.6;
      b.z = o.z - Math.cos(h) * 0.6;
      b.y = o.y + g.van2.roofHeight;
      b.yaw = h;
    } else {
      b.x = o.x;
      b.z = o.z;
      if (g.me !== null && g.me.head !== null) {
        g.me.head.getWorldPosition(_v);
        b.x = _v.x;
        b.z = _v.z;
      }
      b.y = o.headTop;
      b.yaw = Math.atan2(o.fx, o.fz);
    }
  }

  /** Pose and place a pet's mesh. */
  private draw(pet: Pet, dt: number, local: boolean) {
    const b = pet.body;
    const r = pet.rig;
    const happyK = b.gait === 'happy' ? 1 - b.happy / PET.happyFor : 0;
    const target = poseFor(b.gait, b.gait === 'happy' ? happyK : b.phase, this.clock, r.hip);
    blendPose(pet.pose, target, 1 - Math.exp(-14 * dt));
    applyPose(r, pet.pose);
    r.mesh.position.set(b.x, b.y, b.z);
    r.mesh.rotation.set(0, b.yaw, 0);
    void local;
  }

  private puff(pet: Pet) {
    const b = pet.body;
    _v.set(b.x, b.y + 0.25, b.z);
    this.game.particles.smokeAt(_v, 6);
    this.game.particles.dustAt(_v, 0.35, new THREE.Color(0xff82ad));
  }

  /** The perch glow: a little emissive so it reads in the dark sunset room. */
  private setWarmth(k: number) {
    const m = this.mine?.rig.mesh.material as THREE.MeshToonMaterial | undefined;
    if (m === undefined || m.emissive === undefined) return;
    m.emissive.setHex(0xffc4d4);
    m.emissiveIntensity = k;
  }

  // ── Net ──────────────────────────────────────────────────────────────

  private send() {
    const net = this.game.net;
    if (this.saved === null || this.mine === null) {
      net.pet = null;
      return;
    }
    const w = encodePet(this.saved.look, this.mine.body.mode, this.saved.name);
    const cur = net.pet;
    if (cur === null || cur[0] !== w[0] || cur[1] !== w[1] || cur[2] !== w[2]) net.pet = w;
  }

  /**
   * A remote rider's pet (Game.updateNetwork, after their Noun is posed):
   * placed here from their rider, no positions on the wire.
   */
  remote(id: string, rp: RemotePlayer, ch: NounCharacter, hidden: boolean, dt: number) {
    const info = decodePet(rp.pet);
    let pet = this.remotes.get(id);
    if (info === null || info.mode === 'perch') {
      if (pet !== undefined) this.dropRemote(id);
      return;
    }
    const g = this.game;
    if (this.world === null) this.world = collisionPetWorld(g.world);
    const c = rp.current;
    // far ones aren't drawn (nor stepped)
    const far = c.pos.distanceTo(g.gfx.camera.position) > PET.drawFar;
    if (pet === undefined) {
      if (far || hidden) return;
      if (this.remoteMat === null) {
        this.remoteMat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 1,
          metalness: 0,
        });
      }
      const rig = makePet(MOCHI, this.remoteMat);
      toonify(rig.mesh);
      rig.mesh.castShadow = false;
      g.gfx.scene.add(rig.mesh);
      pet = {
        rig,
        body: newPetBody(c.pos.x, c.pos.y, c.pos.z),
        pose: restPose(),
        t: 0,
        shownPoof: 0,
        head: new HeadTop(),
        lastSeen: 0,
      };
      this.remotes.set(id, pet);
    }
    pet.lastSeen = this.clock;
    const visible = !hidden && !far && info.mode !== 'away';
    pet.rig.mesh.visible = visible;
    if (!visible) {
      pet.body.mode = 'away';
      return;
    }
    _f.set(0, 0, 1).applyQuaternion(c.quat);
    _f.y = 0;
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, 1);
    _f.normalize();
    const o: Owner = {
      x: c.pos.x,
      y: c.pos.y,
      z: c.pos.z,
      fx: _f.x,
      fz: _f.z,
      speed: c.speed,
      grounded: !/air|jump|fall|ollie|flip|grab/.test(c.anim),
      onBoard: c.mode === 'board',
      headTop: pet.head.y(ch, this.clock),
    };
    const b = pet.body;
    if (info.mode === 'ride') {
      b.x = o.x;
      b.z = o.z;
      b.y = c.vehicle === 'van' ? o.y + g.van2.roofHeight : o.headTop;
      b.yaw = Math.atan2(o.fx, o.fz);
      b.gait = 'ride';
      b.mode = 'ride';
    } else if (stepPet(b, o, info.mode, this.world, dt) === 'poof') this.puff(pet);
    this.draw(pet, dt, false);
  }

  dropRemote(id: string) {
    const pet = this.remotes.get(id);
    if (pet === undefined) return;
    pet.rig.mesh.removeFromParent();
    this.remotes.delete(id);
  }

  /** How many remote pets are drawn (perf overlay / tests). */
  get drawnRemotes(): number {
    let n = 0;
    for (const p of this.remotes.values()) if (p.rig.mesh.visible) n++;
    return n;
  }

  /** Dev / tests: the local pet's body. */
  get body(): PetBody | null {
    return this.mine?.body ?? null;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && this.view_.card !== null) {
      this.closeCard();
      return;
    }
    if (e.code !== 'KeyE' || !this.view_.prompt) return;
    const el = e.target as HTMLElement | null;
    if (el !== null && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
      return;
    if (this.game.paused) return;
    // ours, not the board toggle's
    e.stopImmediatePropagation();
    e.preventDefault();
    this.openCard();
  };

  dispose() {
    if (this.keyBound) document.removeEventListener('keydown', this.onKey, true);
    this.keyBound = false;
    this.mine?.rig.mesh.removeFromParent();
    this.mine = null;
    for (const id of [...this.remotes.keys()]) this.dropRemote(id);
    this.remoteMat?.dispose();
  }
}
