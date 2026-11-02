// Test-only: the Noun rig's skeleton as plain THREE.Bones (copied from
// breakdance/view/rig.test.ts) + a PoseDriver on it, for pose tests.

import * as THREE from 'three';

import { PoseDriver } from '../../breakdance/view/rig';

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

export function makeRig() {
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
  const driver = new PoseDriver(space, body, body, head);
  return { space, body, model, driver };
}

export const at = (rig: ReturnType<typeof makeRig>, name: string) => {
  rig.space.updateMatrixWorld(true);
  const o = rig.model.getObjectByName(name)!;
  return o.getWorldPosition(new THREE.Vector3());
};
