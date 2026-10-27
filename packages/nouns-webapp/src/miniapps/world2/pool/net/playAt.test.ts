import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { BAR_TABLE, tableOf } from './tableOf';

describe('playAt arguments (tableOf)', () => {
  it('takes a position + yaw (the bar prop size)', () => {
    const v = new THREE.Vector3(12.3, 0.5, -4);
    expect(tableOf(v, 1.2)).toEqual({ x: 12.3, y: 0.5, z: -4, yaw: 1.2, ...BAR_TABLE });
  });
  it('takes a whole PoolTable as it is', () => {
    const t = { x: 1, y: 2, z: 3, yaw: 0.4, length: 2.6, width: 1.4, height: 0.8, id: 'bar7' };
    expect(tableOf(t)).toEqual(t);
  });
  it('a separate yaw wins over the object one, and the copy keeps no extras', () => {
    const t = tableOf({ x: 0, y: 0, z: 0, yaw: 0.4, length: 2.3, width: 1.3 }, -0.2);
    expect(t.yaw).toBe(-0.2);
    expect(t.height).toBe(BAR_TABLE.height);
    expect('id' in t).toBe(false);
  });
});
