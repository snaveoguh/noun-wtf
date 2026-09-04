import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  sourcemap: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: ['viem'],
});
