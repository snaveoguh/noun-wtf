import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { parseVehicle } from '../net/Net';

import { DRAGON_SCALE, dragonFromSeat } from './mesh';
import { SADDLE } from './model';
import { REMOTE_DRAGON_HIDE, RemoteDragons, type RemoteRiderView } from './remote';

describe('dragon on the wire', () => {
  it('parseVehicle: van and dragon, anything else is nothing (older / newer clients)', () => {
    expect(parseVehicle('van')).toBe('van');
    expect(parseVehicle('dragon')).toBe('dragon');
    expect(parseVehicle('ufo')).toBeUndefined();
    expect(parseVehicle(undefined)).toBeUndefined();
    expect(parseVehicle(1)).toBeUndefined();
  });

  it('the dragon sits under its rider: seat − rotated saddle offset', () => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.1, -0.3, 'YXZ'));
    const dragon = new THREE.Vector3(100, 50, -20);
    // the local ride puts the rider at group.localToWorld(SADDLE)
    const g = new THREE.Group();
    g.position.copy(dragon);
    g.quaternion.copy(q);
    g.scale.setScalar(DRAGON_SCALE);
    g.updateMatrixWorld(true);
    const seat = g.localToWorld(SADDLE.clone());
    const back = dragonFromSeat(seat, q, new THREE.Vector3());
    expect(back.distanceTo(dragon)).toBeLessThan(1e-6);
  });
});

function rider(vehicle: 'dragon' | 'van' | undefined, x = 0): RemoteRiderView {
  return {
    current: {
      pos: new THREE.Vector3(x, 40, 0),
      quat: new THREE.Quaternion(),
      speed: 30,
      vehicle,
    },
  };
}

describe('RemoteDragons', () => {
  const scene = new THREE.Scene();
  const host = { scene, toon: false, hidden: () => false };

  it('a dragon under each dragon rider, none for others; gone when they land or leave', () => {
    const rd = new RemoteDragons(host);
    const cam = new THREE.Vector3();
    const players = new Map<string, RemoteRiderView>([
      ['a', rider('dragon')],
      ['b', rider(undefined)],
      ['c', rider('van')],
    ]);
    rd.update(1 / 30, players, cam);
    expect(rd.count).toBe(1);
    expect(scene.children.filter(o => o.name === 'NounDragon').length).toBe(1);
    // lands
    players.set('a', rider(undefined));
    rd.update(1 / 30, players, cam);
    expect(rd.count).toBe(0);
    expect(scene.children.filter(o => o.name === 'NounDragon').length).toBe(0);
    // takes off again, then leaves the room
    players.set('a', rider('dragon'));
    rd.update(1 / 30, players, cam);
    expect(rd.count).toBe(1);
    players.delete('a');
    rd.update(1 / 30, players, cam);
    expect(rd.count).toBe(0);
    rd.dispose();
  });

  it('flaps near, holds still far, hides very far', () => {
    const rd = new RemoteDragons(host);
    const players = new Map([['a', rider('dragon', 0)]]);
    rd.update(1 / 30, players, new THREE.Vector3());
    const g = scene.children.find(o => o.name === 'NounDragon')!;
    const wing = g.children[1]!;
    const z0 = wing.rotation.z;
    rd.update(0.1, players, new THREE.Vector3());
    expect(wing.rotation.z).not.toBe(z0);
    rd.update(0.1, players, new THREE.Vector3(REMOTE_DRAGON_HIDE + 100, 0, 0));
    expect(g.visible).toBe(false);
    rd.dispose();
  });

  it('none in the Upside Down', () => {
    const rd = new RemoteDragons({ ...host, hidden: () => true });
    rd.update(1 / 30, new Map([['a', rider('dragon')]]), new THREE.Vector3());
    expect(rd.count).toBe(0);
  });
});
