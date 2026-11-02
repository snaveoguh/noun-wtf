import { describe, expect, it, vi } from 'vitest';

import { PITCH_5, PITCH_11, STADIUM } from '../../contract';
import { ENTRANCE_PX } from '../../site';

import { insideSlab, stadiumSlabs } from './collider';
import { ENTRANCE, FACADE, STANDABLE_TOP, STANDS, TUNNEL, tierTop } from './layout';
import { crowdBudget, seatList } from './seats';
import { StadiumView } from './StadiumView';

const slabs = stadiumSlabs();
const blocked = (x: number, y: number, z: number, r: number) =>
  slabs.find(s => insideSlab(s, x, y, z, r)) ?? null;

describe('NOUN STADIUM colliders', () => {
  it('lets you walk in from the main entrance, through the tunnel, onto the pitch', () => {
    for (let x = ENTRANCE_PX; x <= 0; x += 0.2)
      for (const y of [0.3, 1, 1.7])
        for (const z of [-1, 0, 1]) expect(blocked(x, y, z, 0.35)?.name ?? null).toBeNull();
  });

  it('is closed everywhere else round the outside', () => {
    // rays from the centre spot out to just past the facade, at waist height
    let open = 0;
    for (let k = 0; k < 360; k++) {
      const th = (k / 360) * Math.PI * 2;
      const dx = Math.sin(th);
      const dz = Math.cos(th);
      const far = Math.min(
        Math.abs((STADIUM.halfX + 2) / (dx || 1e-9)),
        Math.abs((STADIUM.halfZ + 2) / (dz || 1e-9)),
      );
      let hit = false;
      for (let t = 0; t < far && !hit; t += 0.25) hit = blocked(dx * t, 1, dz * t, 0) !== null;
      if (!hit) {
        open++;
        // only through the entrance
        expect(Math.abs(dz * far)).toBeLessThan(ENTRANCE.half + 0.5);
        expect(dx).toBeLessThan(0);
      }
    }
    expect(open).toBeLessThan(6);
  });

  it('has a solid rake under every stand, climbable and inside the band', () => {
    for (const s of STANDS) expect(slabs.some(q => q.name.startsWith(s.id))).toBe(true);
    for (const s of STANDS) for (const t of s.tiers) expect(t.rise / t.depth).toBeLessThan(0.6);
    // the highest collider you can stand on
    let top = 0;
    for (const s of slabs) for (const p of s.pts) top = Math.max(top, p[1]);
    expect(Math.max(...STANDS.flatMap(s => s.tiers.map(tierTop)))).toBeLessThanOrEqual(
      STANDABLE_TOP,
    );
    expect(top).toBeLessThanOrEqual(Math.max(FACADE.side, STANDABLE_TOP));
  });

  it('gives the tunnel head room', () => {
    expect(blocked(-50, TUNNEL.height - 0.4, 0, 0.3)).toBeNull();
    expect(blocked(-50, TUNNEL.height + 0.2, 0, 0)).not.toBeNull();
  });
});

describe('NOUN STADIUM seats', () => {
  it('seats tens of thousands, deterministically, every fan facing the pitch', () => {
    const a = seatList();
    expect(a.count).toBeGreaterThan(30000);
    expect(a.count).toBeGreaterThan(crowdBudget('high', false));
    for (let i = 0; i < a.count; i += 97) {
      const x = a.pos[i * 3]!;
      const z = a.pos[i * 3 + 2]!;
      const fx = Math.sin(a.yaw[i]!);
      const fz = Math.cos(a.yaw[i]!);
      // facing roughly toward the pitch (not away)
      expect(fx * -x + fz * -z).toBeGreaterThan(0);
    }
  });
});

describe('StadiumView', () => {
  it('builds in slices, a handful of draws, and frees everything', () => {
    // jsdom has no 2D canvas: the paint helpers skip a null context
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const v = new StadiumView({
      frame: { x: 0, y: -400, z: -3000, yaw: Math.PI / 2 },
      quality: 'low',
      toon: true,
    });
    let n = 0;
    while (!v.buildStep()) n++;
    expect(n).toBeGreaterThan(5);
    expect(v.built).toBe(true);
    expect(v.draws).toBeLessThanOrEqual(12);
    if (process.env.STADIUM_STATS)
      console.info(
        'draws',
        v.draws,
        'tris',
        v.triangles,
        'slices',
        v.sliceMs.map(m => m.toFixed(1)).join(' '),
      );
    v.setPitch(PITCH_5);
    v.setPitch(PITCH_11);
    v.setKits([
      {
        name: 'A',
        short: 'AAA',
        shirt: 0xffcc00,
        shorts: 0x000000,
        socks: 0xffcc00,
        keeper: 0x00ff00,
      },
      {
        name: 'B',
        short: 'BBB',
        shirt: 0x00aaff,
        shorts: 0xffffff,
        socks: 0x00aaff,
        keeper: 0xff00ff,
      },
    ]);
    v.setLive(true);
    v.crowd(1, 0, 0.016);
    v.netHit(0, 1, 53, 1);
    v.board({ home: 'AAA', away: 'BBB', score: [1, 0], clock: '12:00' });
    v.tick(0.016, v.root.position.clone());
    const geo = v.colliderGeometry();
    expect(geo.getAttribute('position').count).toBeGreaterThan(300);
    v.dispose();
    expect(v.root.children.length).toBe(0);
  });
});
