// Copies the runtime assets Noun World fetches by absolute URL
// (/world2/*, /models/heads/*, /fonts/*) from the webapp's public dir into
// this package's public/ so they ship inside the app bundle. The game code
// itself is imported straight from packages/nouns-webapp/src/miniapps/world2
// (see vite.config.ts); nothing in the webapp is modified.
//
// Only the head sets World v2 actually loads are copied (3dnouns + glasses
// textures + manifest, ~81 MB). The noundry / voxeldata sets are for other
// parts of the site and are skipped to keep the APK/IPA smaller.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const webapp = resolve(pkg, '..', 'nouns-webapp');
const out = join(pkg, 'public');

const COPIES = [
  ['public/world2', 'world2'],
  ['public/models/heads/manifest.json', 'models/heads/manifest.json'],
  ['public/models/heads/glasses-textures', 'models/heads/glasses-textures'],
  ['public/models/heads/3dnouns', 'models/heads/3dnouns'],
  ['public/fonts/Pip3-Regular.32fae758.woff2', 'fonts/Pip3-Regular.32fae758.woff2'],
  ['src/fonts/Londrina_Solid', 'fonts/Londrina_Solid'],
  ['src/fonts/PT_Root_UI', 'fonts/PT_Root_UI'],
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let bytes = 0;
const sizeOf = p => {
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  // cheap recursive size for the summary line
  let n = 0;
  for (const f of walk(p)) n += statSync(f).size;
  return n;
};
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

for (const [from, to] of COPIES) {
  const src = join(webapp, from);
  const dst = join(out, to);
  if (!existsSync(src)) {
    console.error(`[sync-game-assets] missing ${src}`);
    process.exit(1);
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  bytes += sizeOf(src);
}
console.log(`[sync-game-assets] copied ${(bytes / 1e6).toFixed(1)} MB into ${out}`);
