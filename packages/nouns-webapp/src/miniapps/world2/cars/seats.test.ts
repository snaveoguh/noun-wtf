import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { Net, type NetPose } from '../net/Net';

import { decodeCrew, decodeRide, encodeCrew, encodeRide } from './netCar';
import {
  assignSeats,
  freeSeat,
  HIP_HEIGHT,
  passengerSeats,
  RIDER_SCALE,
  rideCheck,
  riderShown,
  SEATS,
  seatRoot,
} from './seats';
import { CAR_IDS, CARS } from './specs';

describe('seats', () => {
  it('every car has a driver seat inside its body', () => {
    for (const id of CAR_IDS) {
      const g = CARS[id].geo;
      const seats = SEATS[id];
      expect(seats.length).toBeGreaterThanOrEqual(1);
      for (const s of seats) {
        const [x, y, z] = s.at;
        expect(Math.abs(x)).toBeLessThan(g.width / 2);
        expect(Math.abs(z)).toBeLessThan(g.length / 2);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(g.height);
      }
      // the driver sits on the left (+X) or in the middle
      expect(seats[0].at[0]).toBeGreaterThanOrEqual(0);
    }
  });

  it('seat counts: two in most, one in the CAVALLINO, four in the DIP, the STOMPA bed', () => {
    expect(passengerSeats('roadstar')).toBe(1);
    expect(passengerSeats('cavallino')).toBe(0);
    expect(passengerSeats('dip')).toBe(3);
    expect(passengerSeats('bubble')).toBe(1);
    expect(passengerSeats('stompa')).toBe(2);
    expect(SEATS.stompa[2].stand).toBe(true);
  });

  it('open cars show everyone; closed cars hide all but the STOMPA bed', () => {
    for (const id of ['roadstar', 'cavallino', 'dip'] as const)
      for (let i = 0; i < SEATS[id].length; i++) expect(riderShown(CARS[id], i)).toBe(true);
    for (const id of ['toro', 'bubble', 'kaido', 'bruiser'] as const)
      for (let i = 0; i < SEATS[id].length; i++) expect(riderShown(CARS[id], i)).toBe(false);
    expect(riderShown(CARS.stompa, 0)).toBe(false);
    expect(riderShown(CARS.stompa, 2)).toBe(true);
    expect(riderShown(CARS.roadstar, 5)).toBe(false);
  });

  it('a sitter’s hips land on the cushion; a stander’s feet on the spot', () => {
    const r = seatRoot('roadstar', 0)!;
    const hips = r[1] + (HIP_HEIGHT - 0.05) * RIDER_SCALE;
    expect(hips).toBeCloseTo(SEATS.roadstar[0].at[1], 6);
    expect(seatRoot('stompa', 2)).toEqual([0, 2.1, -1.45]);
    expect(seatRoot('roadstar', 2)).toBeNull();
  });

  it('the ROADSTAR driver’s head clears the door line and the targa bar', () => {
    // Head bottom ≈ 1.05 m above the rig's origin at scale 1 (measured in the
    // browser); the tub top is 0.85 and the targa bar 1.15 (models.ts)
    const r = seatRoot('roadstar', 0)!;
    expect(r[1] + 1.05 * RIDER_SCALE).toBeGreaterThan(0.85);
    expect(r[1] + 1.05 * RIDER_SCALE).toBeGreaterThan(1.15);
  });
});

describe('who sits where (the driver decides)', () => {
  it('first asker wins a seat; a later ask for it is refused', () => {
    const crew = assignSeats(
      'roadstar',
      [''],
      [
        { id: 'b', seat: 1, since: 20 },
        { id: 'a', seat: 1, since: 10 },
      ],
    );
    expect(crew).toEqual(['a']);
  });

  it('a holder keeps their seat over an earlier newcomer, and frees it by not asking', () => {
    const asks = [
      { id: 'late', seat: 1, since: 50 },
      { id: 'new', seat: 1, since: 1 },
    ];
    expect(assignSeats('roadstar', ['late'], asks)).toEqual(['late']);
    expect(assignSeats('roadstar', ['late'], [{ id: 'new', seat: 1, since: 1 }])).toEqual(['new']);
    expect(assignSeats('roadstar', ['late'], [])).toEqual(['']);
  });

  it('several seats fill independently; bad seats are ignored', () => {
    const crew = assignSeats(
      'dip',
      ['', '', ''],
      [
        { id: 'a', seat: 3, since: 1 },
        { id: 'b', seat: 1, since: 2 },
        { id: 'c', seat: 9, since: 0 },
        { id: 'd', seat: 0, since: 0 },
      ],
    );
    expect(crew).toEqual(['b', '', 'a']);
    expect(assignSeats('cavallino', [], [{ id: 'a', seat: 1, since: 0 }])).toEqual([]);
  });

  it('one rider, one seat (switching seats moves them)', () => {
    const crew = assignSeats('dip', ['a', '', ''], [{ id: 'a', seat: 2, since: 0 }]);
    expect(crew).toEqual(['', 'a', '']);
  });

  it('freeSeat skips taken seats and seats others are asking for', () => {
    expect(freeSeat('dip', ['x', '', ''])).toBe(2);
    expect(freeSeat('dip', ['x', '', ''], new Set([2]))).toBe(3);
    expect(freeSeat('roadstar', ['x'])).toBeNull();
    expect(freeSeat('cavallino', [])).toBeNull();
  });

  it('rideCheck: listed → riding; not yet → pending; taken / too slow → refused; driver out → gone', () => {
    const d = (crew: string[] | null, inCar = true) => ({ inCar, crew });
    expect(rideCheck('me', 1, d(['me']), 0)).toBe('riding');
    expect(rideCheck('me', 1, d(['']), 0.5)).toBe('pending');
    expect(rideCheck('me', 1, d(['']), 3.5)).toBe('refused');
    expect(rideCheck('me', 1, d(['you']), 0)).toBe('refused');
    expect(rideCheck('me', 2, d(['me']), 0)).toBe('refused');
    expect(rideCheck('me', 1, d(['me'], false), 0)).toBe('gone');
    expect(rideCheck('me', 1, d(null), 0)).toBe('gone');
    expect(rideCheck('me', 1, null, 0)).toBe('gone');
  });
});

describe('riding together on the wire (rd / ps)', () => {
  it('codecs round-trip and reject junk', () => {
    expect(
      decodeRide(JSON.parse(JSON.stringify(encodeRide({ driver: 'ab-12_x', seat: 2 })))),
    ).toEqual({ driver: 'ab-12_x', seat: 2 });
    for (const bad of [null, 'x', ['a'], ['a', 0], ['a', 1.5], ['<b>', 1], [7, 1], ['a', 99]])
      expect(decodeRide(bad)).toBeNull();
    expect(decodeCrew(encodeCrew(['a', '', 'c']))).toEqual(['a', '', 'c']);
    expect(encodeCrew(['<x>'])).toEqual(['']);
    expect(decodeCrew([1])).toBeNull();
    expect(decodeCrew('a')).toBeNull();
    expect(decodeCrew(new Array(20).fill(''))).toBeNull();
  });

  function pose(): NetPose {
    return {
      pos: new THREE.Vector3(1, 2, 3),
      quat: new THREE.Quaternion(),
      boardQuat: new THREE.Quaternion(),
      boardLift: 0,
      anim: 'idle',
      animTime: 0,
      mode: 'foot',
      lean: 0,
      speed: 0,
      name: 'TESTER',
      seedKey: '0-1-2-3-4',
      trick: '',
      boardType: 'skate',
      weight: 0,
    };
  }

  function roundTrip(net: Net, p = pose()) {
    const sent: string[] = [];
    net.ws = { readyState: WebSocket.OPEN, send: (m: string) => sent.push(m) } as never;
    net.send(1, p, 0);
    const msg = JSON.parse(sent[0]) as Record<string, unknown>;
    const rx = new Net();
    (rx as unknown as { ingest(id: string, d: Record<string, unknown>): void }).ingest('peer', msg);
    return {
      blob: JSON.parse(msg.state as string) as Record<string, unknown>,
      rp: rx.players.get('peer'),
    };
  }

  it('a passenger’s rd and a driver’s ps arrive at the peer', () => {
    const passenger = new Net();
    passenger.ride = encodeRide({ driver: 'drv', seat: 1 });
    const a = roundTrip(passenger);
    expect(a.blob.rd).toEqual(['drv', 1]);
    expect(a.rp?.ride).toEqual({ driver: 'drv', seat: 1 });

    const driver = new Net();
    driver.crew = encodeCrew(['peer2', '']);
    const b = roundTrip(driver, { ...pose(), vehicle: 'car', car: 'dip.0.1' });
    expect(b.blob.ps).toEqual(['peer2', '']);
    expect(b.rp?.crew).toEqual(['peer2', '']);
  });

  it('nothing set → no keys (older blobs unchanged)', () => {
    const { blob, rp } = roundTrip(new Net());
    expect('rd' in blob).toBe(false);
    expect('ps' in blob).toBe(false);
    expect(rp?.ride).toBeNull();
    expect(rp?.crew).toBeNull();
  });
});
