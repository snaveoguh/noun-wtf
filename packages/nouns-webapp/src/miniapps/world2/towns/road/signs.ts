// ── Road trip sign faces (canvas atlases) ─────────────────────────────────
//
// Two kinds of atlas, both small and built only when a chunk needs one:
//   shared   every station's signs + the billboard designs (one per session)
//   segment  a line's km posts and distance signs for one 10 km stretch
//            (roadside.ts SEGMENT): refcounted by the chunks using it, freed
//            when none do.
// Side towns get their own atlas from their look (like the older towns).

import type { RoadsideItem } from './roadside';

import { BLOCK_FONT, type SignSpec } from '../kit';

import { stationSigns } from './stations';

const HWY = { bg: '#1f6b3a', fg: '#ffffff' };

/** Sign face size (m) for a roadside item. */
export function roadsideSize(it: RoadsideItem): { w: number; h: number } {
  if (it.kind === 'km') return { w: 0.6, h: 0.95 };
  if (it.kind === 'bb') return { w: 12, h: 5 };
  return { w: 5.2, h: 0.6 + 0.62 * it.rows.length };
}

export function roadsideSpec(it: RoadsideItem): SignSpec {
  const { w, h } = roadsideSize(it);
  if (it.kind === 'km')
    return {
      key: it.id,
      w,
      h,
      bg: HWY.bg,
      fg: HWY.fg,
      border: '#ffffff',
      lines: [
        { text: 'KM', size: 0.16, y: 0.24 },
        { text: it.rows[0]!, size: it.rows[0]!.length > 1 ? 0.26 : 0.34, y: 0.62 },
      ],
    };
  const n = it.rows.length;
  return {
    key: it.id,
    w,
    h,
    bg: HWY.bg,
    fg: HWY.fg,
    border: '#ffffff',
    lines: it.rows.map((text, i) => ({
      text: (it.kind === 'back' ? '↑ ' : '') + text,
      size: 0.52 / (n + 0.6),
      y: (i + 0.85) / (n + 0.7),
      font: BLOCK_FONT,
    })),
  };
}

const bb = (
  key: string,
  bg: string,
  fg: string,
  accent: string,
  l1: string,
  l2: string,
  l3?: string,
): SignSpec => ({
  key,
  w: 12,
  h: 5,
  bg,
  fg,
  border: accent,
  lines: [
    { text: l1, size: 0.26, y: 0.3 },
    { text: l2, size: 0.17, y: 0.6, color: accent },
    ...(l3 !== undefined ? [{ text: l3, size: 0.11, y: 0.84 }] : []),
  ],
});

export function billboardSigns(): SignSpec[] {
  return [
    bb(
      'bb-gas',
      '#e8352b',
      '#ffffff',
      '#ffc110',
      'NOUN GAS ⌐◨-◨',
      'FILL UP AT THE NEXT STATION',
      'SNACKS · DRINKS · DRIP',
    ),
    bb(
      'bb-icecream',
      '#ff638d',
      '#ffffff',
      '#ffe14d',
      'HEAR THE JINGLE?',
      'FOLLOW THE ICE CREAM VAN',
      'COLD SELLS HIGH IN THE DESERT',
    ),
    bb(
      'bb-noggles',
      '#111111',
      '#ffffff',
      '#e8352b',
      '⌐◨-◨',
      'SEE CLEARLY. WEAR NOGGLES.',
      'NOGGLE CITY · LENS WORKS',
    ),
    bb(
      'bb-fm',
      '#2b83f6',
      '#ffffff',
      '#ffc110',
      'NOUN FM',
      'COMMUNITY RADIO · ALL ROADS',
      'TUNE IN ON THE VAN',
    ),
    bb(
      'bb-memevalue',
      '#f1efe8',
      '#111111',
      '#e8352b',
      'MEME VALUE',
      'READ IT AT CAMP',
      'BY LIL 67',
    ),
    bb(
      'bb-respect',
      '#2a2f36',
      '#ffc110',
      '#ffffff',
      'BE A LEGEND',
      'RESPECT THE LOCALS',
      'BUY LOCAL · TIP WELL · NO BAILING',
    ),
    bb(
      'bb-peak',
      '#1d3557',
      '#ffffff',
      '#a9e3f5',
      'POWDER PEAK',
      'SKI VILLAGE · +X 3.6 KM',
      'FONDUE · APRÈS · CHAIR 1',
    ),
    bb(
      'bb-lake',
      '#24402c',
      '#f3e2b8',
      '#ffc110',
      'LOON LAKE',
      'FISH FRY · PADDLE · PANCAKES',
      '+Z 14.6 KM',
    ),
    bb('bb-motel', '#a8452f', '#ffe9b0', '#ffffff', 'MOTOR INN', 'VACANCY', 'AT EVERY TRUCK STOP'),
    bb('bb-daily', '#d22209', '#ffffff', '#ffffff', 'ONE NOUN, EVERY DAY,', 'FOREVER.', '⌐◨-◨'),
    bb(
      'bb-bowl',
      '#f3c25b',
      '#2a1c10',
      '#e8352b',
      'THE NOGGLE BOWL',
      'DROP IN · −X LINE',
      'DEEPEST DOOR ON THE MOUNTAIN',
    ),
    bb(
      'bb-diesel',
      '#2a1c10',
      '#ffc110',
      '#e8352b',
      'DIESEL FLATS',
      "TRUCK STOP · MOM'S DINER",
      '−X 20.5 KM · OPEN ALL NIGHT',
    ),
  ];
}

/** The shared road atlas's specs: stations + billboards. */
export function sharedSigns(): SignSpec[] {
  return [...stationSigns(), ...billboardSigns()];
}
