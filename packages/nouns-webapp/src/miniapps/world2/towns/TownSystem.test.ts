import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { placementOf, townFrameNow, townToWorld } from './site';
import { TownSystem, type TownHost } from './TownSystem';

function host(pos: THREE.Vector3, toasts: string[], game: object = {}): TownHost {
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    canvas: document.createElement('canvas'),
    labelLayer: layer,
    toon: false,
    quality: 'low',
    assets: () => null,
    player: { pos, vel: new THREE.Vector3() },
    controlYaw: () => 0,
    toast: (text, tag) => toasts.push(`${text}|${tag}`),
    game,
  };
}

const cowboy = townFrameNow('cowboy')!;
const beach = townFrameNow('beach')!;

describe('TownsApi', () => {
  it('places the city and both grown towns', () => {
    const sys = new TownSystem(host(new THREE.Vector3(), []));
    const ids = sys.placed().map(p => p.id);
    expect(ids).toContain('city');
    expect(ids).toContain('cowboy');
    expect(ids).toContain('beach');
    const pc = sys.placed().find(p => p.id === 'cowboy')!;
    expect(pc).toEqual(placementOf(cowboy));
    sys.dispose();
  });

  it('townAt: plaza, main street, the lagoon, open slope', () => {
    const sys = new TownSystem(host(new THREE.Vector3(), []));
    expect(sys.townAt(0, 0)).toBe('city');
    expect(sys.townAt(300, 0)).toBeNull();
    const w = townToWorld(cowboy, 0, 120, { x: 0, z: 0 });
    expect(sys.townAt(w.x, w.z)).toBe('cowboy');
    townToWorld(beach, 90, 120, w);
    expect(sys.townAt(w.x, w.z)).toBe('beach');
    townToWorld(beach, 0, -200, w);
    expect(sys.townAt(w.x, w.z)).toBeNull();
    sys.dispose();
  });

  it('fires enter / leave and drops the arrival banner', () => {
    const pos = new THREE.Vector3(0, 0, 0);
    const toasts: string[] = [];
    const sys = new TownSystem(host(pos, toasts));
    const log: string[] = [];
    sys.on('enter', t => log.push(`+${t}`));
    const off = sys.on('leave', t => log.push(`-${t}`));
    sys.update(0.3);
    const w = townToWorld(cowboy, 0, 100, { x: 0, z: 0 });
    pos.set(w.x, cowboy.P, w.z);
    sys.update(0.3);
    pos.set(w.x + 5000, 0, w.z);
    sys.update(0.3);
    expect(log).toEqual(['+city', '-city', '+cowboy', '-cowboy']);
    expect(toasts[0]).toMatch(/^DRY GULCH\|.*WATER ↑.*ICE CREAM ↑/);
    off();
    sys.dispose();
  });

  it('uses the van position while driving (game.van2)', () => {
    const toasts: string[] = [];
    const w = townToWorld(beach, 0, 60, { x: 0, z: 0 });
    const van = {
      driving: true,
      pos: { x: w.x, y: beach.P, z: w.z },
      heading: 0,
      speed: 20,
      on: () => () => {},
    };
    const sys = new TownSystem(host(new THREE.Vector3(), toasts, { van2: van }));
    const log: string[] = [];
    sys.on('enter', t => log.push(t));
    sys.update(0.3);
    expect(log).toEqual(['beach']);
    expect(toasts[0]).toMatch(/^PUERTO NOUN\|.*DRIP ↑/);
    sys.dispose();
  });

  it('map pins carry names and rough distances', () => {
    const sys = new TownSystem(host(new THREE.Vector3(), []));
    const pts = sys.mapPoints(true);
    expect(pts.map(p => p.name)).toEqual([
      'Dry Gulch',
      'Puerto Noun',
      'Noggle City',
      'Shroom Hollow',
      'Neon Nouns',
      'Crater Lil',
      'Powder Peak',
      'Loon Lake',
      'Diesel Flats',
    ]);
    expect(pts[0].km).toBeGreaterThanOrEqual(9);
    expect(pts[1].km).toBeGreaterThanOrEqual(23);
    // The weird towns are all 22+ km out
    for (const p of pts.slice(2, 6)) expect(p.km).toBeGreaterThanOrEqual(22);
    // The road trip's side towns: the ski village up high, the lake, the truck stop
    expect(pts.slice(6).map(p => p.km)).toEqual([3, 13, 18]);
    sys.dispose();
  });
});
