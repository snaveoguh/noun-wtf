// ── A live hoop: backboard that wobbles, rim that shakes / bends, net ───
//
// Drawn where the park's static hoop tops stand (NounJerseyPark hides
// those while Noun Hoops runs: njHoopTops). Local frame like the park's:
// origin at the pole's foot behind the baseline, +Z into the court.

import type { CourtSpec } from '../contract';

import * as THREE from 'three';

import { HOOP_POLE_BACK } from '../../world/mountain/NounJerseyPark';

import { NetCloth } from './netCloth';

/** Damped angular spring. */
class Spring {
  x = 0;
  v = 0;
  target = 0;
  constructor(
    public k: number,
    public c: number,
  ) {}
  kick(v: number) {
    this.v += v;
  }
  update(dt: number) {
    const h = Math.min(dt, 1 / 30);
    this.v += (-(this.x - this.target) * this.k - this.v * this.c) * h;
    this.x += this.v * h;
  }
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _off = new THREE.Vector3();
const _cam = new THREE.Vector3();

export class HoopRig {
  readonly group = new THREE.Group();
  /** Rim centre in court space (rest). */
  readonly rim = new THREE.Vector3();
  /** Unit vector (court space) from the board toward the court. */
  readonly inward = new THREE.Vector3();
  readonly net: NetCloth;
  private boardPivot = new THREE.Group();
  private rimPivot = new THREE.Group();
  private rimCentre = new THREE.Group();
  private rimMat: THREE.MeshStandardMaterial;
  private boardPitch = new Spring(260, 4.5);
  private boardRoll = new Spring(200, 4);
  private rimPitch = new Spring(900, 9);
  private rimJitter = 0;
  private t = Math.random() * 10;
  /** 0..1 on-fire glow of the rim. */
  heat = 0;

  constructor(
    readonly court: CourtSpec,
    readonly end: 1 | -1,
    low: boolean,
  ) {
    const K = court;
    const zBase = end * (K.length / 2 + HOOP_POLE_BACK);
    this.group.position.set(0, 0, zBase);
    // Local +Z into the court: the +z hoop turns round
    this.group.rotation.y = end > 0 ? Math.PI : 0;
    this.rim.set(0, K.rimHeight, end * (K.length / 2 - K.rimFromBaseline));
    this.inward.set(0, 0, -end);
    const zFace = HOOP_POLE_BACK + K.boardFromBaseline;
    const zBack = zFace - 0.07;
    const zRim = HOOP_POLE_BACK + K.rimFromBaseline;
    const top = K.boardBottom + K.boardHeight * 0.55;

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.55 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd22209, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.7 });
    this.rimMat = new THREE.MeshStandardMaterial({
      color: 0xe86a2a,
      roughness: 0.4,
      metalness: 0.2,
      emissive: new THREE.Color(0xff4400),
      emissiveIntensity: 0,
    });
    // Board pivots at the arm's end (behind the board, high up)
    this.boardPivot.position.set(0, top, zBack - 0.12);
    this.group.add(this.boardPivot);
    const at = (g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y - top, z - (zBack - 0.12));
      m.castShadow = true;
      m.receiveShadow = true;
      this.boardPivot.add(m);
      return m;
    };
    const bw = K.boardWidth;
    const b0 = K.boardBottom;
    const bh = K.boardHeight;
    at(new THREE.BoxGeometry(bw, bh, 0.07), white, 0, b0 + bh / 2, zBack + 0.035);
    const zP = zFace + 0.003;
    const frame = (w: number, h: number, cy: number, t: number, mat: THREE.Material) => {
      at(new THREE.BoxGeometry(w, t, 0.006), mat, 0, cy - h / 2 + t / 2, zP);
      at(new THREE.BoxGeometry(w, t, 0.006), mat, 0, cy + h / 2 - t / 2, zP);
      at(new THREE.BoxGeometry(t, h, 0.006), mat, -w / 2 + t / 2, cy, zP);
      at(new THREE.BoxGeometry(t, h, 0.006), mat, w / 2 - t / 2, cy, zP);
    };
    frame(bw, bh, b0 + bh / 2, 0.06, red);
    frame(0.59, 0.45, K.rimHeight + 0.375, 0.05, red);
    at(new THREE.BoxGeometry(bw, 0.08, 0.12), dark, 0, b0 - 0.04, zBack + 0.05);
    // Rim hangs off a bracket on the board face; it pivots there (dunks bend it down)
    this.rimPivot.position.set(0, K.rimHeight - top, zFace - (zBack - 0.12));
    this.boardPivot.add(this.rimPivot);
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.1, zRim - K.rimRadius - zFace + 0.01),
      this.rimMat,
    );
    bracket.position.set(0, -0.04, (zRim - K.rimRadius - zFace) / 2);
    this.rimPivot.add(bracket);
    this.rimCentre.position.set(0, 0, zRim - zFace);
    this.rimPivot.add(this.rimCentre);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(K.rimRadius, 0.018, low ? 6 : 8, low ? 20 : 32).rotateX(Math.PI / 2),
      this.rimMat,
    );
    ring.castShadow = true;
    this.rimCentre.add(ring);
    this.net = new NetCloth(K.rimRadius, low);
    this.rimCentre.add(this.net.object);
  }

  /** Meshes that must stay out of the ink pass (thin strands). */
  get inkless(): THREE.Object3D[] {
    return [this.net.object];
  }

  /** Rim centre (court space, including the wobble). */
  rimNow(out: THREE.Vector3) {
    return out.setFromMatrixPosition(this.rimMatrix(_m));
  }

  /** Rim-centre frame → court space. */
  private rimMatrix(out: THREE.Matrix4) {
    for (const o of [this.group, this.boardPivot, this.rimPivot, this.rimCentre]) o.updateMatrix();
    return out
      .copy(this.group.matrix)
      .multiply(this.boardPivot.matrix)
      .multiply(this.rimPivot.matrix)
      .multiply(this.rimCentre.matrix);
  }

  onRim(strength: number) {
    this.rimPitch.kick(-3 - strength * 9);
    this.rimJitter = Math.max(this.rimJitter, 0.4 + strength);
    this.boardPitch.kick(strength * 0.6);
    this.net.impulse(0.4, 0.6 * strength);
  }

  onBoard(strength: number) {
    this.boardPitch.kick(-1.4 * strength - 0.3);
    this.boardRoll.kick((Math.random() - 0.5) * 1.6 * strength);
  }

  onDunk(power: number) {
    this.rimPitch.kick(-12 * power);
    this.boardPitch.kick(2.2 * power);
    this.boardRoll.kick((Math.random() - 0.5) * 1.2 * power);
    this.rimJitter = 1.5;
    this.net.impulse(2.2 * power, 1.8 * power);
  }

  onSwish(strength: number, fire: boolean) {
    this.net.impulse(1.4 * strength, 1.4 * strength);
    if (fire) this.net.burn = 1;
  }

  /** Hanging on the rim pulls it down. */
  setHang(amount: number) {
    this.rimPitch.target = -0.22 * amount;
  }

  /**
   * Step springs + cloth. `ball` in court space (or null), `camCourt` the
   * camera position in court space.
   */
  update(dt: number, ball: THREE.Vector3 | null, ballR: number, camCourt: THREE.Vector3) {
    this.t += dt;
    this.boardPitch.update(dt);
    this.boardRoll.update(dt);
    this.rimPitch.update(dt);
    this.rimJitter = Math.max(0, this.rimJitter - dt * 3.5);
    const j = this.rimJitter;
    this.boardPivot.rotation.set(this.boardPitch.x * 0.05, 0, this.boardRoll.x * 0.04);
    this.rimPivot.rotation.set(
      this.rimPitch.x * 0.06 + Math.sin(this.t * 61) * 0.01 * j,
      0,
      Math.sin(this.t * 47) * 0.012 * j,
    );
    this.rimMat.emissiveIntensity = this.heat * (0.8 + Math.sin(this.t * 20) * 0.2);
    const inv = this.rimMatrix(_m).invert();
    const b = ball !== null ? _v.copy(ball).applyMatrix4(inv) : null;
    this.net.update(dt, b, ballR, _off);
    _cam.copy(camCourt).applyMatrix4(inv);
    this.net.draw(_cam);
  }

  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const x of mats) x.dispose();
      }
    });
    this.net.dispose();
  }
}
