// Build Noun Rush on its own (rush-app/index.html → dist-rush/) for the
// standalone noun-rush Netlify site. See .github/workflows/rush-deploy.yml.
import * as path from 'path';
import type { PluginOption, UserConfig } from 'vite';

import base from './vite.config';

const skip = new Set(['vite-plugin-checker', 'vite-plugin-inspect']);
const plugins = (base.plugins ?? []).filter(
  p => !(p !== null && typeof p === 'object' && 'name' in p && skip.has(p.name)),
) as PluginOption[];

const config: UserConfig = {
  ...base,
  plugins,
  // Only the game's own files get copied (by the workflow), not all of public/
  publicDir: false,
  build: {
    ...base.build,
    outDir: 'dist-rush',
    emptyOutDir: true,
    rollupOptions: {
      ...base.build?.rollupOptions,
      input: { rush: path.resolve(__dirname, 'rush-app/index.html') },
    },
  },
};

export default config;
