// ── Cutscene overlay: letterbox, subtitles, titles, washes, SKIP ──────────
//
// Rendered once per scene; a rAF loop writes each frame's state straight to
// the DOM (no React render per frame). While a scene plays the page root gets
// `data-w2cut`, which fades every HUD layer out (CUTSCENE_CSS) and back in
// after; the canvas host (`data-w2keep`) stays.
//
// Skip: Esc on a keyboard; on touch (and with a mouse) the SKIP button, or tap
// anywhere twice. While a scene plays every key stops here, so nothing behind
// it (talk, journal, board) fires.

import type { Game } from '../Game';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function CutsceneUi({ game, touch }: { game: Game; touch: boolean }) {
  const cs = game.cutscene;
  useSyncExternalStore(cs.subscribe, cs.getVersion);
  const active = cs.active;
  const rootRef = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const subBox = useRef<HTMLDivElement>(null);
  const speaker = useRef<HTMLElement>(null);
  const said = useRef<HTMLSpanElement>(null);
  const unsaid = useRef<HTMLSpanElement>(null);
  const titleBox = useRef<HTMLDivElement>(null);
  const titleText = useRef<HTMLElement>(null);
  const titleSub = useRef<HTMLElement>(null);
  const wash = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);

  // HUD out while a scene plays, back in after
  useEffect(() => {
    const host = rootRef.current?.parentElement ?? null;
    if (host === null) return;
    if (active) {
      host.removeAttribute('data-w2fadein');
      host.setAttribute('data-w2cut', '');
      return;
    }
    if (!host.hasAttribute('data-w2cut')) return;
    host.removeAttribute('data-w2cut');
    host.setAttribute('data-w2fadein', '');
    const id = window.setTimeout(() => host.removeAttribute('data-w2fadein'), 600);
    return () => window.clearTimeout(id);
  }, [active]);

  // Keys: Esc skips; nothing else gets through while a scene plays
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // browser shortcuts still work
      if (e.code === 'Escape') cs.skip();
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', stop, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', stop, true);
    };
  }, [active, cs]);

  // A new scene starts unarmed
  const [armedFor, setArmedFor] = useState(cs.version);
  if (active && armedFor !== cs.version) {
    setArmedFor(cs.version);
    setArmed(false);
  }

  // Frame → DOM
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let lastText = '';
    let lastShown = -1;
    let lastTitle = '';
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const f = cs.frame;
      if (f === null) return;
      const b = f.bars;
      if (top.current) top.current.style.transform = `translateY(${(b - 1) * 100}%)`;
      if (bottom.current) bottom.current.style.transform = `translateY(${(1 - b) * 100}%)`;
      const s = f.sub;
      if (subBox.current) subBox.current.style.opacity = s === null ? '0' : String(s.alpha);
      if (s !== null) {
        if (s.text !== lastText || s.shown !== lastShown) {
          const chars = [...s.text];
          if (said.current) said.current.textContent = chars.slice(0, s.shown).join('');
          if (unsaid.current) unsaid.current.textContent = chars.slice(s.shown).join('');
          if (speaker.current && s.text !== lastText) speaker.current.textContent = s.speaker;
          lastText = s.text;
          lastShown = s.shown;
        }
      }
      const t = f.title;
      if (titleBox.current) titleBox.current.style.opacity = t === null ? '0' : String(t.alpha);
      if (t !== null && t.text + (t.sub ?? '') !== lastTitle) {
        lastTitle = t.text + (t.sub ?? '');
        if (titleText.current) titleText.current.textContent = t.text;
        if (titleSub.current) titleSub.current.textContent = t.sub ?? '';
        // A fresh title pops
        titleBox.current?.classList.remove('w2-cutpop');
        void titleBox.current?.offsetWidth;
        titleBox.current?.classList.add('w2-cutpop');
      }
      if (wash.current) {
        wash.current.style.opacity = f.wash === null ? '0' : String(f.wash.a);
        if (f.wash !== null) wash.current.style.background = f.wash.color;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, cs]);

  // Tap twice (or the button) to skip
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 2500);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (!active) return <div ref={rootRef} hidden />;
  return (
    <div
      ref={rootRef}
      className="w2-cut pointer-events-auto absolute inset-0 z-[60] select-none overflow-hidden"
      onPointerDown={e => {
        e.stopPropagation();
        if (armed) cs.skip();
        else setArmed(true);
      }}
    >
      <div ref={wash} className="w2-cutwash" />
      <div ref={top} className="w2-cutbar w2-cutbar-top" />
      <div ref={bottom} className="w2-cutbar w2-cutbar-bot" />
      <div ref={titleBox} className="w2-cuttitle">
        <b ref={titleText} />
        <i ref={titleSub} />
      </div>
      <div ref={subBox} className="w2-cutsub">
        <b ref={speaker} />
        <div>
          <span ref={said} />
          <span ref={unsaid} className="w2-cutunsaid" />
        </div>
      </div>
      <button
        type="button"
        className={`w2-cutskip ${armed || touch ? 'w2-on' : ''}`}
        onPointerDown={e => e.stopPropagation()}
        onClick={() => cs.skip()}
      >
        {touch ? 'SKIP ▸▸' : armed ? 'SKIP ▸▸' : 'esc · skip'}
      </button>
    </div>
  );
}

function stop(e: KeyboardEvent) {
  e.stopPropagation();
}

export const CUTSCENE_CSS = `
.w2-root[data-w2cut]>*,.w2-root[data-w2fadein]>*{transition:opacity .45s ease}
.w2-root[data-w2cut]>:not(.w2-cut):not([data-w2keep]){opacity:0!important;pointer-events:none!important}
.w2-cut{font-family:'Londrina Solid','PT Root UI',system-ui,sans-serif;touch-action:none}
.w2-cutbar{position:absolute;left:0;right:0;height:max(44px,11vh);background:#000;will-change:transform}
.w2-cutbar-top{top:0;transform:translateY(-100%)}
.w2-cutbar-bot{bottom:0;transform:translateY(100%)}
@media (orientation:portrait){.w2-cutbar{height:max(40px,9vh)}}
.w2-cutwash{position:absolute;inset:0;opacity:0;pointer-events:none}
.w2-cutsub{position:absolute;left:50%;bottom:calc(max(44px,11vh) + 10px);transform:translateX(-50%);width:min(760px,88vw);text-align:center;opacity:0;color:#fff;text-shadow:0 2px 3px #000,0 0 10px rgba(0,0,0,.8);pointer-events:none}
@media (orientation:portrait){.w2-cutsub{bottom:calc(max(40px,9vh) + 8px)}}
.w2-cutsub b{display:block;color:#ffd400;font-size:15px;letter-spacing:.08em;text-transform:uppercase}
.w2-cutsub div{font-size:clamp(17px,2.4vw,24px);line-height:1.25;font-family:system-ui,sans-serif;font-weight:600}
.w2-cutunsaid{visibility:hidden}
.w2-cuttitle{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);text-align:center;opacity:0;pointer-events:none;white-space:nowrap}
.w2-cuttitle b{display:block;font-size:clamp(44px,10vw,110px);font-style:italic;color:#ffd400;text-shadow:5px 5px 0 #d22209,0 0 18px rgba(0,0,0,.6);line-height:1}
.w2-cuttitle i{display:block;font-style:normal;font-size:clamp(14px,2.2vw,22px);letter-spacing:.3em;color:#fff;text-shadow:0 2px 3px #000;margin-top:6px}
.w2-cutpop b{animation:w2cutpop .45s cubic-bezier(.2,1.6,.4,1)}
@keyframes w2cutpop{from{transform:scale(1.6);opacity:0}to{transform:scale(1);opacity:1}}
.w2-cutskip{position:absolute;right:14px;bottom:calc(max(44px,11vh) + 10px);font-family:system-ui,sans-serif;font-size:12px;font-weight:800;letter-spacing:.08em;color:#fff;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:6px 12px;opacity:.55}
.w2-cutskip.w2-on{opacity:1;background:#ffd400;color:#000;border-color:#ffd400;font-size:14px;padding:8px 16px}
@media (orientation:portrait){.w2-cutskip{bottom:calc(max(40px,9vh) + 64px)}}
`;
