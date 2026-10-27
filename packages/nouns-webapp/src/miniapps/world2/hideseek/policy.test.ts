// Who sees whose name tag in hide & seek (policy.ts), and the arena helpers.

import { describe, expect, it } from 'vitest';

import {
  ARENA,
  clampArena,
  doorOf,
  inArena,
  LOBBY_AVOID,
  LOBBY_CANDIDATES,
  pickLobby,
  startSlot,
} from './arena';
import { audible, hasPointer, labelFor, onMinimap } from './policy';

const G = 'game-1';
const hider = { gid: G, st: 'h' as const, phase: 'seek' as const };

describe('label policy', () => {
  it('hides an unfound hider from the seekers', () => {
    expect(labelFor({ gid: G, st: 's' }, hider)).toBe('hide');
    expect(labelFor({ gid: G, st: 'f' }, hider)).toBe('hide');
  });

  it('shows a hider faintly to the other hiders in the same game', () => {
    expect(labelFor({ gid: G, st: 'h' }, hider)).toBe('faint');
  });

  it('hides them from bystanders and from other games too (nobody can relay)', () => {
    expect(labelFor({ gid: null, st: null }, hider)).toBe('hide');
    expect(labelFor({ gid: 'other', st: 'h' }, hider)).toBe('hide');
  });

  it('hides them in the hide phase as well', () => {
    expect(labelFor({ gid: G, st: 's' }, { ...hider, phase: 'hide' })).toBe('hide');
  });

  it('shows seekers, found hiders, the reveal and players in no game', () => {
    expect(labelFor({ gid: G, st: 'h' }, { gid: G, st: 's', phase: 'seek' })).toBe('show');
    expect(labelFor({ gid: G, st: 's' }, { gid: G, st: 'f', phase: 'seek' })).toBe('show');
    expect(labelFor({ gid: G, st: 's' }, { ...hider, phase: 'reveal' })).toBe('show');
    expect(labelFor({ gid: G, st: 's' }, { ...hider, phase: 'over' })).toBe('show');
    expect(labelFor({ gid: G, st: 's' }, { gid: null, st: null, phase: null })).toBe('show');
  });

  it('no minimap dot or pointer unless the tag shows in full; faint stays audible', () => {
    expect([onMinimap('show'), onMinimap('faint'), onMinimap('hide')]).toEqual([
      true,
      false,
      false,
    ]);
    expect([hasPointer('show'), hasPointer('faint'), hasPointer('hide')]).toEqual([
      true,
      false,
      false,
    ]);
    expect([audible('show'), audible('faint'), audible('hide')]).toEqual([true, true, false]);
  });
});

describe('arena', () => {
  it('clamps into the box and says which axis moved', () => {
    const p = { x: ARENA.half + 5, z: -3 };
    expect(clampArena(p)).toEqual({ x: true, z: false });
    expect(p.x).toBe(ARENA.half);
    expect(inArena(0, 0)).toBe(true);
    expect(inArena(0, ARENA.half + 1)).toBe(false);
  });

  it('keeps the lobby clear of the cypher and the fountain', () => {
    for (const [x, z] of LOBBY_CANDIDATES) {
      expect(Math.hypot(x, z + 15)).toBeGreaterThan(12);
      expect(Math.hypot(x, z)).toBeGreaterThan(12);
    }
    expect(LOBBY_AVOID.some(([x, z]) => x === 0 && z === -15)).toBe(true);
  });

  it('picks the first clear, flat candidate', () => {
    const flat = () => ({ y: 0, flat: true });
    expect(pickLobby(flat)).toMatchObject({
      x: LOBBY_CANDIDATES[0]![0],
      z: LOBBY_CANDIDATES[0]![1],
    });
    // First one's on a slope: the next
    const [fx, fz] = LOBBY_CANDIDATES[0]!;
    const s = pickLobby((x, z) =>
      Math.hypot(x - fx, z - fz) < 5 ? { y: 0, flat: false } : flat(),
    );
    expect(s).toMatchObject({ x: LOBBY_CANDIDATES[1]![0], z: LOBBY_CANDIDATES[1]![1] });
    expect(pickLobby(() => null)).toBeNull();
  });

  it('spreads the start ring round the lobby', () => {
    const l = { x: 10, y: 0, z: 10, yaw: 0 };
    const a = startSlot(l, 0, 6);
    const b = startSlot(l, 3, 6);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(4);
    expect(startSlot(l, 0, 1)).toMatchObject({ x: 10, z: 10 });
  });

  it('finds the building someone is inside (up in the pockets) by the nearest door', () => {
    const doors = [
      { id: 'a', x: 0, z: 76 },
      { id: 'b', x: 20, z: 76 },
    ];
    expect(doorOf({ x: 18, y: 4000, z: 80 }, doors)?.id).toBe('b');
    expect(doorOf({ x: 18, y: 2, z: 80 }, doors)).toBeNull();
  });
});
