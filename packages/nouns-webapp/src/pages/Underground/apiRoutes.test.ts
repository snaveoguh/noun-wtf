// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_ROUTES, UNLISTED } from './apiRoutes';

const API_SRC = resolve(__dirname, '../../../../nouns-api/src/api');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

/** Every `app.get('/api/…')` / `app.post('/api/…')` registered by the API. */
function routesInApi(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(API_SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\.(get|post)\(\s*["'`](\/api\/[^"'`]+)["'`]/g)) {
      found.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
  }
  return [...found].sort();
}

describe('/underground API reference', () => {
  const listed = ALL_ROUTES.map(r => `${r.method} ${r.path}`);

  it('covers every route the API registers', () => {
    const known = new Set([...listed, ...UNLISTED]);
    expect(routesInApi().filter(r => !known.has(r))).toEqual([]);
  });

  it('lists no route the API no longer has', () => {
    const api = new Set(routesInApi());
    expect([...listed, ...UNLISTED].filter(r => !api.has(r))).toEqual([]);
  });

  it('lists each route once', () => {
    expect(listed.length).toBe(new Set(listed).size);
  });

  it('only offers to run GETs on a concrete path', () => {
    for (const r of ALL_ROUTES.filter(r => r.try)) {
      expect(r.method).toBe('GET');
      expect(r.try).toMatch(/^\/api\//);
      expect(r.try).not.toContain(':');
    }
  });
});
