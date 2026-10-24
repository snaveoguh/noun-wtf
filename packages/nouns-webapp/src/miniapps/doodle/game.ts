/**
 * Doodle Garden engine: a no-lose catching game for small kids.
 *
 * The drawing walks to wherever you touch (touch high up to jump). Treats
 * float down; every catch counts out loud and plants a flower. Every 10
 * catches is a party and the sky changes. Catch a falling rainbow, cloud or
 * big flower and it becomes a parachute: the drawing floats up into the sky
 * and drifts back down under it. Balloons float up to be popped,
 * and tapping the character makes it spin. Nothing ever goes wrong.
 */
import { say, sfxBoing, sfxCatch, sfxFanfare, sfxJump, sfxPop } from './sound';

const TREATS = ['🌸', '🌼', '⭐', '🍓', '🍎', '💖', '🍭', '🍒', '🌻', '🦋', '🍩', '🧁'];
const PLANTS = ['🌷', '🌼', '🌸', '🌻', '🌹', '🌺', '🍄'];
const BALLOON_COLOURS = ['#ff4d6d', '#ffb703', '#3a86ff', '#8338ec', '#06d6a0', '#ff70a6'];
const CONFETTI = ['#ff4d6d', '#ffd60a', '#3a86ff', '#06d6a0', '#ff70a6', '#ffffff', '#8338ec'];
const SKIES: [string, string][] = [
  ['#58c4ff', '#d6f3ff'],
  ['#ff9ecf', '#ffe9a8'],
  ['#7ee8c7', '#fff6b0'],
  ['#b49bff', '#ffd1f0'],
  ['#232a6b', '#7357c2'],
];
const RAINBOW = ['#ff4d4d', '#ff9f1c', '#ffd60a', '#2ec46b', '#3a86ff', '#8338ec'];
type Chute = 'rainbow' | 'cloud' | 'flower';
const CHUTES: Chute[] = ['rainbow', 'cloud', 'flower'];
const CHUTE_WORDS: Record<Chute, string> = {
  rainbow: 'Rainbow parachute!',
  cloud: 'Cloud parachute!',
  flower: 'Flower parachute!',
};
const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];
const CHEERS = ['Wow!', 'Yay!', 'Amazing!', 'Super!', 'Brilliant!', 'Hooray!'];

interface Treat {
  emoji: string;
  x: number;
  y: number;
  vy: number;
  phase: number;
  size: number;
  big: boolean;
  landed: number;
  chute?: Chute;
}
interface Balloon {
  x: number;
  y: number;
  vy: number;
  phase: number;
  colour: string;
  r: number;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  colour: string;
  size: number;
  spin: number;
  text?: string;
}
interface Plant {
  x: number;
  y: number;
  emoji: string;
  grow: number;
  size: number;
}
interface Cloud {
  x: number;
  y: number;
  s: number;
  v: number;
}

const emojiCache = new Map<string, HTMLCanvasElement>();
const emojiSprite = (emoji: string, size: number) => {
  const px = Math.max(16, Math.round(size / 8) * 8);
  const key = `${emoji}:${px}`;
  let cv = emojiCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(px * 1.3);
    const c = cv.getContext('2d')!;
    c.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(emoji, cv.width / 2, cv.height / 2 + px * 0.06);
    emojiCache.set(key, cv);
  }
  return cv;
};

export interface GameCallbacks {
  onCount?: (n: number) => void;
}

export class DoodleGame {
  private c: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private t = 0;

  private img: HTMLImageElement;
  private charX = 0;
  private charY = 0; // height above the ground
  private charVY = 0;
  private charVX = 0;
  private targetX = 0;
  private spin = 0;
  private squash = 0;
  private happy = 0;

  private treats: Treat[] = [];
  private balloons: Balloon[] = [];
  private parts: Particle[] = [];
  private plants: Plant[] = [];
  private clouds: Cloud[] = [];
  private stars: { x: number; y: number; p: number }[] = [];
  private spawnIn = 0.6;
  private balloonIn = 4;
  private bigIn = 14;
  private chuteIn = 6;
  private chuteNext = 0;
  private chute: Chute | null = null;
  private chuteOpen = 0;
  private skyRainbowGlow = [0, 0];
  private count = 0;
  private sky = 0;
  private skyMix = 1;
  private pointerDown = false;
  private keys = new Set<string>();

  constructor(
    private canvas: HTMLCanvasElement,
    image: HTMLImageElement,
    private cb: GameCallbacks = {},
  ) {
    this.c = canvas.getContext('2d')!;
    this.img = image;
    this.resize();
    this.charX = this.targetX = this.W / 2;
    for (let i = 0; i < 4; i++) {
      this.clouds.push({
        x: Math.random() * this.W,
        y: 40 + Math.random() * this.H * 0.3,
        s: 0.6 + Math.random() * 0.7,
        v: 8 + Math.random() * 14,
      });
    }
    for (let i = 0; i < 40; i++)
      this.stars.push({ x: Math.random(), y: Math.random() * 0.6, p: Math.random() * 6 });

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.frame);
    // Dev handle for browser tests.
    if (import.meta.env.DEV) (window as unknown as { __doodle?: DoodleGame }).__doodle = this;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.resize);
  }

  // ---- layout helpers ----
  private get ground() {
    return this.H * 0.8;
  }
  private get unit() {
    return Math.min(this.W, this.H) / 700;
  }
  private get charH() {
    return Math.min(this.H * 0.3, this.W * 0.45, 300);
  }
  private get charW() {
    return (this.charH * this.img.naturalWidth) / Math.max(1, this.img.naturalHeight);
  }

  private resize = () => {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.charX = Math.min(this.charX, this.W);
    this.targetX = Math.min(this.targetX, this.W);
  };

  // ---- input ----
  private point(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    const { x, y } = this.point(e);
    this.pointerDown = true;

    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      if (Math.hypot(x - b.x, y - b.y) < b.r * 1.5) {
        this.popBalloon(i);
        return;
      }
    }

    for (const [i, r] of this.skyRainbows().entries()) {
      const d = Math.hypot(x - r.x, y - r.y);
      if (d < r.r && d > r.r - r.band * RAINBOW.length - 10 && y < r.y) {
        this.skyRainbowGlow[i] = 1;
        sfxCatch(this.t * 3);
        this.burst(x, y, 16, 300);
        return;
      }
    }

    const top = this.ground - this.charY - this.charH;
    if (Math.abs(x - this.charX) < this.charW / 2 && y > top && y < this.ground - this.charY) {
      this.spin = 1;
      this.happy = 1;
      sfxBoing();
      this.jump();
      return;
    }

    this.targetX = x;
    if (y < this.ground - this.charH * 1.1) this.jump();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.pointerDown) return;
    this.targetX = this.point(e).x;
  };

  private onUp = () => {
    this.pointerDown = false;
  };

  private onKey = (e: KeyboardEvent) => {
    if ([' ', 'ArrowUp', 'w', 'W'].includes(e.key)) {
      e.preventDefault();
      this.jump();
    }
    this.keys.add(e.key);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key);
  };

  private jump() {
    if (this.charY > 2 || this.chute) return;
    this.charVY = 900 * this.unit;
    this.squash = -0.25;
    sfxJump();
  }

  // ---- events ----
  private burst(x: number, y: number, n: number, speed = 380) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.3 + Math.random()) * speed * this.unit;
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 200 * this.unit,
        life: 0,
        max: 1 + Math.random() * 0.8,
        colour: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
        size: (6 + Math.random() * 8) * this.unit,
        spin: Math.random() * 6,
      });
    }
  }

  private floatText(x: number, y: number, text: string, colour = '#fff', size = 64) {
    this.parts.push({
      x,
      y,
      vx: 0,
      vy: -90 * this.unit,
      life: 0,
      max: 1.6,
      colour,
      size: size * this.unit,
      spin: 0,
      text,
    });
  }

  private popBalloon(i: number) {
    const b = this.balloons[i];
    this.balloons.splice(i, 1);
    sfxPop();
    this.burst(b.x, b.y, 26);
    this.floatText(b.x, b.y, 'POP!', b.colour, 56);
  }

  private skyRainbows() {
    const u = this.unit;
    // Below the score / buttons row.
    const r = Math.min(this.W * 0.22, 150 * u);
    const band = r * 0.09;
    return [
      { x: r * 0.95, y: r + 80, r, band },
      { x: this.W - r * 0.95, y: r + 80, r, band },
    ];
  }

  private caughtChute(t: Treat) {
    const kind = t.chute!;
    this.chute = kind;
    this.chuteOpen = 0;
    // Swoosh up into the sky, then drift down slowly.
    this.charVY = Math.sqrt(2 * 2200 * this.unit * this.H * 0.4);
    this.spin = 1;
    this.happy = 1;
    sfxFanfare();
    say(CHUTE_WORDS[kind]);
    this.floatText(this.W / 2, this.H * 0.3, CHUTE_WORDS[kind].toUpperCase(), '#ffffff', 60);
    this.burst(t.x, t.y, 40, 450);
  }

  private caught(t: Treat) {
    if (t.chute) {
      this.caughtChute(t);
      return;
    }
    const before = this.count;
    this.count += t.big ? 5 : 1;
    this.cb.onCount?.(this.count);
    sfxCatch(this.count);
    this.happy = 1;
    this.squash = 0.18;
    this.burst(t.x, t.y, t.big ? 50 : 12, t.big ? 500 : 250);

    // Plant something in the garden where it was caught.
    const plantN = t.big ? 5 : 1;
    for (let i = 0; i < plantN; i++) {
      this.plants.push({
        x: Math.max(
          20,
          Math.min(this.W - 20, t.x + (Math.random() - 0.5) * (t.big ? 260 : 60) * this.unit),
        ),
        y: this.ground + 18 * this.unit + Math.random() * (this.H - this.ground - 40 * this.unit),
        emoji: PLANTS[Math.floor(Math.random() * PLANTS.length)],
        grow: 0,
        size: (34 + Math.random() * 22) * this.unit,
      });
    }
    if (this.plants.length > 140) this.plants.splice(0, this.plants.length - 140);

    const milestone = Math.floor(this.count / 10) > Math.floor(before / 10);
    if (milestone) {
      this.sky = (this.sky + 1) % SKIES.length;
      this.skyMix = 0;
      this.spin = 1;
      sfxFanfare();
      const cheer = CHEERS[Math.floor(Math.random() * CHEERS.length)];
      say(`${cheer} ${this.count}!`);
      this.floatText(this.W / 2, this.H * 0.35, `${this.count}! ${cheer}`, '#ffd60a', 84);
      for (let i = 0; i < 5; i++)
        this.burst(Math.random() * this.W, this.H * (0.1 + Math.random() * 0.3), 30, 450);
    } else if (t.big) {
      say(`Super star! ${this.count}!`);
      this.floatText(t.x, t.y - 40, 'SUPER!', '#ffd60a', 72);
    } else {
      say(this.count <= 10 ? NUMBER_WORDS[this.count] : String(this.count));
      this.floatText(t.x, t.y - 30, String(this.count), '#ffffff', 52);
    }
  }

  // ---- loop ----
  private frame = (now: number) => {
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    this.t += dt;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    const u = this.unit;
    const level = Math.floor(this.count / 10);

    // Character movement: ease toward the finger.
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) this.targetX = this.charX - 120 * u;
    if (this.keys.has('ArrowRight') || this.keys.has('d')) this.targetX = this.charX + 120 * u;
    this.targetX = Math.max(this.charW * 0.3, Math.min(this.W - this.charW * 0.3, this.targetX));
    const want = (this.targetX - this.charX) * 6;
    const maxV = 700 * u;
    this.charVX += (Math.max(-maxV, Math.min(maxV, want)) - this.charVX) * Math.min(1, dt * 10);
    this.charX += this.charVX * dt;
    this.charVY -= 2200 * u * dt;
    if (this.chute) {
      this.chuteOpen = Math.min(1, this.chuteOpen + dt * 2.5);
      // The parachute holds the fall to a gentle drift.
      this.charVY = Math.max(this.charVY, -70 * u);
    }
    this.charY += this.charVY * dt;
    // Never float off the top of the screen.
    const ceiling = this.ground - this.charH * (this.chute ? 1.9 : 1.1);
    if (this.charY > ceiling) {
      this.charY = ceiling;
      this.charVY = Math.min(this.charVY, 0);
    }
    if (this.charY <= 0) {
      if (this.charVY < -300 * u) this.squash = 0.2;
      if (this.chute) {
        this.burst(this.charX, this.ground - this.charH * 1.4, 24, 260);
        this.chute = null;
        this.squash = 0.15;
      }
      this.charY = 0;
      this.charVY = 0;
    }
    this.skyRainbowGlow = this.skyRainbowGlow.map(g => Math.max(0, g - dt * 1.5));
    this.squash += (0 - this.squash) * Math.min(1, dt * 8);
    this.spin = Math.max(0, this.spin - dt * 1.4);
    this.happy = Math.max(0, this.happy - dt * 1.5);
    this.skyMix = Math.min(1, this.skyMix + dt * 0.6);

    // Spawning.
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = Math.max(0.55, 1.15 - level * 0.08) * (0.7 + Math.random() * 0.6);
      // Most treats drop within reach of the character, so it never feels hopeless.
      const near = Math.random() < 0.5;
      const x = near
        ? this.charX + (Math.random() - 0.5) * this.W * 0.5
        : 40 * u + Math.random() * (this.W - 80 * u);
      this.treats.push({
        emoji: TREATS[Math.floor(Math.random() * TREATS.length)],
        x: Math.max(40 * u, Math.min(this.W - 40 * u, x)),
        y: -50 * u,
        vy: (95 + Math.min(level, 8) * 12 + Math.random() * 30) * u,
        phase: Math.random() * 6,
        size: 62 * u,
        big: false,
        landed: 0,
      });
    }
    this.bigIn -= dt;
    if (this.bigIn <= 0) {
      this.bigIn = 16 + Math.random() * 8;
      this.treats.push({
        emoji: '🌟',
        x: 80 * u + Math.random() * (this.W - 160 * u),
        y: -80 * u,
        vy: 80 * u,
        phase: 0,
        size: 110 * u,
        big: true,
        landed: 0,
      });
    }
    this.chuteIn -= dt;
    if (this.chuteIn <= 0 && !this.chute && !this.treats.some(t => t.chute)) {
      this.chuteIn = 10 + Math.random() * 6;
      const kind = CHUTES[this.chuteNext++ % CHUTES.length];
      this.treats.push({
        emoji: kind === 'flower' ? '🌺' : '',
        x: Math.max(
          90 * u,
          Math.min(this.W - 90 * u, this.charX + (Math.random() - 0.5) * this.W * 0.6),
        ),
        y: -80 * u,
        vy: 75 * u,
        phase: 0,
        size: 100 * u,
        big: false,
        landed: 0,
        chute: kind,
      });
    }
    this.balloonIn -= dt;
    if (this.balloonIn <= 0) {
      this.balloonIn = 5 + Math.random() * 5;
      this.balloons.push({
        x: 60 * u + Math.random() * (this.W - 120 * u),
        y: this.H + 60 * u,
        vy: (50 + Math.random() * 30) * u,
        phase: Math.random() * 6,
        colour: BALLOON_COLOURS[Math.floor(Math.random() * BALLOON_COLOURS.length)],
        r: 44 * u,
      });
    }

    // Treats fall and sway; generous catch box around the drawing.
    const cx0 = this.charX - this.charW * 0.5;
    const cx1 = this.charX + this.charW * 0.5;
    const cy1 = this.ground - this.charY;
    const cy0 = cy1 - this.charH * (this.chute ? 1.8 : 1.05);
    for (let i = this.treats.length - 1; i >= 0; i--) {
      const t = this.treats[i];
      if (t.landed) {
        t.landed += dt;
        if (t.landed > 1.4) this.treats.splice(i, 1);
        continue;
      }
      t.y += t.vy * dt;
      t.phase += dt * 2;
      t.x += Math.sin(t.phase) * 30 * u * dt;
      const r = t.size * 0.45;
      if (t.x + r > cx0 && t.x - r < cx1 && t.y + r > cy0 && t.y - r < cy1) {
        this.treats.splice(i, 1);
        this.caught(t);
        continue;
      }
      if (t.y > this.ground + 10 * u) t.landed = 0.001;
    }

    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      b.y -= b.vy * dt;
      b.phase += dt;
      b.x += Math.sin(b.phase * 1.3) * 20 * u * dt;
      if (b.y < -100 * u) this.balloons.splice(i, 1);
    }

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life > p.max) {
        this.parts.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!p.text) {
        p.vy += 700 * u * dt;
        p.vx *= 1 - dt * 1.5;
      }
      p.spin += dt * 8;
    }

    for (const pl of this.plants) pl.grow = Math.min(1, pl.grow + dt * 2.2);
    for (const cl of this.clouds) {
      cl.x += cl.v * dt;
      if (cl.x > this.W + 150) cl.x = -150;
    }
  }

  /** Upper half rainbow, bands outside-in, centred on (x, y). */
  private rainbowArc(x: number, y: number, r: number, band: number, alpha: number) {
    const c = this.c;
    c.globalAlpha = alpha;
    c.lineWidth = band + 1;
    RAINBOW.forEach((col, i) => {
      c.strokeStyle = col;
      c.beginPath();
      c.arc(x, y, r - band * (i + 0.5), Math.PI, Math.PI * 2);
      c.stroke();
    });
    c.globalAlpha = 1;
  }

  private cloud(x: number, y: number, s: number) {
    const c = this.c;
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(80,110,160,0.35)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x, y, s, 0, Math.PI * 2);
    c.arc(x + s, y + s * 0.2, s * 0.8, 0, Math.PI * 2);
    c.arc(x - s, y + s * 0.25, s * 0.7, 0, Math.PI * 2);
    c.arc(x + s * 0.3, y - s * 0.5, s * 0.7, 0, Math.PI * 2);
    c.fill();
  }

  /** Parachute above the drawing (in the drawing's local space, feet at 0,0). */
  private canopy(kind: Chute, cw: number, ch: number) {
    const c = this.c;
    const open = 1 - (1 - this.chuteOpen) ** 3;
    const w = Math.max(cw * 1.3, ch * 0.75) * open;
    const top = -ch * 1.65;
    const rim = top + w * 0.32;
    // strings to the shoulders
    c.strokeStyle = 'rgba(60,40,70,0.7)';
    c.lineWidth = 2;
    for (const f of [-0.5, -0.17, 0.17, 0.5]) {
      c.beginPath();
      c.moveTo(w * f, rim);
      c.lineTo(cw * f * 0.5, -ch * 0.82);
      c.stroke();
    }
    if (kind === 'rainbow') {
      // a dome of rainbow stripes
      RAINBOW.forEach((col, i) => {
        const k = 1 - i / RAINBOW.length;
        c.fillStyle = col;
        c.beginPath();
        c.ellipse(0, rim, (w / 2) * k, (rim - top) * k, 0, Math.PI, Math.PI * 2);
        c.fill();
      });
    } else if (kind === 'cloud') {
      const s = w * 0.18;
      this.cloud(0, rim - s * 0.6, s);
      this.cloud(-w * 0.28, rim - s * 0.2, s * 0.7);
      this.cloud(w * 0.28, rim - s * 0.2, s * 0.7);
    } else {
      // flower: pink petals around a sunny middle
      const pr = w * 0.16;
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        c.fillStyle = i % 2 ? '#ff70a6' : '#ff4d8d';
        c.beginPath();
        c.arc(Math.cos(a) * w * 0.36, rim + Math.sin(a) * (rim - top) * 0.75, pr, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#ff9ec7';
      c.beginPath();
      c.ellipse(0, rim, w * 0.4, (rim - top) * 0.75, 0, Math.PI, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ffd60a';
      c.beginPath();
      c.arc(0, rim - (rim - top) * 0.35, pr * 0.9, 0, Math.PI * 2);
      c.fill();
    }
  }

  private draw() {
    const { c, W, H, dpr } = this;
    const u = this.unit;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sky (crossfades to the next colour at each milestone).
    const paintSky = (i: number, alpha: number) => {
      const g = c.createLinearGradient(0, 0, 0, this.ground);
      g.addColorStop(0, SKIES[i][0]);
      g.addColorStop(1, SKIES[i][1]);
      c.globalAlpha = alpha;
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    };
    paintSky((this.sky + SKIES.length - 1) % SKIES.length, 1);
    paintSky(this.sky, this.skyMix);
    c.globalAlpha = 1;

    const night =
      this.sky === SKIES.length - 1 ? this.skyMix : this.sky === 0 ? 1 - this.skyMix : 0;
    if (night > 0) {
      for (const s of this.stars) {
        c.globalAlpha = night * (0.5 + 0.4 * Math.sin(this.t * 1.5 + s.p));
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(s.x * W, s.y * H, 2 * u + 1, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }

    // Smiling sun (moon at night).
    const sx = W / 2;
    const sy = 85 * u;
    c.save();
    c.translate(sx, sy);
    c.rotate(this.t * 0.2);
    c.fillStyle = night > 0.5 ? '#fff6c8' : '#ffd23f';
    if (night <= 0.5) {
      for (let i = 0; i < 10; i++) {
        c.rotate((Math.PI * 2) / 10);
        c.beginPath();
        c.moveTo(-8 * u, -58 * u);
        c.lineTo(0, -82 * u);
        c.lineTo(8 * u, -58 * u);
        c.fill();
      }
    }
    c.restore();
    c.fillStyle = night > 0.5 ? '#fff6c8' : '#ffd23f';
    c.beginPath();
    c.arc(sx, sy, 50 * u, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#7a4a00';
    c.lineWidth = 4 * u;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(sx - 16 * u, sy - 8 * u, 3 * u, 0, Math.PI * 2);
    c.arc(sx + 16 * u, sy - 8 * u, 3 * u, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(sx, sy + 4 * u, 20 * u, 0.2 * Math.PI, 0.8 * Math.PI);
    c.stroke();

    // Rainbows across the top (tap them to make them sparkle).
    for (const [i, r] of this.skyRainbows().entries()) {
      const glow = this.skyRainbowGlow[i];
      this.rainbowArc(
        r.x,
        r.y + Math.sin(this.t * 1.2 + i) * 4 * u,
        r.r * (1 + glow * 0.08),
        r.band,
        0.85 + glow * 0.15,
      );
    }

    // Clouds.
    c.fillStyle = 'rgba(255,255,255,0.9)';
    for (const cl of this.clouds) {
      const s = cl.s * u * 60;
      c.beginPath();
      c.arc(cl.x, cl.y, s, 0, Math.PI * 2);
      c.arc(cl.x + s, cl.y + s * 0.2, s * 0.8, 0, Math.PI * 2);
      c.arc(cl.x - s, cl.y + s * 0.25, s * 0.7, 0, Math.PI * 2);
      c.arc(cl.x + s * 0.3, cl.y - s * 0.5, s * 0.7, 0, Math.PI * 2);
      c.fill();
    }

    // Hills + grass.
    const gy = this.ground;
    c.fillStyle = '#7fd36b';
    c.beginPath();
    c.moveTo(0, gy - 30 * u);
    for (let x = 0; x <= W; x += 20) c.lineTo(x, gy - 30 * u - Math.sin(x / 140) * 22 * u);
    c.lineTo(W, H);
    c.lineTo(0, H);
    c.fill();
    const grass = c.createLinearGradient(0, gy, 0, H);
    grass.addColorStop(0, '#5cc04a');
    grass.addColorStop(1, '#3f9e36');
    c.fillStyle = grass;
    c.fillRect(0, gy, W, H - gy);
    c.strokeStyle = '#4fb33f';
    c.lineWidth = 3 * u;
    for (let x = 10; x < W; x += 26 * u) {
      c.beginPath();
      c.moveTo(x, gy + 2);
      c.lineTo(x + 5 * u, gy - 10 * u);
      c.stroke();
    }

    // Garden, back to front.
    const plants = [...this.plants].sort((a, b) => a.y - b.y);
    for (const pl of plants) {
      const s = pl.size * (pl.grow < 1 ? 1 - (1 - pl.grow) ** 3 : 1);
      const sway = Math.sin(this.t * 2 + pl.x * 0.05) * 0.08;
      const spr = emojiSprite(pl.emoji, pl.size);
      c.save();
      c.translate(pl.x, pl.y);
      c.rotate(sway);
      c.drawImage(spr, -s * 0.65, -s * 1.2, s * 1.3, s * 1.3);
      c.restore();
    }

    // Balloons.
    for (const b of this.balloons) {
      c.strokeStyle = 'rgba(60,60,60,0.6)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(b.x, b.y + b.r);
      c.quadraticCurveTo(b.x + Math.sin(b.phase * 3) * 12, b.y + b.r * 1.8, b.x, b.y + b.r * 2.6);
      c.stroke();
      c.fillStyle = b.colour;
      c.beginPath();
      c.ellipse(b.x, b.y, b.r * 0.85, b.r, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.beginPath();
      c.ellipse(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.18, b.r * 0.3, -0.5, 0, Math.PI * 2);
      c.fill();
    }

    // The drawing.
    const ch = this.charH;
    const cw = this.charW;
    const moving = Math.abs(this.charVX) > 20 * u && this.charY === 0;
    const bob = moving ? Math.abs(Math.sin(this.t * 12)) * 10 * u : Math.sin(this.t * 3) * 3 * u;
    const tilt =
      Math.max(-0.25, Math.min(0.25, this.charVX / (2800 * u))) + Math.sin(this.t * 2) * 0.03;
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.beginPath();
    const sh = 1 / (1 + this.charY / (200 * u));
    c.ellipse(this.charX, gy + 4 * u, cw * 0.4 * sh, 10 * u * sh, 0, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(this.charX, gy - this.charY - bob);
    c.rotate(tilt);
    const spinScale = this.spin > 0 ? Math.cos((1 - this.spin) * Math.PI * 4) : 1;
    c.scale((1 + this.squash) * spinScale, 1 - this.squash);
    if (this.chute) this.canopy(this.chute, cw, ch);
    c.drawImage(this.img, -cw / 2, -ch, cw, ch);
    c.restore();
    if (this.happy > 0) {
      c.globalAlpha = this.happy;
      const hs = emojiSprite('💖', 40 * u);
      c.drawImage(
        hs,
        this.charX + cw * 0.35,
        gy - this.charY - ch - 20 * u - (1 - this.happy) * 30 * u,
        44 * u,
        44 * u,
      );
      c.globalAlpha = 1;
    }

    // Treats.
    for (const t of this.treats) {
      if (t.chute) {
        c.save();
        c.translate(t.x, t.y);
        c.globalAlpha = t.landed ? Math.max(0, 1 - t.landed / 1.4) : 1;
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.beginPath();
        c.arc(0, 0, t.size * (0.7 + Math.sin(this.t * 5) * 0.08), 0, Math.PI * 2);
        c.fill();
        c.rotate(Math.sin(this.t * 2) * 0.15);
        if (t.chute === 'rainbow') this.rainbowArc(0, t.size * 0.3, t.size * 0.6, t.size * 0.07, 1);
        else if (t.chute === 'cloud') this.cloud(0, 0, t.size * 0.3);
        else {
          const spr = emojiSprite(t.emoji, t.size);
          c.drawImage(spr, -t.size * 0.65, -t.size * 0.65, t.size * 1.3, t.size * 1.3);
        }
        c.restore();
        continue;
      }
      const spr = emojiSprite(t.emoji, t.size);
      c.save();
      c.translate(t.x, t.y);
      if (t.landed) {
        c.globalAlpha = Math.max(0, 1 - t.landed / 1.4);
      }
      if (t.big) {
        c.rotate(this.t * 1.5);
        c.fillStyle = 'rgba(255,240,120,0.35)';
        c.beginPath();
        c.arc(0, 0, t.size * (0.75 + Math.sin(this.t * 5) * 0.08), 0, Math.PI * 2);
        c.fill();
      } else {
        c.rotate(Math.sin(t.phase) * 0.25);
      }
      c.drawImage(spr, -t.size * 0.65, -t.size * 0.65, t.size * 1.3, t.size * 1.3);
      c.restore();
    }

    // Confetti + floating words.
    for (const p of this.parts) {
      const a = 1 - p.life / p.max;
      c.globalAlpha = Math.max(0, a);
      if (p.text) {
        const s = p.size * (p.life < 0.2 ? 0.5 + p.life * 2.5 : 1);
        c.font = `900 ${s}px "Comic Neue","Comic Sans MS",system-ui,sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineWidth = s * 0.16;
        c.strokeStyle = '#2b1d3a';
        c.lineJoin = 'round';
        c.strokeText(p.text, p.x, p.y);
        c.fillStyle = p.colour;
        c.fillText(p.text, p.x, p.y);
      } else {
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.spin);
        c.fillStyle = p.colour;
        c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        c.restore();
      }
    }
    c.globalAlpha = 1;
  }
}
