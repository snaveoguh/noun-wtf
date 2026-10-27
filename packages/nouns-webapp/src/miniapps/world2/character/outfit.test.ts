import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { Net, parseOutfitKey, type NetPose } from '../net/Net';

import {
  DEFAULT_OUTFIT,
  PANTS_COLORS,
  PANTS_STYLES,
  SHOE_COLORS,
  SHOE_STYLES,
  decodeOutfit,
  encodeOutfit,
  isOutfit,
  keepOutfit,
  outfitFromSeed,
  parseOutfit,
  randomOutfit,
  sameOutfit,
  type Outfit,
} from './outfit';
import { pantsGeometry, pantsScale, shoeGeometry } from './outfitMesh';

const seed = (head: number, glasses = 3, body = 7, accessory = 11, background = 0) => ({
  head,
  glasses,
  body,
  accessory,
  background,
});

describe('outfit contract', () => {
  it('outfitFromSeed is deterministic and always valid', () => {
    for (let h = 0; h < 240; h++) {
      const a = outfitFromSeed(seed(h));
      expect(isOutfit(a)).toBe(true);
      expect(outfitFromSeed(seed(h))).toEqual(a);
    }
  });

  it('outfitFromSeed dresses a crowd in every style', () => {
    const pants = new Set<string>();
    const shoes = new Set<string>();
    const looks = new Set<string>();
    for (let h = 0; h < 240; h++) {
      const o = outfitFromSeed(seed(h, h % 20, h % 30, h % 140));
      pants.add(o.pants);
      shoes.add(o.shoes);
      looks.add(encodeOutfit(o));
    }
    expect(pants.size).toBe(PANTS_STYLES.length);
    expect(shoes.size).toBe(SHOE_STYLES.length);
    // Plenty of distinct looks, not a handful
    expect(looks.size).toBeGreaterThan(60);
  });

  it('a one-trait change usually changes the outfit (no visible banding)', () => {
    let same = 0;
    for (let h = 0; h < 200; h++)
      if (sameOutfit(outfitFromSeed(seed(h)), outfitFromSeed(seed(h + 1)))) same++;
    expect(same).toBeLessThan(20);
  });

  it('a head change keeps the outfit the rider is wearing (keepOutfit)', () => {
    for (let h = 0; h < 200; h++) {
      const before = seed(h);
      // No pick yet: the rider wears its seed's default, and keeps it
      const worn = outfitFromSeed(before);
      const after = { ...before, head: h + 1 };
      expect(keepOutfit(null, before)).toEqual(worn);
      // ...and stays in it through more head changes
      expect(keepOutfit(keepOutfit(null, before), after)).toEqual(worn);
    }
    // An explicit pick always stays
    const pick: Outfit = { pants: 'shorts', pantsColor: 10, shoes: 'boot', shoeColor: 8 };
    expect(keepOutfit(pick, seed(4))).toBe(pick);
  });

  it('isOutfit rejects junk', () => {
    expect(isOutfit(DEFAULT_OUTFIT)).toBe(true);
    expect(isOutfit(null)).toBe(false);
    expect(isOutfit({ ...DEFAULT_OUTFIT, pants: 'kilt' })).toBe(false);
    expect(isOutfit({ ...DEFAULT_OUTFIT, shoes: 'heels' })).toBe(false);
    expect(isOutfit({ ...DEFAULT_OUTFIT, pantsColor: PANTS_COLORS.length })).toBe(false);
    expect(isOutfit({ ...DEFAULT_OUTFIT, shoeColor: -1 })).toBe(false);
    expect(isOutfit({ ...DEFAULT_OUTFIT, shoeColor: 1.5 })).toBe(false);
  });

  it('parseOutfit keeps good fields and fills bad ones from the fallback', () => {
    const fb: Outfit = { pants: 'skinny', pantsColor: 2, shoes: 'boot', shoeColor: 8 };
    expect(parseOutfit('nope', fb)).toBeNull();
    expect(parseOutfit([1, 2], fb)).toBeNull();
    expect(parseOutfit({}, fb)).toEqual(fb);
    expect(
      parseOutfit({ pants: 'track', pantsColor: 99, shoes: 'slide', shoeColor: '3' }, fb),
    ).toEqual({ pants: 'track', pantsColor: 2, shoes: 'slide', shoeColor: 8 });
    const good: Outfit = { pants: 'shorts', pantsColor: 4, shoes: 'hightop', shoeColor: 11 };
    expect(parseOutfit(JSON.parse(JSON.stringify(good)), fb)).toEqual(good);
  });

  it('randomOutfit covers the palettes and stays valid', () => {
    let s = 1;
    const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const colours = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const o = randomOutfit(rand);
      expect(isOutfit(o)).toBe(true);
      colours.add(o.shoeColor);
    }
    expect(colours.size).toBe(SHOE_COLORS.length);
    expect(isOutfit(randomOutfit(() => 0.9999999))).toBe(true);
  });

  it('wire key: 4 chars, round-trips every outfit', () => {
    for (const pants of PANTS_STYLES)
      for (const shoes of SHOE_STYLES)
        for (let pc = 0; pc < PANTS_COLORS.length; pc += 5)
          for (let sc = 0; sc < SHOE_COLORS.length; sc += 4) {
            const o: Outfit = { pants, pantsColor: pc, shoes, shoeColor: sc };
            const k = encodeOutfit(o);
            expect(k).toMatch(/^[\da-z]{4}$/);
            expect(decodeOutfit(k)).toEqual(o);
          }
  });

  it('wire key: junk is null, unknown future styles / colours fall back per field', () => {
    for (const bad of ['', 'abc', 'abcde', 'AB12', '01-2', 12, null, undefined, {}])
      expect(decodeOutfit(bad)).toBeNull();
    const fb: Outfit = { pants: 'baggy', pantsColor: 1, shoes: 'runner', shoeColor: 3 };
    // 'z' = style / colour 35: not known here
    expect(decodeOutfit('zzzz', fb)).toEqual(fb);
    expect(decodeOutfit('3z1z', fb)).toEqual({
      pants: 'shorts',
      pantsColor: 1,
      shoes: 'hightop',
      shoeColor: 3,
    });
  });
});

function pose(): NetPose {
  return {
    pos: new THREE.Vector3(1, 2, 3),
    quat: new THREE.Quaternion(),
    boardQuat: new THREE.Quaternion(),
    boardLift: 0,
    anim: 'skate_idle',
    animTime: 0,
    mode: 'board',
    lean: 0,
    speed: 4,
    name: 'TESTER',
    seedKey: '0-1-2-3-4',
    trick: '',
    boardType: 'skate',
    weight: 0,
  };
}

/** Send one pose through a fake socket, feed it back in as a peer's move. */
function roundTrip(net: Net) {
  const sent: string[] = [];
  net.ws = { readyState: WebSocket.OPEN, send: (m: string) => sent.push(m) } as never;
  net.send(1, pose(), 0);
  expect(sent).toHaveLength(1);
  const msg = JSON.parse(sent[0]) as Record<string, unknown>;
  const rx = new Net();
  (rx as unknown as { ingest(id: string, d: Record<string, unknown>): void }).ingest('peer', msg);
  return {
    blob: JSON.parse(msg.state as string) as Record<string, unknown>,
    rp: rx.players.get('peer'),
  };
}

describe('outfit on the wire (Net blob `of`)', () => {
  it('parseOutfitKey only passes well-formed keys', () => {
    expect(parseOutfitKey('0315')).toBe('0315');
    expect(parseOutfitKey('03151')).toBe('');
    expect(parseOutfitKey('<b>x')).toBe('');
    expect(parseOutfitKey(1234)).toBe('');
    expect(parseOutfitKey(undefined)).toBe('');
  });

  it('round-trips through send → ingest', () => {
    const o: Outfit = { pants: 'track', pantsColor: 9, shoes: 'slide', shoeColor: 6 };
    const net = new Net();
    net.outfit = encodeOutfit(o);
    const { blob, rp } = roundTrip(net);
    expect(blob.of).toBe(encodeOutfit(o));
    expect(rp?.outfit).toBe(encodeOutfit(o));
    expect(decodeOutfit(rp?.outfit)).toEqual(o);
  });

  it('no pick → no key (older blobs unchanged) and the peer reads it as the seed default', () => {
    const { blob, rp } = roundTrip(new Net());
    expect('of' in blob).toBe(false);
    expect(rp?.outfit).toBe('');
    expect(decodeOutfit(rp?.outfit)).toBeNull();
  });
});

describe('outfit geometry variants', () => {
  /** A ring of leg vertices at a few heights around the left leg. */
  function legGeo() {
    const pts: number[] = [];
    for (const y of [0.1, 0.2, 0.33, 0.4, 0.5, 0.7])
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push(0.09 + Math.cos(a) * 0.08, y, 0.005 + Math.sin(a) * 0.08);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const idx: number[] = [];
    for (let r = 0; r < 5; r++)
      for (let i = 0; i < 8; i++) {
        const a = r * 8 + i;
        const b = r * 8 + ((i + 1) % 8);
        idx.push(a, b, a + 8, b, b + 8, a + 8);
      }
    g.setIndex(idx);
    return g;
  }
  const radiusAt = (g: THREE.BufferGeometry, y: number) => {
    const p = g.attributes.position as THREE.BufferAttribute;
    let r = 0;
    for (let i = 0; i < p.count; i++)
      if (Math.abs(p.getY(i) - y) < 0.005)
        r = Math.max(r, Math.hypot(p.getX(i) - 0.09, p.getZ(i) - 0.005));
    return r;
  };

  it('baggy flares, skinny hugs, hips stay put, the source is untouched', () => {
    const base = legGeo();
    const baggy = pantsGeometry(base, 'baggy');
    const skinny = pantsGeometry(base, 'skinny');
    expect(radiusAt(baggy, 0.2)).toBeGreaterThan(0.08 * 1.3);
    expect(radiusAt(skinny, 0.2)).toBeLessThan(0.08 * 0.85);
    expect(radiusAt(baggy, 0.7)).toBeCloseTo(0.08, 4);
    expect(radiusAt(base, 0.2)).toBeCloseTo(0.08, 4);
    // Cached: the same object for the same style
    expect(pantsGeometry(base, 'baggy')).toBe(baggy);
  });

  it('shorts split into pants / skin / sock groups covering every triangle', () => {
    const base = legGeo();
    const g = pantsGeometry(base, 'shorts');
    expect(g.groups.map(x => x.materialIndex)).toEqual([0, 1, 2]);
    expect(g.groups.reduce((n, x) => n + x.count, 0)).toBe(base.index!.count);
    expect(pantsScale('shorts', 0.2)).toBeLessThan(1);
    expect(pantsScale('shorts', 0.4)).toBeGreaterThan(1);
  });

  it('tucked hems narrow the ankle for high-tops / boots', () => {
    expect(pantsScale('track', 0.12, true)).toBeLessThan(pantsScale('track', 0.12, false));
    expect(pantsScale('cargo', 0.4, true)).toBe(pantsScale('cargo', 0.4, false));
  });

  it('chunky skate soles are thicker than runner uppers are tall', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0.09, 0.06, 0.06, 0.18, 0.16, 0.2], 3),
    );
    const skateSole = shoeGeometry(g, 'skate', true).attributes.position.getY(0);
    const runnerUp = shoeGeometry(g, 'runner', false).attributes.position.getY(1);
    expect(skateSole).toBeGreaterThan(0.06);
    expect(runnerUp).toBeLessThan(0.16);
  });
});
