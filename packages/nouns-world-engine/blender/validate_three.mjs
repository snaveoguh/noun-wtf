// Validate the exported GLBs with the same three.js the webapp ships.
// Run from the repo root:  node packages/nouns-world-engine/blender/validate_three.mjs
// Checks: parse, bones, clips vs manifest, seamless loops, facing (+Z),
// regular stance (left foot toward +Z nose, chest toward -X), soles on the
// ground / on the deck, skateboard node names and dimensions.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const webapp = path.join(repo, 'packages/nouns-webapp');
const require = createRequire(path.join(webapp, 'package.json'));
const THREE = await import(require.resolve('three'));
const { GLTFLoader } = await import(path.join(webapp, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js'));

// Minimal image stub so GLTFLoader can "load" embedded PNGs in node.
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
THREE.ImageLoader.prototype.load = function (url, onLoad) {
  const img = { width: 1, height: 1 };
  setTimeout(() => onLoad && onLoad(img), 0);
  return img;
};

const outDir = path.join(webapp, 'public/world2');
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'character_manifest.json'), 'utf8'));

async function load(file) {
  const buf = fs.readFileSync(path.join(outDir, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const f3 = v => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

const char = await load('noun_character.glb');
const board = await load('skateboard.glb');
const scene = char.scene;
scene.updateMatrixWorld(true);

let skinned = null;
scene.traverse(o => { if (o.isSkinnedMesh) skinned = o; });
ok(!!skinned, `skinned mesh found: ${skinned?.name}`);
const bones = skinned.skeleton.bones.map(b => b.name);
const allBones = [];
scene.traverse(o => { if (o.isBone) allBones.push(o.name); });
const mb = Object.values(manifest.bones);
ok(mb.every(b => allBones.includes(b)), `all ${mb.length} manifest bones (three.js names) exist (${allBones.length} bones in scene, ${bones.length} skin joints)`);
const mats = new Set();
skinned.traverse(o => { if (o.material) [].concat(o.material).forEach(m => mats.add(m.name)); });
scene.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => mats.add(m.name)); });
ok(['NounBody', 'NounSkin', 'NounPants', 'NounShoe', 'NounSole'].every(m => mats.has(m)), `materials: ${[...mats].join(', ')}`);
const tris = (() => { let n = 0; scene.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return n; })();
ok(tris < 6000, `character triangles ${tris}`);
const size = fs.statSync(path.join(outDir, 'noun_character.glb')).size;
ok(size < 1.5e6, `noun_character.glb size ${(size / 1024).toFixed(0)} KB`);

// clips
const clipNames = char.animations.map(a => a.name);
const missing = manifest.clips.filter(c => !clipNames.includes(c.name)).map(c => c.name);
ok(missing.length === 0, `all ${manifest.clips.length} manifest clips exported as separate animations${missing.length ? ' missing: ' + missing : ''}`);
for (const c of manifest.clips) {
  const a = char.animations.find(x => x.name === c.name);
  if (a && Math.abs(a.duration - c.duration) > 0.034) ok(false, `${c.name} duration ${a.duration} vs ${c.duration}`);
}

// helpers
const mixer = new THREE.AnimationMixer(scene);
const getBone = n => scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
function pose(clipName, t) {
  mixer.stopAllAction();
  const clip = char.animations.find(a => a.name === clipName);
  const act = mixer.clipAction(clip);
  act.reset().play();
  mixer.setTime(t);
  scene.updateMatrixWorld(true);
  return clip;
}
const wp = n => getBone(n).getWorldPosition(new THREE.Vector3());

// sole vertices per side (material NounSole), skinned positions in world space
const geo = skinned.geometry;
const soleIdx = { L: [], R: [] };
{
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index.count, materialIndex: 0 }];
  const matsArr = [].concat(skinned.material);
  const seen = new Set();
  for (const g of groups) {
    if (matsArr[g.materialIndex]?.name !== 'NounSole') continue;
    for (let i = g.start; i < g.start + g.count; i++) {
      const vi = geo.index.getX(i);
      if (seen.has(vi)) continue;
      seen.add(vi);
      const x = geo.attributes.position.getX(vi);
      (x > 0 ? soleIdx.L : soleIdx.R).push(vi);
    }
  }
}
// multi-primitive meshes come in as a Group of SkinnedMeshes
const skinnedMeshes = [];
scene.traverse(o => { if (o.isSkinnedMesh) skinnedMeshes.push(o); });
const soleMesh = skinnedMeshes.find(m => [].concat(m.material).some(x => x.name === 'NounSole'));
function soleStats(side) {
  const m = soleMesh;
  const v = new THREE.Vector3();
  let minY = Infinity, minLocal = Infinity;
  // board-space = world with the board bone's pose delta (relative to rest) removed
  const delta = getBone('board').matrixWorld.clone().multiply(boardRestInv);
  const inv = delta.invert();
  const sx = side === 'L' ? 1 : -1;
  const pos = m.geometry.attributes.position;
  let cnt = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.sign(pos.getX(i)) !== sx) continue;
    m.getVertexPosition(i, v);
    v.applyMatrix4(m.matrixWorld);
    minY = Math.min(minY, v.y);
    const b = v.clone().applyMatrix4(inv);
    minLocal = Math.min(minLocal, b.y);
    cnt++;
  }
  return { minY, minLocal, cnt };
}

// NounBody UV: front-facing torso verts land in uvRegions.front, oriented as documented
{
  const bodyMesh = skinnedMeshes.find(m => [].concat(m.material).some(x => x.name === 'NounBody'));
  const g = bodyMesh.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
  const [u0, v0, u1, v1] = manifest.nounBodyTexture.uvRegions.front;
  let inRect = 0, total = 0, corrU = 0, corrV = 0;
  const pts = [];
  for (let i = 0; i < P.count; i++) {
    if (N.getZ(i) > 0.95 && P.getY(i) > 0.66 && P.getY(i) < 1.06 && Math.abs(P.getX(i)) < 0.2) {
      total++;
      const u = UV.getX(i), v = UV.getY(i);
      if (u >= u0 - 1e-3 && u <= u1 + 1e-3 && v >= v0 - 1e-3 && v <= v1 + 1e-3) inRect++;
      pts.push([P.getX(i), P.getY(i), u, v]);
    }
  }
  const lx = pts.reduce((a, b) => (b[0] > a[0] ? b : a)), hy = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  ok(total > 0 && inRect === total, `torso front verts in front UV rect: ${inRect}/${total}`);
  ok(lx[2] > 0.3 && hy[3] < 0.1, `front UV orientation: character-left (+X) -> image right (u=${lx[2].toFixed(3)}), top of torso -> image top (v=${hy[3].toFixed(3)})`);
}

// rest / head
mixer.stopAllAction();
skinned.skeleton.pose();
scene.updateMatrixWorld(true);
const boardRestInv = getBone('board').matrixWorld.clone().invert();
const head = getBone('head');
const hq = head.getWorldQuaternion(new THREE.Quaternion());
const neck = wp('head');
ok(Math.abs(neck.y - manifest.headAttach.neckTop[1]) < 0.01, `head bone origin (neck top) ${f3(neck)}`);
const hx = new THREE.Vector3(1, 0, 0).applyQuaternion(hq), hy = new THREE.Vector3(0, 1, 0).applyQuaternion(hq), hz = new THREE.Vector3(0, 0, 1).applyQuaternion(hq);
ok(hx.x > 0.99 && hy.y > 0.99 && hz.z > 0.99, `head bone local axes == character axes: X${f3(hx)} Y${f3(hy)} Z${f3(hz)}`);

// facing: in idle, toes are in +Z of the ankles; left foot is +X
pose('idle', 0);
const ankL = wp('foot.L'), toeL = wp('toe.L'), ankR = wp('foot.R');
ok(toeL.z > ankL.z + 0.05, `idle faces +Z (toe.L ${f3(toeL)} ahead of ankle ${f3(ankL)})`);
ok(ankL.x > 0 && ankR.x < 0, `left foot on +X side (L ${ankL.x.toFixed(3)}, R ${ankR.x.toFixed(3)})`);
for (const s of ['L', 'R']) {
  const st = soleStats(s);
  ok(Math.abs(st.minY) < 0.012, `idle sole ${s} on ground: min y = ${st.minY.toFixed(4)}`);
}

// walk/run planted foot never sinks below ground
for (const name of ['walk', 'run', 'sprint', 'land', 'jump_start', 'dance', 'idle_look', 'wave', 'celebrate', 'punch', 'kick']) {
  const clip = char.animations.find(a => a.name === name);
  let lo = Infinity;
  for (let i = 0; i <= 12; i++) {
    pose(name, clip.duration * i / 12);
    for (const s of ['L', 'R']) lo = Math.min(lo, soleStats(s).minY);
  }
  ok(lo > -0.015 && lo < 0.03, `${name}: lowest sole over clip = ${lo.toFixed(4)} (ground = 0)`);
}

// skate stance
pose('skate_idle', 0);
const fL = wp('foot.L'), fR = wp('foot.R');
ok(fL.z > fR.z + 0.25, `skate_idle: left foot toward nose +Z (L z=${fL.z.toFixed(3)}, R z=${fR.z.toFixed(3)})`);
const chestQ = getBone('chest').getWorldQuaternion(new THREE.Quaternion());
// chest bone: local +Z is the character's forward (see head check)
const chestFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chestQ);
ok(chestFwd.x < -0.7, `skate_idle chest faces -X: ${f3(chestFwd)}`);
const deckTop = manifest.skateboard.deckTopHeight;
for (const name of ['skate_idle', 'skate_crouch', 'skate_air', 'skate_land', 'skate_grind', 'skate_manual', 'skate_grab',
  'skate_turn_left', 'skate_turn_right', 'skate_powerslide', 'skate_ollie']) {
  const clip = char.animations.find(a => a.name === name);
  let worst = 0, lo = Infinity, hi = -Infinity;
  const n = name === 'skate_ollie' ? 1 : 8; // ollie feet leave the deck mid-clip
  for (let i = 0; i < n; i++) {
    pose(name, clip.duration * i / 8);
    for (const s of ['L', 'R']) {
      const st = soleStats(s);
      lo = Math.min(lo, st.minLocal); hi = Math.max(hi, st.minLocal);
    }
  }
  ok(lo > deckTop - 0.012 && hi < deckTop + 0.03, `${name}: sole bottoms in board-bone space ${lo.toFixed(4)}..${hi.toFixed(4)} (deck top ${deckTop})`);
}

// seamless loops
for (const c of manifest.clips.filter(c => c.loop)) {
  const clip = char.animations.find(a => a.name === c.name);
  let maxd = 0;
  for (const tr of clip.tracks) {
    const vs = tr.getValueSize();
    const n = tr.times.length;
    for (let k = 0; k < vs; k++) maxd = Math.max(maxd, Math.abs(tr.values[k] - tr.values[(n - 1) * vs + k]));
  }
  if (maxd > 1e-3) ok(false, `${c.name} loop seam max diff ${maxd}`);
}
ok(true, 'loop seams checked (first frame == last frame for every looping clip)');

// skateboard
const bs = board.scene;
bs.updateMatrixWorld(true);
for (const n of manifest.skateboard.nodes) ok(!!bs.getObjectByName(n), `skateboard node ${n}`);
const bb = new THREE.Box3().setFromObject(bs);
ok(Math.abs(bb.min.y) < 0.002, `board rests on y=0 (min y ${bb.min.y.toFixed(4)})`);
ok(Math.abs(bb.max.z - 0.4) < 0.01 && Math.abs(bb.min.z + 0.4) < 0.01, `board length along Z: ${bb.min.z.toFixed(3)}..${bb.max.z.toFixed(3)}`);
ok(Math.abs(bb.max.x - 0.105) < 0.01, `board width along X: ${(bb.max.x - bb.min.x).toFixed(3)}`);
const wfl = bs.getObjectByName('WheelFL').position;
ok(wfl.x > 0 && wfl.z > 0 && Math.abs(wfl.y - 0.027) < 0.002, `WheelFL pivot at ${f3(wfl)} (front-left = +Z,+X)`);
let btris = 0; bs.traverse(o => { if (o.isMesh) btris += o.geometry.index.count / 3; });
ok(btris < 3000, `board triangles ${btris}`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
