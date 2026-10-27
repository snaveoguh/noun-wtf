// ── Hide & Seek in the scene: marker, arena wall, CPU players, beacons, sounds ─
//
// Everything three.js / Web Audio for the mode. HideSeekMode owns one.
//
//   marker   a glowing ring + a floating HIDE & SEEK sign at the lobby spot
//   wall     the arena's edge: four tall, soft glowing curtains, brighter
//            the closer you are (only while you're in a game)
//   bots     CPU players as Nouns (name tags follow policy.ts)
//   beacons  reveal pillars where everyone was when the round ended (green:
//            still hidden, red: found, yellow: seeker) and orange pillars
//            over lit doors
//   sounds   a two-note whistle and a ping chime, placed in the world

import type { Game } from '../Game';
import type { LabelShow } from './policy';

import * as THREE from 'three';

import { parseSeedKey, randomSeed } from '../character/NounAppearance';
import { NounCharacter } from '../character/NounCharacter';
import { toonify } from '../render/Toon';

import { ARENA } from './arena';

const WALL_H = 46;

function signTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const x = c.getContext('2d');
  if (x === null) return null;
  x.fillStyle = 'rgba(12,10,24,0.86)';
  x.beginPath();
  x.roundRect(8, 8, 496, 144, 36);
  x.fill();
  x.lineWidth = 8;
  x.strokeStyle = '#b26bff';
  x.stroke();
  x.fillStyle = '#ffffff';
  x.font = "bold 64px 'Londrina Solid', system-ui, sans-serif";
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('🙈 HIDE & SEEK', 256, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMe: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color('#b26bff') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uMe;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        float fade = pow(1.0 - vUv.y, 1.6);
        float bands = 0.55 + 0.45 * sin(vW.y * 1.4 - uTime * 2.2);
        float grid = smoothstep(0.92, 1.0, abs(sin((vW.x + vW.z) * 0.5)));
        float near = 0.18 + 0.82 * smoothstep(55.0, 4.0, distance(vW.xz, uMe.xz));
        float a = (fade * (0.35 + 0.35 * bands) + grid * 0.25 * fade) * near;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

interface BotAvatar {
  ch: NounCharacter;
  label: HTMLDivElement;
  name: string;
  last: THREE.Vector3;
}

interface Beacon {
  mesh: THREE.Mesh;
  label: HTMLDivElement | null;
  pos: THREE.Vector3;
}

const BEAM_GEO = new THREE.CylinderGeometry(0.4, 0.4, 70, 12, 1, true);
const BEAM_COLORS = { h: '#3dff8a', f: '#ff4d3d', s: '#ffd400', door: '#ff9a1f' } as const;

export class HsView3d {
  readonly group = new THREE.Group();
  private marker: THREE.Group | null = null;
  private ring: THREE.Mesh | null = null;
  private sign: THREE.Sprite | null = null;
  private wall: THREE.Group | null = null;
  private wallMat: THREE.ShaderMaterial | null = null;
  private bots = new Map<string, BotAvatar>();
  private reveal: Beacon[] = [];
  private doors = new Map<string, Beacon>();
  private t = 0;

  constructor(private game: Game) {
    this.group.name = 'hideseek';
    game.gfx.scene.add(this.group);
  }

  // ── The lobby marker ──

  placeMarker(x: number, y: number, z: number) {
    if (this.marker !== null) return;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.2, 48),
      new THREE.MeshBasicMaterial({
        color: '#b26bff',
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(ring);
    const tex = signTexture();
    if (tex !== null) {
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
      sign.scale.set(4.2, 1.31, 1);
      sign.position.y = 3.4;
      g.add(sign);
      this.sign = sign;
    }
    this.ring = ring;
    this.marker = g;
    this.group.add(g);
  }

  showMarker(on: boolean) {
    if (this.marker) this.marker.visible = on;
  }

  // ── The arena wall ──

  showWall(on: boolean) {
    if (on && this.wall === null) {
      const mat = wallMaterial();
      const w = new THREE.Group();
      const L = ARENA.half * 2;
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(L, WALL_H), mat);
        const a = (i * Math.PI) / 2;
        m.position.set(
          ARENA.cx + Math.sin(a) * ARENA.half,
          WALL_H / 2 - 2,
          ARENA.cz + Math.cos(a) * ARENA.half,
        );
        m.rotation.y = a;
        m.renderOrder = 5;
        w.add(m);
      }
      this.wall = w;
      this.wallMat = mat;
      this.group.add(w);
    }
    if (this.wall) this.wall.visible = on;
  }

  // ── CPU players ──

  setBots(
    poses: readonly { id: string; x: number; y: number; z: number; yaw: number; anim: string }[],
    names: (id: string) => { name: string; seed?: string },
    show: (id: string) => LabelShow,
    dt: number,
  ) {
    const assets = this.game.assets;
    if (assets === null) return;
    const seen = new Set<string>();
    const cam = this.game.gfx.camera;
    const w = this.game.labelLayerEl.clientWidth;
    const h = this.game.labelLayerEl.clientHeight;
    for (const p of poses) {
      seen.add(p.id);
      let a = this.bots.get(p.id);
      if (a === undefined) {
        const info = names(p.id);
        const ch = new NounCharacter(parseSeedKey(info.seed) ?? randomSeed(), assets);
        if (this.game.gfx.toon) toonify(ch.root);
        ch.board.visible = false;
        this.game.gfx.scene.add(ch.root);
        const label = document.createElement('div');
        label.className = 'w2-nametag';
        this.game.labelLayerEl.appendChild(label);
        a = { ch, label, name: info.name, last: new THREE.Vector3(p.x, p.y, p.z) };
        label.innerHTML = `<span>${escapeHtml(info.name)} 🤖</span>`;
        this.bots.set(p.id, a);
      }
      const ch = a.ch;
      ch.root.position.set(p.x, p.y, p.z);
      ch.root.quaternion.setFromAxisAngle(UP, p.yaw);
      const clip =
        p.anim === 'crouch'
          ? 'skate_crouch'
          : p.anim === 'climb'
            ? 'walk'
            : p.anim === 'wave'
              ? 'wave'
              : p.anim;
      ch.play({ clip, fade: 0.2, timeScale: p.anim === 'climb' ? 0.6 : 1 });
      ch.board.visible = false;
      ch.update(dt, { lean: 0, travelled: 0, riding: false });
      a.last.set(p.x, p.y, p.z);
      // Name tag, by the same rule as players'
      const s = show(p.id);
      const v = _v.set(p.x, p.y + 2.05, p.z).project(cam);
      const onScreen = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      const dist = cam.position.distanceTo(_v2.set(p.x, p.y, p.z));
      a.label.style.display = s !== 'hide' && onScreen && dist < 60 ? 'block' : 'none';
      a.label.style.opacity = s === 'faint' ? '0.4' : '1';
      if (onScreen)
        a.label.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
    for (const [id, a] of this.bots)
      if (!seen.has(id)) {
        this.disposeBot(a);
        this.bots.delete(id);
      }
  }

  botPos(id: string): THREE.Vector3 | null {
    return this.bots.get(id)?.last ?? null;
  }

  private disposeBot(a: BotAvatar) {
    this.game.gfx.scene.remove(a.ch.root);
    a.ch.dispose();
    a.label.remove();
  }

  clearBots() {
    for (const a of this.bots.values()) this.disposeBot(a);
    this.bots.clear();
  }

  // ── Beacons ──

  private beam(color: string, x: number, y: number, z: number, text: string | null): Beacon {
    const mesh = new THREE.Mesh(
      BEAM_GEO,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.position.set(x, y + 35, z);
    this.group.add(mesh);
    let label: HTMLDivElement | null = null;
    if (text !== null) {
      label = document.createElement('div');
      label.className = 'w2-nametag hs-reveal-tag';
      label.innerHTML = `<span style="border:1px solid ${color}">${text}</span>`;
      this.game.labelLayerEl.appendChild(label);
    }
    return { mesh, label, pos: new THREE.Vector3(x, y, z) };
  }

  private dropBeacon(b: Beacon) {
    this.group.remove(b.mesh);
    (b.mesh.material as THREE.Material).dispose();
    b.label?.remove();
  }

  showReveal(
    spots: readonly { x: number; y: number; z: number; st: 'h' | 's' | 'f'; text: string }[],
  ) {
    this.clearReveal();
    for (const s of spots) this.reveal.push(this.beam(BEAM_COLORS[s.st], s.x, s.y, s.z, s.text));
  }

  clearReveal() {
    for (const b of this.reveal) this.dropBeacon(b);
    this.reveal = [];
  }

  setDoors(lit: readonly { id: string; x: number; z: number }[]) {
    const keep = new Set(lit.map(d => d.id));
    for (const [id, b] of this.doors)
      if (!keep.has(id)) {
        this.dropBeacon(b);
        this.doors.delete(id);
      }
    for (const d of lit)
      if (!this.doors.has(d.id))
        this.doors.set(d.id, this.beam(BEAM_COLORS.door, d.x, 0, d.z, '🚪 someone’s inside'));
  }

  // ── Per frame ──

  update(dt: number, me: THREE.Vector3) {
    this.t += dt;
    if (this.ring)
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.25 * Math.sin(this.t * 3);
    if (this.sign) this.sign.position.y = 3.4 + Math.sin(this.t * 1.6) * 0.15;
    if (this.wallMat) {
      this.wallMat.uniforms.uTime.value = this.t;
      (this.wallMat.uniforms.uMe.value as THREE.Vector3).copy(me);
    }
    const cam = this.game.gfx.camera;
    const w = this.game.labelLayerEl.clientWidth;
    const h = this.game.labelLayerEl.clientHeight;
    for (const b of [...this.reveal, ...this.doors.values()]) {
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.15 * Math.sin(this.t * 4);
      if (b.label === null) continue;
      const v = _v.copy(b.pos).add(_up2).project(cam);
      const on = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      b.label.style.display = on ? 'block' : 'none';
      if (on)
        b.label.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
  }

  // ── Sounds ──

  /** A two-note "wheet-whoo" from where a hider is. */
  whistle(at: THREE.Vector3 | null) {
    const ctx = this.game.audio.ctx;
    const out = this.game.audio.master;
    if (ctx === null || out === null) return;
    const hear = at === null ? { gain: 1, pan: 0 } : this.game.hearOf(at);
    const gain = Math.max(0.12, hear.gain) * 0.35;
    const t0 = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1700, t0);
    osc.frequency.exponentialRampToValueAtTime(2700, t0 + 0.16);
    osc.frequency.setValueAtTime(2700, t0 + 0.24);
    osc.frequency.exponentialRampToValueAtTime(1500, t0 + 0.62);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.04);
    g.gain.setValueAtTime(gain, t0 + 0.18);
    g.gain.exponentialRampToValueAtTime(gain * 0.4, t0 + 0.22);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.28);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.66);
    pan.pan.value = hear.pan;
    osc.connect(g).connect(pan).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.7);
  }

  /** The ping: a chime from where the hider is. */
  ping(at: THREE.Vector3 | null) {
    const hear = at === null ? { gain: 1, pan: 0 } : this.game.hearOf(at);
    // Always faintly audible: it's the point of a ping
    this.game.sfx.play('crystal-chime', { gain: 0.25 + 0.75 * hear.gain, pan: hear.pan });
  }

  dispose() {
    this.clearBots();
    this.clearReveal();
    for (const b of this.doors.values()) this.dropBeacon(b);
    this.doors.clear();
    this.game.gfx.scene.remove(this.group);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up2 = new THREE.Vector3(0, 2.4, 0);

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}
