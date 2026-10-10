// ── Character select — old-school arcade screen over a live 3D turntable ──
//
// The game keeps rendering (showroom mode: physics paused, camera orbiting
// the rider) and this overlay cycles the Noun's traits. Keyboard, gamepad
// D-pad and mouse all work. The pick persists to localStorage.

import type { Game } from '../Game';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';

import { prefetchGlbHead } from '../character/GlbHead';
import { randomSeed, type NounSeed } from '../character/NounAppearance';
import { BUILDS } from '../character/NounCharacter';
import { worldPause } from '../worldPause';

const STORAGE_KEY = 'noun-world-v2-character';

type Row = 'head' | 'glasses' | 'body' | 'accessory' | 'build' | 'board' | 'name';
const ROWS: Row[] = ['head', 'glasses', 'body', 'accessory', 'build', 'board', 'name'];
type TraitRow = Exclude<Row, 'name' | 'board' | 'build'>;
const TRAIT_KEY: Record<TraitRow, 'heads' | 'glasses' | 'bodies' | 'accessories'> = {
  head: 'heads',
  glasses: 'glasses',
  body: 'bodies',
  accessory: 'accessories',
};

export interface SavedCharacter {
  seed: NounSeed;
  name: string;
  board?: 'skate' | 'hover';
  /** Index into BUILDS (skinny … clinically obese). */
  build?: number;
}

export function loadSavedCharacter(): SavedCharacter | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as SavedCharacter;
    if (typeof v.seed?.head !== 'number') return null;
    return v;
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

export function CharacterSelect({
  game,
  initial,
  auctionSeed,
  onConfirm,
}: {
  game: Game;
  initial: SavedCharacter;
  auctionSeed: NounSeed | null;
  onConfirm: (c: SavedCharacter) => void;
}) {
  const [seed, setSeedState] = useState<NounSeed>(initial.seed);
  const [name, setName] = useState(initial.name);
  const [board, setBoard] = useState<'skate' | 'hover'>(initial.board ?? 'skate');
  const [build, setBuild] = useState<number>(initial.build ?? 2);
  const [row, setRow] = useState(0);
  const [flash, setFlash] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const seedRef = useRef(seed);
  seedRef.current = seed;

  // Push the seed into the 3D preview (debounced so key-repeat stays smooth)
  useEffect(() => {
    // Warm the next/previous heads and glasses so flipping through is instant
    const nh = ImageData.images.heads.length;
    const ng = ImageData.images.glasses.length;
    for (const d of [1, -1, 2, -2])
      prefetchGlbHead((((seed.head + d) % nh) + nh) % nh, seed.glasses);
    for (const d of [1, -1]) prefetchGlbHead(seed.head, (((seed.glasses + d) % ng) + ng) % ng);
    const t = window.setTimeout(() => game.setSeed(seed), 60);
    return () => window.clearTimeout(t);
  }, [game, seed]);

  useEffect(() => {
    game.setBoardType(board);
  }, [game, board]);

  useEffect(() => {
    game.setWeight(BUILDS[build]?.w ?? 0);
  }, [game, build]);

  const cycle = useCallback((r: Row, dir: number) => {
    if (r === 'name') return;
    if (r === 'build') {
      setBuild(b => Math.max(0, Math.min(BUILDS.length - 1, b + Math.sign(dir))));
      setFlash(f => f + 1);
      return;
    }
    if (r === 'board') {
      setBoard(b => (b === 'skate' ? 'hover' : 'skate'));
      setFlash(f => f + 1);
      return;
    }
    const key = r;
    const n = traitCount(key);
    setSeedState(s => ({ ...s, [key]: (((s[key] + dir) % n) + n) % n }));
    setFlash(f => f + 1);
  }, []);

  const randomize = useCallback(() => {
    setSeedState(s => ({ ...randomSeed(), background: s.background }));
    setFlash(f => f + 1);
  }, []);

  const confirm = useCallback(() => {
    const c: SavedCharacter = {
      seed: seedRef.current,
      name: name.trim().slice(0, 16) || 'NOUN',
      board,
      build,
    };
    saveCharacter(c);
    onConfirm(c);
  }, [name, board, build, onConfirm]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (worldPause.get()) return;
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (typing && !['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.code)) return;
      const r = ROWS[row];
      if (e.code === 'ArrowUp' || (!typing && e.code === 'KeyW')) {
        e.preventDefault();
        setRow(v => (v + ROWS.length - 1) % ROWS.length);
      } else if (e.code === 'ArrowDown' || (!typing && e.code === 'KeyS')) {
        e.preventDefault();
        setRow(v => (v + 1) % ROWS.length);
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        cycle(r, e.shiftKey ? -10 : -1);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        cycle(r, e.shiftKey ? 10 : 1);
      } else if (e.code === 'KeyR' && !typing) {
        randomize();
      } else if (e.code === 'Enter' || (e.code === 'Space' && !typing)) {
        e.preventDefault();
        if (r === 'name' && !typing) nameRef.current?.focus();
        else confirm();
      } else if (e.code === 'Escape' && typing) {
        nameRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, cycle, randomize, confirm]);

  // Gamepad (D-pad / stick to navigate, A start, X random, B/Y prev/next)
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
      const r = ROWS[row];
      if (hit(12)) setRow(v => (v + ROWS.length - 1) % ROWS.length);
      if (hit(13)) setRow(v => (v + 1) % ROWS.length);
      if (hit(14)) cycle(r, -1);
      if (hit(15)) cycle(r, 1);
      if (hit(4)) cycle(r, -10);
      if (hit(5)) cycle(r, 10);
      if (hit(2)) randomize();
      if (hit(0) || hit(9)) confirm();
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      if (t > stickCooldown) {
        if (Math.abs(ax) > 0.6) {
          cycle(r, ax > 0 ? 1 : -1);
          stickCooldown = t + 160;
        } else if (Math.abs(ay) > 0.6) {
          setRow(v => (v + (ay > 0 ? 1 : ROWS.length - 1)) % ROWS.length);
          stickCooldown = t + 200;
        }
      }
      prev = b;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [row, cycle, randomize, confirm]);

  const rowLabel: Record<Row, string> = {
    head: 'HEAD',
    glasses: 'GLASSES',
    body: 'BODY',
    accessory: 'ACCESSORY',
    build: 'BUILD',
    board: 'DECK',
    name: 'TAG',
  };

  return (
    <div className="cs-root pointer-events-auto absolute inset-0 select-none">
      <style>{CSS}</style>
      <div className="cs-scan" />
      <div className="cs-header">
        <span className="cs-p1">P1</span>
        <span className="cs-blink">SELECT YOUR NOUN</span>
        <span className="cs-credit">CREDIT 01</span>
      </div>

      <div className="cs-panel">
        {ROWS.map((r, i) => {
          const active = i === row;
          return (
            <div
              key={r}
              className={`cs-row ${active ? 'cs-active' : ''}`}
              onMouseEnter={() => setRow(i)}
              onClick={() => setRow(i)}
            >
              <div className="cs-label">
                {active ? (
                  <span className="cs-cursor">▶</span>
                ) : (
                  <span className="cs-cursor"> </span>
                )}
                {rowLabel[r]}
              </div>
              {r === 'build' ? (
                <div className="cs-value">
                  <button type="button" className="cs-arrow" onClick={() => cycle(r, -1)}>
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
                  <button type="button" className="cs-arrow" onClick={() => cycle(r, 1)}>
                    ▶
                  </button>
                </div>
              ) : r === 'board' ? (
                <div className="cs-value">
                  <button type="button" className="cs-arrow" onClick={() => cycle(r, -1)}>
                    ◀
                  </button>
                  <div className="cs-trait" key={`board-${board}-${flash}`}>
                    <span className="cs-num">{board === 'skate' ? '01/02' : '02/02'}</span>
                    <span className="cs-tname">
                      {board === 'skate' ? 'SKATEBOARD' : 'HOVERBOARD ⚡'}
                    </span>
                  </div>
                  <button type="button" className="cs-arrow" onClick={() => cycle(r, 1)}>
                    ▶
                  </button>
                </div>
              ) : r === 'name' ? (
                <input
                  ref={nameRef}
                  className="cs-name"
                  value={name}
                  maxLength={16}
                  spellCheck={false}
                  onFocus={() => setRow(i)}
                  onChange={e => setName(e.target.value.toUpperCase().replace(/[^\d .A-Z_-]/g, ''))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                      confirm();
                    }
                  }}
                />
              ) : (
                <div className="cs-value">
                  <button type="button" className="cs-arrow" onClick={() => cycle(r, -1)}>
                    ◀
                  </button>
                  <div className="cs-trait" key={`${r}-${seed[r]}-${flash}`}>
                    <span className="cs-num">
                      {pad3(seed[r])}/{pad3(traitCount(r) - 1)}
                    </span>
                    <span className="cs-tname">{traitName(r, seed[r])}</span>
                  </div>
                  <button type="button" className="cs-arrow" onClick={() => cycle(r, 1)}>
                    ▶
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="cs-buttons">
          <button type="button" className="cs-btn" onClick={randomize}>
            🎲 RANDOM
          </button>
          {auctionSeed !== null && (
            <button
              type="button"
              className="cs-btn"
              onClick={() => {
                setSeedState(auctionSeed);
                setFlash(f => f + 1);
              }}
            >
              ⌐◨-◨ TODAY&apos;S NOUN
            </button>
          )}
        </div>
        <button type="button" className="cs-start" onClick={confirm}>
          PRESS START
        </button>
      </div>

      <div className="cs-help">
        ↑↓ SELECT   ←→ CHANGE (SHIFT ×10)   R RANDOM   ENTER START
        <br />
        PAD: D-PAD   LB/RB ×10   X RANDOM   A START
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
.cs-root{font-family:'Press Start 2P',ui-monospace,monospace;color:#fff;image-rendering:pixelated;
  background:linear-gradient(90deg,rgba(6,4,24,.92) 0%,rgba(6,4,24,.75) 34%,rgba(6,4,24,0) 58%),
             radial-gradient(ellipse at 70% 60%,rgba(0,0,0,0) 40%,rgba(0,0,0,.55) 100%)}
.cs-scan{position:absolute;inset:0;pointer-events:none;z-index:5;
  background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0px,rgba(0,0,0,.22) 1px,transparent 1px,transparent 3px);
  mix-blend-mode:multiply;animation:csflicker 6s infinite}
@keyframes csflicker{0%,100%{opacity:.9}50%{opacity:1}52%{opacity:.82}54%{opacity:1}}
.cs-header{position:absolute;top:22px;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:0 28px;font-size:clamp(12px,2.2vw,22px);letter-spacing:.08em}
.cs-p1{background:#d22209;padding:6px 10px;box-shadow:4px 4px 0 #000}
.cs-credit{color:#ffd400;font-size:.6em}
.cs-blink{color:#ffd400;text-shadow:4px 4px 0 #d22209,0 0 18px rgba(255,212,0,.5);animation:csblink 1.1s steps(1) infinite}
@keyframes csblink{50%{opacity:.25}}
.cs-panel{position:absolute;left:28px;top:84px;bottom:20px;width:min(540px,calc(100vw - 56px));display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.cs-row{border:4px solid #3a2f7a;background:rgba(20,14,60,.85);box-shadow:6px 6px 0 #000;padding:8px 10px;cursor:pointer;transition:transform .06s;display:flex;align-items:center;gap:8px}
.cs-active{border-color:#ffd400;background:rgba(40,26,110,.95);transform:translateX(6px)}
.cs-label{font-size:10px;color:#9c8cff;display:flex;gap:6px;width:118px;flex-shrink:0}
.cs-active .cs-label{color:#ffd400}
.cs-cursor{width:12px;display:inline-block;animation:csblink .6s steps(1) infinite}
.cs-value{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.cs-arrow{font-family:inherit;font-size:14px;color:#fff;background:#d22209;border:none;padding:8px 10px;box-shadow:3px 3px 0 #000;cursor:pointer}
.cs-arrow:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #000}
.cs-trait{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0;animation:cspop .18s steps(3)}
@keyframes cspop{0%{transform:scale(.9);filter:brightness(2)}100%{transform:none}}
.cs-num{font-size:9px;color:#7f74c9}
.cs-meter{display:flex;gap:3px}.cs-meter i{width:14px;height:7px;background:#2b2160;display:block}.cs-meter i.on{background:#3ddc84}.cs-meter i.on:nth-child(n+5){background:#ff8a00}.cs-meter i.on:nth-child(6){background:#ff2d2d}
.cs-tname{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cs-name{font-family:inherit;font-size:13px;width:100%;min-width:0;flex:1;background:#0b0820;color:#3ddc84;border:3px solid #3ddc84;padding:8px;outline:none;text-transform:uppercase;caret-color:#3ddc84}
.cs-buttons{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.cs-btn{font-family:inherit;font-size:10px;color:#fff;background:#2b2160;border:3px solid #9c8cff;padding:10px 12px;box-shadow:4px 4px 0 #000;cursor:pointer}
.cs-btn:hover{border-color:#ffd400;color:#ffd400}
.cs-start{font-family:inherit;margin-top:6px;flex-shrink:0;font-size:18px;color:#000;background:#ffd400;border:none;padding:16px;box-shadow:6px 6px 0 #d22209;cursor:pointer;animation:csblink 1.2s steps(1) infinite}
.cs-start:hover{animation:none;background:#fff}
.cs-help{position:absolute;bottom:18px;right:28px;text-align:right;font-size:8px;line-height:1.9;color:#9c8cff;text-shadow:2px 2px 0 #000}
@media (max-width:700px){.cs-root{background:linear-gradient(0deg,rgba(6,4,24,.94) 0%,rgba(6,4,24,.85) 52%,rgba(6,4,24,0) 70%)}
  .cs-panel{top:auto;bottom:70px;left:16px;width:calc(100vw - 32px);gap:6px}
  .cs-row{padding:6px 8px}.cs-label{width:84px;font-size:8px}.cs-help{display:none}.cs-header{padding:0 14px}}
`;
