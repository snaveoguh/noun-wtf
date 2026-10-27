import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { FreestyleDancer, RemoteDancers } from './dance';
import { decodeFs, encodeFs } from './wire';

// A copy of view/rig.test.ts's skeleton (the GLB's bind pose): a stand-in
// NounCharacter (root / body / head) for the drivers.
// The Noun rig's skeleton as public/world2/noun_character.glb ships it
// (bind translations + rotations from the file).
type Node = [string, [number, number, number], [number, number, number, number], Node[]];
const SKELETON: Node = [
  'root',
  [0, 0, 0],
  [0, 0, 0, 1],
  [
    [
      'hips',
      [0, 0.56, 0],
      [0, 0, 0, 1],
      [
        [
          'spine',
          [0, 0.12, 0],
          [0, 0, 0, 1],
          [
            [
              'chest',
              [0, 0.18, 0],
              [0, 0, 0, 1],
              [
                ['neck', [0, 0.18, 0], [0, 0, 0, 1], [['head', [0, 0.11, 0], [0, 0, 0, 1], []]]],
                [
                  'shoulder.L',
                  [0.05, 0.14, 0],
                  [-0.5, -0.5, -0.5, 0.5],
                  [
                    [
                      'upperarm.L',
                      [0, 0.22, 0],
                      [-0.5, -0.5, 0.5, 0.5],
                      [
                        [
                          'forearm.L',
                          [0, 0.225, 0],
                          [0, 0, 0, 1],
                          [['hand.L', [0, 0.19, 0], [0, 0, 0, 1], []]],
                        ],
                      ],
                    ],
                  ],
                ],
                [
                  'shoulder.R',
                  [-0.05, 0.14, 0],
                  [-0.5, 0.5, 0.5, 0.5],
                  [
                    [
                      'upperarm.R',
                      [0, 0.22, 0],
                      [-0.5, 0.5, -0.5, 0.5],
                      [
                        [
                          'forearm.R',
                          [0, 0.225, 0],
                          [0, 0, 0, 1],
                          [['hand.R', [0, 0.19, 0], [0, 0, 0, 1], []]],
                        ],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
        ...(['L', 'R'] as const).map(
          (s): Node => [
            `thigh.${s}`,
            [s === 'L' ? 0.09 : -0.09, -0.04, 0],
            [1, 0, 0, 0],
            [
              [
                `shin.${s}`,
                [0, 0.22, 0],
                [0, 0, 0, 1],
                [
                  [
                    `foot.${s}`,
                    [0, 0.215, 0],
                    [-0.502, 0, 0, 0.865],
                    [[`toe.${s}`, [0, 0.115, 0], [0, 0.967, -0.256, 0], []]],
                  ],
                ],
              ],
            ],
          ],
        ),
      ],
    ],
  ],
];

function build(n: Node): THREE.Bone {
  const b = new THREE.Bone();
  b.name = n[0];
  b.position.set(...n[1]);
  b.quaternion.set(...n[2]).normalize();
  for (const c of n[3]) b.add(build(c));
  return b;
}

function makeRig() {
  const space = new THREE.Group();
  const body = new THREE.Group();
  space.add(body);
  const model = new THREE.Group();
  body.add(model);
  model.add(build(SKELETON));
  // The Noun head: a 1.15 × 1.0 × 0.85 box sitting on the head bone, origin bottom-centre
  const headBone = model.getObjectByName('head')!;
  const head = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.0, 0.85));
  box.position.y = 0.5;
  head.add(box);
  head.position.y = -0.15;
  headBone.add(head);
  space.updateMatrixWorld(true);
  return { root: space, body, head, model };
}

const at = (rig: ReturnType<typeof makeRig>, name: string) => {
  rig.root.updateMatrixWorld(true);
  return rig.model.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
};

/** A rider's blob as it crosses the wire and comes out the other side. */
const viaWire = (move: Parameters<typeof encodeFs>[0]) =>
  decodeFs(JSON.parse(JSON.stringify({ fs: encodeFs(move) })).fs);

describe('a remote rider freestyling (blob → pose)', () => {
  it('decodes their blob and dances it: a headspin turns them upside down', () => {
    const rig = makeRig();
    const remotes = new RemoteDancers();
    let fs = viaWire({ move: 'headspin', seq: 7, b: 0.5, n: 4, bpm: 95 });
    for (let i = 0; i < 60; i++) {
      // a fresh blob every 4th frame (15 Hz at 60 fps), the beat moving on at 95 bpm
      if (i % 4 === 0)
        fs = viaWire({ move: 'headspin', seq: 7, b: 0.5 + (i / 60) * (95 / 60), n: 4, bpm: 95 });
      remotes.update('rider', rig, fs, 1 / 60);
    }
    const r = remotes.map.get('rider')!;
    expect(r.dancer.procW).toBeGreaterThan(0.99);
    expect(r.step).toMatchObject({ move: 'headspin', seq: 7, n: 4 });
    // upside down: the (1 m) head under the body, the hips way up
    expect(at(rig, 'head').y).toBeLessThan(at(rig, 'hips').y - 0.3);
    expect(at(rig, 'hips').y).toBeGreaterThan(1.2);
    expect(r.dancer.driver.finite()).toBe(true);
  });

  it('keeps its own beat between blobs and re-locks the phase to each one', () => {
    const rig = makeRig();
    const remotes = new RemoteDancers();
    remotes.update('r', rig, viaWire({ move: 'windmill', seq: 1, b: 1, n: 4, bpm: 120 }), 0);
    const r = remotes.map.get('r')!;
    const start = r.step!.start;
    // half a second later, the same blob (no new sample): the step stays put, the beat moves on
    remotes.update('r', rig, r.seen, 0.5);
    expect(r.step!.start).toBeCloseTo(start);
    expect(r.beat - r.step!.start).toBeCloseTo(2, 5);
    // a fresh sample 0.2 beat ahead of where we thought: glides toward it
    remotes.update('r', rig, viaWire({ move: 'windmill', seq: 1, b: 2.2, n: 4, bpm: 120 }), 0);
    expect(r.beat - r.step!.start).toBeGreaterThan(2);
    expect(r.beat - r.step!.start).toBeLessThan(2.2);
    // a new seq: a new step, right on the blob's phase
    remotes.update('r', rig, viaWire({ move: 'baby_freeze', seq: 2, b: 0.25, n: 2, bpm: 120 }), 0);
    expect(r.step!.move).toBe('baby_freeze');
    expect(r.beat - r.step!.start).toBeCloseTo(0.25, 5);
  });

  it('fades back to the clip when the key goes away, then forgets them', () => {
    const rig = makeRig();
    const remotes = new RemoteDancers();
    const fs = viaWire({ move: 'airchair', seq: 3, b: 1, n: 3, bpm: 95 });
    for (let i = 0; i < 30; i++) remotes.update('r', rig, fs, 1 / 60);
    expect(remotes.map.has('r')).toBe(true);
    for (let i = 0; i < 60; i++) remotes.update('r', rig, null, 1 / 60);
    expect(remotes.map.has('r')).toBe(false);
    expect(rig.body.position.y).toBe(0);
  });

  it('costs nothing for riders who are not dancing', () => {
    const remotes = new RemoteDancers();
    remotes.update('idle', makeRig(), null, 1 / 60);
    expect(remotes.map.size).toBe(0);
  });

  it('prunes riders who left; a rebuilt character gets a new driver', () => {
    const remotes = new RemoteDancers();
    const fs = viaWire({ move: 'flare', seq: 1, b: 0, n: 2, bpm: 95 });
    remotes.update('a', makeRig(), fs, 1 / 60);
    remotes.update('b', makeRig(), fs, 1 / 60);
    const b2 = makeRig();
    remotes.update('b', b2, fs, 1 / 60);
    expect(remotes.map.get('b')!.dancer.rig).toBe(b2);
    remotes.prune(id => id === 'b');
    expect([...remotes.map.keys()]).toEqual(['b']);
  });
});

describe('my own dancer', () => {
  it('crossfades move to move and stays finite', () => {
    const rig = makeRig();
    const d = new FreestyleDancer(rig);
    expect(d.ok).toBe(true);
    let beat = 0;
    const steps = [
      { move: 'indian_step' as const, start: 0, n: 4, seq: 1 },
      { move: 'drop' as const, start: 4, n: 1, seq: 2 },
      { move: 'windmill' as const, start: 5, n: 4, seq: 3 },
      { move: 'baby_freeze' as const, start: 9, n: 2, seq: 4 },
    ];
    for (let i = 0; i < 13 * 40; i++) {
      beat += 1 / 40;
      const s = [...steps].reverse().find(x => x.start <= beat)!;
      d.drive(1 / 60, s, beat, 95, 1);
      expect(d.driver.finite()).toBe(true);
      expect(d.driver.lowest()).toBeGreaterThan(-0.06);
    }
    expect(d.procW).toBe(1);
    for (let i = 0; i < 60; i++) d.drive(1 / 60, null, beat, 95, 0);
    expect(d.idle).toBe(true);
  });
});
