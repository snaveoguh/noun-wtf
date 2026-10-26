// ── StubView: capsules in a circle + a DOM beat track, until breakdance/view ─
//
// Implements the contract's BattleView so BreakMode can run a battle end to
// end before the real view lands: a capsule per dancer on the edge of the
// cypher (crew colours), the dancer up in the middle bouncing on the beat
// and spinning through their move, a grade flash, a camera on the circle,
// a tick on every beat, and a small HUD (crews' totals, whose turn, the next
// prompts sliding in on a beat track). factory.ts swaps the real view in.

import type { BreakViewDeps } from './factory';
import type { BattleConfig, BattleView, BreakKey, HitGrade, SimEvent, SimState } from '../contract';

import * as THREE from 'three';

import { ringSlot, type CypherSpot } from './cypher';

const CREW_C = [0xd22209, 0x2a6bff];
const GRADE_C: Record<HitGrade, string> = {
  perfect: '#ffd400',
  great: '#3ddc84',
  ok: '#9ad',
  miss: '#ff4d3d',
};
export const ARROW: Record<BreakKey, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  a: 'A',
  b: 'B',
};

export class StubBattleView implements BattleView {
  private group = new THREE.Group();
  private bodies = new Map<
    string,
    { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; home: THREE.Vector3; yaw: number }
  >();
  private centre = new THREE.Vector3();
  private spot: CypherSpot | null = null;
  private config: BattleConfig | null = null;
  private local: string | null = null;
  private hud: HTMLDivElement | null = null;
  private els: Record<'top' | 'turn' | 'track' | 'flash', HTMLDivElement> | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private first = true;
  private flash = { text: '', color: '', until: 0 };
  private bounce = 0;
  private v = new THREE.Vector3();

  constructor(private deps: BreakViewDeps) {}

  mount(config: BattleConfig, at: { x: number; y: number; z: number; yaw: number }) {
    this.config = config;
    this.spot = at;
    this.centre.set(at.x, at.y, at.z);
    const cap = new THREE.CapsuleGeometry(0.3, 1.0, 4, 10);
    const idx: [number, number] = [0, 0];
    for (const d of config.dancers) {
      const mat = new THREE.MeshStandardMaterial({ color: CREW_C[d.crew], roughness: 0.6 });
      const mesh = new THREE.Mesh(cap, mat);
      const s = ringSlot(at, d.crew, idx[d.crew]++, config.crewSize);
      const home = new THREE.Vector3(s.x, at.y + 0.8, s.z);
      mesh.position.copy(home);
      mesh.name = `break-stub:${d.id}`;
      this.group.add(mesh);
      this.bodies.set(d.id, { mesh, mat, home, yaw: s.yaw });
    }
    this.deps.scene.add(this.group);
    const layer = this.deps.hudLayer;
    if (layer) {
      const hud = document.createElement('div');
      hud.className = 'bk-stubhud';
      hud.innerHTML =
        '<div data-k="top"></div><div data-k="turn"></div><div data-k="flash"></div><div data-k="track"></div>';
      const style = document.createElement('style');
      style.textContent = STUB_CSS;
      hud.appendChild(style);
      layer.appendChild(hud);
      const q = (k: string) => hud.querySelector(`[data-k="${k}"]`) as HTMLDivElement;
      this.hud = hud;
      this.els = { top: q('top'), turn: q('turn'), track: q('track'), flash: q('flash') };
    }
  }

  setLocal(id: string | null) {
    this.local = id;
  }

  update(dt: number, s: SimState, events: readonly SimEvent[]) {
    const cfg = this.config;
    if (cfg === null || this.spot === null) return;
    for (const e of events) {
      if (e.e === 'beat') {
        this.bounce = 1;
        this.tick(e.downbeat);
      } else if (e.e === 'hit' && e.id === s.turn?.id) {
        this.flash = { text: e.grade.toUpperCase(), color: GRADE_C[e.grade], until: s.t + 0.45 };
        const b = this.bodies.get(e.id);
        b?.mat.emissive.set(GRADE_C[e.grade]);
      } else if (e.e === 'move')
        this.flash = {
          text: e.move.replace(/_/g, ' ').toUpperCase(),
          color: '#fff',
          until: s.t + 0.8,
        };
    }
    this.bounce = Math.max(0, this.bounce - dt * 4);
    for (const p of s.poses) {
      const b = this.bodies.get(p.id);
      if (!b) continue;
      b.mat.emissive.multiplyScalar(Math.max(0, 1 - dt * 5));
      if (p.centre) {
        b.mesh.position.lerp(
          this.v.copy(this.centre).setY(this.centre.y + 0.8 + this.bounce * 0.35),
          Math.min(1, dt * 8),
        );
        b.mesh.rotation.set(
          p.crashed === true ? 1.2 : 0,
          p.moveT * Math.PI * 2,
          p.move?.includes('freeze') === true ? Math.PI / 2 : 0,
        );
      } else {
        b.mesh.position.lerp(
          this.v.copy(b.home).setY(b.home.y + this.bounce * 0.08),
          Math.min(1, dt * 8),
        );
        b.mesh.rotation.set(0, b.yaw, 0);
      }
    }
    this.camera(dt);
    this.drawHud(s, cfg);
  }

  private camera(dt: number) {
    const cam = this.deps.camera;
    const sp = this.spot!;
    const mine = this.local !== null ? this.bodies.get(this.local) : undefined;
    const from = mine
      ? mine.home
      : this.v.set(sp.x - Math.sin(sp.yaw) * 6, 0, sp.z - Math.cos(sp.yaw) * 6);
    const dx = from.x - sp.x;
    const dz = from.z - sp.z;
    const len = Math.hypot(dx, dz) || 1;
    const want = new THREE.Vector3(sp.x + (dx / len) * 8.5, sp.y + 4.2, sp.z + (dz / len) * 8.5);
    const look = new THREE.Vector3(sp.x, sp.y + 0.9, sp.z);
    if (this.first) {
      this.camPos.copy(want);
      this.camLook.copy(look);
      this.first = false;
    }
    const k = Math.min(1, dt * 3);
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  private tick(down: boolean) {
    const ctx = this.deps.audio;
    if (!ctx || ctx.state !== 'running') return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = down ? 880 : 660;
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
    o.connect(g).connect(this.deps.audioOut ?? ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.07);
  }

  private drawHud(s: SimState, cfg: BattleConfig) {
    const el = this.els;
    if (el === null) return;
    const up = cfg.dancers.find(d => d.id === s.turn?.id);
    el.top.innerHTML = `<b style="color:#ff6a55">${s.totals[0]}</b> <span>ROUND ${s.round + 1}/${cfg.rounds} · ${s.phase.toUpperCase()}</span> <b style="color:#6c9bff">${s.totals[1]}</b>`;
    const mine = up !== undefined && up.id === this.local;
    el.turn.textContent =
      s.phase === 'done'
        ? ''
        : up === undefined
          ? 'GET READY'
          : mine
            ? `YOUR TURN · ${Math.round(s.turnScore)} · x${s.combo}`
            : `${up.name.toUpperCase()} · ${Math.round(s.turnScore)} · x${s.combo}`;
    el.turn.style.color = mine ? '#ffd400' : '#fff';
    el.flash.textContent = s.t < this.flash.until ? this.flash.text : '';
    el.flash.style.color = this.flash.color;
    // The beat track: the next prompts slide in from the right onto the line
    const html: string[] = ['<i class="bk-line"></i>'];
    for (const p of s.prompts) {
      const d = p.beat - s.beat;
      if (d < -0.5 || d > 4) continue;
      html.push(
        `<span class="bk-key${mine ? ' bk-mine' : ''}" style="left:${12 + d * 22}%">${ARROW[p.key]}</span>`,
      );
    }
    el.track.innerHTML = html.join('');
  }

  unmount() {
    this.group.removeFromParent();
    for (const b of this.bodies.values()) b.mat.dispose();
    this.bodies.clear();
    (this.group.children[0] as THREE.Mesh | undefined)?.geometry.dispose();
    this.group.clear();
    this.hud?.remove();
    this.hud = null;
    this.els = null;
    this.config = null;
  }
}

const STUB_CSS = `
.bk-stubhud{position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#fff;text-shadow:0 2px 0 #000}
.bk-stubhud [data-k=top]{position:absolute;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:14px;align-items:center;font-size:13px;letter-spacing:.08em}
.bk-stubhud [data-k=top] b{font-size:26px;font-style:italic}
.bk-stubhud [data-k=turn]{position:absolute;top:52px;left:50%;transform:translateX(-50%);font-weight:900;font-style:italic;font-size:18px;white-space:nowrap}
.bk-stubhud [data-k=flash]{position:absolute;top:38%;left:50%;transform:translateX(-50%);font-weight:900;font-style:italic;font-size:clamp(22px,5vw,40px)}
.bk-stubhud [data-k=track]{position:absolute;left:50%;transform:translateX(-50%);bottom:max(170px,24vh);width:min(560px,calc(100vw - 32px));height:44px;background:rgba(0,0,0,.45);border-radius:10px}
.bk-line{position:absolute;left:12%;top:4px;bottom:4px;width:3px;background:#ffd400}
.bk-key{position:absolute;top:50%;transform:translate(-50%,-50%);font-size:24px;font-weight:900;opacity:.55}
.bk-key.bk-mine{opacity:1;color:#ffd400}
@media (max-width:600px){.bk-stubhud [data-k=top]{top:58px}.bk-stubhud [data-k=turn]{top:96px;font-size:15px}.bk-stubhud [data-k=track]{bottom:310px}}
`;
