// Emits /world-sw.js (Noun World's service worker) on every production build:
// src/miniapps/world2/pwa/sw.ts transpiled, with this build's id and
// precache list baked in, so each deploy ships a new worker. Dev has none.
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { transformWithEsbuild, type Plugin } from 'vite';

import { buildId, worldPrecache, type BundleItem } from '../src/miniapps/world2/pwa/precache';

const SRC = path.resolve(__dirname, '../src/miniapps/world2/pwa/sw.ts');

export function worldPwa(): Plugin {
  return {
    name: 'noun-world-pwa',
    apply: 'build',
    async generateBundle(_opts, bundle) {
      const files = worldPrecache(bundle as unknown as Record<string, BundleItem>);
      const build = buildId(files);
      const ts = readFileSync(SRC, 'utf8');
      const { code } = await transformWithEsbuild(ts, SRC, {
        loader: 'ts',
        format: 'esm',
        target: 'es2020',
        minifyWhitespace: true,
      });
      // esbuild hoists the exports into one `export{…}` list (or keeps them inline)
      const body = code
        .replace(/\bexport\s*{[^}]*};?/g, '')
        .replace(/\bexport\s+(?=(async\s+)?(function|const|let|class)\b)/g, '');
      if (/\bexport\b/.test(body)) this.error('world-sw: unexpected export left in sw.ts');
      this.emitFile({
        type: 'asset',
        fileName: 'world-sw.js',
        source: `// Noun World service worker, build ${build}\n${body}\nstart(self, ${JSON.stringify(build)}, ${JSON.stringify(files)});\n`,
      });
    },
  };
}
