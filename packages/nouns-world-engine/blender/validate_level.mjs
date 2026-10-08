// Validate the Noggle Plaza level export with the three.js the webapp ships.
// Run from the repo root:  node packages/nouns-world-engine/blender/validate_level.mjs [levelDir]
// Checks: level.json keys, plaza.glb / collision.glb parse, lightmapped meshes have uv1,
// lightmap files exist, rails sit on geometry (ray down from 0.3 m above each rail sample),
// spawns stand on the ground, landmarks inside bounds, folder size.
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

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
THREE.ImageLoader.prototype.load = function (url, onLoad) {
  const img = { width: 1, height: 1 };
  setTimeout(() => onLoad && onLoad(img), 0);
  return img;
};

const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(webapp, 'public/world2/level');
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
async function load(file) {
  const buf = fs.readFileSync(path.join(dir, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

const json = JSON.parse(fs.readFileSync(path.join(dir, 'level.json'), 'utf8'));
const req = ['glb', 'collisionGlb', 'rails', 'spawns', 'sun', 'sky', 'fog', 'lightmaps', 'lightMapIntensity', 'bounds', 'landmarks'];
ok(req.every(k => k in json), `level.json has keys ${req.join(', ')}`);
ok(typeof json.sun.color === 'string' && /^#[0-9a-f]{6}$/.test(json.sun.color), `sun.color ${json.sun.color}`);
const sd = new THREE.Vector3(...json.sun.direction);
ok(Math.abs(sd.length() - 1) < 1e-3 && sd.y < 0, `sun.direction unit & pointing down ${json.sun.direction}`);
ok(/^#/.test(json.sky.zenith) && /^#/.test(json.sky.horizon) && /^#/.test(json.fog.color), 'sky/fog hex colours');

const plaza = (await load(json.glb)).scene;
plaza.updateMatrixWorld(true);
const col = (await load(json.collisionGlb)).scene;
col.updateMatrixWorld(true);
const nodes = {};
plaza.children.forEach(c => (nodes[c.name] = c));
console.log('      plaza nodes:', Object.keys(nodes).join(', '));
for (const [name, file] of Object.entries(json.lightmaps)) {
  const n = nodes[name];
  const meshes = [];
  n?.traverse(o => o.isMesh && meshes.push(o));
  ok(!!n && meshes.length > 0 && meshes.every(m => m.geometry.attributes.uv1 && m.geometry.attributes.uv),
    `lightmapped node ${name}: ${meshes.length} mesh(es) all with uv + uv1 -> ${file}`);
  ok(fs.existsSync(path.join(dir, file)), `  lightmap file ${file} exists`);
}
let tris = 0;
plaza.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
const colMeshes = [];
col.traverse(o => o.isMesh && colMeshes.push(o));
let ctris = 0;
colMeshes.forEach(m => (ctris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3));
console.log(`      plaza ${tris} tris; collision ${colMeshes.length} meshes ${ctris} tris (${colMeshes.map(m => m.name).join(', ')})`);

// geometry for raycasts: what the runtime collides with
const targets = colMeshes;
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
function dropDist(p, h = 0.3) {
  // try exact point + small horizontal jitters (rail points sit exactly ON an edge)
  let best = Infinity;
  for (const [dx, dz] of [[0, 0], [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01], [0.02, 0.02], [-0.02, -0.02], [0.02, -0.02], [-0.02, 0.02]]) {
    ray.set(new THREE.Vector3(p.x + dx, p.y + h, p.z + dz), down);
    ray.far = h + 2;
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) best = Math.min(best, Math.abs(hit.distance - h));
  }
  return best;
}
let bad = 0, samples = 0;
const types = {};
for (const r of json.rails) {
  types[r.type] = (types[r.type] ?? 0) + 1;
  const pts = r.points.map(p => new THREE.Vector3(...p));
  let worst = 0;
  for (let i = 0; i < pts.length; i++) {
    const cand = [pts[i]];
    if (i + 1 < pts.length) for (const t of [0.25, 0.5, 0.75]) cand.push(pts[i].clone().lerp(pts[i + 1], t));
    for (const c of cand) {
      samples++;
      worst = Math.max(worst, dropDist(c));
    }
  }
  if (!(worst <= 0.05)) {
    bad++;
    console.log(`FAIL  rail ${r.id} (${r.type}) worst offset ${worst === Infinity ? 'no hit' : worst.toFixed(3) + ' m'}`);
  }
}
ok(bad === 0, `${json.rails.length} rails (${Object.entries(types).map(([k, v]) => `${v} ${k}`).join(', ')}), ${samples} samples within 5 cm of geometry`);
for (const s of json.spawns) {
  const p = new THREE.Vector3(...s.position);
  ray.set(p.clone().add(new THREE.Vector3(0, 1.5, 0)), down);
  ray.far = 5;
  const hit = ray.intersectObjects(targets, false)[0];
  ok(hit && Math.abs(hit.point.y - p.y) < 0.05, `spawn ${s.name ?? ''} ${s.position} yaw ${s.yaw} on ground (hit y=${hit?.point.y.toFixed(3)})`);
}
const bmin = new THREE.Vector3(...json.bounds.min), bmax = new THREE.Vector3(...json.bounds.max);
const box = new THREE.Box3(bmin, bmax);
ok(json.landmarks.every(l => box.containsPoint(new THREE.Vector3(...l.position))), `${json.landmarks.length} landmarks inside bounds`);
ok(json.spawns.every(s => box.containsPoint(new THREE.Vector3(...s.position))), 'spawns inside bounds');
const size = fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
ok(size < 25e6, `level folder ${(size / 1e6).toFixed(2)} MB < 25 MB`);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
