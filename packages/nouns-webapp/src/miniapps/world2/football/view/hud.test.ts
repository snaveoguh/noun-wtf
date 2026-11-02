import { describe, expect, it } from 'vitest';

import {
  addedChip,
  formatClock,
  hexCss,
  inkOn,
  minuteLabel,
  mmss,
  periodLabel,
  setPieceHint,
} from './hudFormat';
import { HudStore } from './hudStore';
import { LOD_HIGH, LOD_LOW, posesThisFrame, tierOf } from './lod';

describe('HUD clock formatting', () => {
  it('mm:ss, past 99 minutes too', () => {
    expect(mmss(0)).toBe('00:00');
    expect(mmss(65.9)).toBe('01:05');
    expect(mmss(45 * 60)).toBe('45:00');
    expect(mmss(105 * 60 + 7)).toBe('105:07');
  });

  it('stops at the end of the period and counts stoppage time beside it', () => {
    expect(formatClock(23 * 60 + 4, 1)).toEqual({ main: '23:04', extra: null });
    expect(formatClock(45 * 60, 1)).toEqual({ main: '45:00', extra: null });
    expect(formatClock(45 * 60 + 72, 1)).toEqual({ main: '45:00', extra: '+1:12' });
    expect(formatClock(90 * 60 + 185, 2)).toEqual({ main: '90:00', extra: '+3:05' });
    expect(formatClock(100 * 60, 3)).toEqual({ main: '100:00', extra: null });
    expect(formatClock(121 * 60, 4)).toEqual({ main: '120:00', extra: '+1:00' });
    expect(formatClock(0, 5).main).toBe('PENS');
  });

  it('added time chip and minute labels', () => {
    expect(addedChip(0)).toBeNull();
    expect(addedChip(180)).toBe('+3');
    expect(addedChip(150)).toBe('+3');
    expect(addedChip(20)).toBe('+1');
    expect(minuteLabel(0, 1)).toBe("1'");
    expect(minuteLabel(22 * 60 + 30, 1)).toBe("23'");
    expect(minuteLabel(45 * 60 + 70, 1)).toBe("45+2'");
    expect(minuteLabel(89 * 60 + 59, 2)).toBe("90'");
  });

  it('period labels', () => {
    expect(periodLabel(1, 'live')).toBe('1ST');
    expect(periodLabel(2, 'live')).toBe('2ND');
    expect(periodLabel(3, 'live')).toBe('ET 1');
    expect(periodLabel(5, 'shootout')).toBe('PENS');
    expect(periodLabel(1, 'halftime')).toBe('HT');
    expect(periodLabel(2, 'fulltime')).toBe('FT');
  });

  it('kit colours and hints', () => {
    expect(hexCss(0xd22209)).toBe('#d22209');
    expect(hexCss(0x00ff)).toBe('#0000ff');
    expect(inkOn(0xffffff)).toBe('#0b0b12');
    expect(inkOn(0x0b1f4a)).toBe('#ffffff');
    expect(setPieceHint({ kind: 'corner', team: 0, x: 0, z: 0, taker: null }, 0)).toContain(
      'CORNER',
    );
    expect(setPieceHint({ kind: 'corner', team: 1, x: 0, z: 0, taker: null }, 0)).toContain(
      'DEFEND',
    );
    expect(setPieceHint(null, 0)).toBeNull();
    expect(setPieceHint({ kind: 'penalty', team: 0, x: 0, z: 0, taker: null }, null)).toBeNull();
  });
});

describe('HUD store', () => {
  it('only notifies on a real change', () => {
    const st = new HudStore({
      teams: [
        { name: 'A', short: 'AAA', shirt: '#f00', shorts: '#fff', ink: '#fff' },
        { name: 'B', short: 'BBB', shirt: '#00f', shorts: '#fff', ink: '#fff' },
      ],
      score: [0, 0],
      clock: '00:00',
      extra: null,
      added: null,
      period: '1ST',
      phase: 'live',
      poss: 0,
      banners: [],
      hint: null,
      shootout: null,
      replay: false,
      wipe: 0,
      local: null,
      localTeam: null,
    });
    let n = 0;
    st.subscribe(() => n++);
    st.set({ clock: '00:00' });
    expect(n).toBe(0);
    st.set({ clock: '00:01' });
    expect(n).toBe(1);
  });
});

describe('footballer LOD', () => {
  it('tiers by distance; the important ones are always near', () => {
    expect(tierOf(10, false, LOD_HIGH)).toBe(0);
    expect(tierOf(50, false, LOD_HIGH)).toBe(1);
    expect(tierOf(90, false, LOD_HIGH)).toBe(2);
    expect(tierOf(90, true, LOD_HIGH)).toBe(0);
    expect(tierOf(30, false, LOD_LOW)).toBe(1);
  });

  it('spreads the solves: mid every 2nd frame, far every 3rd/4th, none off screen', () => {
    const count = (tier: 0 | 1 | 2, cfg = LOD_HIGH, on = true) => {
      let n = 0;
      for (let f = 0; f < 120; f++) if (posesThisFrame(tier, f, 5, cfg, on)) n++;
      return n;
    };
    expect(count(0)).toBe(120);
    expect(count(1)).toBe(60);
    expect(count(2)).toBe(40);
    expect(count(2, LOD_LOW)).toBe(30);
    expect(count(0, LOD_HIGH, false)).toBe(0);
    // 22 mid-tier footballers: about half posed on any frame
    for (let f = 0; f < 4; f++) {
      let n = 0;
      for (let i = 0; i < 22; i++) if (posesThisFrame(1, f, i, LOD_HIGH, true)) n++;
      expect(n).toBe(11);
    }
  });
});
