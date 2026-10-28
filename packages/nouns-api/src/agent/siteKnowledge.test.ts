/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises the runner awaits */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  NOUN_WTF_SITE_KNOWLEDGE,
  OWNER_KNOWLEDGE,
  SITE_GAMES,
  SITE_SECTIONS,
} from './siteKnowledge.js';

const nounOs = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../nouns-webapp/src/components/NounOS',
);

describe('site knowledge stays in step with the webapp', () => {
  it('covers every game on the homescreen deck (rows.ts GAMES)', () => {
    const rows = readFileSync(resolve(nounOs, 'home/rows.ts'), 'utf8');
    const block = rows.slice(
      rows.indexOf('export const GAMES'),
      rows.indexOf('export function game('),
    );
    const ids = [...block.matchAll(/^ {4}id: '([^']+)'/gm)].map(m => m[1]!);
    assert.ok(ids.length >= 9, `parsed ${ids.length} game ids from rows.ts`);
    const known = new Set(SITE_GAMES.map(g => g.id));
    assert.deepEqual(
      ids.filter(id => !known.has(id)),
      [],
      'add these games to SITE_GAMES',
    );
  });

  it('covers every catalog path (catalog.ts)', () => {
    const catalog = readFileSync(resolve(nounOs, 'catalog.ts'), 'utf8');
    const paths = [...catalog.matchAll(/path: '([^']+)'/g)].map(m => m[1]!);
    assert.ok(paths.length >= 30, `parsed ${paths.length} catalog paths`);
    const known = new Set(SITE_SECTIONS.map(s => s.path));
    assert.deepEqual(
      paths.filter(p => !known.has(p)),
      [],
      'add these paths to SITE_SECTIONS',
    );
  });
});

describe('NOUN_WTF_SITE_KNOWLEDGE', () => {
  it('names every game and the sections people asked about', () => {
    for (const name of [
      'Noun World',
      'Noun Hoops',
      'Noun Breaks',
      'Hide & Seek',
      'Noun Warfare',
      'The Big Drop',
      'Noun Parkour',
      'Noun Drive',
      'Noun Pool',
      'GRAND EXCHANGE',
      'VOICE BOOTH',
      'MEME VALUE',
      'CC0 LIBRARY',
      'NONSENSE',
      'NOUN FM',
    ]) {
      assert.ok(NOUN_WTF_SITE_KNOWLEDGE.includes(name), name);
    }
    assert.match(NOUN_WTF_SITE_KNOWLEDGE, /never say Noun World is the only game/);
  });

  it('keeps the owner to known facts and they/them', () => {
    assert.ok(NOUN_WTF_SITE_KNOWLEDGE.includes(OWNER_KNOWLEDGE));
    assert.match(OWNER_KNOWLEDGE, /they\/them/);
    assert.doesNotMatch(OWNER_KNOWLEDGE, /\b(he|him|his|she|her)\b/i);
  });
});

describe('SOUL.md', () => {
  const soul = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'SOUL.md'), 'utf8');

  it('makes no claims about the owner beyond the knowledge', () => {
    assert.doesNotMatch(soul, /walked away|never touch the code/i);
    assert.doesNotMatch(soul, /\bpipe\b/);
    // Sentences about pip use the name or they/them.
    for (const line of soul.split('\n').filter(l => /\bpip\b/.test(l))) {
      assert.doesNotMatch(line, /\b(he|him|his|she|her)\b/i, line);
    }
  });
});
