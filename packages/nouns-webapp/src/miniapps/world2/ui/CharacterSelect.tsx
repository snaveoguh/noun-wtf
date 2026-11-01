// ── Create your rider: live 3D preview + an options sheet ──
//
// The game keeps rendering (showroom mode: physics paused, camera framing
// the rider inside the preview area: top of the screen on phones, left on
// desktop; drag it to turn the rider). The sheet has tabs for the Noun's
// traits, trousers, shoes and the ride. Keyboard, gamepad and touch all
// work. The pick persists to localStorage.

import type { Game } from '../Game';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';

import { prefetchGlbHead } from '../character/GlbHead';
import { randomSeed, type NounSeed } from '../character/NounAppearance';
import {
  BOARD_LABELS,
  BOARD_TYPES,
  BUILDS,
  parseBoardType,
  type BoardType,
} from '../character/NounCharacter';
import {
  PANTS_COLORS,
  PANTS_LABELS,
  PANTS_STYLES,
  SHOE_COLORS,
  SHOE_LABELS,
  SHOE_STYLES,
  keepOutfit,
  outfitFromSeed,
  parseOutfit,
  randomOutfit,
  swatchCss,
  type Outfit,
  type PantsStyle,
  type ShoeStyle,
  type Swatch,
} from '../character/outfit';
import { worldPause } from '../worldPause';

import { DeckGraphicRow } from './DeckDesigner';

const STORAGE_KEY = 'noun-world-v2-character';

type TraitRow = 'head' | 'glasses' | 'body' | 'accessory';
const TRAITS: TraitRow[] = ['head', 'glasses', 'body', 'accessory'];
const TRAIT_KEY: Record<TraitRow, 'heads' | 'glasses' | 'bodies' | 'accessories'> = {
  head: 'heads',
  glasses: 'glasses',
  body: 'bodies',
  accessory: 'accessories',
};

type Tab = 'noun' | 'pants' | 'shoes' | 'ride';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'noun', label: 'NOUN', icon: '⌐◨-◨' },
  { id: 'pants', label: 'PANTS', icon: '👖' },
  { id: 'shoes', label: 'SHOES', icon: '👟' },
  { id: 'ride', label: 'RIDE', icon: '🛹' },
];

/** Keyboard / pad rows per tab (up/down picks, left/right changes). */
type Row =
  | 'name'
  | TraitRow
  | 'pantsStyle'
  | 'pantsColor'
  | 'shoeStyle'
  | 'shoeColor'
  | 'board'
  | 'build';
const TAB_ROWS: Record<Tab, Row[]> = {
  noun: ['name', 'head', 'glasses', 'body', 'accessory'],
  pants: ['pantsStyle', 'pantsColor'],
  shoes: ['shoeStyle', 'shoeColor'],
  ride: ['board', 'build'],
};

export interface SavedCharacter {
  seed: NounSeed;
  name: string;
  board?: BoardType;
  /** Index into BUILDS (skinny … clinically obese). */
  build?: number;
  /** Trousers + shoes; absent = the seed's default (`outfitFromSeed`). */
  outfit?: Outfit;
}

export function loadSavedCharacter(): SavedCharacter | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as SavedCharacter;
    if (typeof v.seed?.head !== 'number') return null;
    const outfit = v.outfit !== undefined ? parseOutfit(v.outfit, outfitFromSeed(v.seed)) : null;
    return { ...v, board: parseBoardType(v.board), outfit: outfit ?? undefined };
  } catch {
    return null;
  }
}

function saveCharacter(c: SavedCharacter) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // storage blocked — fine, the pick just won't persist
  }
}

function traitCount(row: TraitRow) {
  return ImageData.images[TRAIT_KEY[row]].length;
}

function traitName(row: TraitRow, i: number) {
  const f = ImageData.images[TRAIT_KEY[row]][i]?.filename ?? '';
  return f
    .replace(/^(head|glasses|body|accessory)-/, '')
    .replace(/-/g, ' ')
    .toUpperCase();
}

const pad3 = (n: number) => String(n).padStart(3, '0');
const wrap = (i: number, n: number) => ((i % n) + n) % n;

/**
 * The head row has one more stop than the art: missingnoun, after the last
 * head (character/missingNoun.ts). `head` keeps the last real head, so the
 * seed stays valid for older clients and the stops either side work.
 */
export function stepHead(s: NounSeed, dir: number): NounSeed {
  const n = traitCount('head');
  const at = s.missingnoun === true ? n : s.head;
  const next = wrap(at + dir, n + 1);
  if (next === n) return { ...s, missingnoun: true };
  const { missingnoun: _drop, ...rest } = s;
  void _drop;
  return { ...rest, head: next };
}

/** Number shown on a trait row (missingnoun counts as the extra head stop). */
function traitNum(r: TraitRow, s: NounSeed): number {
  return r === 'head' && s.missingnoun === true ? traitCount('head') : s[r];
}

/** Name shown on a trait row: missingnoun has no body or accessory. */
function traitLabel(r: TraitRow, s: NounSeed): string {
  if (s.missingnoun === true) {
    if (r === 'head') return 'MISSINGNOUN';
    if (r === 'body' || r === 'accessory') return '—';
  }
  return traitName(r, s[r]);
}

// ── Little pictograms for the style chips (tinted with the current colour) ──

const PANTS_ICON: Record<PantsStyle, string> = {
  baggy: 'M7 3h10l2 18h-6l-1-10-1 10H5z',
  cargo: 'M8 3h8l1 18h-4l-1-10-1 10H7z M4.5 9h3v4h-3z M16.5 9h3v4h-3z',
  track: 'M8 3h8l1 17h-4l-1-9-1 9H7z M8.6 4h1v15h-1z',
  shorts: 'M7 3h10l1.5 9h-5.5l-1-4-1 4H5.5z',
  skinny: 'M9 3h6l.5 18h-2.5l-1-10-1 10H8.5z',
};
const SHOE_ICON: Record<ShoeStyle, string> = {
  skate: 'M3 11h7l2 2h8a2 2 0 0 1 2 2v3H3z M3 18h19v2H3z',
  hightop: 'M5 4h6v8l2 1h7a2 2 0 0 1 2 2v3H5z M5 18h17v2H5z',
  runner: 'M3 12h6l3 2h7l3 2v2H3z M3 18h19l-2 2H5z',
  boot: 'M6 3h7v10h6a2 2 0 0 1 2 2v3H6z M6 18h15v3H6z',
  slide: 'M4 13h17v3H4z M8 10h8v3H8z',
};

function Pictogram({ d, color }: { d: string; color: string }) {
  return (
    <svg className="cs-pic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill={color} stroke="#000" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

function Swatches({
  list,
  value,
  onPick,
}: {
  list: readonly Swatch[];
  value: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="cs-swatches" role="radiogroup">
      {list.map((s, i) => (
        <button
          key={s.name}
          type="button"
          role="radio"
          aria-checked={i === value}
          aria-label={s.name}
          title={s.name}
          className={`cs-swatch ${i === value ? 'on' : ''}`}
          style={{ background: swatchCss(s) }}
          onClick={() => onPick(i)}
        />
      ))}
    </div>
  );
}

export function CharacterSelect({
  game,
  initial,
  auctionSeed,
  onConfirm,
  onDesignDeck,
}: {
  game: Game;
  initial: SavedCharacter;
  auctionSeed: NounSeed | null;
  onConfirm: (c: SavedCharacter) => void;
  /** Opens the board shop's deck designer. */
  onDesignDeck?: () => void;
}) {
  const [seed, setSeedState] = useState<NounSeed>(initial.seed);
  const [name, setName] = useState(initial.name);
  const [board, setBoard] = useState<BoardType>(() => parseBoardType(initial.board));
  const [build, setBuild] = useState<number>(initial.build ?? 2);
  /** null = wear the seed's default (pinned by the first trait change, `keepOutfit`). */
  const [picked, setPicked] = useState<Outfit | null>(initial.outfit ?? null);
  const outfit = useMemo(() => picked ?? outfitFromSeed(seed), [picked, seed]);
  const [tab, setTab] = useState<Tab>('noun');
  const [row, setRow] = useState(1);
  const [flash, setFlash] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const rows = TAB_ROWS[tab];

  // Push the seed into the 3D preview (debounced so key-repeat stays smooth)
  useEffect(() => {
    // Warm the next/previous heads and glasses so flipping through is instant
    const nh = ImageData.images.heads.length;
    const ng = ImageData.images.glasses.length;
    for (const d of [1, -1, 2, -2]) prefetchGlbHead(wrap(seed.head + d, nh), seed.glasses);
    for (const d of [1, -1]) prefetchGlbHead(seed.head, wrap(seed.glasses + d, ng));
    const t = window.setTimeout(() => game.setSeed(seed), 60);
    return () => window.clearTimeout(t);
  }, [game, seed]);

  useEffect(() => {
    game.setBoardType(board);
  }, [game, board]);

  useEffect(() => {
    game.setWeight(BUILDS[build]?.w ?? 0);
  }, [game, build]);

  useEffect(() => {
    game.setOutfit(picked);
  }, [game, picked]);

  // Frame the rider inside the preview area (follows layout + resizes)
  useLayoutEffect(() => {
    const root = rootRef.current;
    const pv = previewRef.current;
    if (root === null || pv === null) return;
    const frame = () => {
      const r = root.getBoundingClientRect();
      const p = pv.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      game.showroomFrame = {
        x: (p.left + p.width / 2 - r.left) / r.width,
        y: (p.top + p.height / 2 - r.top) / r.height,
        w: p.width / r.width,
        h: p.height / r.height,
      };
    };
    frame();
    const ro = new ResizeObserver(frame);
    ro.observe(root);
    ro.observe(pv);
    return () => ro.disconnect();
  }, [game]);

  // Drag the preview to turn the rider
  const drag = useRef<{ id: number; x: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { id: e.pointerId, x: e.clientX };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    game.showroomSway = 0;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    game.showroomSpin -= (e.clientX - d.x) * 0.012;
    d.x = e.clientX;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const spinBy = (rad: number) => {
    game.showroomSway = 0;
    game.showroomSpin += rad;
  };

  const bump = () => setFlash(f => f + 1);
  const setOutfit = useCallback((fn: (o: Outfit) => Outfit) => {
    setPicked(p => fn(p ?? outfitFromSeed(seedRef.current)));
    bump();
  }, []);

  /** Change the Noun's traits without touching its clothes. */
  const setSeed = useCallback((fn: (s: NounSeed) => NounSeed) => {
    const prev = seedRef.current;
    setPicked(p => keepOutfit(p, prev));
    setSeedState(fn);
  }, []);

  const cycleTrait = useCallback(
    (r: TraitRow, dir: number) => {
      const n = traitCount(r);
      setSeed(s => (r === 'head' ? stepHead(s, dir) : { ...s, [r]: wrap(s[r] + dir, n) }));
      bump();
    },
    [setSeed],
  );

  const randomTrait = useCallback(
    (r: TraitRow) => {
      const n = traitCount(r);
      setSeed(s =>
        r === 'head'
          ? stepHead({ ...s, missingnoun: undefined, head: 0 }, Math.floor(Math.random() * (n + 1)))
          : { ...s, [r]: Math.floor(Math.random() * n) },
      );
      bump();
    },
    [setSeed],
  );

  const cycle = useCallback(
    (r: Row, dir: number) => {
      const step = Math.sign(dir);
      switch (r) {
        case 'name':
          return;
        case 'build':
          setBuild(b => Math.max(0, Math.min(BUILDS.length - 1, b + step)));
          return bump();
        case 'board':
          setBoard(b => BOARD_TYPES[wrap(BOARD_TYPES.indexOf(b) + step, BOARD_TYPES.length)]);
          return bump();
        case 'pantsStyle':
          return setOutfit(o => ({
            ...o,
            pants: PANTS_STYLES[wrap(PANTS_STYLES.indexOf(o.pants) + step, PANTS_STYLES.length)],
          }));
        case 'pantsColor':
          return setOutfit(o => ({
            ...o,
            pantsColor: wrap(o.pantsColor + step, PANTS_COLORS.length),
          }));
        case 'shoeStyle':
          return setOutfit(o => ({
            ...o,
            shoes: SHOE_STYLES[wrap(SHOE_STYLES.indexOf(o.shoes) + step, SHOE_STYLES.length)],
          }));
        case 'shoeColor':
          return setOutfit(o => ({
            ...o,
            shoeColor: wrap(o.shoeColor + step, SHOE_COLORS.length),
          }));
        default:
          return cycleTrait(r, dir);
      }
    },
    [cycleTrait, setOutfit],
  );

  const randomNoun = useCallback(() => {
    setSeed(s => ({ ...randomSeed(), background: s.background }));
    bump();
  }, [setSeed]);
  const randomFit = useCallback(() => {
    setPicked(randomOutfit());
    bump();
  }, []);
  const randomAll = useCallback(() => {
    randomNoun();
    randomFit();
  }, [randomNoun, randomFit]);

  const switchTab = useCallback((dir: number) => {
    setTab(t => TABS[wrap(TABS.findIndex(x => x.id === t) + dir, TABS.length)].id);
    setRow(0);
  }, []);
  const pickTab = (t: Tab) => {
    setTab(t);
    setRow(t === 'noun' ? 1 : 0);
  };

  const confirm = useCallback(() => {
    const c: SavedCharacter = {
      seed: seedRef.current,
      name: name.trim().slice(0, 16) || 'NOUN',
      board,
      build,
      ...(picked !== null ? { outfit: picked } : {}),
    };
    saveCharacter(c);
    onConfirm(c);
  }, [name, board, build, picked, onConfirm]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (worldPause.get()) return;
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (typing && !['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.code)) return;
      const r = rows[Math.min(row, rows.length - 1)];
      if (e.code === 'ArrowUp' || (!typing && e.code === 'KeyW')) {
        e.preventDefault();
        setRow(v => wrap(v - 1, rows.length));
      } else if (e.code === 'ArrowDown' || (!typing && e.code === 'KeyS')) {
        e.preventDefault();
        setRow(v => wrap(v + 1, rows.length));
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        cycle(r, e.shiftKey ? -10 : -1);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        cycle(r, e.shiftKey ? 10 : 1);
      } else if (e.code === 'KeyQ' || e.code === 'BracketLeft') {
        switchTab(-1);
      } else if (e.code === 'KeyE' || e.code === 'BracketRight' || e.code === 'Tab') {
        e.preventDefault();
        switchTab(e.shiftKey ? -1 : 1);
      } else if (e.code === 'KeyR') {
        randomAll();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (r === 'name' && !typing) nameRef.current?.focus();
        else confirm();
      } else if (e.code === 'Escape' && typing) {
        nameRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, rows, cycle, randomAll, confirm, switchTab]);

  // Gamepad (D-pad / stick to navigate, LB/RB tabs, A start, X random)
  useEffect(() => {
    let raf = 0;
    let prev: boolean[] = [];
    let stickCooldown = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const gp = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected === true);
      if (!gp) return;
      const b = gp.buttons.map(x => x.pressed);
      const hit = (i: number) => b[i] === true && prev[i] !== true;
      const r = rows[Math.min(row, rows.length - 1)];
      if (hit(12)) setRow(v => wrap(v - 1, rows.length));
      if (hit(13)) setRow(v => wrap(v + 1, rows.length));
      if (hit(14)) cycle(r, -1);
      if (hit(15)) cycle(r, 1);
      if (hit(4)) switchTab(-1);
      if (hit(5)) switchTab(1);
      if (hit(2)) randomAll();
      if (hit(0) || hit(9)) confirm();
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      const rx = gp.axes[2] ?? 0;
      if (Math.abs(rx) > 0.25) spinBy(rx * 0.05);
      if (t > stickCooldown) {
        if (Math.abs(ax) > 0.6) {
          cycle(r, ax > 0 ? 1 : -1);
          stickCooldown = t + 160;
        } else if (Math.abs(ay) > 0.6) {
          setRow(v => wrap(v + (ay > 0 ? 1 : -1), rows.length));
          stickCooldown = t + 200;
        }
      }
      prev = b;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // spinBy only touches the game
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, rows, cycle, randomAll, confirm, switchTab]);

  const activeRow = rows[Math.min(row, rows.length - 1)];
  const rowProps = (r: Row) => ({
    className: `cs-row ${activeRow === r ? 'cs-active' : ''}`,
    onMouseEnter: () => setRow(rows.indexOf(r)),
    onClick: () => setRow(rows.indexOf(r)),
  });
  const label = (text: string, r: Row) => (
    <div className="cs-label">
      <span className="cs-cursor">{activeRow === r ? '▶' : ' '}</span>
      {text}
    </div>
  );

  const pantsHex = swatchCss(PANTS_COLORS[outfit.pantsColor] ?? PANTS_COLORS[0]);
  const shoeHex = swatchCss(SHOE_COLORS[outfit.shoeColor] ?? SHOE_COLORS[0]);

  return (
    <div ref={rootRef} className="cs-root pointer-events-auto absolute inset-0 select-none">
      <style>{CSS}</style>

      {/* Live preview: the game renders the rider into this box */}
      <div
        ref={previewRef}
        className="cs-preview"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Rider preview, drag to turn"
      >
        <div className="cs-scan" />
        <div className="cs-header">
          <span className="cs-p1">P1</span>
          <span className="cs-blink">CREATE YOUR RIDER</span>
        </div>
        <div className="cs-tagline">
          <span className="cs-tag">{name.trim() || 'NOUN'}</span>
          <span className="cs-fit">
            {PANTS_LABELS[outfit.pants]} · {SHOE_LABELS[outfit.shoes]}
          </span>
        </div>
        <div className="cs-spin">
          <button type="button" aria-label="Turn left" onClick={() => spinBy(-0.5)}>
            ⟲
          </button>
          <span>DRAG TO SPIN</span>
          <button type="button" aria-label="Turn right" onClick={() => spinBy(0.5)}>
            ⟳
          </button>
        </div>
      </div>

      {/* Options sheet */}
      <div className="cs-sheet">
        <div className="cs-tabs" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`cs-tab ${tab === t.id ? 'on' : ''}`}
              onClick={() => pickTab(t.id)}
            >
              <span className="cs-tab-ico">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="cs-body" key={tab}>
          {tab === 'noun' && (
            <>
              <div {...rowProps('name')}>
                {label('TAG', 'name')}
                <input
                  ref={nameRef}
                  className="cs-name"
                  value={name}
                  maxLength={16}
                  spellCheck={false}
                  placeholder="NOUN"
                  onFocus={() => setRow(0)}
                  onChange={e => setName(e.target.value.toUpperCase().replace(/[^\d .A-Z_-]/g, ''))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                      confirm();
                    }
                  }}
                />
              </div>
              {TRAITS.map(r => (
                <div key={r} {...rowProps(r)}>
                  {label(r.toUpperCase(), r)}
                  <div className="cs-value">
                    <button type="button" className="cs-arrow" onClick={() => cycle(r, -1)}>
                      ◀
                    </button>
                    <div className="cs-trait" key={`${r}-${traitNum(r, seed)}-${flash}`}>
                      <span className="cs-num">
                        {pad3(traitNum(r, seed))}/{pad3(traitCount(r) - (r === 'head' ? 0 : 1))}
                      </span>
                      <span className="cs-tname">{traitLabel(r, seed)}</span>
                    </div>
                    <button type="button" className="cs-arrow" onClick={() => cycle(r, 1)}>
                      ▶
                    </button>
                    <button
                      type="button"
                      className="cs-arrow cs-dice"
                      aria-label={`Random ${r}`}
                      onClick={() => randomTrait(r)}
                    >
                      🎲
                    </button>
                  </div>
                </div>
              ))}
              <div className="cs-buttons">
                <button type="button" className="cs-btn" onClick={randomNoun}>
                  🎲 RANDOM NOUN
                </button>
                {auctionSeed !== null && (
                  <button
                    type="button"
                    className="cs-btn"
                    onClick={() => {
                      setSeed(() => auctionSeed);
                      bump();
                    }}
                  >
                    ⌐◨-◨ TODAY&apos;S NOUN
                  </button>
                )}
              </div>
            </>
          )}

          {tab === 'pants' && (
            <>
              <div {...rowProps('pantsStyle')}>
                {label('STYLE', 'pantsStyle')}
                <div className="cs-chips">
                  {PANTS_STYLES.map(s => (
                    <button
                      key={s}
                      type="button"
                      className={`cs-chip ${outfit.pants === s ? 'on' : ''}`}
                      onClick={() => setOutfit(o => ({ ...o, pants: s }))}
                    >
                      <Pictogram d={PANTS_ICON[s]} color={pantsHex} />
                      <span>{PANTS_LABELS[s]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div {...rowProps('pantsColor')}>
                {label(`COLOUR · ${PANTS_COLORS[outfit.pantsColor]?.name ?? ''}`, 'pantsColor')}
                <Swatches
                  list={PANTS_COLORS}
                  value={outfit.pantsColor}
                  onPick={i => setOutfit(o => ({ ...o, pantsColor: i }))}
                />
              </div>
              <div className="cs-buttons">
                <button type="button" className="cs-btn" onClick={randomFit}>
                  🎲 RANDOM FIT
                </button>
                {picked !== null && (
                  <button
                    type="button"
                    className="cs-btn"
                    onClick={() => {
                      setPicked(null);
                      bump();
                    }}
                  >
                    ↺ MY NOUN&apos;S FIT
                  </button>
                )}
              </div>
            </>
          )}

          {tab === 'shoes' && (
            <>
              <div {...rowProps('shoeStyle')}>
                {label('STYLE', 'shoeStyle')}
                <div className="cs-chips">
                  {SHOE_STYLES.map(s => (
                    <button
                      key={s}
                      type="button"
                      className={`cs-chip ${outfit.shoes === s ? 'on' : ''}`}
                      onClick={() => setOutfit(o => ({ ...o, shoes: s }))}
                    >
                      <Pictogram d={SHOE_ICON[s]} color={shoeHex} />
                      <span>{SHOE_LABELS[s]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div {...rowProps('shoeColor')}>
                {label(`COLOUR · ${SHOE_COLORS[outfit.shoeColor]?.name ?? ''}`, 'shoeColor')}
                <Swatches
                  list={SHOE_COLORS}
                  value={outfit.shoeColor}
                  onPick={i => setOutfit(o => ({ ...o, shoeColor: i }))}
                />
              </div>
              <div className="cs-buttons">
                <button type="button" className="cs-btn" onClick={randomFit}>
                  🎲 RANDOM FIT
                </button>
              </div>
            </>
          )}

          {tab === 'ride' && (
            <>
              <div {...rowProps('board')}>
                {label('RIDE', 'board')}
                <div className="cs-chips cs-chips-4">
                  {BOARD_TYPES.map(t => (
                    <button
                      key={t}
                      type="button"
                      className={`cs-chip ${board === t ? 'on' : ''}`}
                      onClick={() => {
                        setBoard(t);
                        bump();
                      }}
                    >
                      <span>{BOARD_LABELS[t]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div {...rowProps('build')}>
                {label('BUILD', 'build')}
                <div className="cs-value">
                  <button type="button" className="cs-arrow" onClick={() => cycle('build', -1)}>
                    ◀
                  </button>
                  <div className="cs-trait" key={`build-${build}-${flash}`}>
                    <span className="cs-meter">
                      {BUILDS.map((b, i) => (
                        <i key={b.name} className={i <= build ? 'on' : ''} />
                      ))}
                    </span>
                    <span className="cs-tname">{BUILDS[build]?.name}</span>
                  </div>
                  <button type="button" className="cs-arrow" onClick={() => cycle('build', 1)}>
                    ▶
                  </button>
                </div>
              </div>
              {onDesignDeck !== undefined && <DeckGraphicRow onDesign={onDesignDeck} />}
            </>
          )}
        </div>

        <div className="cs-foot">
          <button type="button" className="cs-btn cs-rand" onClick={randomAll}>
            🎲 ALL
          </button>
          <button type="button" className="cs-start" onClick={confirm}>
            PLAY ▶
          </button>
        </div>
        <div className="cs-help">
          ↑↓ PICK ←→ CHANGE Q/E TABS R RANDOM ENTER PLAY · PAD: LB/RB TABS X RANDOM A PLAY
        </div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
.cs-root{font-family:'Press Start 2P',ui-monospace,monospace;color:#fff;display:grid;
  grid-template-columns:minmax(0,1fr) min(460px,44vw);grid-template-rows:minmax(0,1fr)}
.cs-preview{position:relative;min-height:0;cursor:grab;touch-action:none;overflow:hidden;
  background:radial-gradient(ellipse at 50% 58%,rgba(0,0,0,0) 45%,rgba(6,4,24,.5) 100%)}
.cs-preview:active{cursor:grabbing}
.cs-scan{position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0px,rgba(0,0,0,.16) 1px,transparent 1px,transparent 3px);
  mix-blend-mode:multiply}
.cs-header{position:absolute;top:22px;left:24px;right:24px;display:flex;gap:14px;align-items:center;font-size:clamp(12px,1.8vw,20px);letter-spacing:.08em;pointer-events:none}
.cs-p1{background:#d22209;padding:6px 10px;box-shadow:4px 4px 0 #000}
.cs-blink{color:#ffd400;text-shadow:4px 4px 0 #d22209,0 0 18px rgba(255,212,0,.5)}
.cs-tagline{position:absolute;left:24px;bottom:58px;display:flex;flex-direction:column;gap:8px;pointer-events:none;text-shadow:3px 3px 0 #000}
.cs-tag{font-size:clamp(14px,2vw,22px);color:#3ddc84}
.cs-fit{font-size:9px;color:#c9c1ff}
.cs-spin{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;font-size:8px;color:#c9c1ff;text-shadow:2px 2px 0 #000}
.cs-spin button{font-family:inherit;font-size:16px;line-height:1;color:#fff;background:rgba(43,33,96,.85);border:2px solid #9c8cff;width:40px;height:40px;box-shadow:3px 3px 0 #000;cursor:pointer}
.cs-sheet{position:relative;display:flex;flex-direction:column;min-height:0;background:rgba(10,7,34,.94);border-left:4px solid #3a2f7a;box-shadow:-8px 0 0 rgba(0,0,0,.35)}
.cs-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:14px 14px 10px;flex-shrink:0;border-bottom:4px solid #3a2f7a}
.cs-tab{font-family:inherit;font-size:9px;color:#9c8cff;background:#1a1446;border:3px solid #3a2f7a;padding:8px 2px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;min-height:54px}
.cs-tab-ico{font-size:15px;line-height:1;font-family:system-ui,sans-serif}
.cs-tab.on{color:#000;background:#ffd400;border-color:#ffd400;box-shadow:4px 4px 0 #d22209}
.cs-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 14px 16px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.cs-row{border:4px solid #3a2f7a;background:rgba(20,14,60,.85);box-shadow:5px 5px 0 #000;padding:10px;cursor:pointer;display:flex;flex-direction:column;gap:10px}
.cs-active{border-color:#ffd400;background:rgba(40,26,110,.95)}
.cs-label{font-size:9px;color:#9c8cff;display:flex;gap:6px}
.cs-active .cs-label{color:#ffd400}
.cs-cursor{width:10px;display:inline-block}
.cs-value{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.cs-arrow{font-family:inherit;font-size:14px;color:#fff;background:#d22209;border:none;min-width:44px;height:44px;padding:0 10px;box-shadow:3px 3px 0 #000;cursor:pointer;flex-shrink:0}
.cs-arrow:active,.cs-btn:active,.cs-chip:active,.cs-start:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #000}
.cs-dice{background:#2b2160;border:2px solid #9c8cff;font-family:system-ui,sans-serif;font-size:16px}
.cs-trait{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0;animation:cspop .18s steps(3)}
@keyframes cspop{0%{transform:scale(.9);filter:brightness(2)}100%{transform:none}}
.cs-num{font-size:8px;color:#7f74c9}
.cs-tname{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cs-meter{display:flex;gap:3px}.cs-meter i{width:14px;height:7px;background:#2b2160;display:block}.cs-meter i.on{background:#3ddc84}.cs-meter i.on:nth-child(n+5){background:#ff8a00}.cs-meter i.on:nth-child(6){background:#ff2d2d}
.cs-name{font-family:inherit;font-size:14px;width:100%;min-width:0;background:#0b0820;color:#3ddc84;border:3px solid #3ddc84;padding:10px;outline:none;text-transform:uppercase;caret-color:#3ddc84;user-select:text}
.cs-name::placeholder{color:#2c7a52}
.cs-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.cs-chips-4{grid-template-columns:repeat(2,1fr)}
.cs-chip{font-family:inherit;font-size:8px;line-height:1.5;color:#fff;background:#1a1446;border:3px solid #3a2f7a;padding:8px 6px;display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer;min-height:52px;box-shadow:3px 3px 0 #000}
.cs-chip.on{border-color:#ffd400;background:#3a2a8a;color:#ffd400}
.cs-pic{width:30px;height:30px;flex-shrink:0}
.cs-swatches{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
.cs-swatch{aspect-ratio:1;min-height:40px;border:3px solid #000;box-shadow:3px 3px 0 #000;cursor:pointer;padding:0}
.cs-swatch.on{outline:3px solid #ffd400;outline-offset:2px}
.cs-buttons{display:flex;gap:10px;flex-wrap:wrap}
.cs-btn{font-family:inherit;font-size:9px;color:#fff;background:#2b2160;border:3px solid #9c8cff;padding:0 12px;min-height:44px;box-shadow:4px 4px 0 #000;cursor:pointer}
.cs-btn:hover{border-color:#ffd400;color:#ffd400}
.cs-foot{display:flex;gap:10px;padding:12px 14px;border-top:4px solid #3a2f7a;flex-shrink:0;background:rgba(10,7,34,.98)}
.cs-rand{flex-shrink:0}
.cs-start{flex:1;font-family:inherit;font-size:20px;color:#000;background:#ffd400;border:none;min-height:60px;box-shadow:6px 6px 0 #d22209;cursor:pointer;letter-spacing:.06em}
.cs-start:hover{background:#fff}
.cs-help{font-size:7px;line-height:1.8;color:#7f74c9;padding:0 14px 10px}
.dd-csrow .dd-csthumb{width:14px;height:44px;image-rendering:pixelated;border-radius:7px;border:2px solid #000}
.dd-csrow .dd-csdesign{font-size:8px;background:#2b2160;border:2px solid #ffd400;color:#ffd400}
.dd-csrow .cs-value{flex-wrap:wrap}
/* Phones (portrait): preview on top, the sheet below, PLAY in thumb reach */
@media (max-width:760px) and (orientation:portrait){
.cs-root{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(240px,42%) minmax(0,1fr)}
.cs-header{top:46px;left:14px;right:14px;font-size:12px}
.cs-tagline{left:14px;bottom:58px}
.cs-spin{bottom:10px}
.cs-sheet{border-left:none;border-top:4px solid #3a2f7a;box-shadow:0 -8px 0 rgba(0,0,0,.35)}
.cs-tabs{padding:10px 10px 8px;gap:5px}
.cs-body{padding:10px 10px 12px}
.cs-foot{padding:10px 10px calc(10px + env(safe-area-inset-bottom))}
.cs-help{display:none}
.cs-chips{grid-template-columns:repeat(2,1fr)}
}
/* Phones on their side: short, so a narrow sheet on the right */
@media (orientation:landscape) and (max-height:520px){
.cs-root{grid-template-columns:minmax(0,1fr) min(400px,52vw)}
.cs-header{top:44px;font-size:11px}
.cs-tabs{padding:8px;gap:4px}.cs-tab{min-height:40px;padding:4px 2px;gap:3px}
.cs-body{padding:8px;gap:8px}.cs-row{padding:6px;gap:6px}
.cs-arrow{height:38px;min-width:38px}
.cs-start{min-height:46px;font-size:16px}
.cs-foot{padding:8px}
.cs-help,.cs-tagline{display:none}
}
`;
