// ── icecreamvan.eth: 1970s Midland on a Dodge chassis, as a static prop ──
//
// Low-fi port of the procedural three.js model on /icecreamvan (public/
// icecreamvan/index.html). Same silhouette, proportions and livery (white
// ribbed body, pink stripes, DOGE star grille, six headlights, chrome
// bumpers), but flat colours and chunky shapes so it cel-shades and inks like
// the rest of the world. Shown "open for business": rear hatch raised as an
// awning on its struts and stays, slide-out stairs down, counter and sink
// unit visible through the open back.
//
// Plain MeshStandardMaterials throughout; toonify() converts them.

import * as THREE from 'three';

// Source-model constants (metres). The builder works in the source frame —
// x across (negative = driver side seen from behind), y up, z = -distance
// from the rear opening — and the finished body is turned to face +Z.
const FLOOR = 0.8;
const ROOF = 2.85;
const W = 1.24; // half width of the body shell
const IN = 1.18; // half width inside the lining
const REAR_U = -0.12; // rear bumper
const FRONT_U = 6.42; // front bumper
const MID_U = (REAR_U + FRONT_U) / 2;
const HL = ROOF + 0.04 - FLOOR; // hatch length

/** Collision body in van-local space (group origin / axes). */
const BODY_BOX = {
  w: 2 * W,
  h: ROOF + 0.06,
  len: FRONT_U - REAR_U,
};

type Mats = Record<
  | 'skin'
  | 'roof'
  | 'pink'
  | 'glass'
  | 'steel'
  | 'alu'
  | 'chrome'
  | 'tyre'
  | 'hub'
  | 'dark'
  | 'red'
  | 'amber'
  | 'led'
  | 'cab'
  | 'teak'
  | 'vinyl'
  | 'seat'
  | 'copper'
  | 'brass'
  | 'pot'
  | 'plant',
  THREE.MeshStandardMaterial
>;

function flat(color: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra });
}

function makeMats(): Mats {
  return {
    // whites get a little emissive lift so they stay white in the toon mid band
    skin: flat(0xfbfaf5, { emissive: 0x3a3a3a }),
    roof: flat(0xfbfbf8, { emissive: 0x3a3a3a }),
    // flush decal planes (no side faces, so the ink pass leaves them alone)
    pink: flat(0xf5b0c2, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    glass: flat(0x3d7584, { roughness: 0.25, side: THREE.DoubleSide }),
    steel: flat(0x6f7a76),
    alu: flat(0xdfe3e6, { emissive: 0x202020 }),
    chrome: flat(0xdfe5e8, { roughness: 0.3 }),
    tyre: flat(0x232624, { roughness: 0.9 }),
    hub: flat(0xd5dadc, { roughness: 0.35 }),
    dark: flat(0x2b302e, { roughness: 0.8 }),
    red: flat(0xc02a1d, { emissive: 0x400a05 }),
    amber: flat(0xf0a030, { emissive: 0x5a3000 }),
    led: flat(0xfff2c8, { emissive: 0xffd88a, emissiveIntensity: 0.9 }),
    // interior pieces glow warm, standing in for the van's ceiling lamp
    cab: flat(0xfaf8f2, { emissive: 0x4a4030 }),
    teak: flat(0xa8683a, { emissive: 0x2a1a0e }),
    vinyl: flat(0xbdb7a6, { roughness: 0.85, emissive: 0x2e2a22 }),
    seat: flat(0x3c4a52, { roughness: 0.85 }),
    copper: flat(0xb8683a),
    brass: flat(0xcfa64e),
    pot: flat(0xb5623a, { roughness: 0.8 }),
    plant: flat(0x3d8c47, { roughness: 0.7 }),
  };
}

function shade<T extends THREE.Object3D>(o: T): T {
  o.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return o;
}

/** Axis-aligned box in source coords: x, y, and distance-from-rear d. */
function box(
  parent: THREE.Object3D,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  d0: number,
  d1: number,
  m: THREE.Material,
): THREE.Mesh {
  const me = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, d1 - d0), m);
  me.position.set((x0 + x1) / 2, (y0 + y1) / 2, -(d0 + d1) / 2);
  parent.add(me);
  return me;
}

function cyl(
  parent: THREE.Object3D,
  r: number,
  len: number,
  seg: number,
  m: THREE.Material,
): THREE.Mesh {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
  parent.add(me);
  return me;
}

/** Stretch a unit-height Y cylinder between two points. */
const UP = new THREE.Vector3(0, 1, 0);
function rod(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number,
  m: THREE.Material,
) {
  const d = new THREE.Vector3().subVectors(b, a);
  const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8), m);
  me.scale.set(1, d.length(), 1);
  me.position.copy(a).addScaledVector(d, 0.5);
  me.quaternion.setFromUnitVectors(UP, d.normalize());
  parent.add(me);
}

function canvasTex(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g !== null) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Front face: two-piece windscreen, DOGE letters, star grille, six lamps. */
function frontTexture(): THREE.CanvasTexture {
  // drawn in the source's 1240×1075 coordinate space at half resolution
  return canvasTex(620, 538, g => {
    g.scale(0.5, 0.5);
    g.fillStyle = '#f3f2ec';
    g.fillRect(0, 0, 1240, 1075);
    g.fillStyle = '#111619';
    g.fillRect(0, 0, 1240, 40);
    // windscreen
    g.fillStyle = '#3d7584';
    g.fillRect(14, 40, 600, 480);
    g.fillRect(626, 40, 600, 480);
    g.strokeStyle = '#0c0f10';
    g.lineWidth = 18;
    g.strokeRect(14, 40, 600, 480);
    g.strokeRect(626, 40, 600, 480);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.beginPath();
    g.moveTo(40, 60);
    g.lineTo(220, 60);
    g.lineTo(60, 500);
    g.lineTo(40, 500);
    g.fill();
    g.beginPath();
    g.moveTo(650, 60);
    g.lineTo(830, 60);
    g.lineTo(670, 500);
    g.lineTo(650, 500);
    g.fill();
    // grille panel + DOGE
    g.strokeStyle = '#1b1f22';
    g.lineWidth = 8;
    g.strokeRect(400, 530, 440, 345);
    g.fillStyle = '#2b3036';
    g.font = '900 56px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const L = 'DOGE';
    for (let i = 0; i < L.length; i++) g.fillText(L[i], 620 + (i - (L.length - 1) / 2) * 64, 574);
    for (let y = 615; y < 860; y += 36) {
      g.fillStyle = '#2c3550';
      g.fillRect(410, y, 125, 20);
      g.fillRect(705, y, 125, 20);
    }
    const pent = (r: number) => {
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
        g.lineTo(620 + r * Math.cos(a), 740 + r * Math.sin(a));
      }
      g.closePath();
    };
    pent(128);
    g.fillStyle = '#c9cdd0';
    g.fill();
    pent(108);
    g.fillStyle = '#2b3138';
    g.fill();
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const r = k % 2 === 1 ? 40 : 104;
      g.lineTo(620 + r * Math.cos(a), 740 + r * Math.sin(a));
    }
    g.closePath();
    g.fillStyle = '#eef0f2';
    g.fill();
    g.strokeStyle = '#1b1f22';
    g.lineWidth = 6;
    g.stroke();
    // indicators
    g.fillStyle = '#e8781c';
    g.fillRect(110, 760, 150, 40);
    g.fillRect(980, 760, 150, 40);
    // six headlights
    [150, 270, 360, 880, 970, 1090].forEach(x => {
      g.fillStyle = '#1b1f22';
      g.beginPath();
      g.arc(x, 925, 56, 0, 7);
      g.fill();
      g.fillStyle = '#c4cacd';
      g.beginPath();
      g.arc(x, 925, 48, 0, 7);
      g.fill();
      g.fillStyle = '#fbf6dc';
      g.beginPath();
      g.arc(x, 925, 36, 0, 7);
      g.fill();
    });
  });
}

/** Side profile: u = distance from rear, v = height, with both wheel arches. */
function profile(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0.42);
  s.lineTo(0, ROOF);
  s.lineTo(6.05, ROOF);
  s.quadraticCurveTo(6.25, ROOF, 6.25, 2.55);
  s.lineTo(6.3, 1.6);
  s.lineTo(6.3, 0.55);
  s.lineTo(6.25, 0.42);
  s.lineTo(5.62, 0.42);
  s.absarc(5.12, 0.36, 0.5, 0.12, Math.PI - 0.12, false);
  s.lineTo(2.37, 0.42);
  s.absarc(1.87, 0.36, 0.5, 0.12, Math.PI - 0.12, false);
  s.lineTo(0, 0.42);
  return s;
}

type Win = [number, number, number, number]; // u0, u1, v0, v1
const WIN_L: Win[] = [
  [0.3, 1.25, 1.75, 2.21],
  [1.95, 3.5, 1.75, 2.21],
  [4.59, 5.84, 1.75, 2.25],
];
const WIN_R: Win[] = [
  [0.23, 1.18, 1.75, 2.21],
  [1.935, 3.54, 1.75, 2.21],
  [4.59, 5.84, 1.75, 2.25],
];

// Side livery painted into the wall texture rather than modelled as raised
// strips: thin proud geometry turns solid black under the ink pass.
const LIV_U = 6.4; // metres covered by the texture along the body
const LIV_V = 3.2; // ...and up the side
const LIV_PX = 160; // pixels per metre
const PINK = '#f2a2b6';

function liveryMaterial(M: Mats, wins: Win[]): THREE.MeshStandardMaterial {
  const t = canvasTex(LIV_U * LIV_PX, LIV_V * LIV_PX, (g, w, h) => {
    const X = (u: number) => u * LIV_PX;
    const Y = (v: number) => h - v * LIV_PX;
    g.fillStyle = '#fbfaf5';
    g.fillRect(0, 0, w, h);
    // faint horizontal ribs of the aluminium siding
    g.fillStyle = '#eceae2';
    for (let v = 0.5; v < ROOF; v += 0.11) g.fillRect(0, Y(v), w, 3);
    // the two pink pinstripes
    g.fillStyle = PINK;
    g.fillRect(X(0.12), Y(1.6), X(5.9), 0.1 * LIV_PX);
    g.fillRect(X(0.12), Y(1.45), X(5.9), 0.05 * LIV_PX);
    // pink window surrounds
    const f = 0.06;
    for (const [u0, u1, v0, v1] of wins) {
      g.fillRect(X(u0 - f), Y(v1 + f), X(u1 - u0 + 2 * f), (v1 - v0 + 2 * f) * LIV_PX);
    }
    // dark rocker strip along the sill
    g.fillStyle = '#c9c8c0';
    g.fillRect(0, Y(0.62), w, 0.2 * LIV_PX);
  });
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(1 / LIV_U, 1 / LIV_V);
  const m = M.skin.clone();
  m.map = t;
  m.color.set(0xffffff);
  return m;
}

function wall(v: THREE.Group, M: Mats, side: -1 | 1, wins: Win[]) {
  const s = profile();
  for (const w of wins) {
    const p = new THREE.Path();
    p.moveTo(w[0], w[2]);
    p.lineTo(w[0], w[3]);
    p.lineTo(w[1], w[3]);
    p.lineTo(w[1], w[2]);
    p.lineTo(w[0], w[2]);
    s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false, curveSegments: 8 });
  // caps get shape-space UVs (metres), so the livery is painted straight on
  const m = new THREE.Mesh(g, [liveryMaterial(M, wins), M.skin]);
  m.rotation.y = Math.PI / 2;
  m.position.x = side < 0 ? -W : W - 0.04;
  v.add(m);
  const sx = side * W;
  for (const w of wins) {
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(w[1] - w[0], w[3] - w[2]), M.glass);
    gl.rotation.y = (side * Math.PI) / 2;
    gl.position.set(side * (W - 0.025), (w[2] + w[3]) / 2, -(w[0] + w[1]) / 2);
    v.add(gl);
  }
  // amber side marker up front, red at the back
  box(v, sx, sx + side * 0.03, 0.82, 0.92, 6.0, 6.1, M.amber);
  box(v, sx, sx + side * 0.03, 0.55, 0.65, 0.12, 0.2, M.red);
  // big black wing mirror
  const mx = side * (W + 0.17);
  box(v, Math.min(sx, mx), Math.max(sx, mx), 2.02, 2.06, 6.12, 6.16, M.dark);
  box(v, mx - 0.05, mx + 0.05, 1.78, 2.22, 6.08, 6.2, M.dark);
}

/**
 * Builds icecreamvan.eth as a static, cel-shade-ready prop.
 *
 * Origin: centre of the body footprint on the ground (y = 0 at tyre
 * contact). Long axis along +Z with the cab/front toward +Z; the open
 * serving end (rear) faces −Z. Metres.
 *
 * Overall dimensions:
 * - body: 6.54 m long (bumper to bumper, z −3.27…+3.27) × 2.48 m wide
 *   (x ±1.24; wing mirrors reach ±1.46) × 3.17 m tall (roof 2.91, A/C pods 3.17)
 * - wheelbase 3.25 m, tyres Ø0.74 m, floor height 0.80 m
 * - the open rear hatch/awning projects a further ~2.1 m behind the body
 *   (to z ≈ −5.4, at 2.9 m height) on two ground stays, and the slide-out
 *   stairs ~0.8 m (to z ≈ −4.0)
 */
export function buildIceCreamVan(): THREE.Group {
  const M = makeMats();
  const root = new THREE.Group();
  root.name = 'IceCreamVan';
  // v holds everything in the source frame; turned to face +Z at the end
  const v = new THREE.Group();
  root.add(v);

  // ── shell ──
  wall(v, M, -1, WIN_L);
  wall(v, M, 1, WIN_R);
  // side door (right / kerb side) with its little window and handle
  box(v, W, W + 0.015, 0.45, 2.49, 3.7, 4.46, M.skin);
  box(v, W + 0.015, W + 0.02, 1.78, 2.21, 3.82, 4.17, M.glass);
  box(v, W + 0.015, W + 0.05, 1.25, 1.33, 4.3, 4.4, M.chrome);

  // roof, front cap, A/C pods, marker lights
  box(v, -W, W, ROOF, ROOF + 0.06, 0, 6.08, M.roof);
  box(v, -W, W, 2.6, ROOF + 0.06, 5.95, 6.31, M.skin);
  box(v, -0.42, 0.42, ROOF + 0.06, ROOF + 0.32, 1.3, 2.2, M.roof);
  box(v, -0.38, 0.38, ROOF + 0.06, ROOF + 0.22, 2.9, 3.6, M.roof);
  for (const x of [-0.9, 0, 0.9]) box(v, x - 0.05, x + 0.05, 2.72, 2.79, 6.31, 6.34, M.amber);

  // front: lower panel, painted face, chrome bumper
  box(v, -W, W, 0.45, 1.6, 6.24, 6.3, M.skin);
  const fr = new THREE.Mesh(
    new THREE.PlaneGeometry(2.48, 2.15),
    new THREE.MeshStandardMaterial({ map: frontTexture(), roughness: 0.5 }),
  );
  fr.rotation.y = Math.PI;
  fr.position.set(0, 1.525, -6.315);
  v.add(fr);
  box(v, -1.3, 1.3, 0.38, 0.6, 6.28, FRONT_U, M.chrome);

  // underbody + wheels
  box(v, -0.55, 0.55, 0.3, 0.42, 0.2, 6.1, M.dark);
  box(v, -W, W, 0.36, 0.45, 0.05, 6.2, M.dark);
  for (const [u, x] of [
    [1.87, 1.0],
    [5.12, 1.03],
  ] as const) {
    for (const s of [-1, 1]) {
      const t = cyl(v, 0.37, 0.26, 14, M.tyre);
      t.rotation.z = Math.PI / 2;
      t.position.set(s * x, 0.37, -u);
      const hb = cyl(v, 0.21, 0.32, 12, M.hub);
      hb.rotation.z = Math.PI / 2;
      hb.position.copy(t.position);
    }
  }

  // ── rear: ring frame, lower panel, lights, bumper ──
  box(v, -W, -1.1, FLOOR, ROOF, 0, 0.08, M.steel);
  box(v, 1.1, W, FLOOR, ROOF, 0, 0.08, M.steel);
  box(v, -W, W, 2.72, ROOF, 0, 0.08, M.steel);
  box(v, -W, W, 0.42, FLOOR, 0, 0.04, M.skin);
  const rs = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 0.08), M.pink);
  rs.position.set(0, 0.65, 0.002);
  v.add(rs);
  box(v, -1.2, -0.98, 0.47, 0.75, -0.015, 0, M.red);
  box(v, 0.98, 1.2, 0.47, 0.75, -0.015, 0, M.red);
  box(v, -0.42, 0.42, 0.44, 0.6, -0.01, 0, M.dark);
  box(v, -1.3, 1.3, 0.3, 0.42, REAR_U, 0.06, M.chrome);

  // ── hatch, raised flat as an awning ──
  const hinge = new THREE.Group();
  hinge.position.set(0, ROOF + 0.04, 0.02);
  hinge.rotation.x = -Math.PI / 2;
  v.add(hinge);
  const hp = new THREE.Mesh(new THREE.BoxGeometry(2.48, HL, 0.05), [
    M.skin,
    M.skin,
    M.skin,
    M.skin,
    M.skin, // outer face (now the top)
    M.alu, // inner face (now the ceiling of the awning)
  ]);
  hp.position.set(0, -HL / 2, 0.025);
  hinge.add(hp);
  const hbox = (y0: number, y1: number, x0: number, x1: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), m);
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2 - (ROOF + 0.04), 0.052);
    hinge.add(b);
  };
  hbox(1.5, 1.6, -W, W, M.pink);
  hbox(1.4, 1.45, -W, W, M.pink);
  hbox(1.7, 2.3, -0.85, 0.85, M.glass);
  const led = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.02), M.led);
  led.position.set(0, -HL + 0.12, -0.01);
  hinge.add(led);
  box(v, -W, W, ROOF + 0.01, ROOF + 0.07, -0.06, 0.03, M.alu); // hinge bar
  v.updateMatrixWorld(true);
  for (const s of [-1, 1]) {
    // gas struts from the frame to the hatch underside
    const a = new THREE.Vector3(s * 1.17, 2.2, 0.05);
    const b = hinge.localToWorld(new THREE.Vector3(s * 1.17, -0.8, 0.0));
    rod(v, a, b, 0.025, M.chrome);
    // ground stays at the awning's outer corners
    const c = hinge.localToWorld(new THREE.Vector3(s * 1.18, -HL + 0.06, 0));
    rod(v, c, new THREE.Vector3(c.x, 0, c.z), 0.03, M.chrome);
  }

  // ── slide-out stairs ──
  for (let i = 1; i <= 3; i++) {
    const tr = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.25), M.alu);
    tr.position.set(0, FLOOR - 0.2 * i, 0.25 * i - 0.11);
    v.add(tr);
  }
  for (const x of [-0.42, 0.42]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 1.15), M.steel);
    st.position.set(x, 0.38, 0.5);
    st.rotation.x = Math.atan2(FLOOR - 0.02, 0.95);
    v.add(st);
  }

  // ── interior (what you see through the open back) ──
  box(v, -IN, IN, FLOOR - 0.03, FLOOR + 0.003, 0, 6.2, M.vinyl);
  box(v, -IN, IN, 2.76, 2.78, 0, 6.06, M.cab);
  // driver-side sink unit with a copper basin and brass tap
  box(v, -IN, -0.58, FLOOR, FLOOR + 0.1, 0.95, 2.1, M.dark);
  box(v, -IN, -0.58, FLOOR + 0.1, 1.7, 0.9, 2.1, M.cab);
  box(v, -IN, -0.55, 1.7, 1.735, 0.88, 2.12, M.teak);
  const basin = cyl(v, 0.2, 0.02, 16, M.copper);
  basin.position.set(-0.87, 1.74, -1.5);
  rod(v, new THREE.Vector3(-1.12, 1.735, -1.5), new THREE.Vector3(-1.12, 2.1, -1.5), 0.02, M.brass);
  rod(v, new THREE.Vector3(-1.12, 2.1, -1.5), new THREE.Vector3(-0.94, 2.02, -1.5), 0.02, M.brass);
  // serving counter across the back, walk-in gap on the driver side
  box(v, -0.42, IN, FLOOR + 0.003, FLOOR + 0.11, 0.15, 0.7, M.dark);
  box(v, -0.42, IN, FLOOR + 0.11, 1.75, 0.1, 0.7, M.cab);
  box(v, -0.46, IN, 1.75, 1.785, 0.05, 0.72, M.teak);
  box(v, 0.1, 0.45, 1.785, 1.81, 0.25, 0.55, M.teak);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.16, 10), M.pot);
  pot.position.set(0.95, 1.865, -0.45);
  v.add(pot);
  const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), M.plant);
  bush.scale.set(1, 1.35, 1);
  bush.position.set(0.95, 2.06, -0.45);
  v.add(bush);
  // cab: seats, dash, wheel
  for (const [x0, x1] of [
    [-0.85, -0.35],
    [0.35, 0.85],
  ] as const) {
    box(v, x0, x1, FLOOR, 1.25, 4.85, 5.35, M.seat);
    box(v, x0, x1, 1.25, 2.0, 4.85, 4.98, M.seat);
  }
  box(v, -IN, IN, FLOOR, 1.45, 5.8, 6.24, M.dark);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 16), M.dark);
  sw.position.set(-0.6, 1.45, -5.6);
  sw.rotation.x = -1.0;
  v.add(sw);

  // turn the source frame (front at −z, rear opening at z = 0) to face +Z,
  // centred on the body footprint
  v.rotation.y = Math.PI;
  v.position.z = -MID_U;
  shade(root);
  return root;
}

/**
 * An invisible box matching the van body (bumper to bumper, ground to roof)
 * for the collision BVH. Call after the group is positioned in the scene:
 * the returned mesh is unparented with the group's world transform baked
 * into its own position/rotation/scale (matrixWorld is up to date).
 */
export function iceCreamVanCollisionBox(group: THREE.Object3D): THREE.Mesh {
  group.updateWorldMatrix(true, false);
  const geo = new THREE.BoxGeometry(BODY_BOX.w, BODY_BOX.h, BODY_BOX.len);
  geo.translate(0, BODY_BOX.h / 2, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  mesh.name = 'col_IceCreamVan';
  group.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.updateMatrixWorld(true);
  return mesh;
}
