// Thick-marker line-art recreation of the "milking the treasury" noun meme (prop 997).
// Run: node scripts/marker-memes/milking-the-treasury.cjs  -> writes milking-the-treasury.svg in cwd.
// Black wobbly strokes on white, kid-drawing style. Writes milking-the-treasury.svg
const fs = require('fs');
const W = 1600, H = 900, SW = 13;
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const j = a => (rnd() * 2 - 1) * a;

// resample a polyline every `step` px, jitter, then smooth (Catmull-Rom -> cubic)
function wob(pts, { closed = false, amp = 4, step = 38 } = {}) {
  const src = closed ? [...pts, pts[0]] : pts;
  const out = [];
  for (let i = 0; i < src.length - 1; i++) {
    const [x0, y0] = src[i], [x1, y1] = src[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k++) { const t = k / n; out.push([x0 + (x1 - x0) * t + j(amp), y0 + (y1 - y0) * t + j(amp)]); }
  }
  if (!closed) out.push([src[src.length - 1][0] + j(amp), src[src.length - 1][1] + j(amp)]);
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
const ell = (cx, cy, rx, ry, n = 24, rot = 0) => Array.from({ length: n }, (_, i) => { const a = rot + i / n * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

let svg = '';
const S = (pts, o = {}) => { svg += `<path d="${wob(pts, o)}" fill="${o.fill || 'none'}" stroke-width="${o.sw || SW}"/>`; };
const F = (pts, o = {}) => S(pts, { ...o, fill: '#000' });   // solid black blob
const L = (x0, y0, x1, y1, o) => S([[x0, y0], [x1, y1]], o);

// noun noggles: two boxes, bridge, left arm; right half of each lens solid black
function noggles(x, y, s, mirror = false) { // s = lens height
  const lw = s * 1.15, m = mirror ? -1 : 1;
  const lens = (lx) => {
    S(rect(lx, y, lw, s), { closed: true, amp: 2 });
    F([[lx + lw * 0.5, y + 2], [lx + lw - 2, y + 2], [lx + lw - 2, y + s - 2], [lx + lw * 0.5, y + s - 2]], { closed: true, amp: 1, sw: 4 });
  };
  const l1 = x, l2 = x + lw + s * 0.25;
  lens(l1); lens(l2);
  L(l1 + lw, y + s * 0.45, l2, y + s * 0.45, { amp: 1 });
  L(l1, y + s * 0.45, l1 - s * 0.55, y + s * 0.45, { amp: 1 });
  L(l1 - s * 0.55, y + s * 0.45, l1 - s * 0.55, y + s * 0.95, { amp: 1 });
}
const drop = (x, y, s) => S([[x, y], [x + s * 0.6, y + s], [x, y + s * 1.4], [x - s * 0.6, y + s]], { closed: true, amp: 1, sw: SW * 0.7 });


const B = (pts, o = {}) => S(pts, { ...o, closed: true, fill: '#fff' });   // white-filled blob (occludes)

// ───────── barn background (sparse) ─────────
[240, 470, 1090].forEach(x => L(x, 0, x + j(10), 270 + j(30), { amp: 3 }));
S(rect(640, 20, 330, 120), { closed: true, amp: 3 }); L(640, 80, 970, 80, { amp: 3 });
L(0, 300, 1250, 300, { amp: 3 });                                   // beam
// doorway right
S([[1260, 0], [1260, 560], [1600, 560]], { amp: 3 });
S([[1330, 110], [1350, 70], [1400, 60], [1430, 80], [1480, 70], [1520, 100], [1500, 140], [1440, 150], [1380, 145], [1330, 140]], { closed: true, amp: 3, sw: SW * 0.8 }); // cloud
S([[1470, 380], [1470, 300], [1530, 250], [1590, 300], [1590, 380]], { amp: 3, sw: SW * 0.8 });          // barn
S(rect(1512, 320, 36, 60), { closed: true, amp: 2, sw: SW * 0.6 });
L(1280, 470, 1600, 470, { amp: 3, sw: SW * 0.7 }); L(1280, 520, 1600, 520, { amp: 3, sw: SW * 0.7 });     // fence
for (let x = 1320; x < 1600; x += 90) L(x, 440, x, 545, { amp: 2, sw: SW * 0.7 });
// floor
L(0, 790, 1600, 790 + j(8), { amp: 4 });
for (let x = 30; x < 1600; x += 140) S([[x, 830], [x + 25, 815], [x + 50, 835], [x + 75, 818]], { amp: 3, sw: SW * 0.6 });

// ───────── cow ─────────
function cow(m) { // m = 1 left cow, -1 right cow (mirrored around x=800)
  const X = x => m === 1 ? x : 1600 - x;
  const P = pts => pts.map(([x, y]) => [X(x), y]);
  // legs first (behind body): two fat U legs
  [[330, 560], [560, 570]].forEach(([x, y]) => B(P([[x, y], [x + 70, y], [x + 65, 780], [x + 5, 780]]), { amp: 3 }));
  // tail
  S(P([[665, 380], [720, 430], [700, 520]]), { amp: 4, sw: SW * 0.8 }); F(P(ell(705, 535, 18, 22, 10)), { closed: true, amp: 2 });
  // body (big blob)
  B(P([[260, 330], [420, 265], [560, 275], [660, 350], [690, 470], [670, 570], [560, 610], [420, 615], [300, 590], [240, 500]]), { amp: 5 });
  F(P(ell(470, 340, 70, 40, 14)), { closed: true, amp: 5 });
  F(P(ell(600, 470, 55, 45, 14)), { closed: true, amp: 5 });
  F(P(ell(400, 540, 45, 30, 12)), { closed: true, amp: 4 });
  // udder = ETH diamond hanging off the rear underside
  const ux = 490, uy = 590;
  B(P([[ux, uy], [ux + 75, uy + 90], [ux, uy + 150], [ux - 75, uy + 90]]), { amp: 3 });
  S(P([[ux - 75, uy + 90], [ux, uy + 115], [ux + 75, uy + 90]]), { amp: 3, sw: SW * 0.8 });
  L(X(ux), uy, X(ux), uy + 115, { amp: 2, sw: SW * 0.8 });
  [[ux - 38, uy + 150], [ux + 38, uy + 150], [ux, uy + 168]].forEach(([x, y]) => B(P(ell(x, y, 22, 18, 10)), { amp: 2, sw: SW * 0.8 }));
  // horns + ears (behind head)
  S(P([[150, 360], [110, 300], [185, 330]]), { amp: 2 }); S(P([[290, 355], [330, 295], [255, 330]]), { amp: 2 });
  B(P([[100, 450], [40, 430], [45, 490], [100, 495]]), { amp: 3 }); B(P([[330, 450], [390, 430], [385, 490], [330, 495]]), { amp: 3 });
  // head
  B(P([[120, 380], [200, 340], [300, 350], [340, 420], [330, 560], [280, 610], [160, 615], [95, 560], [90, 440]]), { amp: 4 });
  F(P(ell(180, 380, 55, 25, 10)), { closed: true, amp: 4 });                                             // head patch
  noggles(m === 1 ? 120 : 1600 - 120 - 2 * 92 - 20, 420, 80, m === -1);
  B(P(ell(215, 560, 95, 40, 16)), { amp: 3 });                                                           // muzzle
  F(P(ell(180, 560, 10, 8, 6)), { closed: true, amp: 1 }); F(P(ell(250, 560, 10, 8, 6)), { closed: true, amp: 1 });
}
cow(1); cow(-1);

// ───────── the noun ─────────
// stool (behind)
B(rect(720, 665, 160, 30), { amp: 3 }); L(740, 695, 732, 790, { amp: 3 }); L(860, 695, 868, 790, { amp: 3 });
// legs + shoes
B([[700, 640], [760, 640], [755, 770], [695, 770]], { amp: 3 }); B([[840, 640], [900, 640], [905, 770], [845, 770]], { amp: 3 });
F([[660, 765], [760, 762], [768, 795], [655, 800]], { closed: true, amp: 3 }); F([[840, 762], [940, 765], [945, 800], [832, 795]], { closed: true, amp: 3 });
// arms (behind torso) out to the teats
S([[700, 500], [665, 610], [610, 715], [575, 748]], { amp: 4, sw: SW * 1.3 }); S([[900, 500], [935, 610], [990, 715], [1025, 748]], { amp: 4, sw: SW * 1.3 });
// torso + hi-vis vest
B([[690, 470], [910, 470], [925, 650], [675, 650]], { amp: 4 });
S([[740, 470], [745, 650]], { amp: 2 }); S([[860, 470], [855, 650]], { amp: 2 });
[525, 590].forEach(y => { L(690, y, 743, y + 2, { amp: 1 }); L(857, y, 912, y + 2, { amp: 1 }); L(690, y + 22, 743, y + 24, { amp: 1 }); L(857, y + 22, 912, y + 24, { amp: 1 }); });
F([[750, 470], [850, 470], [800, 530]], { closed: true, amp: 2 });                                                            // black tee at neck
// hands
B(ell(555, 758, 34, 26, 12), { amp: 3 }); B(ell(1045, 758, 34, 26, 12), { amp: 3 });
[[535, 772], [555, 780], [575, 776]].forEach(([x, y]) => L(x, y, x + 3, y + 16, { amp: 1, sw: SW * 0.6 }));
[[1025, 772], [1045, 780], [1065, 776]].forEach(([x, y]) => L(x, y, x + 3, y + 16, { amp: 1, sw: SW * 0.6 }));
// head (bear-ish), ears + tuft behind
S([[650, 250], [640, 205], [700, 200], [705, 250]], { amp: 3 }); S([[950, 250], [960, 205], [900, 200], [895, 250]], { amp: 3 });
F([[720, 250], [745, 190], [800, 215], [850, 190], [880, 250]], { closed: true, amp: 3 });
B([[650, 245], [950, 245], [960, 470], [640, 470]], { amp: 5 });
S([[665, 300], [935, 300]], { amp: 2, sw: SW * 0.8 });                                                                           // brow
noggles(700, 320, 78);
F(ell(800, 415, 18, 12, 8), { closed: true, amp: 1 });                                                                          // nose
S(rect(715, 425, 170, 35), { closed: true, amp: 2 }); for (let x = 745; x < 885; x += 30) L(x, 425, x, 460, { amp: 1, sw: SW * 0.7 }); // teeth
drop(615, 300, 22); drop(985, 330, 22); drop(600, 380, 18);
// milk
drop(455, 800, 16); drop(1145, 800, 16);
S([[500, 790], [480, 830], [440, 860]], { amp: 3, sw: SW * 0.7 }); S([[1100, 790], [1120, 830], [1160, 860]], { amp: 3, sw: SW * 0.7 });

// ───────── props ─────────
S(ell(80, 40, 28, 22, 12), { closed: true, amp: 2 }); L(80, 62, 80, 230, { amp: 3 }); L(20, 230, 140, 230, { amp: 3 });   // pitchfork
[25, 60, 100, 135].forEach(x => L(x, 232, x - 3, 310, { amp: 2 }));
B(rect(20, 650, 190, 130), { amp: 5 });                                                                                // hay bale
for (let y = 685; y < 780; y += 40) S([[35, y], [80, y + 12], [130, y - 8], [195, y + 10]], { amp: 4, sw: SW * 0.6 });
S([[1440, 610], [1420, 560]], { amp: 2 }); S([[1440, 610], [1475, 560]], { amp: 2 });
B(rect(1310, 610, 260, 170), { amp: 4 }); S(rect(1335, 635, 210, 120), { closed: true, amp: 3, sw: SW * 0.7 }); // tv
noggles(1385, 665, 42);
L(1570, 690, 1600, 690, { amp: 2 });

fs.writeFileSync('milking-the-treasury.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><g stroke="#000" stroke-linecap="round" stroke-linejoin="round">${svg}</g></svg>`);
console.log('ok');
