/**
 * Doodle Garden — a catching game starring kids' own drawings.
 * Pick a drawing, then move it around to catch falling treats. Grown-ups can
 * add a new drawing from a photo (📷), which is cut out in the browser.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router';

import { BUILT_IN, type DoodleCharacter, loadCustom, saveCustom } from './characters';
import { type CropRect, cutOutDrawing, loadImage } from './cutout';
import { DoodleGame } from './game';
import { isMuted, setMuted, startMusic, stopMusic, unlockAudio } from './sound';

const FONT = '"Comic Neue","Comic Sans MS",system-ui,sans-serif';
// The site theme forces its font on `*`; this outranks it inside the game.
// Also tucks away the idle NOUN FM pill so it doesn't sit on the game.
const GAME_CSS = `[data-theme] .dg, [data-theme] .dg * { font-family: ${FONT} !important; }
[data-nounfm="off"] { display: none !important; }`;

const bigBtn =
  'border-4 border-[#2b1d3a] shadow-[0_6px_0_#2b1d3a] text-[#2b1d3a] active:translate-y-1 active:shadow-[0_2px_0_#2b1d3a] font-black select-none';

function Sky({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="dg fixed inset-0 overflow-auto"
      style={{
        background: 'linear-gradient(#58c4ff 0%, #d6f3ff 70%, #5cc04a 70%, #3f9e36 100%)',
        fontFamily: FONT,
        touchAction: 'manipulation',
      }}
    >
      <style>{GAME_CSS}</style>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- play

function Play({ who, onHome }: { who: DoodleCharacter; onHome: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(0);
  const [muted, setMutedState] = useState(isMuted);

  useEffect(() => {
    let game: DoodleGame | null = null;
    let dead = false;
    const img = new Image();
    img.onload = () => {
      if (dead || !canvasRef.current) return;
      game = new DoodleGame(canvasRef.current, img, { onCount: setCount });
    };
    img.src = who.src;
    startMusic();
    return () => {
      dead = true;
      game?.destroy();
      stopMusic();
    };
  }, [who.src]);

  const toggleMute = () => {
    setMuted(!muted);
    setMutedState(!muted);
  };

  return (
    <div className="dg fixed inset-0 select-none" style={{ background: '#58c4ff' }}>
      <style>{GAME_CSS}</style>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: 'none' }}
      />
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border-4 border-[#2b1d3a] bg-[#fff] px-4 py-1 text-4xl font-black text-[#2b1d3a] shadow-[0_5px_0_#2b1d3a]">
        <span>🌼</span>
        <span>{count}</span>
      </div>
      <div className="absolute right-3 top-3 flex gap-3">
        <button
          type="button"
          aria-label={muted ? 'Sound on' : 'Sound off'}
          className={`${bigBtn} h-16 w-16 rounded-full bg-[#fff] text-3xl`}
          onClick={toggleMute}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button
          type="button"
          aria-label="Back to the drawings"
          className={`${bigBtn} h-16 w-16 rounded-full bg-[#ffd60a] text-3xl`}
          onClick={onHome}
        >
          🏠
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- add a drawing

function AddDrawing({ onDone }: { onDone: (c: DoodleCharacter | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const i = await loadImage(f);
      const w = i.naturalWidth;
      const h = i.naturalHeight;
      setImg(i);
      setCrop({ x: w * 0.04, y: h * 0.04, w: w * 0.92, h: h * 0.92 });
      setResult(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Drag on the photo to draw the box around the drawing.
  const toImage = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    const sx = img!.naturalWidth / r.width;
    const sy = img!.naturalHeight / r.height;
    return {
      x: Math.max(0, Math.min(img!.naturalWidth, (e.clientX - r.left) * sx)),
      y: Math.max(0, Math.min(img!.naturalHeight, (e.clientY - r.top) * sy)),
    };
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = toImage(e);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = toImage(e);
    const a = drag.current;
    setCrop({
      x: Math.min(a.x, p.x),
      y: Math.min(a.y, p.y),
      w: Math.abs(p.x - a.x),
      h: Math.abs(p.y - a.y),
    });
  };
  const onUp = () => {
    drag.current = null;
  };

  const cut = () => {
    if (!img || !crop || crop.w < 20 || crop.h < 20) {
      setError('Draw a box around the drawing first');
      return;
    }
    setBusy(true);
    setError(null);
    // Let the "working" state paint before the (blocking) cut-out runs.
    setTimeout(() => {
      try {
        setResult(cutOutDrawing(img, crop));
      } catch (e) {
        setError((e as Error).message);
      }
      setBusy(false);
    }, 30);
  };

  const keep = () => {
    if (!result) return;
    const c: DoodleCharacter = {
      id: `d${Date.now().toString(36)}`,
      name: name.trim() || 'My drawing',
      src: result,
      custom: true,
    };
    if (!saveCustom([...loadCustom(), c])) {
      setError(
        "This browser couldn't save it (storage full or private mode). You can still play now!",
      );
    }
    onDone(c);
  };

  return (
    <Sky>
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 p-4 text-[#2b1d3a]">
        <h1 className="text-center text-4xl font-black">📷 Add a drawing</h1>
        {!img && (
          <>
            <p className="rounded-2xl bg-[rgba(255,255,255,0.8)] p-3 text-center text-lg font-bold">
              Take a photo of the drawing on plain paper, in good light. Fill the screen with it.
            </p>
            <button
              type="button"
              className={`${bigBtn} rounded-full bg-[#ffd60a] px-8 py-4 text-3xl`}
              onClick={() => fileRef.current?.click()}
            >
              📸 Take photo
            </button>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => void pick(e.target.files?.[0])}
        />

        {img && !result && crop && (
          <>
            <p className="rounded-2xl bg-[rgba(255,255,255,0.8)] px-3 py-2 text-center text-lg font-bold">
              Drag a box around just the character
            </p>
            <div
              ref={boxRef}
              className="relative w-full touch-none overflow-hidden rounded-xl border-4 border-[#2b1d3a]"
              style={{
                aspectRatio: `${img.naturalWidth} / ${img.naturalHeight}`,
                maxHeight: '60vh',
              }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              <img
                src={img.src}
                alt=""
                className="pointer-events-none h-full w-full"
                draggable={false}
              />
              <div
                className="pointer-events-none absolute border-4 border-dashed border-[#ff4d6d]"
                style={{
                  left: `${(crop.x / img.naturalWidth) * 100}%`,
                  top: `${(crop.y / img.naturalHeight) * 100}%`,
                  width: `${(crop.w / img.naturalWidth) * 100}%`,
                  height: `${(crop.h / img.naturalHeight) * 100}%`,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                className={`${bigBtn} rounded-full bg-[#fff] px-5 py-3 text-xl`}
                onClick={() => fileRef.current?.click()}
              >
                🔁 New photo
              </button>
              <button
                type="button"
                className={`${bigBtn} rounded-full bg-[#06d6a0] px-6 py-3 text-2xl`}
                onClick={cut}
                disabled={busy}
              >
                {busy ? '✂️ Cutting…' : '✂️ Cut it out!'}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <div className="flex h-[45vh] w-full items-end justify-center rounded-xl border-4 border-[#2b1d3a] bg-gradient-to-b from-[#58c4ff] to-[#d6f3ff] p-3">
              <img src={result} alt="Cut-out drawing" className="max-h-full max-w-full" />
            </div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Name (optional)"
              maxLength={20}
              className="w-64 rounded-full border-4 border-[#2b1d3a] px-4 py-2 text-center text-2xl font-bold"
            />
            <div className="flex gap-3">
              <button
                type="button"
                className={`${bigBtn} rounded-full bg-[#fff] px-5 py-3 text-xl`}
                onClick={() => setResult(null)}
              >
                ↩️ Try again
              </button>
              <button
                type="button"
                className={`${bigBtn} rounded-full bg-[#06d6a0] px-6 py-3 text-2xl`}
                onClick={keep}
              >
                ✅ Play!
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="rounded-2xl bg-[#ff4d6d] px-4 py-2 text-center font-bold text-white">
            {error}
          </p>
        )}
        <button
          type="button"
          className={`${bigBtn} mt-2 rounded-full bg-[#fff] px-5 py-2 text-xl`}
          onClick={() => onDone(null)}
        >
          ← Back
        </button>
      </div>
    </Sky>
  );
}

// ---------------------------------------------------------------- pick

const DoodlePage: React.FC = () => {
  const navigate = useNavigate();
  const [screen, setScreen] = useState<'pick' | 'play' | 'add'>('pick');
  const [custom, setCustom] = useState<DoodleCharacter[]>(() => loadCustom());
  const [who, setWho] = useState<DoodleCharacter>(BUILT_IN[0]);
  const all = [...BUILT_IN, ...custom];

  useEffect(() => {
    document.title = 'Doodle Garden';
  }, []);

  const play = useCallback((c: DoodleCharacter) => {
    unlockAudio();
    setWho(c);
    setScreen('play');
  }, []);

  const remove = (c: DoodleCharacter) => {
    if (!window.confirm(`Remove ${c.name}?`)) return;
    const next = custom.filter(x => x.id !== c.id);
    saveCustom(next);
    setCustom(next);
  };

  if (screen === 'play') return <Play who={who} onHome={() => setScreen('pick')} />;
  if (screen === 'add')
    return (
      <AddDrawing
        onDone={c => {
          setCustom(loadCustom());
          if (c) play(c);
          else setScreen('pick');
        }}
      />
    );

  return (
    <Sky>
      <style>{`@keyframes dg-bob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-10px) rotate(3deg)}}`}</style>
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 pb-10 pt-6 text-[#2b1d3a]">
        <h1
          className="text-center text-6xl font-black leading-none text-white sm:text-7xl"
          style={{
            WebkitTextStroke: '3px #2b1d3a',
            paintOrder: 'stroke fill',
            textShadow: '5px 5px 0 #ff70a6',
          }}
        >
          🌼 Doodle Garden 🌼
        </h1>
        <p className="rounded-full bg-[rgba(255,255,255,0.8)] px-5 py-2 text-center text-2xl font-bold">
          Who wants to play?
        </p>
        <div className="flex flex-wrap justify-center gap-5">
          {all.map((c, i) => (
            <div key={c.id} className="relative">
              <button
                type="button"
                onClick={() => play(c)}
                className={`${bigBtn} flex h-60 w-44 flex-col items-center justify-end gap-1 rounded-3xl bg-[#fff] p-3`}
              >
                <img
                  src={c.src}
                  alt={c.name}
                  className="min-h-0 flex-1 object-contain"
                  style={{ animation: `dg-bob ${1.6 + (i % 3) * 0.3}s ease-in-out infinite` }}
                  draggable={false}
                />
                <span className="text-2xl">{c.name}</span>
              </button>
              {c.custom === true && (
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  onClick={() => remove(c)}
                  className="absolute -right-2 -top-2 h-9 w-9 rounded-full border-2 border-[#2b1d3a] bg-[#fff] text-lg"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setScreen('add')}
            className={`${bigBtn} flex h-60 w-44 flex-col items-center justify-center gap-2 rounded-3xl border-dashed bg-[rgba(255,255,255,0.7)] text-2xl`}
          >
            <span className="text-6xl">📷</span>
            Add a drawing
          </button>
        </div>
        <div className="max-w-md rounded-2xl bg-[rgba(255,255,255,0.8)] p-4 text-center text-lg font-bold">
          👆 Touch where to go · touch up high to jump
          <br />
          Catch the treats 🍓⭐ · pop the balloons 🎈
        </div>
        <button type="button" className="text-lg font-bold underline" onClick={() => navigate('/')}>
          noun.wtf
        </button>
      </div>
    </Sky>
  );
};

export default DoodlePage;
