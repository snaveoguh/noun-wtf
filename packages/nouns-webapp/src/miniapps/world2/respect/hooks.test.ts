import type { BuildingDoor } from '../interiors/contract';

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { PIXELS } from '../../../components/NounOS/home/introScene';
import { createCombo, bankCombo, addTrick, bailCombo } from '../skate/Tricks';

import { LEGEND_BADGE, nogglesSvg, tipBonus } from './effects';
import {
  classifyTag,
  nearestWho,
  PIECE_STROKES,
  RespectHooks,
  type RespectHookGame,
} from './hooks';
import { RespectSystem } from './RespectSystem';

const door = (
  id: string,
  x: number,
  z: number,
  kind?: BuildingDoor['kind'],
  foot = true,
): BuildingDoor => ({
  id,
  area: 'plaza',
  x,
  y: 0,
  z,
  yaw: 0,
  width: 1.4,
  ...(foot ? { footprint: { minX: x - 5, minZ: z, maxX: x + 5, maxZ: z + 8, height: 9 } } : {}),
  ...(kind !== undefined ? { kind } : {}),
});

describe('classifyTag', () => {
  const doors = [
    door('home1', 0, 0, 'home'),
    door('cafe1', 30, 0, 'cafe'),
    door('x', 60, 0, undefined, false),
  ];
  const kindOf = (d: BuildingDoor) => d.kind ?? null;

  it('a tag on a home is a home', () => {
    expect(classifyTag({ x: 2, y: 3, z: -0.5 }, doors, kindOf)).toEqual({
      home: true,
      building: 'home1',
    });
  });
  it('a tag on a cafe is that building, not a home', () => {
    expect(classifyTag({ x: 31, y: 3, z: 4 }, doors, kindOf)).toEqual({
      home: false,
      building: 'cafe1',
    });
  });
  it('a plain wall far from any door is no building', () => {
    expect(classifyTag({ x: 15, y: 2, z: 30 }, doors, kindOf)).toBeNull();
  });
  it('above the roof does not count', () => {
    expect(classifyTag({ x: 0, y: 20, z: 2 }, doors, kindOf)).toBeNull();
  });
  it("no footprint: within 5 m of the door; an unknown kind is someone's home", () => {
    expect(classifyTag({ x: 62, y: 1, z: 1 }, doors, kindOf)).toEqual({
      home: true,
      building: 'x',
    });
    expect(classifyTag({ x: 70, y: 1, z: 1 }, doors, kindOf)).toBeNull();
  });
});

describe('nearestWho', () => {
  const people = [
    { name: 'far', pos: { x: 10, y: 0, z: 0 } },
    { name: 'near', pos: { x: 1, y: 0, z: 1 } },
    { name: 'above', pos: { x: 0.2, y: 5, z: 0 } },
  ];
  it('the closest within reach, ignoring other levels', () => {
    expect(nearestWho({ x: 0, y: 0, z: 0 }, people)).toBe('near');
    expect(nearestWho({ x: 30, y: 0, z: 0 }, people)).toBeNull();
  });
});

function fakeGame(doors: BuildingDoor[] = [], score?: number) {
  const now = Date.now();
  const book = { score, tier: 'legend', at: now, log: [] };
  const storage =
    score === undefined
      ? null
      : { getItem: () => JSON.stringify({ v: 1, book }), setItem: () => undefined };
  const respect = new RespectSystem({ storage, timers: false });
  const g: RespectHookGame & { interiors: unknown; missions: { ud: { active: boolean } } } = {
    respect,
    player: { pos: new THREE.Vector3(), combo: createCombo() },
    net: {
      players: new Map([
        ['p1', { name: 'Remote Rider', current: { pos: new THREE.Vector3(1, 0, 0) } }],
      ]),
      respectBadge: '',
    },
    crew: { npcs: [{ name: 'Ziggy', pos: new THREE.Vector3(0, 0, 5) }] },
    towns: { customersOf: () => [] },
    voice: { speak: vi.fn() },
    interiors: { current: () => null, doors: () => doors },
    missions: { ud: { active: false } },
  };
  return { g, respect, hooks: new RespectHooks(g) };
}

describe('RespectHooks', () => {
  it('a banked clean combo is a trick; a bailed one is not; each bank once', () => {
    const { g, respect, hooks } = fakeGame();
    const c = g.player.combo;
    addTrick(c, 'Kickflip', 3000);
    addTrick(c, 'Heelflip', 3000);
    bankCombo(c, 1);
    hooks.frame();
    hooks.frame();
    expect(respect.state().recent).toHaveLength(1);
    expect(respect.state().recent[0]!.label).toBe('landed a 12,000 combo');
    addTrick(c, 'Kickflip', 30000);
    bailCombo(c, 2);
    hooks.frame();
    expect(respect.state().recent).toHaveLength(1);
  });

  it('nothing counts in the Big Drop', () => {
    const { g, respect, hooks } = fakeGame();
    g.missions.ud.active = true;
    addTrick(g.player.combo, 'Kickflip', 30000);
    bankCombo(g.player.combo, 1);
    hooks.frame();
    hooks.bail();
    expect(respect.state().score).toBe(0);
  });

  it('a bail next to someone is a bail into them', () => {
    const { respect, hooks } = fakeGame();
    hooks.bail();
    expect(respect.state().recent[0]!.label).toBe('bailed into Remote Rider');
  });

  it('a bail with nobody near costs nothing', () => {
    const { g, respect, hooks } = fakeGame();
    g.player.pos.set(100, 0, 100);
    hooks.bail();
    expect(respect.state().score).toBe(0);
  });

  it('tagging a home costs; a dozen strokes on a plain wall is a piece, once', () => {
    const { respect, hooks } = fakeGame([door('home1', 0, 0, 'home')]);
    hooks.stroke('plane-home', { x: 1, y: 2, z: -0.4 });
    expect(respect.state().score).toBe(-10);
    for (let i = 0; i < PIECE_STROKES * 2; i++) hooks.stroke('plane-wall', { x: 50, y: 2, z: 50 });
    expect(respect.state().score).toBe(-8);
    expect(respect.state().recent[0]!.label).toBe('put up a piece');
  });

  it('the legend badge follows the tier', () => {
    const plain = fakeGame();
    plain.hooks.frame();
    expect(plain.g.net.respectBadge).toBe('');
    const { g, respect, hooks } = fakeGame([], 700);
    hooks.frame();
    expect(g.net.respectBadge).toBe('L');
    hooks.wave(
      'Ziggy',
      { background: 0, body: 1, accessory: 2, head: 3, glasses: 4 },
      new THREE.Vector3(0, 0, 3),
    );
    expect(g.voice.speak).toHaveBeenCalledTimes(1);
    expect(respect.ticker()[0]!.label).toMatch(/^Ziggy: "/);
    // Not again straight away
    hooks.wave(
      'Ziggy',
      { background: 0, body: 1, accessory: 2, head: 3, glasses: 4 },
      new THREE.Vector3(0, 0, 3),
    );
    expect(g.voice.speak).toHaveBeenCalledTimes(1);
  });

  it('nobody greets a non-legend', () => {
    const { g, hooks } = fakeGame();
    hooks.wave(
      'Ziggy',
      { background: 0, body: 1, accessory: 2, head: 3, glasses: 4 },
      new THREE.Vector3(),
    );
    expect(g.voice.speak).not.toHaveBeenCalled();
  });
});

describe('effects', () => {
  it('tips a little more the better known you are (never the price)', () => {
    expect(tipBonus(10, 'stranger')).toBe(10);
    expect(tipBonus(10, 'legend')).toBe(12);
    expect(tipBonus(10, 'outcast')).toBe(9);
    expect(tipBonus(10, undefined)).toBe(10);
  });

  it('the legend badge is the canonical noggles, pixel for pixel', () => {
    expect(nogglesSvg().match(/<rect /g)).toHaveLength(PIXELS.length);
    expect(LEGEND_BADGE).toContain('data:image/svg+xml');
  });
});
