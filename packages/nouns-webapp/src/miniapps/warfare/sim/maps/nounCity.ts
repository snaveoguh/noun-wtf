// ── "Noun City Night" — the plaza after dark, as a compact arena ───────
//
// Red base west, Blue base east, three lanes:
//   north street  (z −25 … −12): cars, a kiosk, the roof ramp up to a
//                                sniper perch + the sky bridge over the
//                                north connector (Turf zone A below it)
//   plaza         (z  −8 …  +8): the big ⌐◨-◨ statue (zone B), planters
//   south street  (z +12 … +25): bus shelter, cars, barriers (zone C)
// Buildings between the lanes, crossings in the middle (x −4.5 … 4.5) and
// next to each base, so every fight has a flank. Each base has a spawn
// screen so you can't be shot the moment you appear.

import type { BoxDef, MapDef, RampDef, SpawnDef } from '../world';

import { FACE_EAST, box, mirrorBoxX, mirrorRampX, mirrorSpawnX, ramp } from './kit';

function build(): MapDef {
  const shared: BoxDef[] = [
    box(-37, 37, -1, 0, -29, 29, 'floor'),
    // Outer city blocks (north + south)
    box(-37, 37, 0, 14, -29, -25.5, 'building'),
    box(-37, 37, 0, 14, 25.5, 29, 'building'),
    // The statue: plinth + giant noggles (a gap under the bridge to shoot through)
    box(-1.6, 1.6, 0, 1.2, -1.6, 1.6, 'statue'),
    box(-2.5, -0.45, 1.2, 2.7, -0.35, 0.35, 'statue', 0xd22209),
    box(0.45, 2.5, 1.2, 2.7, -0.35, 0.35, 'statue', 0xd22209),
    box(-0.45, 0.45, 2.1, 2.5, -0.25, 0.25, 'statue', 0xd22209),
    box(-3.5, -2.5, 2.1, 2.5, -0.25, 0.25, 'statue', 0xd22209),
    // Sky bridge between the north roofs (over the north crossing)
    box(-4.5, 4.5, 3.7, 4.0, -12, -8.6, 'bridge'),
    box(-4.5, 4.5, 4.0, 4.9, -12, -11.75, 'parapet'),
    box(-4.5, 4.5, 4.0, 4.9, -8.85, -8.6, 'parapet'),
    // South crossing: a jersey barrier to fight over
    box(-1.6, 1.6, 0, 1.05, 9.9, 10.7, 'barrier'),
  ];

  // West (red) half — mirrored to the east for blue.
  const west: BoxDef[] = [
    box(-37, -33, 0, 14, -29, 29, 'building'),
    // North block: a 4 m roof you can reach by the ramp (sniper perch)
    box(-18, -4.5, 0, 4, -12, -8.6, 'building'),
    box(-15.2, -4.5, 4, 4.8, -12, -11.75, 'parapet'),
    box(-16.5, -11.5, 4, 4.8, -8.85, -8.6, 'parapet'),
    box(-9, -6, 4, 4.8, -8.85, -8.6, 'parapet'),
    box(-18, -17.75, 4, 4.8, -11.75, -8.6, 'parapet'),
    // South block: tall shop fronts
    box(-18, -4.5, 0, 7, 8.6, 12, 'building'),
    // North street
    box(-14, -10, 0, 1.45, -21.2, -19.2, 'car'),
    box(-8.2, -6.2, 0, 2.4, -17.2, -15.6, 'kiosk'),
    box(-22, -19.6, 0, 1.3, -25.4, -23.8, 'dumpster'),
    box(-3.4, -1.4, 0, 1.05, -20.2, -19.4, 'barrier'),
    box(-27, -25, 0, 1.05, -20.5, -19.7, 'barrier'),
    // Plaza: L planters, benches, lamp posts
    box(-8.6, -5.4, 0, 1.0, -5.1, -4.1, 'planter'),
    box(-8.6, -7.6, 0, 1.0, -4.1, -2, 'planter'),
    box(-8.6, -5.4, 0, 1.0, 4.1, 5.1, 'planter'),
    box(-8.6, -7.6, 0, 1.0, 2, 4.1, 'planter'),
    box(-14, -12, 0, 0.55, -0.45, 0.45, 'bench'),
    box(-12.2, -11.8, 0, 4.6, -7.7, -7.3, 'pillar'),
    box(-12.2, -11.8, 0, 4.6, 7.3, 7.7, 'pillar'),
    box(-19.5, -18.7, 0, 1.15, -4.8, -2.8, 'barrier'),
    box(-19.5, -18.7, 0, 1.15, 2.8, 4.8, 'barrier'),
    // South street
    box(-12.2, -7.8, 0, 2.6, 22.8, 23.2, 'kiosk'),
    box(-12.4, -7.6, 2.6, 2.85, 21.4, 23.4, 'roof'),
    box(-17.2, -13, 0, 1.45, 15.2, 17.2, 'car'),
    box(-6.2, -4, 0, 1.05, 17.6, 18.4, 'barrier'),
    box(-25, -21, 0, 1.0, 18.2, 18.9, 'barrier'),
    box(-3.2, -1.2, 0, 1.3, 21.6, 23.4, 'dumpster'),
    // Red base: spawn screens around the plaza gap
    box(-24.6, -24, 0, 3, -8.6, -3, 'base'),
    box(-24.6, -24, 0, 3, 3, 8.6, 'base'),
    box(-28.2, -27.6, 0, 2.2, -1.9, 1.9, 'base'),
    box(-30.5, -28.5, 0, 1.1, -13.2, -12.4, 'base'),
    box(-30.5, -28.5, 0, 1.1, 12.4, 13.2, 'base'),
  ];

  const westRamps: RampDef[] = [
    // North-street ramp up onto the roof perch
    ramp(-17.6, -15.4, -20, -12, 0, 4, '+z'),
  ];

  const redSpawns: SpawnDef[] = [
    { x: -30.5, y: 0, z: -6, yaw: FACE_EAST, team: 0 },
    { x: -30.5, y: 0, z: -2.5, yaw: FACE_EAST, team: 0 },
    { x: -30.5, y: 0, z: 2.5, yaw: FACE_EAST, team: 0 },
    { x: -30.5, y: 0, z: 6, yaw: FACE_EAST, team: 0 },
    { x: -30, y: 0, z: -17, yaw: FACE_EAST, team: 0 },
    { x: -30, y: 0, z: 17, yaw: FACE_EAST, team: 0 },
    { x: -27, y: 0, z: -22.5, yaw: FACE_EAST, team: 0 },
    { x: -27, y: 0, z: 22.5, yaw: FACE_EAST, team: 0 },
  ];
  const neutral: SpawnDef[] = [
    { x: -12, y: 0, z: -23, yaw: FACE_EAST, team: -1 },
    { x: -11, y: 0, z: 19.5, yaw: FACE_EAST, team: -1 },
    { x: -14.5, y: 0, z: 3, yaw: FACE_EAST, team: -1 },
  ];

  return {
    id: 'nouncity',
    name: 'Noun City Night',
    blurb: 'The plaza after dark. Neon, lit windows, a roof perch and three lanes.',
    half: [35, 27],
    boxes: [...shared, ...west, ...west.map(mirrorBoxX)],
    ramps: [...westRamps, ...westRamps.map(mirrorRampX)],
    spawns: [
      ...redSpawns,
      ...redSpawns.map(mirrorSpawnX),
      ...neutral,
      ...neutral.map(mirrorSpawnX),
    ],
    zones: [
      { id: 'A', x: 0, y: 0, z: -17.5, r: 4.2 },
      { id: 'B', x: 0, y: 0, z: 0, r: 5 },
      { id: 'C', x: 0, y: 0, z: 17.5, r: 4.2 },
    ],
    killY: -8,
  };
}

export const NOUN_CITY: MapDef = build();
