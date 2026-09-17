// Thick-marker, deliberately crappy line-art recreation of the "milking the treasury" noun meme (prop 997).
// Run: node scripts/marker-memes/milking-the-treasury.cjs  -> writes milking-the-treasury.svg in cwd.
const fs = require('fs');
const W = 1600, H = 900, SW = 13;
let seed = 23;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const j = a => (rnd() * 2 - 1) * a;
const pick = a => a[Math.floor(rnd() * a.length)];

// resample, jitter, low-frequency warp, overshoot the ends, then smooth
function wob(pts, { closed = false, amp = 5, step = 30, warp = 7, over = 0 } = {}) {
  const src = closed ? [...pts, pts[0]] : pts;
  const out = [];
  const ph = rnd() * 6.28, fr = 0.004 + rnd() * 0.006;
  let dist = 0;
  for (let i = 0; i < src.length - 1; i++) {
    const [x0, y0] = src[i], [x1, y1] = src[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n; const wx = Math.sin(ph + dist * fr) * warp, wy = Math.cos(ph * 1.7 + dist * fr * 1.3) * warp;
      out.push([x0 + (x1 - x0) * t + j(amp) + wx, y0 + (y1 - y0) * t + j(amp) + wy]); dist += len / n;
    }
  }
  if (!closed) {
    const e = src[src.length - 1]; out.push([e[0] + j(amp), e[1] + j(amp)]);
    if (over > 0 && out.length > 1) { // overshoot both ends like a rushed marker
      const a = out[0], b = out[1], n = out.length, y = out[n - 1], z = out[n - 2];
      const d1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, d2 = Math.hypot(y[0] - z[0], y[1] - z[1]) || 1;
      const o1 = rnd() * over, o2 = rnd() * over;
      out.unshift([a[0] - (b[0] - a[0]) / d1 * o1, a[1] - (b[1] - a[1]) / d1 * o1]);
      out.push([y[0] + (y[0] - z[0]) / d2 * o2, y[1] + (y[1] - z[1]) / d2 * o2]);
    }
  }
  const P = closed ? [...out, out[0]] : out;
  const at = i => P[Math.max(0, Math.min(P.length - 1, i))];
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = closed ? P[(i - 1 + P.length - 1) % (P.length - 1)] : at(i - 1), p1 = P[i], p2 = P[i + 1], p3 = closed ? P[(i + 2) % (P.length - 1)] : at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + (closed ? 'Z' : '');
}
const ell = (cx, cy, rx, ry, n = 20, rot = 0) => Array.from({ length: n }, (_, i) => { const a = rot + i / n * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const lump = (pts, a = 12) => pts.map(([x, y]) => [x + j(a), y + j(a)]);   // pre-distort control points

let svg = '';
const path = (d, fill, sw, extra = '') => { svg += `<path d="${d}" fill="${fill}" stroke-width="${sw.toFixed(1)}" ${extra}/>`; };
// stroke: random weight, sometimes retraced with a thinner offset pass
const S = (pts, o = {}) => {
  const sw = (o.sw || SW) * (0.65 + rnd() * 0.9);
  path(wob(pts, { over: o.closed ? 0 : 14, ...o }), o.fill || 'none', sw);
  if (rnd() < 0.2) path(wob(pts.map(([x, y]) => [x + j(3), y + j(3)]), { over: 8, ...o, closed: o.closed }), 'none', sw * 0.4);
};
const L = (x0, y0, x1, y1, o) => S([[x0, y0], [x1, y1]], o);
// white blob: silent white fill for occlusion + an open outline that starts anywhere and overshoots past its start
const B = (pts, o = {}) => {
  path(wob(pts, { closed: true, ...o }), '#fff', 0.1, 'stroke="none"');
  const k = Math.floor(rnd() * pts.length); const ring = [...pts.slice(k), ...pts.slice(0, k + 1)];
  S(ring, { ...o, closed: false, over: 18 });
};
// black scribble fill: outline + one frantic zigzag across the polygon
const F = (pts, o = {}) => {
  if (o.solid) { path(wob(pts, { closed: true, amp: 3, warp: 3 }), '#000', (o.sw || SW) * 0.8); return; }
  const ys = pts.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const zig = []; let dir = 1;
  for (let y = y0 + 6; y < y1; y += 6 + rnd() * 3) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
    if (xs.length < 2) continue; const lo = Math.min(...xs), hi = Math.max(...xs);
    zig.push(dir > 0 ? [lo + j(8), y] : [hi + j(8), y]); zig.push(dir > 0 ? [hi + j(8), y + 3] : [lo + j(8), y + 3]); dir = -dir;
  }
  if (zig.length > 1) path(wob(zig, { amp: 2, warp: 2, step: 60 }), 'none', SW * 0.7);
  S(pts, { ...o, closed: true });
};

// noun noggles, drawn badly: lenses different sizes, pupils wander
function noggles(x, y, s) {
  const lw = s * 1.15;
  const lens = (lx, ly, k) => {
    const w = lw * k, h = s * (0.85 + rnd() * 0.35);
    S(lump(rect(lx, ly, w, h), 6), { closed: true, amp: 3 });
    const px = lx + w * (0.4 + rnd() * 0.2);
    F(lump([[px, ly + 4], [lx + w - 3, ly + 4], [lx + w - 3, ly + h - 4], [px, ly + h - 4]], 3), { solid: true, sw: 5 });
  };
  const l1 = x, l2 = x + lw + s * 0.25;
  lens(l1, y, 0.9 + rnd() * 0.2); lens(l2, y + j(10), 0.9 + rnd() * 0.3);
  L(l1 + lw, y + s * 0.45, l2, y + s * 0.5, { amp: 2 });
  S([[l1, y + s * 0.45], [l1 - s * 0.6, y + s * 0.4], [l1 - s * 0.6, y + s * 1.05]], { amp: 3 });
}
const drop = (x, y, s) => S(lump([[x, y], [x + s * 0.6, y + s], [x, y + s * 1.4], [x - s * 0.6, y + s]], 3), { closed: true, amp: 2, sw: SW * 0.7 });
const fly = (x, y) => { F(ell(x, y, 9, 7, 8), { solid: true, sw: 5 }); S([[x - 14, y - 12], [x + 2, y - 4]], { sw: 4, amp: 1 }); S([[x + 14, y - 12], [x - 2, y - 4]], { sw: 4, amp: 1 }); S([[x + 20, y + 4], [x + 40, y - 10], [x + 30, y + 20], [x + 55, y + 5]], { sw: 3, amp: 3 }); };

// ───────── barn background (sparse, crooked) ─────────
[240, 470, 1090].forEach(x => L(x + j(30), 0, x + j(40), 270 + j(60), { amp: 5 }));
S(lump(rect(640, 20, 330, 120), 15), { closed: true }); L(630, 80, 985, 90);
L(0, 300, 1250, 310, { amp: 6 });                                   // beam
S([[1260, 0], [1250, 560], [1600, 570]], { amp: 6 });               // doorway
S(lump([[1330, 110], [1350, 70], [1400, 60], [1430, 80], [1480, 70], [1520, 100], [1500, 140], [1440, 150], [1380, 145], [1330, 140]], 10), { closed: true, sw: SW * 0.8 });
S(lump([[1470, 380], [1470, 300], [1530, 250], [1590, 300], [1590, 380]], 10), { sw: SW * 0.8 });
S(lump(rect(1512, 320, 36, 60), 5), { closed: true, sw: SW * 0.6 });
L(1280, 470, 1600, 480, { sw: SW * 0.7 }); L(1280, 520, 1600, 515, { sw: SW * 0.7 });
for (let x = 1320; x < 1600; x += 90) L(x, 440 + j(15), x + j(15), 545, { sw: SW * 0.7 });
L(0, 790, 1600, 800, { amp: 6, warp: 6 });                          // floor
for (let x = 30; x < 1600; x += 140) S([[x, 830], [x + 25, 815], [x + 50, 835], [x + 75, 818]], { sw: SW * 0.6 });

// ───────── cow ─────────
function cow(m) { // m = 1 left, -1 right; each one lumped differently so they are not mirror twins
  const X = x => m === 1 ? x : 1600 - x;
  const P = (pts, a = 14) => lump(pts.map(([x, y]) => [X(x), y]), a);
  [[330, 560], [560, 570]].forEach(([x, y]) => B(P([[x, y], [x + 70, y], [x + 80, 785], [x - 10, 780]]), { amp: 5 }));
  S(P([[665, 380], [740, 420], [700, 540]]), { sw: SW * 0.8 }); F(P(ell(705, 555, 22, 28, 10)), { solid: true });
  B(P([[260, 330], [420, 255], [560, 275], [670, 350], [700, 470], [680, 580], [560, 620], [420, 625], [300, 600], [230, 500]], 22), { amp: 6, warp: 10 });
  F(P(ell(470, 340, 75, 45, 12)), {}); F(P(ell(600, 470, 60, 50, 12)), {}); F(P(ell(400, 545, 50, 32, 10)), {});
  // udder: saggy ETH diamond, veiny, five teats
  const ux = 490, uy = 580;
  B(P([[ux, uy], [ux + 95, uy + 100], [ux + 20, uy + 190], [ux - 30, uy + 200], [ux - 90, uy + 100]], 10), { amp: 6 });
  S(P([[ux - 90, uy + 100], [ux, uy + 130], [ux + 95, uy + 100]]), { sw: SW * 0.8 });
  L(X(ux), uy, X(ux - 5), uy + 130, { sw: SW * 0.8 });
  for (let i = 1; i < 3; i++) S(P([[ux - 50 + i * 30, uy + 40 + i * 10], [ux - 40 + i * 30, uy + 80], [ux - 60 + i * 30, uy + 120]]), { sw: 4, amp: 4 });   // veins
  [[ux - 55, uy + 190], [ux - 15, uy + 215], [ux + 25, uy + 205], [ux + 55, uy + 175], [ux - 90, uy + 165]].forEach(([x, y]) => B(P(ell(x, y, 18 + rnd() * 10, 16 + rnd() * 10, 9)), { sw: SW * 0.8, amp: 3 }));
  // horns, ears, head
  S(P([[150, 360], [100, 280], [190, 330]]), {}); S(P([[290, 355], [340, 285], [255, 330]]), {});
  B(P([[100, 450], [30, 420], [40, 500], [100, 500]]), {}); B(P([[330, 450], [400, 425], [390, 500], [330, 495]]), {});
  B(P([[120, 380], [200, 330], [300, 350], [350, 420], [335, 570], [280, 625], [160, 630], [90, 570], [80, 440]], 14), { amp: 6, warp: 9 });
  F(P(ell(180, 380, 60, 28, 10)), {});
  noggles(m === 1 ? 120 : 1600 - 120 - 2 * 92 - 20, 420 + j(20), 80);
  if (m === 1) { B(P(ell(300, 470, 26, 30, 10)), { sw: SW * 0.8 }); F(P(ell(306, 476, 9, 11, 8)), { solid: true, sw: 4 }); }   // one eyeball escaped the noggles
  B(P(ell(215, 565, 100, 45, 14), 8), { amp: 5 });
  F(P(ell(180, 560, 12, 9, 6)), { solid: true, sw: 5 }); F(P(ell(250, 565, 14, 10, 6)), { solid: true, sw: 5 });
  B(P([[200, 600], [240, 600], [255, 660], [225, 690], [195, 660]]), { amp: 4, sw: SW * 0.8 });  // tongue
  L(X(225), 610, X(228), 680, { sw: 4 });
  S(P([[230, 690], [232, 740], [225, 770]]), { sw: 4, amp: 3 });                              // drool
}
cow(1); cow(-1);

// ───────── the noun ─────────
B(lump(rect(720, 665, 160, 30), 6), {}); L(740, 695, 725, 795); L(860, 695, 875, 795);
B(lump([[700, 640], [760, 640], [750, 775], [690, 775]], 8), {}); B(lump([[840, 640], [900, 640], [910, 775], [850, 775]], 8), {});
F(lump([[655, 765], [765, 762], [775, 800], [645, 805]], 6), { solid: true }); F(lump([[835, 762], [945, 765], [955, 805], [825, 800]], 6), { solid: true });
// hairy arms
S([[700, 500], [660, 610], [605, 715], [570, 750]], { sw: SW * 1.4, amp: 6 }); S([[900, 500], [940, 610], [995, 715], [1030, 750]], { sw: SW * 1.4, amp: 6 });
for (let i = 0; i < 7; i++) { const t = 0.15 + i * 0.12; L(700 - 130 * t, 500 + 250 * t, 700 - 130 * t - 18, 500 + 250 * t - 6, { sw: 4, amp: 1 }); L(900 + 130 * t, 500 + 250 * t, 900 + 130 * t + 18, 500 + 250 * t - 6, { sw: 4, amp: 1 }); }
// torso + vest
B(lump([[690, 470], [910, 470], [935, 655], [665, 655]], 12), { amp: 6 });
S([[740, 470], [750, 655]]); S([[860, 470], [850, 655]]);
[525, 590].forEach(y => { L(690, y, 748, y + 6); L(852, y, 918, y - 4); L(690, y + 22, 748, y + 26); L(852, y + 24, 918, y + 18); });
F(lump([[750, 470], [850, 470], [800, 540]], 8), { solid: true });
// claw hands
B(ell(550, 760, 38, 30, 10), {}); B(ell(1050, 760, 38, 30, 10), {});
[[520, 775], [545, 785], [570, 782], [588, 770]].forEach(([x, y]) => S([[x, y], [x - 4, y + 26], [x + 6, y + 34]], { sw: 5, amp: 2 }));
[[1012, 770], [1030, 782], [1055, 785], [1080, 775]].forEach(([x, y]) => S([[x, y], [x + 4, y + 26], [x - 6, y + 34]], { sw: 5, amp: 2 }));
// head
S([[650, 250], [630, 195], [700, 195], [710, 250]]); S([[950, 250], [975, 190], [900, 205], [890, 250]]);
F(lump([[720, 250], [740, 180], [800, 220], [860, 175], [885, 250]], 8), { solid: true });
B(lump([[650, 245], [950, 240], [970, 480], [630, 470]], 14), { amp: 6, warp: 9 });
S([[665, 300], [800, 290], [935, 310]], { sw: SW * 0.8 });
L(660, 285, 700, 270, { sw: 5 }); L(700, 275, 740, 262, { sw: 5 });                 // stray eyebrow hairs
noggles(700, 320, 78);
F(lump(ell(800, 415, 22, 14, 8), 4), { solid: true }); L(790, 428, 785, 450, { sw: 4 }); L(812, 428, 818, 452, { sw: 4 });   // nose + nose hair
// manic mouth: gaping black, crooked teeth, tongue, drool
F(lump([[705, 425], [895, 420], [905, 500], [800, 520], [695, 495]], 8), { solid: true });
for (let x = 725; x < 885; x += 26) { const h = 20 + rnd() * 30; B(lump(rect(x, 428, 20, h), 3), { sw: SW * 0.6, amp: 2 }); }
B(lump([[760, 495], [840, 492], [850, 540], [800, 560], [750, 540]], 6), { sw: SW * 0.8 });
S([[870, 500], [880, 560], [870, 610]], { sw: 4, amp: 3 });
[[615, 300], [985, 330], [600, 380], [1000, 400], [630, 220]].forEach(([x, y]) => drop(x, y, 16 + rnd() * 14));
// milk everywhere
[[455, 800], [1145, 800], [420, 760], [1180, 770], [500, 840], [1100, 850]].forEach(([x, y]) => drop(x, y, 12 + rnd() * 10));
S([[500, 790], [470, 830], [420, 870]], { sw: SW * 0.7 }); S([[1100, 790], [1130, 830], [1180, 870]], { sw: SW * 0.7 });
S([[430, 790], [380, 840], [300, 860]], { sw: SW * 0.5 }); S([[1170, 795], [1230, 845], [1320, 865]], { sw: SW * 0.5 });
[[360, 870], [1250, 875], [300, 880]].forEach(([x, y]) => F(ell(x, y, 8, 6, 6), { solid: true, sw: 4 }));
// flies
fly(300, 250); fly(1150, 700); fly(560, 130); fly(1380, 400);

// ───────── props ─────────
S(ell(80, 40, 28, 22, 10), { closed: true }); L(80, 62, 85, 230); L(15, 232, 145, 228);
[25, 60, 100, 135].forEach(x => L(x, 232, x + j(8), 310 + j(15)));
B(lump(rect(20, 650, 190, 130), 12), { amp: 6 });
for (let y = 685; y < 780; y += 40) S([[35, y], [80, y + 12], [130, y - 8], [195, y + 10]], { sw: SW * 0.6 });
S([[1440, 610], [1410, 550]]); S([[1440, 610], [1480, 555]]);
B(lump(rect(1310, 610, 260, 170), 12), { amp: 6 }); S(lump(rect(1335, 635, 210, 120), 8), { closed: true, sw: SW * 0.7 });
noggles(1385, 665, 42);
L(1570, 690, 1600, 695);

fs.writeFileSync('milking-the-treasury.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><g stroke="#000" stroke-linecap="round" stroke-linejoin="round">${svg}</g></svg>`);
console.log('ok');
