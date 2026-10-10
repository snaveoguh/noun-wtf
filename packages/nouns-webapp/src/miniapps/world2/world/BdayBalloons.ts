// ── Birthday balloons for Bob Burnquist (Oct 10) ─────────────────────────
//
// Party dressing for every mega ramp: clusters of helium balloons tied to
// the drop-in railings, the run-deck scaffold, the kicker and landing sides,
// the arch feet and the quarter-pipe deck, plus two pixel-letter
// "HAPPY BDAY BOB" banners floating on balloons (back of the drop-in and
// back of the QP deck, both readable from either side).
//
// Cheap: per ramp one InstancedMesh for the plain balloons (instance
// colour), one for the noggles-print balloons, one LineSegments for every
// string and one mesh for both banners: four draw calls. The bob / sway is
// computed in onBeforeRender, so off-screen ramps cost nothing. Balloons
// have no collision. Strings are kept out of the ink normals pass (and out
// of the depth buffer) so they stay clean hairlines instead of ink smudges.
//
// When it shows: `bobBdayActive()` — Oct 9–11 local date by default,
// `?bday=bob` forces it on, `?bday=0` forces it off.

import type { MegaRampStations } from './MegaRamp';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { inkExcluded } from '../render/Toon';

/**
 * Birthday window helper (reusable): `?bday=bob` (or `1`/`on`) forces on,
 * `?bday=0` (or `off`) forces off, otherwise on from (month, day) − before
 * to + after days, local date.
 */
export function birthdayActive(
  month: number,
  day: number,
  opts: { key?: string; before?: number; after?: number; now?: Date } = {},
): boolean {
  let q: string | null = null;
  try {
    q = new URLSearchParams(window.location.search).get('bday');
  } catch {
    q = null;
  }
  if (q !== null) {
    const v = q.toLowerCase();
    if (v === '0' || v === 'off' || v === 'false' || v === 'no') return false;
    if (v === '1' || v === 'on' || v === 'true' || (opts.key !== undefined && v === opts.key))
      return true;
  }
  const now = opts.now ?? new Date();
  const y = now.getFullYear();
  const today = new Date(y, now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  // Check this year's and neighbouring years' dates so a window can wrap New Year
  for (const yy of [y - 1, y, y + 1]) {
    const d = new Date(yy, month - 1, day).getTime();
    if (today >= d - (opts.before ?? 1) * DAY && today <= d + (opts.after ?? 1) * DAY) return true;
  }
  return false;
}

/** Bob Burnquist's birthday (Oct 10): Oct 9–11, or forced with `?bday=bob` / `?bday=0`. */
export function bobBdayActive(now?: Date): boolean {
  return birthdayActive(10, 10, { key: 'bob', before: 1, after: 1, now });
}

// ── Textures (shared, built once) ────────────────────────────────────────

/** 5×7 block glyphs for the banner. */
const GLYPHS: Record<string, string[]> = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const BANNER_TEXT = 'HAPPY BDAY BOB';
const LETTER_COLORS = ['#ff2d55', '#1fb7ff', '#ff8a00', '#b04dff', '#e8251c'];

let bannerTex: THREE.CanvasTexture | null = null;
let noggleTex: THREE.CanvasTexture | null = null;

function bannerTexture(): THREE.CanvasTexture {
  if (bannerTex !== null) return bannerTex;
  const cell = 14; // px per glyph pixel
  const gap = 2; // glyph pixels between letters
  const cols = BANNER_TEXT.length * (5 + gap) - gap;
  const pad = 3;
  const W = (cols + pad * 2) * cell;
  const H = (7 + pad * 2) * cell;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // Bunting-yellow banner with a pink scalloped trim
  g.fillStyle = '#ffd21f';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ff7ab8';
  g.fillRect(0, 0, W, cell * 0.9);
  g.fillRect(0, H - cell * 0.9, W, cell * 0.9);
  for (let x = 0; x < W; x += cell * 2) {
    g.beginPath();
    g.arc(x + cell, cell * 0.9, cell * 0.7, 0, Math.PI);
    g.fill();
    g.beginPath();
    g.arc(x + cell, H - cell * 0.9, cell * 0.7, Math.PI, Math.PI * 2);
    g.fill();
  }
  let li = 0;
  for (let i = 0; i < BANNER_TEXT.length; i++) {
    const ch = BANNER_TEXT[i];
    const glyph = GLYPHS[ch] ?? GLYPHS[' '];
    const x0 = (pad + i * (5 + gap)) * cell;
    const y0 = pad * cell;
    if (ch === ' ') continue;
    const col = LETTER_COLORS[li++ % LETTER_COLORS.length];
    // Ink drop shadow, then the coloured pixels: chunky, readable at distance
    for (const [dx, dy, fill] of [
      [cell * 0.35, cell * 0.35, '#0a0812'],
      [0, 0, col],
    ] as const) {
      g.fillStyle = fill;
      glyph.forEach((row, r) => {
        for (let k = 0; k < 5; k++)
          if (row[k] === '1')
            g.fillRect(x0 + k * cell + dx, y0 + r * cell + dy, cell + 0.5, cell + 0.5);
      });
    }
  }
  bannerTex = new THREE.CanvasTexture(c);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  bannerTex.anisotropy = 4;
  return bannerTex;
}

/** Balloon skin with the ⌐◨-◨ noggles printed twice round the equator. */
function noggleTexture(): THREE.CanvasTexture {
  if (noggleTex !== null) return noggleTex;
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const s = 9; // px per noggle pixel; glyph is 16×6
  for (const cx of [W * 0.25, W * 0.75]) {
    const ox = cx - 8 * s;
    const oy = H * 0.5 - 3 * s;
    const px = (x: number, y: number, w: number, h: number, f: string) => {
      g.fillStyle = f;
      g.fillRect(ox + x * s, oy + y * s, w * s, h * s);
    };
    for (const lx of [3, 10]) {
      px(lx, 0, 6, 6, '#e8251c');
      px(lx + 1, 1, 2, 4, '#ffffff');
      px(lx + 3, 1, 2, 4, '#0b0b0b');
    }
    px(9, 2, 1, 1, '#e8251c');
    px(0, 2, 3, 1, '#e8251c');
    px(0, 2, 1, 3, '#e8251c');
  }
  noggleTex = new THREE.CanvasTexture(c);
  noggleTex.colorSpace = THREE.SRGBColorSpace;
  return noggleTex;
}

// ── Geometry ─────────────────────────────────────────────────────────────

/** Unit balloon: egg-shaped sphere (radius 1, slightly narrower at the bottom) + knot; knot tip at y = 0. */
function balloonGeometry(): THREE.BufferGeometry {
  const s = new THREE.SphereGeometry(1, 18, 14);
  const p = s.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 + 0.12 * y; // egg: fuller on top
    p.setXYZ(i, p.getX(i) * k, y * 1.15, p.getZ(i) * k);
  }
  s.computeVertexNormals();
  s.translate(0, 1.15 + 0.12, 0);
  const knot = new THREE.ConeGeometry(0.16, 0.16, 8);
  knot.translate(0, 0.08, 0);
  const m = mergeGeometries([s, knot], false)!;
  s.dispose();
  knot.dispose();
  return m;
}

// ── Balloon layout ───────────────────────────────────────────────────────

const PARTY = [0xff2d2d, 0xffd21f, 0x22d3ff, 0xff7ab8, 0xffffff, 0xe8251c] as const;

interface Balloon {
  tie: THREE.Vector3;
  /** Rest direction of the string (unit, mostly up). */
  dir: THREE.Vector3;
  len: number;
  r: number;
  ph: number;
  freq: number;
  noggles: boolean;
}

export interface BdayDecor {
  object: THREE.Group;
  dispose(): void;
}

/** Deterministic tiny PRNG (per ramp). */
function rng(seed: number) {
  let s = (seed >>> 0) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Add the birthday dressing to a mega ramp group (local frame, see
 * MegaRamp.ts). Returns the decoration group (already a child of `parent`)
 * and a dispose that releases the instanced buffers, strings and the
 * ink-exclusion entry.
 */
export function addBdayBalloons(
  parent: THREE.Object3D,
  st: MegaRampStations,
  dims: {
    width: number;
    topY: number;
    topDeckLen: number;
    runY: number;
    archX: number;
    floorY: number;
    archLeadIn: number;
    archFoot: number;
  },
  seed = 1,
): BdayDecor {
  const rand = rng(seed * 7919 + 17);
  const root = new THREE.Group();
  root.name = 'BdayBalloons';
  const balloons: Balloon[] = [];
  const hw = dims.width / 2 - 0.05;

  const cluster = (
    tie: THREE.Vector3,
    n: number,
    o: {
      lean?: THREE.Vector3;
      len?: [number, number];
      r?: [number, number];
      noggles?: number;
    } = {},
  ) => {
    const [l0, l1] = o.len ?? [1.8, 3.6];
    const [r0, r1] = o.r ?? [0.42, 0.7];
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const spread = 0.15 + rand() * 0.35;
      const dir = new THREE.Vector3(Math.cos(a) * spread, 1, Math.sin(a) * spread);
      if (o.lean !== undefined) dir.add(o.lean);
      dir.normalize();
      balloons.push({
        tie: tie.clone(),
        dir,
        len: l0 + rand() * (l1 - l0),
        r: r0 + rand() * (r1 - r0),
        ph: rand() * Math.PI * 2,
        freq: 0.7 + rand() * 0.6,
        noggles: i < (o.noggles ?? 0),
      });
    }
  };
  const out = (x: number) => new THREE.Vector3(Math.sign(x) * 0.35, 0, 0);

  // Drop-in deck railing posts (front corners; the back corners hold the banner)
  const y0 = dims.topY + 1.05;
  const L = dims.topDeckLen - 0.3;
  for (const x of [-hw, hw]) cluster(new THREE.Vector3(x, y0, L), 5, { lean: out(x), noggles: 1 });
  // Run-deck scaffold tops (sides of the flat run-up)
  for (const x of [-hw, hw])
    cluster(new THREE.Vector3(x, dims.runY, st.runStartZ + 1.5), 3, { lean: out(x) });
  // Kicker sides, just behind the lip
  for (const x of [-hw, hw])
    cluster(new THREE.Vector3(x, st.lipY - 0.4, st.lipZ - 1.2), 4, { lean: out(x), noggles: 1 });
  // Landing deck top corners
  for (const x of [-hw, hw])
    cluster(new THREE.Vector3(x, st.landingY, st.landingStartZ + 0.2), 4, { lean: out(x) });
  // Arch ends (feet), leaning outward so grinders don't ride through them
  const footY = dims.floorY + dims.archFoot;
  for (const z of [st.archStartZ - dims.archLeadIn, st.archEndZ + dims.archLeadIn])
    cluster(new THREE.Vector3(dims.archX, footY, z), 5, {
      lean: new THREE.Vector3(0.5, 0, 0),
      len: [2.2, 3.6],
      noggles: 1,
    });
  // QP deck front corners
  for (const x of [-hw, hw])
    cluster(new THREE.Vector3(x, st.qpLipY, st.qpLipZ + 0.3), 4, { lean: out(x), noggles: 1 });

  // ── Banners: back of the drop-in (facing the run) + back of the QP deck ──
  const bannerW = 8.4;
  const bannerH = bannerW * (13 / (BANNER_TEXT.length * 7 - 2 + 6));
  const banners: { center: THREE.Vector3; yaw: number; base: number; baseZ: number }[] = [
    // Drop-in: high enough to ride under from a bridge behind
    {
      center: new THREE.Vector3(0, dims.topY + 3.6, 0.1),
      yaw: 0,
      base: dims.topY + 1.05,
      baseZ: 0.1,
    },
    // QP deck back edge, faces -Z (toward riders coming down the run)
    {
      center: new THREE.Vector3(0, st.qpLipY + 3.4, st.endZ - 0.2),
      yaw: Math.PI,
      base: st.qpLipY,
      baseZ: st.endZ - 0.2,
    },
  ];
  const bannerParts: THREE.BufferGeometry[] = [];
  const staticLines: number[] = [];
  for (const b of banners) {
    for (const back of [false, true]) {
      // Gentle sag along the top/bottom; two faces so the text reads from both sides
      const g = new THREE.PlaneGeometry(bannerW, bannerH, 16, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const t = p.getX(i) / (bannerW / 2);
        p.setY(i, p.getY(i) - 0.25 * (1 - t * t));
      }
      if (back) g.rotateY(Math.PI);
      g.rotateY(b.yaw);
      g.translate(
        b.center.x,
        b.center.y,
        b.center.z + (back ? -0.01 : 0.01) * (b.yaw === 0 ? 1 : -1),
      );
      g.computeVertexNormals();
      bannerParts.push(g);
    }
    // Banner corners: balloons pull the top up, strings tie the bottom to the deck
    for (const sx of [-1, 1]) {
      const cx = b.center.x + sx * (bannerW / 2) * (b.yaw === 0 ? 1 : -1);
      const top = new THREE.Vector3(cx, b.center.y + bannerH / 2, b.center.z);
      cluster(top, 4, { lean: new THREE.Vector3(sx * 0.3, 0, 0), len: [0.8, 1.8], noggles: 1 });
      const bot = b.center.y - bannerH / 2;
      staticLines.push(cx, bot, b.center.z, Math.sign(cx) * hw, b.base, b.baseZ);
      staticLines.push(cx, b.center.y + bannerH / 2, b.center.z, cx, bot, b.center.z);
    }
  }
  const bannerGeo = mergeGeometries(bannerParts, false)!;
  for (const g of bannerParts) g.dispose();
  const bannerMesh = new THREE.Mesh(
    bannerGeo,
    new THREE.MeshStandardMaterial({ map: bannerTexture(), roughness: 0.8, metalness: 0 }),
  );
  bannerMesh.name = 'BdayBanner';
  bannerMesh.castShadow = true;
  root.add(bannerMesh);

  // ── Instanced balloons ───────────────────────────────────────────────
  const geo = balloonGeometry();
  const plain = balloons.filter(b => !b.noggles);
  const nog = balloons.filter(b => b.noggles);
  const plainMesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0 }),
    plain.length,
  );
  plainMesh.name = 'BdayBalloonsPlain';
  const nogMesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: noggleTexture(),
      roughness: 0.3,
      metalness: 0,
    }),
    Math.max(1, nog.length),
  );
  nogMesh.name = 'BdayBalloonsNoggles';
  nogMesh.count = nog.length;
  const col = new THREE.Color();
  plain.forEach((_, i) =>
    plainMesh.setColorAt(i, col.setHex(PARTY[Math.floor(rand() * PARTY.length)])),
  );
  const nogCols = [0xffd21f, 0xffffff, 0x22d3ff, 0xff7ab8];
  nog.forEach((_, i) => nogMesh.setColorAt(i, col.setHex(nogCols[i % nogCols.length])));
  for (const m of [plainMesh, nogMesh]) {
    m.castShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(m);
  }

  // ── Strings: one LineSegments (2 verts per balloon + static banner ties) ──
  const nDyn = balloons.length * 6;
  const linePos = new Float32Array(nDyn + staticLines.length);
  linePos.set(staticLines, nDyn);
  const lineGeo = new THREE.BufferGeometry();
  const lineAttr = new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage);
  lineGeo.setAttribute('position', lineAttr);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xf2f2f2,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const strings = new THREE.LineSegments(lineGeo, lineMat);
  strings.name = 'BdayStrings';
  root.add(strings);
  inkExcluded.add(strings);

  // ── Animation ────────────────────────────────────────────────────────
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const d = new THREE.Vector3();
  const top = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let last = -1;
  const update = () => {
    const now = performance.now();
    if (Math.abs(now - last) < 4) return; // once per frame (several passes call this)
    last = now;
    const t = now / 1000;
    // Shared gust so neighbours lean together, plus per-balloon wobble
    const gust = 0.12 * Math.sin(t * 0.35) + 0.06 * Math.sin(t * 0.9 + 1.3);
    let pi = 0;
    let ni = 0;
    for (let i = 0; i < balloons.length; i++) {
      const b = balloons[i];
      const w = t * b.freq + b.ph;
      d.copy(b.dir);
      d.x += gust + 0.1 * Math.sin(w) + 0.04 * Math.sin(w * 2.3 + 0.7);
      d.z += 0.6 * gust + 0.1 * Math.cos(w * 0.8 + 1.1);
      d.normalize();
      const len = b.len * (1 + 0.025 * Math.sin(w * 1.4));
      top.copy(b.tie).addScaledVector(d, len);
      q.setFromUnitVectors(UP, d);
      scl.setScalar(b.r);
      mtx.compose(top, q, scl);
      if (b.noggles) nogMesh.setMatrixAt(ni++, mtx);
      else plainMesh.setMatrixAt(pi++, mtx);
      const o = i * 6;
      linePos[o] = b.tie.x;
      linePos[o + 1] = b.tie.y;
      linePos[o + 2] = b.tie.z;
      linePos[o + 3] = top.x;
      linePos[o + 4] = top.y;
      linePos[o + 5] = top.z;
    }
    plainMesh.instanceMatrix.needsUpdate = true;
    nogMesh.instanceMatrix.needsUpdate = true;
    lineAttr.needsUpdate = true;
  };
  update();
  // Fixed bounds (with sway margin) so culling doesn't depend on the current pose
  for (const m of [plainMesh, nogMesh]) {
    m.computeBoundingSphere();
    if (m.boundingSphere !== null) m.boundingSphere.radius += 2;
    m.onBeforeRender = update;
  }
  lineGeo.computeBoundingSphere();
  if (lineGeo.boundingSphere !== null) lineGeo.boundingSphere.radius += 2;
  strings.onBeforeRender = update;

  parent.add(root);
  return {
    object: root,
    dispose() {
      inkExcluded.delete(strings);
      plainMesh.dispose();
      nogMesh.dispose();
      geo.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      bannerGeo.dispose();
      for (const m of [plainMesh, nogMesh, bannerMesh]) (m.material as THREE.Material).dispose();
    },
  };
}
