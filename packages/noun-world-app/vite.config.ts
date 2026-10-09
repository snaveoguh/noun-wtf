import * as path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The game is imported in place from the webapp package; this app owns only
// the native shell (src/) and the asset copy (scripts/sync-game-assets.mjs).
const webappSrc = path.resolve(__dirname, '../nouns-webapp/src');

export default defineConfig({
  plugins: [react()],
  // Capacitor serves dist/ from the origin root (https://localhost on
  // Android, capacitor://localhost on iOS), so absolute /world2/… URLs in
  // the game resolve to the bundled copies.
  base: '/',
  resolve: {
    alias: [
      // World2Page reads the current auction seed from the site's Redux
      // store; the app has no store, so give it a stub that returns nothing.
      { find: /^@\/hooks$/, replacement: path.resolve(__dirname, 'src/shims/hooks.ts') },
      { find: /^@\//, replacement: `${webappSrc}/` },
    ],
    // The game's sources live in another package; make sure they get this
    // package's copy of each runtime dependency (one `three`, one React).
    dedupe: [
      'three',
      'postprocessing',
      'n8ao',
      'three-mesh-bvh',
      'partysocket',
      'react',
      'react-dom',
      'react-router',
      '@noundry/nouns-assets',
      '@nouns/voxel-engine',
    ],
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
    fs: {
      // Dev server must be able to read the game sources + voxel-engine.
      allow: [path.resolve(__dirname, '../..')],
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', 'postprocessing', 'n8ao', 'three-mesh-bvh'],
        },
      },
    },
  },
});
