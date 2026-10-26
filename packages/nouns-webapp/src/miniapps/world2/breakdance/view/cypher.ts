// ── The cypher's dressing ───────────────────────────────────────────────
//
// Cypher space: origin at the middle of the circle on the floor, +Y up, +Z
// toward the DJ booth, −Z toward the judges' table. Crews wait at ±X.
//
//   chalk ring + flattened cardboard in the middle, a crowd ring (crowd.ts)
//   DJ booth (+Z): table, two decks, a mixer, stacked speakers that pump on
//     the kick, and a DJ Noun scratching between turns
//   judges (−Z): three Nouns at a table, holding up crew-coloured cards
//   light rigs: four poles with coloured beams that cycle per bar, pulse on
//     the beat and flash white on freezes; a floor wash in the circle

import type { CrewId, JudgeCard } from '../contract';

import * as THREE from 'three';

import { NounCharacter, solveTwoBone, type CharacterAssets } from '../../character/NounCharacter';

import { seedOf } from './dancer';

export const RING_R = 3.0;
export const DJ_AT = new THREE.Vector3(0, 0, 6.4);
export const JUDGES_AT = new THREE.Vector3(0, 0, -6.2);
export const JUDGE_X = [-1.35, 0, 1.35];

/** Where a crew's dancers wait (cypher space) and which way they face. */
export function edgeSpot(crew: CrewId, i: number, k: number) {
  const sx = crew === 0 ? -1 : 1;
  const z = (i - (k - 1) / 2) * 1.25;
  const p = new THREE.Vector3(sx * 3.8, 0, z);
  return { p, yaw: Math.atan2(-p.x, -p.z * 0.3) };
}

/** Facing in the middle: toward the other crew, opened up a little to the judges. */
export function centreYaw(crew: CrewId) {
  return crew === 0 ? Math.atan2(1, -0.55) : Math.atan2(-1, -0.55);
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const glowTex = () =>
  canvasTex(128, 128, c => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });

const beamTex = () =>
  canvasTex(64, 256, c => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 256);
    // soft edges
    const e = c.createLinearGradient(0, 0, 64, 0);
    e.addColorStop(0, 'rgba(0,0,0,1)');
    e.addColorStop(0.3, 'rgba(0,0,0,0)');
    e.addColorStop(0.7, 'rgba(0,0,0,0)');
    e.addColorStop(1, 'rgba(0,0,0,1)');
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = e;
    c.fillRect(0, 0, 64, 256);
  });

const PALETTE = [0xff2d6f, 0x2fd4ff, 0xffd400, 0x8a5cff, 0x3ddc84, 0xff7a00];

interface Judge {
  ch: NounCharacter;
  arm: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D } | null;
  card: THREE.Group;
  face: THREE.MeshBasicMaterial;
  raise: number;
  /** 0 hidden, 1 up. */
  want: number;
  delay: number;
}

interface Beam {
  pole: THREE.Group;
  head: THREE.Object3D;
  beam: THREE.Mesh;
  lamp: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  lampMat: THREE.MeshBasicMaterial;
  phase: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class CypherDressing {
  readonly group = new THREE.Group();
  /** Meshes the ink outline should skip (additive light, the floor wash). */
  readonly inkless: THREE.Object3D[] = [];
  readonly dj: NounCharacter;
  private djArm: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D } | null;
  private judges: Judge[] = [];
  private beams: Beam[] = [];
  private cones: THREE.Mesh[] = [];
  private platters: THREE.Mesh[] = [];
  private wash: THREE.Mesh;
  private washMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private disposables: { dispose(): void }[] = [];
  private flash = 0;
  private kick = 0;
  private scratch = 0;
  private time = 0;
  crewColors: [string, string] = ['#ff2d6f', '#2fd4ff'];
  crewNames: [string, string] = ['RED CREW', 'BLUE CREW'];

  constructor(
    assets: CharacterAssets,
    private low: boolean,
  ) {
    this.group.name = 'BreakCypher';
    const own = <T extends { dispose(): void }>(x: T) => {
      this.disposables.push(x);
      return x;
    };
    const std = (color: number, rough = 0.8, metal = 0) =>
      own(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
    const mesh = (
      g: THREE.BufferGeometry,
      m: THREE.Material,
      parent: THREE.Object3D = this.group,
    ) => {
      const x = new THREE.Mesh(own(g), m);
      x.castShadow = true;
      x.receiveShadow = true;
      parent.add(x);
      return x;
    };

    // ── floor: cardboard + chalk ring ──
    const cardTex = own(
      canvasTex(256, 256, c => {
        c.fillStyle = '#b98a55';
        c.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 900; i++) {
          c.fillStyle = `rgba(${90 + Math.random() * 40},${60 + Math.random() * 30},30,${Math.random() * 0.12})`;
          c.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 10, 1);
        }
        c.fillStyle = 'rgba(70,45,20,0.35)';
        for (let x = 12; x < 256; x += 22) c.fillRect(x, 0, 2, 256);
        c.fillStyle = 'rgba(205,190,160,0.85)';
        c.fillRect(0, 118, 256, 20);
        c.fillStyle = 'rgba(40,25,10,0.5)';
        c.font = 'bold 22px sans-serif';
        c.fillText('THIS SIDE UP ↑', 20, 60);
        c.fillText('FRAGILE', 150, 210);
      }),
    );
    const cardMat = own(new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.95 }));
    const sheets: [number, number, number, number, number][] = [
      [-0.65, 0, 1.25, 2.4, 0.04],
      [0.62, 0.05, 1.25, 2.3, -0.06],
      [0.05, -1.05, 2.2, 0.7, 0.03],
    ];
    sheets.forEach(([x, z, w, d, r], i) => {
      const m = mesh(new THREE.BoxGeometry(w, 0.012, d), cardMat);
      m.position.set(x, 0.006 + i * 0.002, z);
      m.rotation.y = r;
      m.castShadow = false;
    });
    this.ringMat = own(
      new THREE.MeshBasicMaterial({
        color: 0xf4f1ea,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    const ring = mesh(
      new THREE.RingGeometry(RING_R - 0.07, RING_R + 0.07, 72).rotateX(-Math.PI / 2),
      this.ringMat,
    );
    ring.position.y = 0.02;
    ring.castShadow = false;
    ring.renderOrder = 2;
    this.inkless.push(ring);
    // Floor wash: coloured light pooled in the circle
    this.washMat = own(
      new THREE.MeshBasicMaterial({
        map: own(glowTex()),
        color: 0xff2d6f,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.wash = mesh(
      new THREE.PlaneGeometry(RING_R * 2.6, RING_R * 2.6).rotateX(-Math.PI / 2),
      this.washMat,
    );
    this.wash.position.y = 0.03;
    this.wash.castShadow = false;
    this.wash.renderOrder = 3;
    this.inkless.push(this.wash);

    // ── DJ booth ──
    const booth = new THREE.Group();
    booth.position.copy(DJ_AT);
    booth.rotation.y = Math.PI; // faces −z, into the circle
    this.group.add(booth);
    const black = std(0x16171b, 0.6);
    const metal = std(0x9aa0aa, 0.35, 0.6);
    const table = mesh(new THREE.BoxGeometry(2.3, 0.08, 0.85), black, booth);
    table.position.set(0, 0.86, 0.35);
    const front = mesh(new THREE.BoxGeometry(2.3, 0.82, 0.06), std(0x22232a, 0.7), booth);
    front.position.set(0, 0.43, 0.76);
    // Banner on the front of the booth
    const banner = own(
      canvasTex(512, 160, c => {
        c.fillStyle = '#111';
        c.fillRect(0, 0, 512, 160);
        c.fillStyle = '#ffd400';
        c.font = "900 92px 'Londrina Solid', Impact, sans-serif";
        c.textAlign = 'center';
        c.fillText('NOUN BREAKS', 256, 110);
        c.fillStyle = '#d22209';
        c.fillRect(0, 140, 512, 20);
      }),
    );
    const bannerM = mesh(
      new THREE.PlaneGeometry(2.1, 0.66),
      own(new THREE.MeshBasicMaterial({ map: banner })),
      booth,
    );
    bannerM.position.set(0, 0.45, 0.795);
    bannerM.castShadow = false;
    for (const x of [-0.6, 0.6]) {
      const deck = mesh(new THREE.BoxGeometry(0.62, 0.08, 0.5), metal, booth);
      deck.position.set(x, 0.94, 0.35);
      const plat = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 28), std(0x0b0b0d, 0.4), booth);
      plat.position.set(x, 0.99, 0.35);
      // A label so you can see it spin
      const lab = mesh(new THREE.BoxGeometry(0.12, 0.005, 0.03), std(0xd22209, 0.5), plat);
      lab.position.set(0.08, 0.012, 0);
      lab.castShadow = false;
      this.platters.push(plat);
    }
    const mixer = mesh(new THREE.BoxGeometry(0.34, 0.1, 0.42), std(0x2a2b30, 0.5), booth);
    mixer.position.set(0, 0.95, 0.35);
    // Speakers: stacks either side, cones pump on the kick
    const cab = std(0x101114, 0.7);
    const coneMat = std(0x2a2b2f, 0.5);
    for (const x of [-1.75, 1.75]) {
      for (const [y, h, r] of [
        [0.55, 1.1, 0.34],
        [1.45, 0.7, 0.2],
      ] as const) {
        const box = mesh(new THREE.BoxGeometry(0.85, h, 0.7), cab, booth);
        box.position.set(x, y, 0.4);
        const cone = mesh(
          new THREE.CylinderGeometry(r, r * 0.7, 0.08, 24).rotateX(Math.PI / 2),
          coneMat,
          booth,
        );
        cone.position.set(x, y - (h > 1 ? 0.1 : 0), 0.77);
        cone.castShadow = false;
        this.cones.push(cone);
      }
    }
    this.dj = new NounCharacter(seedOf(null, 'dj:noun'), assets);
    this.dj.board.visible = false;
    this.dj.root.position.set(0, 0, -0.15);
    booth.add(this.dj.root);
    this.djArm = findArm(this.dj, 'r');

    // ── judges ──
    const jt = new THREE.Group();
    jt.position.copy(JUDGES_AT);
    this.group.add(jt);
    const jtable = mesh(new THREE.BoxGeometry(4.4, 0.08, 0.9), std(0xf4f1ea, 0.7), jt);
    jtable.position.set(0, 0.82, 0.5);
    const skirt = mesh(new THREE.BoxGeometry(4.4, 0.78, 0.05), std(0xd22209, 0.7), jt);
    skirt.position.set(0, 0.41, 0.94);
    const sign = own(
      canvasTex(512, 96, c => {
        c.fillStyle = '#d22209';
        c.fillRect(0, 0, 512, 96);
        c.fillStyle = '#fff';
        c.font = "900 64px 'Londrina Solid', Impact, sans-serif";
        c.textAlign = 'center';
        c.fillText('JUDGES', 256, 72);
      }),
    );
    const signM = mesh(
      new THREE.PlaneGeometry(1.6, 0.3),
      own(new THREE.MeshBasicMaterial({ map: sign })),
      jt,
    );
    signM.position.set(0, 0.5, 0.97);
    signM.castShadow = false;
    JUDGE_X.forEach((x, i) => {
      const ch = new NounCharacter(seedOf(null, `judge:${i}`), assets);
      ch.board.visible = false;
      ch.root.position.set(x, 0, -0.05);
      jt.add(ch.root);
      const card = new THREE.Group();
      const face = own(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      const board = new THREE.Mesh(own(new THREE.PlaneGeometry(0.62, 0.46)), face);
      board.position.y = 0.3;
      const stick = new THREE.Mesh(
        own(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6)),
        std(0xc9a46a),
      );
      stick.position.y = 0.0;
      card.add(board, stick);
      card.visible = false;
      this.group.add(card);
      this.judges.push({
        ch,
        arm: findArm(ch, 'r'),
        card,
        face,
        raise: 0,
        want: 0,
        delay: i * 0.35,
      });
    });

    // ── lights ──
    const bt = own(beamTex());
    const poleMat = std(0x2b2d33, 0.5, 0.5);
    const corners: [number, number][] = [
      [4.9, 4.4],
      [-4.9, 4.4],
      [4.9, -4.4],
      [-4.9, -4.4],
    ];
    corners.forEach(([x, z], i) => {
      const pole = new THREE.Group();
      pole.position.set(x, 0, z);
      this.group.add(pole);
      const mast = mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.6, 8), poleMat, pole);
      mast.position.y = 1.8;
      const foot = mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.08, 10), poleMat, pole);
      foot.position.y = 0.04;
      const head = new THREE.Group();
      head.position.y = 3.6;
      pole.add(head);
      // Aim at the middle of the circle
      head.lookAt(
        new THREE.Vector3(0, 0, 0)
          .sub(pole.position)
          .add(new THREE.Vector3(0, 3.6, 0))
          .setY(-0.2),
      );
      const can = mesh(
        new THREE.CylinderGeometry(0.16, 0.12, 0.34, 12).rotateX(Math.PI / 2),
        poleMat,
        head,
      );
      can.position.z = 0.05;
      const lampMat = own(new THREE.MeshBasicMaterial({ color: PALETTE[i], toneMapped: false }));
      const lamp = mesh(new THREE.CircleGeometry(0.15, 16), lampMat, head);
      lamp.position.z = 0.23;
      lamp.castShadow = false;
      const len = Math.hypot(x, z, 3.6) * 1.05;
      const mat = own(
        new THREE.MeshBasicMaterial({
          map: bt,
          color: PALETTE[i],
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      // Cone along +z from the lamp; the texture fades it out down its length
      const g = new THREE.CylinderGeometry(0.14, 1.25, len, 20, 1, true);
      g.translate(0, -len / 2, 0);
      g.rotateX(-Math.PI / 2);
      const beam = mesh(g, mat, head);
      beam.position.z = 0.22;
      beam.castShadow = false;
      beam.receiveShadow = false;
      beam.renderOrder = 4;
      this.inkless.push(beam, lamp);
      this.beams.push({ pole, head, beam, lamp, mat, lampMat, phase: i * 0.25 });
    });
    if (low) for (const b of this.beams.slice(2)) b.beam.visible = false;
  }

  setCrews(colors: [string, string], names: [string, string]) {
    this.crewColors = colors;
    this.crewNames = names;
  }

  /** Strobe (freezes, the winner). */
  strobe(k = 1) {
    this.flash = Math.max(this.flash, k);
  }

  /** Kick drum hit (speaker cones + the floor wash). */
  pump(k = 1) {
    this.kick = Math.max(this.kick, k);
  }

  setScratch(on: boolean) {
    this.scratch = on ? 1 : 0;
  }

  /** Raise the judges' cards for this round's card (each judge in turn). */
  showCard(card: JudgeCard) {
    this.judges.forEach((j, i) => {
      const v = card.votes[i] ?? 0;
      const col = new THREE.Color(this.crewColors[v]);
      const tex = canvasTex(256, 192, c => {
        c.fillStyle = '#fff';
        c.fillRect(0, 0, 256, 192);
        c.fillStyle = `#${col.getHexString()}`;
        c.fillRect(10, 10, 236, 172);
        c.fillStyle = '#fff';
        c.textAlign = 'center';
        c.font = "900 104px 'Londrina Solid', Impact, sans-serif";
        c.fillText(v === 0 ? '◀' : '▶', 128, 112);
        c.font = "900 34px 'Londrina Solid', Impact, sans-serif";
        c.fillText(this.crewNames[v].slice(0, 12), 128, 166);
      });
      j.face.map?.dispose();
      j.face.map = tex;
      j.face.needsUpdate = true;
      j.want = 1;
      j.raise = Math.min(j.raise, 0);
      j.delay = i * 0.45;
    });
  }

  hideCards() {
    for (const j of this.judges) j.want = 0;
  }

  update(dt: number, beat: number, hype: number) {
    this.time += dt;
    const ph = ((beat % 1) + 1) % 1;
    const onBeat = Math.exp(-ph * 7);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.flash = Math.max(0, this.flash - dt * 3);
    // ── lights: colour per bar, pulse per beat, sweep a little ──
    const bar = Math.floor(beat / 4);
    this.beams.forEach((b, i) => {
      const c = new THREE.Color(PALETTE[(i + bar) % PALETTE.length]);
      if (this.flash > 0) c.lerp(new THREE.Color(0xffffff), Math.min(1, this.flash));
      b.mat.color.copy(c);
      b.lampMat.color.copy(c).multiplyScalar(1.4);
      b.mat.opacity =
        (0.1 + 0.16 * onBeat + 0.12 * hype + 0.35 * this.flash) * (this.low ? 0.8 : 1);
      const sw = Math.sin(this.time * 0.9 + b.phase * 6) * 0.22;
      b.head.rotation.z = sw * 0.5;
      b.beam.rotation.x = Math.sin(this.time * 0.7 + b.phase * 4) * 0.12;
    });
    const wc = new THREE.Color(PALETTE[bar % PALETTE.length]);
    if (this.flash > 0) wc.lerp(new THREE.Color(0xffffff), this.flash);
    this.washMat.color.copy(wc);
    this.washMat.opacity =
      0.16 + 0.22 * onBeat * (0.5 + hype * 0.5) + 0.3 * this.flash + 0.12 * this.kick;
    this.ringMat.opacity = 0.7 + 0.25 * onBeat;
    // ── speakers + decks ──
    for (const c of this.cones) c.scale.setScalar(1 + this.kick * 0.12);
    this.platters.forEach((p, i) => {
      const scr = i === 0 && this.scratch > 0 ? Math.sin(this.time * 22) * 0.35 : 0;
      p.rotation.y -= dt * 3.5 * (1 - this.scratch * 0.8) + scr;
    });
    // ── DJ: bobs to the beat, right hand on the deck ──
    const dj = this.dj;
    dj.play({ clip: 'dance', fade: 0.3, time: ((((beat / 4) % 1) + 1) % 1) * 2, timeScale: 0 });
    dj.update(dt, { lean: 0, travelled: 0, riding: false });
    if (this.djArm !== null) {
      const wig =
        this.scratch > 0 ? Math.sin(this.time * 20) * 0.1 : Math.sin(beat * Math.PI) * 0.02;
      // Right hand (−x in character space) on the deck at booth x −0.6
      const tgt = _a.set(-0.48 + wig, 1.04, 0.5);
      dj.root.updateMatrixWorld(true);
      dj.root.localToWorld(tgt);
      dj.root.getWorldQuaternion(_q);
      const pole = _b.set(-0.8, -0.6, -0.3).applyQuaternion(_q);
      solveTwoBone(this.djArm.upper, this.djArm.fore, this.djArm.hand, tgt, pole, 1);
    }
    // ── judges ──
    for (const j of this.judges) {
      j.ch.play({ clip: 'idle', fade: 0.3 });
      j.ch.update(dt, { lean: 0, travelled: 0, riding: false });
      if (j.want > 0 && j.delay > 0) j.delay -= dt;
      const goal = j.want > 0 && j.delay <= 0 ? 1 : 0;
      j.raise += (goal - j.raise) * (1 - Math.exp(-(goal > j.raise ? 9 : 6) * dt));
      const k = Math.max(0, j.raise);
      j.card.visible = k > 0.02;
      if (j.arm === null) continue;
      const root = j.ch.root;
      root.updateMatrixWorld(true);
      root.getWorldQuaternion(_q);
      // Card up beside the head (the head swallows anything straight overhead)
      const tgt = _a.set(-0.42, 0.62 + 0.62 * k, 0.32 + 0.1 * k);
      root.localToWorld(tgt);
      const pole = _b.set(-0.8, -0.5, -0.4).applyQuaternion(_q);
      solveTwoBone(j.arm.upper, j.arm.fore, j.arm.hand, tgt, pole, Math.min(1, k * 1.5));
      j.arm.hand.getWorldPosition(_a);
      this.group.worldToLocal(_a);
      j.card.position.copy(_a);
      // Face the circle (the judge's forward), a little wobble when it goes up
      this.group.getWorldQuaternion(_q).invert();
      j.card.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion())).premultiply(_q);
      j.card.rotateZ(Math.sin(this.time * 3 + j.delay) * 0.05 * k);
      j.card.scale.setScalar(0.6 + 0.4 * k);
    }
  }

  dispose() {
    this.dj.dispose();
    for (const j of this.judges) {
      j.ch.dispose();
      j.face.map?.dispose();
    }
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

function findArm(ch: NounCharacter, s: 'l' | 'r') {
  const f = (n: string) => {
    let hit: THREE.Object3D | null = null;
    ch.body.traverse(o => {
      if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === n) hit = o;
    });
    return hit as THREE.Object3D | null;
  };
  const upper = f(`upperarm${s}`);
  const fore = f(`forearm${s}`);
  const hand = f(`hand${s}`);
  return upper !== null && fore !== null && hand !== null ? { upper, fore, hand } : null;
}

export { UP };
