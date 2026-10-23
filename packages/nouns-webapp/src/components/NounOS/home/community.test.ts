import { describe, expect, it } from 'vitest';

import {
  BLURB_MAX,
  checkUrl,
  cleanText,
  hostOf,
  NAME_MAX,
  parseEntries,
  validateSubmission,
} from './community';

const good = {
  name: 'Noun Kart',
  url: 'https://nounkart.xyz/play',
  blurb: 'mario kart but everyone has noggles on',
  kind: 'game',
};

describe('validateSubmission', () => {
  it('accepts a normal submission and normalises it', () => {
    const v = validateSubmission({ ...good, name: '  Noun   Kart ', kind: 'GAME' });
    expect(v).toEqual({ ok: true, value: { ...good } });
  });

  it.each([
    ['http link', { url: 'http://nounkart.xyz' }, /https/],
    ['javascript link', { url: 'javascript:alert(1)' }, /https/],
    ['data link', { url: 'data:text/html,hi' }, /https/],
    ['no link', { url: '' }, /link/],
    ['garbage link', { url: 'not a url' }, /parse/],
    ['credentials', { url: 'https://user:pw@nounkart.xyz' }, /login/],
    ['localhost', { url: 'https://localhost/x' }, /public/],
    ['ip', { url: 'https://127.0.0.1/x' }, /public/],
    ['ipv6', { url: 'https://[::1]/x' }, /public/],
    ['bare host', { url: 'https://intranet/x' }, /public/],
    ['port', { url: 'https://nounkart.xyz:8443/' }, /port/],
    ['long link', { url: `https://nounkart.xyz/${'a'.repeat(300)}` }, /capped/],
    ['short name', { name: 'x' }, /name/],
    ['long name', { name: 'n'.repeat(NAME_MAX + 1) }, /capped/],
    ['short blurb', { blurb: 'hi' }, /words/],
    ['long blurb', { blurb: 'b'.repeat(BLURB_MAX + 1) }, /blurb/],
    ['bad kind', { kind: 'casino' }, /kind/],
    ['honeypot', { website: 'spam.biz' }, /bad request/],
  ])('rejects %s', (_, patch, err) => {
    const v = validateSubmission({ ...good, ...patch });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(err);
  });

  it('rejects non-objects', () => {
    expect(validateSubmission(null).ok).toBe(false);
    expect(validateSubmission('x').ok).toBe(false);
    expect(validateSubmission([good]).ok).toBe(false);
  });
});

describe('cleanText', () => {
  it('strips control and bidi-override characters', () => {
    expect(cleanText('a\u0000b‮c\n\td')).toBe('a b c d');
    expect(cleanText(42)).toBe('');
  });
});

describe('checkUrl', () => {
  it('returns the normalised href', () => {
    expect(checkUrl('https://Nouns.GAME')).toEqual({ ok: true, value: 'https://nouns.game/' });
  });
});

describe('parseEntries', () => {
  it('keeps only entries that still pass the rules', () => {
    const out = parseEntries({
      entries: [
        { ...good, id: 'abc', at: 1 },
        { ...good, url: 'javascript:alert(1)', id: 'bad', at: 2 },
        { ...good, id: 7, at: 3 },
        'junk',
      ],
    });
    expect(out).toEqual([{ ...good, id: 'abc', at: 1 }]);
    expect(parseEntries(null)).toEqual([]);
    expect(parseEntries({ entries: 'x' })).toEqual([]);
  });
});

describe('hostOf', () => {
  it('drops www', () => {
    expect(hostOf('https://www.nouns.camp/')).toBe('nouns.camp');
    expect(hostOf('nope')).toBe('');
  });
});
