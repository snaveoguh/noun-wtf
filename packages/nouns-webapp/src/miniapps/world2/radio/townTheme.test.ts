import { describe, expect, it } from 'vitest';

import { introAllowed } from './FmSpots';
import { TOWN_THEME_COOLDOWN_MS, townThemeStep, type TownThemeState } from './townTheme';

const FRESH: TownThemeState = { lastStart: -Infinity, playing: false };

describe("Dry Gulch's theme", () => {
  it('plays on entering the cowboy town and fades on leaving', () => {
    const a = townThemeStep(FRESH, 'enter', 'cowboy', 1000, false);
    expect(a.action).toBe('play');
    const b = townThemeStep(a.state, 'leave', 'cowboy', 20_000, false);
    expect(b.action).toBe('stop');
    expect(b.state.playing).toBe(false);
  });

  it('ignores other towns', () => {
    expect(townThemeStep(FRESH, 'enter', 'beach', 0, false).action).toBe('none');
  });

  it("doesn't replay within five minutes of the last start", () => {
    const a = townThemeStep(FRESH, 'enter', 'cowboy', 0, false);
    const b = townThemeStep(a.state, 'leave', 'cowboy', 60_000, false);
    expect(townThemeStep(b.state, 'enter', 'cowboy', 120_000, false).action).toBe('none');
    expect(
      townThemeStep(b.state, 'enter', 'cowboy', TOWN_THEME_COOLDOWN_MS + 1, false).action,
    ).toBe('play');
  });

  it('stays quiet while blocked (replay / the Upside Down / the intro), and a blocked entry costs no cooldown', () => {
    const a = townThemeStep(FRESH, 'enter', 'cowboy', 0, true);
    expect(a.action).toBe('none');
    expect(a.state).toEqual(FRESH);
    expect(townThemeStep(a.state, 'leave', 'cowboy', 10, false).action).toBe('none');
  });

  it('leaving while not playing does nothing', () => {
    expect(townThemeStep(FRESH, 'leave', 'cowboy', 0, false).action).toBe('none');
  });
});

describe('station intro gate', () => {
  const base = {
    enabled: true,
    played: false,
    offline: false,
    forced: false,
    replay: false,
    fmMode: true,
  };
  it('plays once, on NOUN FM, when enabled', () => {
    expect(introAllowed(base)).toBe(true);
    expect(introAllowed({ ...base, played: true })).toBe(false);
    expect(introAllowed({ ...base, enabled: false })).toBe(false);
    expect(introAllowed({ ...base, fmMode: false })).toBe(false);
    expect(introAllowed({ ...base, replay: true })).toBe(false);
  });
  it('never in offline test runs unless forced', () => {
    expect(introAllowed({ ...base, offline: true })).toBe(false);
    expect(introAllowed({ ...base, offline: true, forced: true })).toBe(true);
  });
});
