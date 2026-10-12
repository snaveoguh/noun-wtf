// ── Board shop: paint your own deck, pixel by pixel, plus Nouns stickers ──
//
// The deck is a DECK_W × DECK_H pixel grid (nose at the top) with Nouns
// trait decals on top, kept as references (see character/deckSchema). Save
// stores it in this browser, and with a wallet signs it to the world-decks
// function so other riders see it. Opened from the Noun Jersey board shop
// door or the character select screen.

import type { Game } from '../Game';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import * as THREE from 'three';
import { useAccount, useSignMessage } from 'wagmi';

import {
  composeDeck,
  decalSize,
  defaultDesign,
  designCanvas,
  hexRgb,
  rgbHex,
  traitArt,
  traitCount,
  traitLabel,
} from '../character/deckArt';
import {
  DECAL_KINDS,
  DECK_H,
  DECK_SLOTS,
  DECK_W,
  MAX_DECALS,
  MAX_PAL,
  decodePixels,
  deckMessage,
  encodePixels,
  type DecalKind,
  type DeckDecal,
  type DeckDesign,
} from '../character/deckSchema';
import { DECKS_URL, deckStore } from '../character/deckStore';
import { loadCharacterAssets, NounCharacter } from '../character/NounCharacter';
import { SPRAY_COLORS } from '../graffiti/Graffiti';
import { worldPause } from '../worldPause';

// ── Shared hooks ──

export function useDeckState() {
  return useSyncExternalStore(deckStore.subscribe, deckStore.getState);
}

/** Keep the deck store on the connected wallet (mount once, e.g. World2Page). */
export function useDeckWallet() {
  const { address } = useAccount();
  useEffect(() => {
    deckStore.setAddress(address ?? null);
  }, [address]);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const thumbCache = new Map<string, string>();
function designThumb(d: DeckDesign): string {
  const key = JSON.stringify(d);
  let url = thumbCache.get(key);
  if (url === undefined) {
    url = designCanvas(d).toDataURL();
    thumbCache.set(key, url);
  }
  return url;
}

// ── Editor document ──

interface Doc {
  idx: Uint8Array;
  pal: string[];
  decals: DeckDecal[];
  bg: string[];
  grip: string;
  name: string;
}

const cloneDoc = (d: Doc): Doc => ({
  idx: d.idx.slice(),
  pal: d.pal.slice(),
  decals: d.decals.map(x => ({ ...x })),
  bg: d.bg.slice(),
  grip: d.grip,
  name: d.name,
});

function docFrom(design: DeckDesign): Doc {
  return {
    idx: decodePixels(design.px, design.pal.length) ?? new Uint8Array(DECK_W * DECK_H),
    pal: design.pal.slice(),
    decals: design.decals.map(x => ({ ...x })),
    bg: design.bg.slice(),
    grip: design.grip,
    name: design.name,
  };
}

/** Drop unused colours and renumber (keeps saves small). */
function compact(d: Doc) {
  const used = new Set<number>();
  for (const v of d.idx) if (v > 0) used.add(v);
  const map = new Map<number, number>();
  const pal: string[] = [];
  for (let i = 1; i <= d.pal.length; i++)
    if (used.has(i)) {
      pal.push(d.pal[i - 1]);
      map.set(i, pal.length);
    }
  for (let i = 0; i < d.idx.length; i++) if (d.idx[i] > 0) d.idx[i] = map.get(d.idx[i]) ?? 0;
  d.pal = pal;
}

function docDesign(d: Doc): DeckDesign {
  const c = cloneDoc(d);
  compact(c);
  return {
    v: 1,
    name: c.name.slice(0, 20),
    bg: c.bg,
    pal: c.pal,
    px: encodePixels(c.idx),
    decals: c.decals,
    grip: c.grip,
  };
}

/** Palette index for a colour (adds it; 0 = clear). */
function palIndex(d: Doc, hex: string | null): number {
  if (hex === null) return 0;
  const i = d.pal.indexOf(hex);
  if (i >= 0) return i + 1;
  if (d.pal.length >= MAX_PAL) compact(d);
  if (d.pal.length < MAX_PAL) {
    d.pal.push(hex);
    return d.pal.length;
  }
  // Full: nearest colour already on the deck
  const [r, g, b] = hexRgb(hex);
  let best = 1;
  let bd = Infinity;
  d.pal.forEach((c, k) => {
    const [r2, g2, b2] = hexRgb(c);
    const dd = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (dd < bd) [best, bd] = [k + 1, dd];
  });
  return best;
}

const DRAFT_KEY = 'noun-world-v2-deck-draft';
function loadDraft(): DeckDesign | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw === null) return null;
    const d = JSON.parse(raw) as DeckDesign;
    return decodePixels(d.px, d.pal.length) !== null ? d : null;
  } catch {
    return null;
  }
}

// ── Palettes ──

const NOUNS_PALETTE: string[] = (() => {
  const seen = new Set<string>();
  const out: { hex: string; h: number; l: number; s: number }[] = [];
  for (const raw of ImageData.palette as string[]) {
    if (!/^[\da-f]{6}$/i.test(raw)) continue;
    const hex = `#${raw.toLowerCase()}`;
    if (seen.has(hex)) continue;
    seen.add(hex);
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    out.push({ hex, ...hsl });
  }
  // Greys first, then by hue band and lightness
  return out
    .sort((a, b) => {
      const ga = a.s < 0.12 ? -1 : Math.floor(a.h * 12);
      const gb = b.s < 0.12 ? -1 : Math.floor(b.h * 12);
      return ga - gb || b.l - a.l;
    })
    .map(c => c.hex);
})();

const GRIPS = [
  '#1b1b1b',
  '#3a3a3a',
  '#f2f2f2',
  '#d22209',
  '#ffd400',
  '#2b83f6',
  '#3ddc84',
  '#ff5fa2',
];

// ── Tools ──

type Tool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'move';
const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'pencil', icon: '✎', label: 'PENCIL', key: 'B' },
  { id: 'eraser', icon: '⌫', label: 'ERASER', key: 'E' },
  { id: 'fill', icon: '◍', label: 'FILL', key: 'G' },
  { id: 'picker', icon: '⊙', label: 'PICK', key: 'I' },
  { id: 'line', icon: '╱', label: 'LINE', key: 'L' },
  { id: 'rect', icon: '▭', label: 'RECT', key: 'R' },
  { id: 'move', icon: '✥', label: 'STICKER', key: 'V' },
];

type Pattern = 'stripes' | 'checker' | 'dots' | 'halftone' | 'flames';
const PATTERNS: Pattern[] = ['stripes', 'checker', 'dots', 'halftone', 'flames'];

const FONTS: { id: string; label: string; css: string }[] = [
  { id: 'pixel', label: 'PIXEL', css: "'Press Start 2P'" },
  { id: 'block', label: 'BLOCK', css: "900 {px}px 'Arial Black', Impact, sans-serif" },
  { id: 'londrina', label: 'LONDRINA', css: "'Londrina Solid'" },
  { id: 'serif', label: 'SERIF', css: "bold {px}px Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'MONO', css: 'bold {px}px ui-monospace, Menlo, monospace' },
];
const fontString = (id: string, px: number) => {
  const f = FONTS.find(x => x.id === id) ?? FONTS[0];
  return f.css.includes('{px}') ? f.css.replace('{px}', String(px)) : `${px}px ${f.css}`;
};

function patternHit(p: Pattern, x: number, y: number): 0 | 1 | 2 {
  switch (p) {
    case 'stripes':
      return Math.floor(y / 6) % 2 === 0 ? 1 : 0;
    case 'checker':
      return (Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0 ? 1 : 0;
    case 'dots': {
      const cx = (x % 8) - 3.5;
      const cy = (y % 8) - 3.5;
      return cx * cx + cy * cy <= 5 ? 1 : 0;
    }
    case 'halftone': {
      const r = 0.3 + 2.9 * (y / DECK_H);
      const cx = (x % 6) - 2.5;
      const cy = (y % 6) - 2.5;
      return cx * cx + cy * cy <= r * r ? 1 : 0;
    }
    case 'flames': {
      const h = DECK_H * 0.26 + 16 * Math.abs(Math.sin(x * 0.29 + 0.4)) + 5 * Math.sin(x * 1.3);
      const up = DECK_H - 1 - y;
      if (up < h * 0.55) return 2;
      return up < h ? 1 : 0;
    }
  }
}

// ── The designer ──

export function DeckDesigner({ game, onClose }: { game: Game | null; onClose: () => void }) {
  const deck = useDeckState();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [slot, setSlot] = useState(() => Math.max(0, deck.selected));
  const docRef = useRef<Doc>(null as unknown as Doc);
  if (docRef.current === null) {
    const from = loadDraft() ?? deckStore.slot(slot)?.d ?? defaultDesign();
    docRef.current = docFrom(from);
  }
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev(r => r + 1), []);
  const undoRef = useRef<{ past: Doc[]; future: Doc[] }>({ past: [], future: [] });

  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#d22209');
  const [brush, setBrush] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [rectFill, setRectFill] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useState<'paint' | 'decals' | 'fills' | 'save'>('paint');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keys stay in here while open (the game and the select screen sleep)
  useEffect(() => {
    const was = worldPause.get();
    worldPause.set(true);
    return () => worldPause.set(was);
  }, []);

  // Draft survives closing the shop
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(docDesign(docRef.current)));
      } catch {
        // fine
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [rev]);

  const pushUndo = useCallback(() => {
    const u = undoRef.current;
    u.past.push(cloneDoc(docRef.current));
    if (u.past.length > 60) u.past.shift();
    u.future = [];
  }, []);
  const undo = useCallback(() => {
    const u = undoRef.current;
    const prev = u.past.pop();
    if (prev === undefined) return;
    u.future.push(cloneDoc(docRef.current));
    docRef.current = prev;
    setSel(s => (s !== null && s < prev.decals.length ? s : null));
    bump();
  }, [bump]);
  const redo = useCallback(() => {
    const u = undoRef.current;
    const next = u.future.pop();
    if (next === undefined) return;
    u.past.push(cloneDoc(docRef.current));
    docRef.current = next;
    setSel(s => (s !== null && s < next.decals.length ? s : null));
    bump();
  }, [bump]);

  const loadDesign = useCallback(
    (d: DeckDesign) => {
      pushUndo();
      docRef.current = docFrom(d);
      setSel(null);
      bump();
    },
    [pushUndo, bump],
  );

  // ── Decal ops ──
  const addDecal = useCallback(
    (k: DecalKind, i: number) => {
      const d = docRef.current;
      if (d.decals.length >= MAX_DECALS) {
        setStatus(`Max ${MAX_DECALS} stickers`);
        return;
      }
      pushUndo();
      const s = k === 'glasses' ? 2 : 1;
      const dec: DeckDecal = { k, i, x: 0, y: 0, s, r: 0 };
      const { w, h } = decalSize(dec);
      dec.x = Math.round((DECK_W - w) / 2);
      dec.y = Math.round((DECK_H - h) / 2);
      d.decals.push(dec);
      setSel(d.decals.length - 1);
      setTool('move');
      bump();
    },
    [pushUndo, bump],
  );

  const editDecal = useCallback(
    (fn: (d: DeckDecal, all: DeckDecal[]) => number | void) => {
      if (sel === null) return;
      const all = docRef.current.decals;
      const d = all[sel];
      if (d === undefined) return;
      pushUndo();
      const next = fn(d, all);
      if (typeof next === 'number') setSel(next >= 0 ? next : null);
      bump();
    },
    [sel, pushUndo, bump],
  );

  const scaleDecal = (dir: number) =>
    editDecal(d => {
      const before = decalSize(d);
      d.s = Math.max(1, Math.min(4, d.s + dir));
      const after = decalSize(d);
      d.x -= Math.round((after.w - before.w) / 2);
      d.y -= Math.round((after.h - before.h) / 2);
    });
  const rotateDecal = () =>
    editDecal(d => {
      const before = decalSize(d);
      d.r = (d.r + 1) % 4;
      const after = decalSize(d);
      d.x += Math.round((before.w - after.w) / 2);
      d.y += Math.round((before.h - after.h) / 2);
    });
  const nudge = (dx: number, dy: number) =>
    editDecal(d => {
      d.x += dx;
      d.y += dy;
    });
  const layer = (dir: number) =>
    editDecal((d, all) => {
      const i = all.indexOf(d);
      const j = Math.max(0, Math.min(all.length - 1, i + dir));
      all.splice(i, 1);
      all.splice(j, 0, d);
      return j;
    });

  // ── Fills ──
  const applyPattern = (p: Pattern) => {
    pushUndo();
    const d = docRef.current;
    const a = palIndex(d, color);
    const inner = palIndex(d, color === '#ffd400' ? '#ff8a00' : '#ffd400');
    for (let y = 0; y < DECK_H; y++)
      for (let x = 0; x < DECK_W; x++) {
        const hit = patternHit(p, x, y);
        if (hit === 0) continue;
        d.idx[y * DECK_W + x] = hit === 2 && p === 'flames' ? inner : a;
      }
    bump();
  };

  const [text, setText] = useState('');
  const [font, setFont] = useState('pixel');
  const [textSize, setTextSize] = useState<'S' | 'M' | 'L'>('M');
  const [along, setAlong] = useState(true);
  const [textPos, setTextPos] = useState<0.25 | 0.5 | 0.75>(0.5);
  const stampText = async () => {
    const t = text.trim();
    if (t === '') return;
    const px = along ? { S: 12, M: 18, L: 28 }[textSize] : { S: 8, M: 12, L: 18 }[textSize];
    const fs = fontString(font, px);
    try {
      await document.fonts?.load(fs, t);
    } catch {
      // fall back to whatever's loaded
    }
    const c = document.createElement('canvas');
    c.width = DECK_W;
    c.height = DECK_H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.font = fs;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    const cy = Math.round(DECK_H * textPos);
    if (along) {
      ctx.translate(DECK_W / 2, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(t, 0, 0, DECK_H * 0.92);
    } else {
      ctx.fillText(t, DECK_W / 2, cy, DECK_W - 2);
    }
    const img = ctx.getImageData(0, 0, DECK_W, DECK_H).data;
    pushUndo();
    const d = docRef.current;
    const ci = palIndex(d, color);
    for (let i = 0; i < DECK_W * DECK_H; i++) if (img[i * 4 + 3] > 110) d.idx[i] = ci;
    bump();
  };

  // ── Save ──
  const save = async (to: number) => {
    if (busy) return;
    const design = docDesign(docRef.current);
    const json = JSON.stringify(design);
    const at = Date.now();
    deckStore.saveLocal(to, design, at);
    deckStore.select(to);
    setSlot(to);
    if (address === undefined) {
      setStatus(`Saved to slot ${to + 1} on this device. Connect a wallet to keep it everywhere.`);
      return;
    }
    setBusy(true);
    setStatus('Sign the message in your wallet…');
    try {
      const message = deckMessage(address, await sha256Hex(json), at);
      const signature = await signMessageAsync({ message });
      setStatus('Saving…');
      const r = await fetch(DECKS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: address.toLowerCase(),
          slot: to,
          design: json,
          message,
          signature,
        }),
      });
      const res = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || res.ok !== true) throw new Error(res.error ?? `HTTP ${r.status}`);
      deckStore.setRemoteSlot(to, { d: design, at });
      setStatus(`Saved to your wallet, slot ${to + 1}. Everyone sees it now.`);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      setStatus(
        /reject|denied/i.test(msg)
          ? 'Not signed. Saved on this device only.'
          : `Wallet save failed (${msg.slice(0, 80)}). Saved on this device.`,
      );
    } finally {
      setBusy(false);
    }
  };

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(
        (e.target as HTMLElement | null)?.tagName ?? '',
      );
      e.stopPropagation();
      if (typing) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Escape') return onClose();
      const t = TOOLS.find(x => x.key.toLowerCase() === k);
      if (t !== undefined) setTool(t.id);
      else if (k === 'm') setMirror(m => !m);
      else if (k === '[') setBrush(b => Math.max(1, b - 1));
      else if (k === ']') setBrush(b => Math.min(6, b + 1));
      else if (sel !== null && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 4 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudge(dx, dy);
      } else if (sel !== null && (e.key === 'Delete' || e.key === 'Backspace'))
        editDecal((d, all) => {
          all.splice(all.indexOf(d), 1);
          return -1;
        });
    };
    // Capture on document: ahead of the game's window listeners
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const doc = docRef.current;
  const designNow = useMemo(() => docDesign(doc), [doc, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dd-root" onPointerDown={e => e.stopPropagation()}>
      <style>{CSS}</style>
      <header className="dd-head">
        <button type="button" className="dd-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <span className="dd-title">BOARD SHOP</span>
        <span className="dd-head-tools">
          <button type="button" className="dd-ib" onClick={undo} title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button type="button" className="dd-ib" onClick={redo} title="Redo (Ctrl+Shift+Z)">
            ↷
          </button>
          <button
            type="button"
            className={`dd-ib ${mirror ? 'dd-on' : ''}`}
            onClick={() => setMirror(m => !m)}
            title="Mirror left/right (M)"
          >
            ⇋
          </button>
          <button
            type="button"
            className="dd-save-quick"
            disabled={busy}
            onClick={() => void save(slot)}
          >
            SAVE {slot + 1}
          </button>
        </span>
      </header>

      <div className="dd-body">
        <div className="dd-rail">
          {TOOLS.map(t => (
            <button
              key={t.id}
              type="button"
              className={`dd-tool ${tool === t.id ? 'dd-on' : ''}`}
              onClick={() => {
                setTool(t.id);
                if (t.id === 'move') setTab('decals');
              }}
              title={`${t.label} (${t.key})`}
            >
              <b>{t.icon}</b>
              <i>{t.label}</i>
            </button>
          ))}
          <div className="dd-brush" title="Brush size ([ ])">
            <button type="button" onClick={() => setBrush(b => Math.max(1, b - 1))}>
              −
            </button>
            <span>{brush}px</span>
            <button type="button" onClick={() => setBrush(b => Math.min(6, b + 1))}>
              +
            </button>
          </div>
          <button
            type="button"
            className="dd-swatch-now"
            style={{ background: color }}
            onClick={() => setTab('paint')}
            title="Colour"
          />
        </div>

        <Stage
          doc={doc}
          rev={rev}
          tool={tool}
          color={color}
          brush={brush}
          mirror={mirror}
          rectFill={rectFill}
          sel={sel}
          onSel={setSel}
          onPick={c => {
            setColor(c);
            setTool('pencil');
          }}
          pushUndo={pushUndo}
          bump={bump}
          design={designNow}
        />

        <aside className="dd-panel">
          <nav className="dd-tabs">
            {(['paint', 'decals', 'fills', 'save'] as const).map(t => (
              <button
                key={t}
                type="button"
                className={tab === t ? 'dd-on' : ''}
                onClick={() => setTab(t)}
              >
                {{ paint: 'PAINT', decals: 'STICKERS', fills: 'QUICK', save: 'SAVE' }[t]}
              </button>
            ))}
          </nav>
          <div className="dd-tabbody">
            {tab === 'paint' && (
              <PaintTab
                color={color}
                setColor={setColor}
                used={doc.pal}
                rectFill={rectFill}
                setRectFill={setRectFill}
              />
            )}
            {tab === 'decals' && (
              <DecalsTab
                decals={doc.decals}
                sel={sel}
                setSel={i => {
                  setSel(i);
                  setTool('move');
                }}
                onAdd={addDecal}
                onScale={scaleDecal}
                onRotate={rotateDecal}
                onFlip={() =>
                  editDecal(d => {
                    d.f = d.f === 1 ? 0 : 1;
                    if (d.f === 0) delete d.f;
                  })
                }
                onLayer={layer}
                onNudge={nudge}
                onDelete={() =>
                  editDecal((d, all) => {
                    all.splice(all.indexOf(d), 1);
                    return -1;
                  })
                }
                onDup={() =>
                  editDecal((d, all) => {
                    if (all.length >= MAX_DECALS) return;
                    all.push({ ...d, x: d.x + 3, y: d.y + 3 });
                    return all.length - 1;
                  })
                }
              />
            )}
            {tab === 'fills' && (
              <div className="dd-sec">
                <h4>BASE</h4>
                <div className="dd-rowc">
                  <label className="dd-colorbox">
                    <input
                      type="color"
                      value={doc.bg[0]}
                      onFocus={pushUndo}
                      onChange={e => {
                        doc.bg[0] = e.target.value;
                        bump();
                      }}
                    />
                    <span style={{ background: doc.bg[0] }} />
                  </label>
                  <button
                    type="button"
                    className={`dd-chip ${doc.bg.length === 2 ? 'dd-on' : ''}`}
                    onClick={() => {
                      pushUndo();
                      if (doc.bg.length === 2) doc.bg = [doc.bg[0]];
                      else doc.bg = [doc.bg[0], color];
                      bump();
                    }}
                  >
                    GRADIENT
                  </button>
                  {doc.bg.length === 2 && (
                    <label className="dd-colorbox">
                      <input
                        type="color"
                        value={doc.bg[1]}
                        onFocus={pushUndo}
                        onChange={e => {
                          doc.bg[1] = e.target.value;
                          bump();
                        }}
                      />
                      <span style={{ background: doc.bg[1] }} />
                    </label>
                  )}
                  <button
                    type="button"
                    className="dd-chip"
                    onClick={() => {
                      pushUndo();
                      doc.bg = doc.bg.length === 2 ? [color, doc.bg[1]] : [color];
                      bump();
                    }}
                  >
                    = PAINT
                  </button>
                </div>
                <h4>PATTERN (IN PAINT COLOUR)</h4>
                <div className="dd-rowc">
                  {PATTERNS.map(p => (
                    <button
                      key={p}
                      type="button"
                      className="dd-chip"
                      onClick={() => applyPattern(p)}
                    >
                      {p.toUpperCase()}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="dd-chip dd-warn"
                    onClick={() => {
                      pushUndo();
                      doc.idx.fill(0);
                      bump();
                    }}
                  >
                    CLEAR PIXELS
                  </button>
                </div>
                <h4>TEXT</h4>
                <input
                  className="dd-input"
                  value={text}
                  maxLength={18}
                  placeholder="NAME / TAG"
                  onChange={e => setText(e.target.value)}
                />
                <div className="dd-rowc">
                  {FONTS.map(f => (
                    <button
                      key={f.id}
                      type="button"
                      className={`dd-chip ${font === f.id ? 'dd-on' : ''}`}
                      onClick={() => setFont(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="dd-rowc">
                  {(['S', 'M', 'L'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      className={`dd-chip ${textSize === s ? 'dd-on' : ''}`}
                      onClick={() => setTextSize(s)}
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`dd-chip ${along ? 'dd-on' : ''}`}
                    onClick={() => setAlong(a => !a)}
                  >
                    {along ? 'ALONG ↕' : 'ACROSS ↔'}
                  </button>
                  {([0.25, 0.5, 0.75] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      className={`dd-chip ${textPos === p ? 'dd-on' : ''}`}
                      onClick={() => setTextPos(p)}
                    >
                      {{ 0.25: 'NOSE', 0.5: 'MID', 0.75: 'TAIL' }[p]}
                    </button>
                  ))}
                </div>
                <button type="button" className="dd-big" onClick={() => void stampText()}>
                  STAMP TEXT <span className="dd-dot" style={{ background: color }} />
                </button>
                <h4>GRIP TAPE</h4>
                <div className="dd-rowc">
                  {GRIPS.map(g => (
                    <button
                      key={g}
                      type="button"
                      className={`dd-sw ${doc.grip === g ? 'dd-on' : ''}`}
                      style={{ background: g }}
                      onClick={() => {
                        pushUndo();
                        doc.grip = g;
                        bump();
                      }}
                    />
                  ))}
                  <label className="dd-colorbox">
                    <input
                      type="color"
                      value={doc.grip}
                      onFocus={pushUndo}
                      onChange={e => {
                        doc.grip = e.target.value;
                        bump();
                      }}
                    />
                    <span style={{ background: doc.grip }} />
                  </label>
                </div>
              </div>
            )}
            {tab === 'save' && (
              <div className="dd-sec">
                <h4>NAME</h4>
                <input
                  className="dd-input"
                  value={doc.name}
                  maxLength={20}
                  onChange={e => {
                    doc.name = e.target.value.toUpperCase().replace(/[<>]/g, '');
                    bump();
                  }}
                />
                <div className="dd-wallet">
                  {address !== undefined ? (
                    <>
                      WALLET {address.slice(0, 6)}…{address.slice(-4)} ✓<br />
                      <small>Saves are signed and show for everyone.</small>
                    </>
                  ) : (
                    <>
                      NO WALLET: saves stay on this device.
                      <br />
                      <small>Connect a wallet to keep it everywhere.</small>
                    </>
                  )}
                </div>
                <div className="dd-slots">
                  {Array.from({ length: DECK_SLOTS }, (_, i) => {
                    const s = deckStore.slot(i);
                    const onWallet =
                      s !== null && deck.remote?.[i] !== null && deck.remote?.[i] !== undefined;
                    return (
                      <div key={i} className={`dd-slot ${slot === i ? 'dd-on' : ''}`}>
                        <div className="dd-slot-top" onClick={() => setSlot(i)}>
                          {s !== null ? (
                            <img src={designThumb(s.d)} alt="" />
                          ) : (
                            <div className="dd-slot-empty">EMPTY</div>
                          )}
                          <div className="dd-slot-meta">
                            <b>SLOT {i + 1}</b>
                            <span>{s?.d.name ?? ''}</span>
                            <em>
                              {s === null ? '' : onWallet ? 'WALLET' : 'THIS DEVICE'}
                              {deck.selected === i ? ' · RIDING' : ''}
                            </em>
                          </div>
                        </div>
                        <div className="dd-slot-btns">
                          <button type="button" disabled={busy} onClick={() => void save(i)}>
                            SAVE HERE
                          </button>
                          {s !== null && (
                            <button
                              type="button"
                              onClick={() => {
                                loadDesign(s.d);
                                setSlot(i);
                              }}
                            >
                              LOAD
                            </button>
                          )}
                          {s !== null && (
                            <button type="button" onClick={() => deckStore.select(i)}>
                              RIDE
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="dd-rowc">
                  <button
                    type="button"
                    className={`dd-chip ${deck.selected === -1 ? 'dd-on' : ''}`}
                    onClick={() => deckStore.select(-1)}
                  >
                    RIDE DEFAULT DECK
                  </button>
                  <button
                    type="button"
                    className="dd-chip dd-warn"
                    onClick={() => loadDesign(defaultDesign())}
                  >
                    NEW DECK
                  </button>
                </div>
              </div>
            )}
          </div>
          {status !== null && <div className="dd-status">{status}</div>}
        </aside>
      </div>
      <Preview3D game={game} design={designNow} />
    </div>
  );
}

// ── Canvas stage: paint, pinch/drag zoom + pan ──

interface View {
  x: number;
  y: number;
  z: number;
}

function Stage(props: {
  doc: Doc;
  rev: number;
  tool: Tool;
  color: string;
  brush: number;
  mirror: boolean;
  rectFill: boolean;
  sel: number | null;
  onSel: (i: number | null) => void;
  onPick: (hex: string) => void;
  pushUndo: () => void;
  bump: () => void;
  design: DeckDesign;
}) {
  const { rev, sel } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const off = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = DECK_W;
    c.height = DECK_H;
    return c;
  }, []);
  const view = useRef<View>({ x: 0, y: 0, z: 4 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const p = useRef(props);
  p.current = props;

  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const z = Math.max(1, Math.min((w - 24) / DECK_W, (h - 24) / DECK_H));
    view.current = { z, x: (w - DECK_W * z) / 2, y: (h - DECK_H * z) / 2 };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: host.clientWidth, h: host.clientHeight });
      fit();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [fit]);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const d = p.current.doc;
    const octx = off.getContext('2d')!;
    const img = octx.createImageData(DECK_W, DECK_H);
    composeDeck(d.bg, d.idx, d.pal, d.decals, img.data);
    octx.putImageData(img, 0, 0);
    const { x, y, z } = view.current;
    const W = DECK_W * z;
    const H = DECK_H * z;
    // Deck silhouette (rounded nose + tail), stuff outside it dimmed
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.28;
    ctx.drawImage(off, x, y, W, H);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, W, H, W / 2);
    ctx.clip();
    ctx.drawImage(off, x, y, W, H);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 1, y - 1, W + 2, H + 2, W / 2);
    ctx.stroke();
    // Pixel grid when zoomed in
    if (z >= 7) {
      ctx.strokeStyle = 'rgba(0,0,0,.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < DECK_W; i++) {
        ctx.moveTo(Math.round(x + i * z) + 0.5, y);
        ctx.lineTo(Math.round(x + i * z) + 0.5, y + H);
      }
      for (let j = 1; j < DECK_H; j++) {
        ctx.moveTo(x, Math.round(y + j * z) + 0.5);
        ctx.lineTo(x + W, Math.round(y + j * z) + 0.5);
      }
      ctx.stroke();
    }
    if (p.current.mirror) {
      ctx.strokeStyle = 'rgba(0,229,255,.8)';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x + W / 2, y - 8);
      ctx.lineTo(x + W / 2, y + H + 8);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const s = p.current.sel;
    const dec = s !== null ? d.decals[s] : undefined;
    if (dec !== undefined) {
      const ds = decalSize(dec);
      ctx.strokeStyle = '#ffd400';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x + dec.x * z - 1, y + dec.y * z - 1, ds.w * z + 2, ds.h * z + 2);
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.textAlign = 'center';
    ctx.fillText('NOSE', x + W / 2, Math.max(10, y - 8));
    ctx.fillText('TAIL', x + W / 2, Math.min(h - 4, y + H + 16));
  }, [off]);

  useEffect(draw, [draw, rev, sel, size, props.mirror]);

  // ── Pointer handling ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const stroke = useRef<{
    start: Doc | null;
    sx: number;
    sy: number;
    lx: number;
    ly: number;
    moved: boolean;
    decal: { i: number; ox: number; oy: number } | null;
  } | null>(null);
  const pinch = useRef<{ d0: number; mx: number; my: number; v: View } | null>(null);
  const pan = useRef<{ x: number; y: number; v: View } | null>(null);

  const toDeck = (cx: number, cy: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { x, y, z } = view.current;
    return { px: Math.floor((cx - r.left - x) / z), py: Math.floor((cy - r.top - y) / z) };
  };

  const plot = (d: Doc, x: number, y: number, v: number) => {
    const b = p.current.brush;
    const o = Math.floor((b - 1) / 2);
    const put = (px: number, py: number) => {
      for (let j = 0; j < b; j++)
        for (let i = 0; i < b; i++) {
          const xx = px - o + i;
          const yy = py - o + j;
          if (xx >= 0 && xx < DECK_W && yy >= 0 && yy < DECK_H) d.idx[yy * DECK_W + xx] = v;
        }
    };
    put(x, y);
    if (p.current.mirror) put(DECK_W - 1 - x - (b % 2 === 0 ? 1 : 0), y);
  };

  const line = (d: Doc, x0: number, y0: number, x1: number, y1: number, v: number) => {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (let n = 0; n < 2000; n++) {
      plot(d, x, y, v);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  };

  const flood = (d: Doc, x: number, y: number, v: number) => {
    if (x < 0 || x >= DECK_W || y < 0 || y >= DECK_H) return;
    const target = d.idx[y * DECK_W + x];
    if (target === v) return;
    const stack = [y * DECK_W + x];
    while (stack.length > 0) {
      const i = stack.pop()!;
      if (d.idx[i] !== target) continue;
      d.idx[i] = v;
      const cx = i % DECK_W;
      if (cx > 0) stack.push(i - 1);
      if (cx < DECK_W - 1) stack.push(i + 1);
      if (i >= DECK_W) stack.push(i - DECK_W);
      if (i < DECK_W * (DECK_H - 1)) stack.push(i + DECK_W);
    }
  };

  const shape = (d: Doc, x0: number, y0: number, x1: number, y1: number, v: number) => {
    if (p.current.tool === 'line') return line(d, x0, y0, x1, y1, v);
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (p.current.rectFill) {
      for (let y = ay; y <= by; y++) line(d, ax, y, bx, y, v);
    } else {
      line(d, ax, ay, bx, ay, v);
      line(d, bx, ay, bx, by, v);
      line(d, bx, by, ax, by, v);
      line(d, ax, by, ax, ay, v);
    }
  };

  const hitDecal = (x: number, y: number) => {
    const ds = p.current.doc.decals;
    for (let i = ds.length - 1; i >= 0; i--) {
      const s = decalSize(ds[i]);
      if (x >= ds[i].x && x < ds[i].x + s.w && y >= ds[i].y && y < ds[i].y + s.h) return i;
    }
    return -1;
  };

  const begin = (cx: number, cy: number) => {
    const { tool, color } = p.current;
    const d = p.current.doc;
    const { px, py } = toDeck(cx, cy);
    if (tool === 'picker') {
      const rgba = composeDeck(d.bg, d.idx, d.pal, d.decals);
      if (px >= 0 && px < DECK_W && py >= 0 && py < DECK_H) {
        const o = (py * DECK_W + px) * 4;
        p.current.onPick(rgbHex(rgba[o], rgba[o + 1], rgba[o + 2]));
      }
      return;
    }
    if (tool === 'move') {
      const i = hitDecal(px, py);
      p.current.onSel(i >= 0 ? i : null);
      if (i < 0) return;
      p.current.pushUndo();
      const dec = d.decals[i];
      stroke.current = {
        start: null,
        sx: px,
        sy: py,
        lx: px,
        ly: py,
        moved: false,
        decal: { i, ox: dec.x, oy: dec.y },
      };
      return;
    }
    const start = cloneDoc(d);
    p.current.pushUndo();
    const v = tool === 'eraser' ? 0 : palIndex(d, color);
    if (tool === 'fill') {
      flood(d, px, py, v);
      if (p.current.mirror) flood(d, DECK_W - 1 - px, py, v);
      p.current.bump();
      return;
    }
    stroke.current = { start, sx: px, sy: py, lx: px, ly: py, moved: false, decal: null };
    if (tool === 'pencil' || tool === 'eraser') plot(d, px, py, v);
    else shape(d, px, py, px, py, v);
    p.current.bump();
  };

  const moveTo = (cx: number, cy: number) => {
    const s = stroke.current;
    if (s === null) return;
    const d = p.current.doc;
    const { px, py } = toDeck(cx, cy);
    if (px === s.lx && py === s.ly) return;
    s.moved = true;
    const { tool, color } = p.current;
    if (s.decal !== null) {
      const dec = d.decals[s.decal.i];
      if (dec !== undefined) {
        dec.x = s.decal.ox + (px - s.sx);
        dec.y = s.decal.oy + (py - s.sy);
      }
    } else {
      const v = tool === 'eraser' ? 0 : palIndex(d, color);
      if (tool === 'pencil' || tool === 'eraser') line(d, s.lx, s.ly, px, py, v);
      else if (s.start !== null) {
        d.idx.set(s.start.idx);
        shape(d, s.sx, s.sy, px, py, v);
      }
    }
    s.lx = px;
    s.ly = py;
    p.current.bump();
  };

  const cancelStroke = () => {
    const s = stroke.current;
    if (s === null) return;
    const d = p.current.doc;
    if (s.start !== null) {
      d.idx.set(s.start.idx);
      d.pal = s.start.pal;
    } else if (s.decal !== null) {
      const dec = d.decals[s.decal.i];
      if (dec !== undefined) {
        dec.x = s.decal.ox;
        dec.y = s.decal.oy;
      }
    }
    stroke.current = null;
    p.current.bump();
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      cancelStroke();
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        v: { ...view.current },
      };
      return;
    }
    if (pointers.current.size > 2) return;
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || e.altKey)) {
      pan.current = { x: e.clientX, y: e.clientY, v: { ...view.current } };
      return;
    }
    begin(e.clientX, e.clientY);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pc = pinch.current;
    if (pc !== null && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const z = Math.max(1, Math.min(40, (pc.v.z * dist) / pc.d0));
      const r = canvasRef.current!.getBoundingClientRect();
      // Keep the deck point under the first midpoint under the fingers
      const dx = (pc.mx - r.left - pc.v.x) / pc.v.z;
      const dy = (pc.my - r.top - pc.v.y) / pc.v.z;
      view.current = { z, x: mx - r.left - dx * z, y: my - r.top - dy * z };
      draw();
      return;
    }
    if (pan.current !== null) {
      const pn = pan.current;
      view.current = { ...pn.v, x: pn.v.x + e.clientX - pn.x, y: pn.v.y + e.clientY - pn.y };
      draw();
      return;
    }
    moveTo(e.clientX, e.clientY);
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    pan.current = null;
    if (pointers.current.size === 0) stroke.current = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    const z = Math.max(1, Math.min(40, v.z * Math.exp(-e.deltaY * 0.0015)));
    const dx = (e.clientX - r.left - v.x) / v.z;
    const dy = (e.clientY - r.top - v.y) / v.z;
    view.current = { z, x: e.clientX - r.left - dx * z, y: e.clientY - r.top - dy * z };
    draw();
  };

  return (
    <div ref={hostRef} className="dd-stage">
      <canvas
        ref={canvasRef}
        className={`dd-canvas dd-cur-${props.tool}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        onContextMenu={e => e.preventDefault()}
      />
      <div className="dd-zoom">
        <button
          type="button"
          onClick={() => {
            const v = view.current;
            const host = hostRef.current!;
            const z = Math.min(40, v.z * 1.5);
            const cx = host.clientWidth / 2;
            const cy = host.clientHeight / 2;
            view.current = { z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z };
            draw();
          }}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            const v = view.current;
            const host = hostRef.current!;
            const z = Math.max(1, v.z / 1.5);
            const cx = host.clientWidth / 2;
            const cy = host.clientHeight / 2;
            view.current = { z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z };
            draw();
          }}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => {
            fit();
            draw();
          }}
        >
          ⤢
        </button>
      </div>
    </div>
  );
}

// ── Tabs ──

function PaintTab(props: {
  color: string;
  setColor: (c: string) => void;
  used: string[];
  rectFill: boolean;
  setRectFill: (v: boolean) => void;
}) {
  const { color, setColor } = props;
  const sw = (c: string) => (
    <button
      key={c}
      type="button"
      className={`dd-sw ${c === color ? 'dd-on' : ''}`}
      style={{ background: c }}
      onClick={() => setColor(c)}
      title={c}
    />
  );
  return (
    <div className="dd-sec">
      <div className="dd-rowc">
        <label className="dd-colorbox dd-colorbig">
          <input type="color" value={color} onChange={e => setColor(e.target.value)} />
          <span style={{ background: color }} />
        </label>
        <div className="dd-now">
          <b>{color.toUpperCase()}</b>
          <small>tap the box for a custom colour</small>
        </div>
        <button
          type="button"
          className={`dd-chip ${props.rectFill ? 'dd-on' : ''}`}
          onClick={() => props.setRectFill(!props.rectFill)}
        >
          RECT {props.rectFill ? 'FILLED' : 'OUTLINE'}
        </button>
      </div>
      {props.used.length > 0 && (
        <>
          <h4>ON THIS DECK</h4>
          <div className="dd-grid">{props.used.slice(0, 48).map(sw)}</div>
        </>
      )}
      <h4>SPRAY CANS</h4>
      <div className="dd-grid">{SPRAY_COLORS.map(sw)}</div>
      <h4>NOUNS PALETTE</h4>
      <div className="dd-grid dd-grid-sm">{NOUNS_PALETTE.map(sw)}</div>
    </div>
  );
}

const KIND_LABEL: Record<DecalKind, string> = {
  head: 'HEADS',
  glasses: 'NOGGLES',
  body: 'BODIES',
  accessory: 'ACCESSORIES',
};

const traitThumbs = new Map<string, string>();
function traitThumb(k: DecalKind, i: number): string {
  const key = `${k}:${i}`;
  let url = traitThumbs.get(key);
  if (url !== undefined) return url;
  const a = traitArt(k, i);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  if (a !== null) {
    const img = new globalThis.ImageData(a.w, a.h);
    img.data.set(a.px);
    c.getContext('2d')!.putImageData(img, (32 - a.w) >> 1, (32 - a.h) >> 1);
  }
  url = c.toDataURL();
  traitThumbs.set(key, url);
  return url;
}

function DecalsTab(props: {
  decals: DeckDecal[];
  sel: number | null;
  setSel: (i: number | null) => void;
  onAdd: (k: DecalKind, i: number) => void;
  onScale: (dir: number) => void;
  onRotate: () => void;
  onFlip: () => void;
  onLayer: (dir: number) => void;
  onNudge: (dx: number, dy: number) => void;
  onDelete: () => void;
  onDup: () => void;
}) {
  const [kind, setKind] = useState<DecalKind | 'all'>('head');
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const kinds = kind === 'all' ? DECAL_KINDS : [kind];
    const needle = q.trim().toLowerCase();
    const out: { k: DecalKind; i: number; label: string }[] = [];
    for (const k of kinds)
      for (let i = 0; i < traitCount(k); i++) {
        const label = traitLabel(k, i);
        if (needle === '' || label.includes(needle)) out.push({ k, i, label });
      }
    return out;
  }, [kind, q]);
  const cur = props.sel !== null ? props.decals[props.sel] : undefined;
  return (
    <div className="dd-sec">
      {cur !== undefined && (
        <div className="dd-selbox">
          <div className="dd-selname">
            <img src={traitThumb(cur.k, cur.i)} alt="" />
            <span>
              {traitLabel(cur.k, cur.i).toUpperCase()}
              <small>
                ×{cur.s} · {cur.r * 90}°{cur.f === 1 ? ' · FLIPPED' : ''}
              </small>
            </span>
          </div>
          <div className="dd-rowc">
            <button type="button" className="dd-chip" onClick={() => props.onScale(-1)}>
              SIZE −
            </button>
            <button type="button" className="dd-chip" onClick={() => props.onScale(1)}>
              SIZE +
            </button>
            <button type="button" className="dd-chip" onClick={props.onRotate}>
              ⟳ 90°
            </button>
            <button type="button" className="dd-chip" onClick={props.onFlip}>
              ⇋ FLIP
            </button>
          </div>
          <div className="dd-rowc">
            <button type="button" className="dd-chip" onClick={() => props.onNudge(-1, 0)}>
              ◀
            </button>
            <button type="button" className="dd-chip" onClick={() => props.onNudge(0, -1)}>
              ▲
            </button>
            <button type="button" className="dd-chip" onClick={() => props.onNudge(0, 1)}>
              ▼
            </button>
            <button type="button" className="dd-chip" onClick={() => props.onNudge(1, 0)}>
              ▶
            </button>
            <button type="button" className="dd-chip" onClick={() => props.onLayer(1)}>
              LAYER ↑
            </button>
            <button type="button" className="dd-chip" onClick={() => props.onLayer(-1)}>
              LAYER ↓
            </button>
            <button type="button" className="dd-chip" onClick={props.onDup}>
              COPY
            </button>
            <button type="button" className="dd-chip dd-warn" onClick={props.onDelete}>
              DELETE
            </button>
          </div>
        </div>
      )}
      {props.decals.length > 0 && (
        <>
          <h4>LAYERS (TOP FIRST)</h4>
          <div className="dd-layers">
            {props.decals
              .map((d, i) => ({ d, i }))
              .reverse()
              .map(({ d, i }) => (
                <button
                  key={i}
                  type="button"
                  className={props.sel === i ? 'dd-on' : ''}
                  onClick={() => props.setSel(i)}
                >
                  <img src={traitThumb(d.k, d.i)} alt="" />
                </button>
              ))}
          </div>
        </>
      )}
      <h4>ADD A STICKER</h4>
      <div className="dd-rowc">
        {(['all', ...DECAL_KINDS] as const).map(k => (
          <button
            key={k}
            type="button"
            className={`dd-chip ${kind === k ? 'dd-on' : ''}`}
            onClick={() => setKind(k)}
          >
            {k === 'all' ? 'ALL' : KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <input
        className="dd-input"
        value={q}
        placeholder="SEARCH (e.g. shark, pizza)"
        onChange={e => setQ(e.target.value)}
      />
      <div className="dd-traits">
        {items.slice(0, 400).map(t => (
          <button
            key={`${t.k}:${t.i}`}
            type="button"
            title={t.label}
            onClick={() => props.onAdd(t.k, t.i)}
          >
            <img src={traitThumb(t.k, t.i)} alt={t.label} loading="lazy" />
            <span>{t.label}</span>
          </button>
        ))}
        {items.length === 0 && <div className="dd-empty">NOTHING MATCHES</div>}
      </div>
    </div>
  );
}

// ── Live 3D board ──

function Preview3D({ game, design }: { game: Game | null; design: DeckDesign }) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef<{ tex: THREE.CanvasTexture; ch: NounCharacter | null } | null>(null);
  const [face, setFace] = useState<'spin' | 'under' | 'top'>('spin');
  const faceRef = useRef(face);
  faceRef.current = face;
  const designRef = useRef(design);
  designRef.current = design;

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    // A fresh canvas per mount: StrictMode's remount would otherwise reuse
    // the one whose context the cleanup just lost
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      canvas.remove();
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
    camera.position.set(0, 0, 1.75);
    const spin = new THREE.Group();
    const stand = new THREE.Group();
    // Nose up, underside (graphic) toward the camera
    stand.rotation.x = -Math.PI / 2;
    spin.add(stand);
    scene.add(spin);
    const c = document.createElement('canvas');
    designCanvas(designRef.current, c);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    live.current = { tex, ch: null };
    let disposed = false;
    void loadCharacterAssets().then(assets => {
      if (disposed) return;
      const ch = new NounCharacter(
        game?.seed ?? { background: 0, body: 0, accessory: 0, head: 0, glasses: 0 },
        assets,
      );
      ch.body.visible = false;
      ch.board.position.y = -0.12;
      ch.setDeckGraphic(tex, designRef.current.grip);
      stand.add(ch.root);
      ch.root.position.set(0, 0, 0);
      if (live.current) live.current.ch = ch;
    });
    let raf = 0;
    let t = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      const f = faceRef.current;
      t += dt;
      const want =
        f === 'spin' ? spin.rotation.y + dt * 1.1 : f === 'under' ? 0.35 : Math.PI + 0.35;
      spin.rotation.y =
        f === 'spin' ? want : THREE.MathUtils.lerp(spin.rotation.y % (Math.PI * 2), want, 0.15);
      spin.rotation.x = Math.sin(t * 0.7) * 0.08;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      live.current?.ch?.dispose();
      tex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      live.current = null;
    };
  }, [game]);

  useEffect(() => {
    const l = live.current;
    if (!l) return;
    designCanvas(design, l.tex.image as HTMLCanvasElement);
    l.tex.needsUpdate = true;
    l.ch?.setDeckGraphic(l.tex, design.grip);
  }, [design]);

  return (
    <button
      type="button"
      className="dd-preview"
      onClick={() => setFace(f => (f === 'spin' ? 'under' : f === 'under' ? 'top' : 'spin'))}
      title="Tap: spin / underside / grip"
    >
      <div ref={ref} className="dd-preview-gl" />
      <span>{face === 'spin' ? '3D ⟳' : face === 'under' ? 'GRAPHIC' : 'GRIP'}</span>
    </button>
  );
}

// ── Character select: pick which saved deck you ride ──

export function DeckGraphicRow({ onDesign }: { onDesign: () => void }) {
  const deck = useDeckState();
  const options = [
    -1,
    ...Array.from({ length: DECK_SLOTS }, (_, i) => i).filter(i => deckStore.slot(i) !== null),
  ];
  const at = Math.max(0, options.indexOf(deck.selected));
  const cur = options[at] ?? -1;
  const step = (dir: number) =>
    deckStore.select(options[(((at + dir) % options.length) + options.length) % options.length]);
  const slot = cur >= 0 ? deckStore.slot(cur) : null;
  return (
    <div className="cs-row dd-csrow">
      <div className="cs-label">
        <span className="cs-cursor"> </span>GRAPHIC
      </div>
      <div className="cs-value">
        <button type="button" className="cs-arrow" onClick={() => step(-1)}>
          ◀
        </button>
        <div className="cs-trait" key={`deck-${cur}`}>
          <span className="cs-num">
            {at + 1}/{options.length}
          </span>
          <span className="cs-tname">
            {slot !== null ? `${cur + 1}: ${slot.d.name || 'MY DECK'}` : 'DEFAULT'}
          </span>
        </div>
        {slot !== null && <img className="dd-csthumb" src={designThumb(slot.d)} alt="" />}
        <button type="button" className="cs-arrow" onClick={() => step(1)}>
          ▶
        </button>
        <button type="button" className="cs-arrow dd-csdesign" onClick={onDesign}>
          ✎ DESIGN
        </button>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
.dd-root{position:absolute;inset:0;z-index:60;display:flex;flex-direction:column;font-family:'Press Start 2P',ui-monospace,monospace;color:#fff;
  background:radial-gradient(ellipse at 40% 30%,#2a1d6e 0%,#120c33 55%,#07051a 100%);touch-action:none;user-select:none;-webkit-user-select:none}
.dd-root button{font-family:inherit;color:inherit;cursor:pointer}
.dd-root button:disabled{opacity:.5;cursor:default}
.dd-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:4px solid #000;background:#1a1250;flex-shrink:0}
.dd-x{background:#d22209;border:none;padding:8px 11px;font-size:12px;box-shadow:3px 3px 0 #000}
.dd-title{color:#ffd400;font-size:clamp(11px,2vw,18px);text-shadow:3px 3px 0 #d22209;letter-spacing:.06em;white-space:nowrap}
.dd-head-tools{margin-left:auto;display:flex;gap:8px;align-items:center}
.dd-ib{background:#2b2160;border:3px solid #9c8cff;min-width:38px;height:38px;font-size:16px;box-shadow:3px 3px 0 #000}
.dd-ib.dd-on,.dd-tool.dd-on{border-color:#ffd400;color:#ffd400;background:#3a2a90}
.dd-save-quick{background:#ffd400;color:#000 !important;border:none;height:38px;padding:0 12px;font-size:11px;box-shadow:3px 3px 0 #d22209}
.dd-body{flex:1;display:flex;min-height:0}
.dd-rail{width:76px;flex-shrink:0;display:flex;flex-direction:column;gap:6px;padding:10px 8px;background:rgba(10,7,30,.6);border-right:4px solid #000;overflow-y:auto}
.dd-tool{display:flex;flex-direction:column;align-items:center;gap:4px;background:#2b2160;border:3px solid #3a2f7a;padding:7px 2px;box-shadow:3px 3px 0 #000}
.dd-tool b{font-size:17px;font-weight:400;font-family:system-ui,sans-serif;line-height:1}
.dd-tool i{font-style:normal;font-size:6px;letter-spacing:.04em}
.dd-brush{display:flex;flex-direction:column;align-items:center;gap:4px;background:#160f40;border:3px solid #3a2f7a;padding:5px 0;font-size:8px}
.dd-brush button{background:#d22209;border:none;width:30px;height:24px;font-size:13px}
.dd-swatch-now{height:36px;border:3px solid #fff;box-shadow:3px 3px 0 #000}
.dd-stage{flex:1;position:relative;min-width:0;min-height:0;background:
  repeating-conic-gradient(#191236 0 25%,#1e1640 0 50%) 0 0/24px 24px}
.dd-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair}
.dd-cur-move{cursor:move}.dd-cur-picker{cursor:copy}
.dd-zoom{position:absolute;left:10px;bottom:10px;display:flex;gap:6px}
.dd-zoom button{background:#2b2160;border:3px solid #9c8cff;width:38px;height:38px;font-size:15px;box-shadow:3px 3px 0 #000}
.dd-panel{width:min(380px,36vw);flex-shrink:0;display:flex;flex-direction:column;background:rgba(10,7,30,.85);border-left:4px solid #000;min-height:0}
.dd-tabs{display:flex;flex-shrink:0}
.dd-tabs button{flex:1;background:#160f40;border:none;border-bottom:4px solid #000;padding:12px 2px;font-size:9px;color:#9c8cff !important}
.dd-tabs button.dd-on{background:#3a2a90;color:#ffd400 !important;border-bottom-color:#ffd400}
.dd-tabbody{flex:1;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch;touch-action:pan-y}
@media (min-width:761px){.dd-tabbody{padding-bottom:72px}}
.dd-sec{padding:12px;display:flex;flex-direction:column;gap:9px}
.dd-sec h4{margin:6px 0 0;font-size:8px;color:#9c8cff;letter-spacing:.08em;font-weight:400}
.dd-rowc{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dd-chip{background:#2b2160;border:3px solid #3a2f7a;padding:8px 9px;font-size:8px;box-shadow:2px 2px 0 #000}
.dd-chip.dd-on{border-color:#ffd400;color:#ffd400}
.dd-chip.dd-warn{border-color:#d22209}
.dd-chip:active,.dd-tool:active,.dd-ib:active{transform:translate(2px,2px);box-shadow:none}
.dd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(30px,1fr));gap:4px}
.dd-grid-sm{grid-template-columns:repeat(auto-fill,minmax(22px,1fr));gap:3px}
.dd-sw{aspect-ratio:1;border:2px solid rgba(0,0,0,.6);padding:0;min-height:22px}
.dd-sw.dd-on{outline:3px solid #ffd400;outline-offset:1px;z-index:1}
.dd-colorbox{position:relative;width:40px;height:40px;border:3px solid #fff;box-shadow:3px 3px 0 #000;cursor:pointer;flex-shrink:0}
.dd-colorbox input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}
.dd-colorbox span{display:block;width:100%;height:100%}
.dd-colorbig{width:52px;height:52px}
.dd-now{display:flex;flex-direction:column;gap:6px;font-size:10px;flex:1;min-width:110px}
.dd-now small{font-size:7px;color:#9c8cff;line-height:1.5}
.dd-input{font-family:inherit;font-size:11px;background:#0b0820;color:#3ddc84;border:3px solid #3ddc84;padding:9px;outline:none;text-transform:uppercase;width:100%;box-sizing:border-box;user-select:text;-webkit-user-select:text}
.dd-big{background:#d22209;border:none;padding:12px;font-size:11px;box-shadow:4px 4px 0 #000;display:flex;align-items:center;justify-content:center;gap:10px}
.dd-dot{display:inline-block;width:14px;height:14px;border:2px solid #fff}
.dd-traits{display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));gap:6px}
.dd-traits button{display:flex;flex-direction:column;align-items:center;gap:4px;background:#160f40;border:3px solid #3a2f7a;padding:5px 3px}
.dd-traits button:hover{border-color:#ffd400}
.dd-traits img,.dd-layers img,.dd-selname img{image-rendering:pixelated;width:48px;height:48px}
.dd-traits span{font-size:6px;line-height:1.3;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:uppercase}
.dd-empty{font-size:8px;color:#9c8cff;padding:10px}
.dd-layers{display:flex;gap:5px;overflow-x:auto;padding-bottom:4px;touch-action:pan-x}
.dd-layers button{background:#160f40;border:3px solid #3a2f7a;padding:2px;flex-shrink:0}
.dd-layers button.dd-on{border-color:#ffd400}
.dd-layers img{width:36px;height:36px}
.dd-selbox{border:3px solid #ffd400;padding:8px;display:flex;flex-direction:column;gap:7px;background:#1d1452}
.dd-selname{display:flex;align-items:center;gap:8px;font-size:9px}
.dd-selname span{display:flex;flex-direction:column;gap:5px}
.dd-selname small{font-size:7px;color:#9c8cff}
.dd-wallet{font-size:8px;line-height:1.8;background:#0b0820;border:3px solid #3a2f7a;padding:8px}
.dd-wallet small{font-size:7px;color:#ffd400}
.dd-slots{display:flex;flex-direction:column;gap:8px}
.dd-slot{border:3px solid #3a2f7a;background:#160f40;padding:7px;display:flex;flex-direction:column;gap:7px}
.dd-slot.dd-on{border-color:#ffd400}
.dd-slot-top{display:flex;gap:10px;cursor:pointer}
.dd-slot-top img{width:26px;height:100px;image-rendering:pixelated;border-radius:13px;border:2px solid #000}
.dd-slot-empty{width:26px;height:100px;border:2px dashed #3a2f7a;border-radius:13px;font-size:0}
.dd-slot-meta{display:flex;flex-direction:column;gap:7px;font-size:9px;min-width:0}
.dd-slot-meta span{color:#3ddc84;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dd-slot-meta em{font-style:normal;font-size:7px;color:#9c8cff}
.dd-slot-btns{display:flex;gap:6px;flex-wrap:wrap}
.dd-slot-btns button{background:#d22209;border:none;padding:8px;font-size:8px;box-shadow:2px 2px 0 #000}
.dd-slot-btns button+button{background:#2b2160}
.dd-status{flex-shrink:0;font-size:8px;line-height:1.7;padding:9px 12px;background:#ffd400;color:#000;border-top:4px solid #000}
.dd-preview{position:absolute;right:calc(min(380px,36vw) + 14px);top:70px;width:150px;height:290px;background:rgba(0,0,0,.35);border:3px solid #3a2f7a;padding:0;box-shadow:4px 4px 0 #000}
.dd-preview-gl,.dd-preview canvas{width:100%;height:100%;display:block}
.dd-preview span{position:absolute;left:0;right:0;bottom:4px;text-align:center;font-size:7px;color:#9c8cff}
.dd-csrow .dd-csthumb{width:14px;height:52px;image-rendering:pixelated;border-radius:7px;border:2px solid #000}
.dd-csrow .dd-csdesign{font-size:8px;background:#2b2160;border:2px solid #ffd400;color:#ffd400}
@media (max-width:760px){
  .dd-head{padding:44px 10px 8px;gap:6px}
  .dd-ib{min-width:34px;height:34px}
  .dd-body{flex-direction:column}
  .dd-stage{flex:1 1 44%;order:1}
  .dd-rail{order:2;width:auto;flex-direction:row;border-right:none;border-top:4px solid #000;padding:6px;overflow-x:auto;overflow-y:hidden;flex-shrink:0;touch-action:pan-x}
  .dd-tool{min-width:52px;padding:6px 2px}
  .dd-brush{flex-direction:row;padding:0 4px;min-width:118px;justify-content:center}
  .dd-swatch-now{min-width:40px;height:auto}
  .dd-panel{order:3;width:auto;flex:0 0 38%;border-left:none;border-top:4px solid #000}
  .dd-preview{right:10px;top:96px;width:74px;height:150px}
}
`;
