import { beforeEach, describe, expect, it } from 'vitest';

import { forgetSet, loadSetHistory, rememberSet, SET_HISTORY_MAX } from './setHistory';

const track = (n: number) =>
  ({
    src: { kind: 'direct', url: `https://cdn.example/${n}.mp3` },
    title: `t${n}`,
    artist: 'a',
    dur: 120,
  }) as never;

describe('NOUN FM set history', () => {
  beforeEach(() => localStorage.clear());

  it('remembers booked sets newest first and survives a reload', () => {
    rememberSet({ dj: 'NOUN', name: 'sunset', tracks: [track(1), track(2)] }, 1);
    rememberSet({ dj: 'NOUN', name: 'night', tracks: [track(3)] }, 2);
    const h = loadSetHistory();
    expect(h.map(s => s.name)).toEqual(['night', 'sunset']);
    expect(h[1]!.tracks).toHaveLength(2);
  });

  it('re-booking the same set moves it to the top instead of duplicating', () => {
    rememberSet({ dj: 'NOUN', name: 'sunset', tracks: [track(1)] }, 1);
    rememberSet({ dj: 'NOUN', name: 'night', tracks: [track(2)] }, 2);
    rememberSet({ dj: 'NOUN', name: 'sunset', tracks: [track(1)] }, 3);
    expect(loadSetHistory().map(s => [s.name, s.at])).toEqual([
      ['sunset', 3],
      ['night', 2],
    ]);
  });

  it('caps the list, forgets on request and ignores junk', () => {
    for (let i = 0; i < SET_HISTORY_MAX + 5; i++)
      rememberSet({ dj: 'D', name: `s${i}`, tracks: [track(i)] }, i);
    expect(loadSetHistory()).toHaveLength(SET_HISTORY_MAX);
    expect(forgetSet(0)).toHaveLength(SET_HISTORY_MAX - 1);
    localStorage.setItem('noun-fm-set-history', '{"nope":1}');
    expect(loadSetHistory()).toEqual([]);
  });
});
