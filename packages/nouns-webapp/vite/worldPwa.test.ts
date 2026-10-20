// @vitest-environment node
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { worldPwa } from './worldPwa';

describe('world-sw.js build', () => {
  it("emits a self-contained worker that starts with this build's precache list", async () => {
    const plugin = worldPwa();
    const emitted: { fileName: string; source: string }[] = [];
    const ctx = {
      emitFile: (f: { fileName: string; source: string }) => emitted.push(f),
      error: (m: string) => {
        throw new Error(m);
      },
    };
    const bundle = {
      'assets/index-a.js': {
        type: 'chunk',
        fileName: 'assets/index-a.js',
        isEntry: true,
        imports: [],
      },
      'assets/World2Page-b.js': {
        type: 'chunk',
        fileName: 'assets/World2Page-b.js',
        facadeModuleId: '/x/src/miniapps/world2/World2Page.tsx',
        imports: [],
      },
    };
    const hook = plugin.generateBundle as unknown as (
      this: typeof ctx,
      o: object,
      b: object,
    ) => Promise<void>;
    await hook.call(ctx, {}, bundle);
    expect(emitted).toHaveLength(1);
    const { fileName, source } = emitted[0]!;
    expect(fileName).toBe('world-sw.js');
    expect(source).not.toMatch(/\bexport\b/);

    // run it against a fake worker scope: it registers the three handlers
    const events: string[] = [];
    const self = {
      location: { origin: 'https://noun.wtf' },
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
      addEventListener: (t: string) => events.push(t),
    };
    runInNewContext(source, { self, URL, caches: {}, fetch: () => undefined, Response, Request });
    expect(events.sort()).toEqual(['activate', 'fetch', 'install']);
    expect(source).toContain('"/assets/World2Page-b.js"');
    expect(source).toContain('"/assets/index-a.js"');
  });
});
