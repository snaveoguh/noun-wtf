// 1-bit pixel recreation of the "milking the treasury" noun meme (prop 997), pip3 style.
// Run: node scripts/pixel-memes/milking-the-treasury.cjs  -> writes milking-the-treasury.svg in cwd.
// Values: 0 black, 1 white, 2 checker dither (50%), 3 sparse dither (25%), -1 transparent
const W = 128, H = 72;
const fs = require('fs');

function layer(w, h, fill = -1) {
  const d = new Array(w * h).fill(fill);
  const L = {
    w, h, d,
    px(x, y, v) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < w && y < h) d[y * w + x] = v; },
    get(x, y) { return (x >= 0 && y >= 0 && x < w && y < h) ? d[y * w + x] : -1; },
    rect(x, y, rw, rh, v) { for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) L.px(x + i, y + j, v); },
    box(x, y, rw, rh, v) { L.rect(x, y, rw, 1, v); L.rect(x, y + rh - 1, rw, 1, v); L.rect(x, y, 1, rh, v); L.rect(x + rw - 1, y, 1, rh, v); },
    ellipse(cx, cy, rx, ry, v) {
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry; if (dx * dx + dy * dy <= 1) L.px(x, y, v);
      }
    },
    ring(cx, cy, rx, ry, v) {
      const ins = (px, py) => { const dx = (px - cx) / rx, dy = (py - cy) / ry; return dx * dx + dy * dy <= 1; };
      for (let y = Math.floor(cy - ry) - 1; y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx) - 1; x <= cx + rx + 1; x++) {
        if (ins(x, y) && !(ins(x - 1, y) && ins(x + 1, y) && ins(x, y - 1) && ins(x, y + 1))) L.px(x, y, v);
      }
    },
    line(x0, y0, x1, y1, v, thick = 1) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) {
        const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
        for (let t = 0; t < thick; t++) L.px(x + t, y, v);
      }
    },
    sprite(x, y, rows, map = {}) {
      const M = { '#': 1, 'x': 0, ':': 2, '`': 3, '.': -1, ...map };
      rows.forEach((r, j) => [...r].forEach((c, i) => { const v = M[c]; if (v !== -1 && v !== undefined) L.px(x + i, y + j, v); }));
    },
    blit(src, x, y, mirror = false) {
      for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) {
        const v = src.d[j * src.w + i]; if (v === -1) continue;
        L.px(x + (mirror ? src.w - 1 - i : i), y + j, v);
      }
    },
    // 1px black outline on every transparent pixel touching the drawing
    halo() {
      const out = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (L.get(x, y) !== -1) continue;
        let near = false;
        for (let j = -1; j <= 1 && !near; j++) for (let i = -1; i <= 1; i++) if (L.get(x + i, y + j) !== -1) { near = true; break; }
        if (near) out.push([x, y]);
      }
      out.forEach(([x, y]) => L.px(x, y, 0));
      return L;
    },
  };
  return L;
}

// noggles: black frame, white lens, black pupil on the right (canonical noun)
const LENS = ['xxxxxxx', 'x###xxx', 'x###xxx', 'x###xxx', 'xxxxxxx'];
const NOGGLES = LENS.map((r, i) => (i === 1 ? 'xx' : '..') + r + (i === 1 ? 'x' : '.') + r);
const BIGLENS = ['xxxxxxxxx', 'x####xxxx', 'x####xxxx', 'x####xxxx', 'x####xxxx', 'xxxxxxxxx'];
const BIGNOGGLES = BIGLENS.map((r, i) => (i === 2 ? 'xx' : '..') + r + (i === 2 ? 'x' : '.') + r);
const DROP = ['.#.', '###', '###', '.#.'];

// ───────────────────────── background ─────────────────────────
const S = layer(W, H, 0);
for (let x = 4; x < 100; x += 12) S.rect(x, 0, 1, 64, 3);          // plank seams
S.rect(0, 8, 100, 1, 1);                                           // beam
S.box(46, 0, 36, 9, 1); S.rect(48, 4, 32, 1, 3); S.rect(60, 2, 8, 5, 1); S.rect(61, 3, 6, 3, 0); // loft hatch
S.rect(0, 66, 128, 1, 1);                                          // floor edge
for (let x = 2; x < 128; x += 7) S.rect(x, 68 + (x % 3), 3, 1, 1);  // straw
// doorway on the right
S.rect(100, 0, 28, 66, 0); S.rect(100, 0, 1, 66, 1); S.rect(100, 0, 28, 1, 1);
S.ellipse(114, 8, 6, 3, 1); S.ellipse(119, 10, 5, 3, 1); S.ellipse(109, 11, 4, 2, 1);   // cloud
S.rect(101, 44, 27, 22, 2);                                        // grass
for (let x = 102; x < 128; x += 4) S.rect(x, 42 - ((x * 7) % 3), 1, 3, 1);
S.sprite(107, 24, [
  '.......####.......', '......#::::#......', '.....#::::::#.....', '....#::::::::#....', '...#::::::::::#...',
  '..################', '..#xxxxxxxxxxxxx#.', '..#xxxxx#####xxx#.', '..#xxxxx#x.x#xxx#.', '..#xxxxx#.x.#xxx#.',
  '..#xxxxx#x.x#xxx#.', '..################',
]);
S.rect(101, 40, 27, 1, 1); S.rect(101, 43, 27, 1, 1); for (let x = 103; x < 128; x += 7) S.rect(x, 38, 1, 7, 1); // fence

// ───────────────────────── cow ─────────────────────────
const C = layer(62, 62);
C.ellipse(34, 20, 22, 13, 1); C.rect(14, 20, 42, 20, 1); C.ellipse(34, 40, 21, 6, 1);  // body
C.ellipse(30, 12, 6, 3, 0); C.ellipse(45, 28, 6, 4, 0); C.ellipse(20, 34, 4, 3, 0); C.ellipse(50, 13, 4, 2, 0); // spots
[[13, 44], [21, 44], [27, 44], [34, 44]].forEach(([x, y]) => { C.rect(x, y, 5, 14, 1); C.rect(x, y + 12, 5, 2, 2); });
C.rect(18, 44, 3, 12, 0); C.rect(19, 44, 1, 3, 1); C.rect(32, 44, 2, 12, 0); C.rect(32, 44, 1, 3, 1);
C.line(56, 12, 60, 30, 1, 2); C.ellipse(60, 31, 2, 2, 1);                                 // tail
// head (own layer so it gets its own outline)
const Hd = layer(32, 30);
Hd.ellipse(16, 12, 13, 9, 1); Hd.rect(4, 12, 25, 12, 1); Hd.ellipse(16, 22, 12, 6, 1);
Hd.ellipse(9, 6, 5, 3, 0); Hd.ellipse(26, 20, 3, 2, 0);                                   // patches
Hd.sprite(2, 1, ['.##', '##.', '#..']); Hd.sprite(28, 1, ['##.', '.##', '..#']);           // horns
Hd.sprite(0, 10, ['.###', '####', '.##.']); Hd.sprite(29, 10, ['###.', '####', '.##.']);   // ears
Hd.ellipse(16, 23, 10, 4, 2); Hd.ring(16, 23, 10, 4, 0); Hd.rect(11, 22, 2, 2, 0); Hd.rect(20, 22, 2, 2, 0); // muzzle
Hd.sprite(4, 12, BIGNOGGLES);
Hd.halo();
C.blit(Hd, 0, 14);
// udder = ETH diamond (own layer) at the rear
const U = layer(15, 20);
U.sprite(1, 0, [
  '......#......', '.....###.....', '....##:##....', '...##:::##...', '..##:::::##..', '.##:::::::##.', '##:::::::::##',
  '#############', '.##:::::::##.', '..##:::::##..', '...##:::##...', '....##:##....', '.....###.....', '......#......',
]);
U.ellipse(4, 15, 2, 2, 1); U.ellipse(10, 15, 2, 2, 1); U.ellipse(7, 17, 2, 2, 1);
U.halo();
C.blit(U, 37, 38);
C.halo();
S.blit(C, 0, 8, false);
S.blit(C, 66, 8, true);

// ───────────────────────── the noun ─────────────────────────
const N = layer(W, H);
N.rect(55, 56, 18, 3, 2); N.box(55, 56, 18, 3, 1); N.rect(57, 59, 2, 7, 1); N.rect(69, 59, 2, 7, 1); N.rect(57, 62, 14, 1, 1); // stool
N.rect(55, 49, 7, 12, 0); N.box(55, 49, 7, 12, 1); N.rect(66, 49, 7, 12, 0); N.box(66, 49, 7, 12, 1);  // trousers
N.rect(52, 60, 9, 3, 1); N.rect(67, 60, 9, 3, 1);                                        // shoes
N.rect(54, 37, 20, 14, 0); N.box(54, 37, 20, 14, 1);                                    // black tee
N.rect(56, 37, 6, 14, 2); N.rect(66, 37, 6, 14, 2);                                     // hi-vis vest
N.rect(56, 41, 6, 1, 1); N.rect(66, 41, 6, 1, 1); N.rect(56, 46, 6, 1, 1); N.rect(66, 46, 6, 1, 1); // reflective stripes
N.rect(63, 37, 2, 14, 1); N.rect(63, 38, 2, 1, 0); N.rect(63, 41, 2, 1, 0); N.rect(63, 44, 2, 1, 0); N.rect(63, 47, 2, 1, 0); // zip
N.rect(50, 40, 3, 18, 1); N.rect(44, 57, 9, 3, 1); N.rect(75, 40, 3, 18, 1); N.rect(75, 57, 9, 3, 1);                             // arms
N.ellipse(43, 60, 4, 2, 1); N.ellipse(85, 60, 4, 2, 1);                                 // hands
N.rect(42, 60, 1, 1, 0); N.rect(44, 61, 1, 1, 0); N.rect(84, 60, 1, 1, 0); N.rect(86, 61, 1, 1, 0);
N.rect(53, 19, 22, 19, 1);                                                              // head
N.rect(53, 19, 1, 1, -1); N.rect(74, 19, 1, 1, -1); N.rect(53, 37, 1, 1, -1); N.rect(74, 37, 1, 1, -1);
N.sprite(51, 16, ['.###', '####', '#xx.']); N.sprite(73, 16, ['###.', '####', '.xx#']);  // ears
N.rect(56, 17, 16, 2, 1); N.rect(58, 15, 12, 2, 1); N.rect(62, 14, 4, 1, 1);             // tuft
N.rect(55, 21, 18, 1, 3); N.rect(57, 23, 14, 1, 0);                                     // fur + brow
N.sprite(56, 24, NOGGLES);
N.rect(62, 31, 4, 2, 0); N.rect(63, 30, 2, 1, 0);                                        // nose
N.rect(57, 34, 14, 3, 0); N.rect(58, 35, 12, 2, 1); for (let x = 60; x < 70; x += 2) N.rect(x, 35, 1, 2, 0); // teeth
N.rect(53, 26, 1, 1, 0); N.rect(74, 30, 1, 1, 0); N.rect(53, 32, 1, 1, 0);               // fur ticks
N.halo();
S.blit(N, 0, 0);
// sweat
S.sprite(48, 21, DROP); S.sprite(77, 23, DROP); S.sprite(49, 29, DROP);

// ───────────────────────── milk ─────────────────────────
S.line(46, 71, 45, 64, 1); S.line(82, 71, 83, 64, 1);
[[39, 64], [88, 64]].forEach(([x, y]) => S.sprite(x, y, DROP));

// ───────────────────────── props ─────────────────────────
S.sprite(2, 0, ['.####.', '#....#', '#....#', '.####.']); S.rect(4, 4, 2, 16, 1); S.rect(0, 20, 10, 2, 1);
for (let x = 0; x <= 9; x += 3) S.rect(x, 22, 1, 6, 1);                                   // pitchfork
function bale(x, y, w, h) { const B = layer(w + 2, h + 2); B.rect(1, 1, w, h, 2); B.box(1, 1, w, h, 1); B.rect(1, 4, w, 1, 3); B.rect(1, h - 3, w, 1, 3); B.rect(4, 1, 1, h, 3); B.halo(); S.blit(B, x - 1, y - 1); }
bale(0, 50, 12, 16);
const T = layer(26, 18); T.rect(1, 1, 22, 16, 0); T.box(1, 1, 22, 16, 1); T.box(3, 3, 18, 10, 3);
T.sprite(4, 5, NOGGLES.map(r => r.replace(/[#x]/g, c => c === '#' ? 'x' : '#'))); T.rect(23, 7, 3, 1, 1); T.rect(25, 3, 1, 5, 1); T.rect(5, 14, 14, 1, 3); T.halo();
S.blit(T, 102, 52);                                                                       // tv

// ───────────────────────── output ─────────────────────────
function resolve(v, x, y) {
  if (v === 1) return 1; if (v === 2) return (x + y) % 2 === 0 ? 1 : 0;
  if (v === 3) return (x % 2 === 0 && y % 2 === 0) ? 1 : 0; return 0;
}
const bits = [];
for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) row.push(resolve(S.d[y * W + x], x, y)); bits.push(row); }
let rects = '';
for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (bits[y][x]) { let s = x; while (x < W && bits[y][x]) x++; rects += `<rect x="${s}" y="${y}" width="${x - s}" height="1"/>`; } else x++; } }
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 12}" height="${H * 12}" shape-rendering="crispEdges"><rect width="${W}" height="${H}" fill="#000"/><g fill="#fff">${rects}</g></svg>`;
fs.writeFileSync('milking-the-treasury.svg', svg);
console.log('ok');
