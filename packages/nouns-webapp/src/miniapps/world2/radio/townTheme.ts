// ── Dry Gulch's theme: "Sell It Cold" when you ride into the cowboy town ──
//
// Pure rules (the playing lives in FmSpots): the theme starts on entering
// Dry Gulch, once per visit, not again if you rode in within the last five
// minutes, never while something else owns the moment (a replay, the Upside
// Down, a cutscene, the start-of-game intro). Leaving town fades it out.

export const TOWN_THEME_TOWN = 'cowboy';
export const TOWN_THEME_SONG = 'sell-it-cold';
export const TOWN_THEME_COOLDOWN_MS = 5 * 60_000;
export const TOWN_THEME_FADE_S = 2;

export interface TownThemeState {
  /** When the theme last started (ms), -Infinity if never. */
  lastStart: number;
  playing: boolean;
}

export type TownThemeAction = 'play' | 'stop' | 'none';

export function townThemeStep(
  st: TownThemeState,
  ev: 'enter' | 'leave',
  town: string,
  now: number,
  blocked: boolean,
): { action: TownThemeAction; state: TownThemeState } {
  if (town !== TOWN_THEME_TOWN) return { action: 'none', state: st };
  if (ev === 'leave')
    return st.playing
      ? { action: 'stop', state: { ...st, playing: false } }
      : { action: 'none', state: st };
  if (st.playing || blocked || now - st.lastStart < TOWN_THEME_COOLDOWN_MS)
    return { action: 'none', state: st };
  return { action: 'play', state: { lastStart: now, playing: true } };
}
