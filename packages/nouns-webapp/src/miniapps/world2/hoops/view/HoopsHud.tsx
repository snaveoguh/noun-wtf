// ── Noun Hoops HUD: score bug, shot meter, callouts, final box score,
//    phone controls. Sticker style to match World2Page's w2-* look. ─────

import type { HoopsView } from './index';
import type { BallerInput } from '../contract';
import type { BoxRow, Callout, HoopsHudState } from './hudStore';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { NO_INPUT } from '../contract';

export interface HoopsHudProps {
  view: HoopsView;
  /** Touch controls → input (court-space move). Omit to hide the overlay. */
  onInput?: (input: BallerInput) => void;
  /** Force the touch overlay on / off (default: coarse pointers only). */
  touch?: boolean;
  onRematch?: () => void;
  onLeave?: () => void;
}

export function HoopsHud({ view, onInput, touch, onRematch, onLeave }: HoopsHudProps) {
  const s = useSyncExternalStore(view.hud.subscribe, view.hud.get);
  const coarse = useCoarse();
  const showTouch = onInput !== undefined && (touch ?? coarse);
  return (
    <div className="w2-hoops pointer-events-none absolute inset-0 z-20 select-none overflow-hidden">
      <style>{CSS}</style>
      {s.slowmo && <div className="w2-hoops-letterbox" />}
      <ScoreBug s={s} />
      <Meter view={view} />
      {s.final === null && <Callouts list={s.callouts} />}
      <button
        type="button"
        className="w2-hoops-cam pointer-events-auto"
        onClick={() => view.setCameraMode(s.cameraMode === 'broadcast' ? 'chase' : 'broadcast')}
        title="Camera"
      >
        {s.cameraMode === 'broadcast' ? '📺 TV' : '🏃 CHASE'}
      </button>
      {s.final !== null && <FinalBoard s={s} onRematch={onRematch} onLeave={onLeave} />}
      {showTouch && s.final === null && <TouchPad view={view} onInput={onInput!} />}
    </div>
  );
}

function useCoarse() {
  const [c] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches === true || 'ontouchstart' in window),
  );
  return c;
}

// ── Score bug ───────────────────────────────────────────────────────────

function ScoreBug({ s }: { s: HoopsHudState }) {
  const [a, b] = s.teams;
  const clock = Math.max(0, Math.ceil(s.shotClock));
  const hot = s.shotClockMax > 0 && clock <= 5 && s.phase === 'live';
  const fire = (t: 0 | 1) => s.teams[t].players.some(p => p.onFire);
  return (
    <div className="w2-hoops-bug">
      <div
        className={`w2-hoops-team ${s.offense === 0 ? 'w2-hoops-poss' : ''}`}
        style={{ ['--tc' as string]: a.color }}
      >
        <span className="w2-hoops-tname">
          {fire(0) ? '🔥 ' : ''}
          {a.name}
        </span>
        <b key={`a${s.score[0]}`} className="w2-hoops-pts">
          {s.score[0]}
        </b>
      </div>
      <div className="w2-hoops-mid">
        {s.shotClockMax > 0 ? (
          <b className={`w2-hoops-clock ${hot ? 'w2-hoops-hot' : ''}`}>{clock}</b>
        ) : (
          <b className="w2-hoops-clock">•</b>
        )}
        <span>
          TO {s.target}
          {s.winBy2 ? ' · BY 2' : ''}
        </span>
      </div>
      <div
        className={`w2-hoops-team w2-hoops-right ${s.offense === 1 ? 'w2-hoops-poss' : ''}`}
        style={{ ['--tc' as string]: b.color }}
      >
        <b key={`b${s.score[1]}`} className="w2-hoops-pts">
          {s.score[1]}
        </b>
        <span className="w2-hoops-tname">
          {b.name}
          {fire(1) ? ' 🔥' : ''}
        </span>
      </div>
    </div>
  );
}

// ── Shot meter (positioned every frame from view.hud.live) ─────────────

function Meter({ view }: { view: HoopsView }) {
  const box = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const res = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let lastResult = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const m = view.hud.live.meter;
      const el = box.current;
      if (el === null || fill.current === null || res.current === null) return;
      const showResult = m.result !== null && performance.now() - m.resultAt < 900;
      el.style.display = m.visible || showResult ? 'block' : 'none';
      if (m.visible)
        el.style.transform = `translate(${(m.x + 64).toFixed(0)}px, ${(m.y - 70).toFixed(0)}px)`;
      const v = Math.max(0, Math.min(1, m.value));
      fill.current.style.height = `${(v * 100).toFixed(1)}%`;
      const near = Math.abs(v - m.sweet) < 0.04;
      fill.current.className = `w2-hoops-fill ${near ? 'w2-hoops-green' : v > m.sweet ? 'w2-hoops-over' : ''}`;
      if (showResult && m.resultAt !== lastResult) {
        lastResult = m.resultAt;
        const q = m.result!;
        res.current.textContent =
          q >= 0.95 ? 'PERFECT!' : q >= 0.8 ? 'GOOD' : q >= 0.55 ? 'OKAY' : 'BRICK';
        res.current.className = `w2-hoops-res ${q >= 0.95 ? 'w2-hoops-res-p' : q >= 0.8 ? 'w2-hoops-res-g' : 'w2-hoops-res-b'}`;
      }
      if (!showResult) res.current.textContent = '';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view]);
  const sweet = view.hud.live.meter.sweet;
  return (
    <div ref={box} className="w2-hoops-meter" style={{ display: 'none' }}>
      <div className="w2-hoops-tube">
        <div
          className="w2-hoops-sweet"
          style={{ bottom: `${(sweet - 0.04) * 100}%`, height: '8%' }}
        />
        <div ref={fill} className="w2-hoops-fill" />
      </div>
      <div ref={res} className="w2-hoops-res" />
    </div>
  );
}

// ── Callouts ────────────────────────────────────────────────────────────

function Callouts({ list }: { list: Callout[] }) {
  return (
    <div className="w2-hoops-callouts">
      {list.map((c, i) => (
        <div
          key={c.id}
          className={`w2-hoops-call w2-hoops-s${c.size} w2-hoops-t-${c.tone}`}
          style={{
            ['--r' as string]: `${(c.id % 2 === 0 ? -1 : 1) * (2 + (c.id % 3))}deg`,
            ['--i' as string]: i,
          }}
        >
          <b>{c.text}</b>
          {c.sub !== undefined && <span>{c.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Final scoreboard + box score ───────────────────────────────────────

function FinalBoard({
  s,
  onRematch,
  onLeave,
}: {
  s: HoopsHudState;
  onRematch?: () => void;
  onLeave?: () => void;
}) {
  const f = s.final!;
  const win = s.teams[f.winner];
  const mine = s.localId !== null ? f.box.find(r => r.id === s.localId) : undefined;
  const youWon = mine !== undefined ? mine.team === f.winner : null;
  const cols: [keyof BoxRow, string][] = [
    ['pts', 'PTS'],
    ['fgm', 'FG'],
    ['tpm', '3PT'],
    ['reb', 'REB'],
    ['ast', 'AST'],
    ['stl', 'STL'],
    ['blk', 'BLK'],
    ['dnk', 'DNK'],
  ];
  const cell = (r: BoxRow, k: keyof BoxRow) =>
    k === 'fgm' ? `${r.fgm}-${r.fga}` : k === 'tpm' ? `${r.tpm}-${r.tpa}` : String(r[k]);
  return (
    <div className="w2-hoops-final pointer-events-auto">
      <div className="w2-hoops-final-card">
        <div className="w2-hoops-final-kicker">FINAL</div>
        <div className="w2-hoops-final-title" style={{ ['--tc' as string]: win.color }}>
          {youWon === null ? `${win.name} WIN` : youWon ? 'YOU WIN!' : 'YOU LOSE'}
        </div>
        <div className="w2-hoops-final-score">
          <span style={{ color: s.teams[0].color }}>{f.score[0]}</span>
          <i>–</i>
          <span style={{ color: s.teams[1].color }}>{f.score[1]}</span>
        </div>
        <div className="w2-hoops-table-wrap">
          <table className="w2-hoops-table">
            <thead>
              <tr>
                <th className="text-left">PLAYER</th>
                {cols.map(([, l]) => (
                  <th key={l}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {f.box.map(r => (
                <tr key={r.id} className={r.id === s.localId ? 'w2-hoops-me' : ''}>
                  <td className="text-left">
                    <i className="w2-hoops-dot" style={{ background: s.teams[r.team].color }} />
                    {r.id === s.localId ? 'YOU' : r.name}
                    {f.mvp === r.id && <em className="w2-hoops-mvp">MVP</em>}
                  </td>
                  {cols.map(([k]) => (
                    <td key={k}>{cell(r, k)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(onRematch !== undefined || onLeave !== undefined) && (
          <div className="w2-hoops-final-btns">
            {onRematch !== undefined && (
              <button type="button" className="w2-btn" onClick={onRematch}>
                RUN IT BACK
              </button>
            )}
            {onLeave !== undefined && (
              <button type="button" className="w2-hoops-leave" onClick={onLeave}>
                Leave court
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Touch controls: stick + SHOOT / PASS / MOVE / SPRINT ───────────────

const STICK_R = 54;

function TouchPad({ view, onInput }: { view: HoopsView; onInput: (i: BallerInput) => void }) {
  const input = useRef<BallerInput>({ ...NO_INPUT });
  const stick = useRef({ id: null as number | null, ox: 0, oy: 0, sx: 0, sy: 0 });
  const [knob, setKnob] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [down, setDown] = useState<Record<string, boolean>>({});

  const emit = () => {
    const st = stick.current;
    const m = view.stickToCourt(st.sx, st.sy);
    input.current = { ...input.current, moveX: m.x, moveZ: m.z };
    onInput({ ...input.current });
  };

  // The camera keeps moving under a held stick: re-resolve it to court space
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (stick.current.id !== null) emit();
    }, 66);
    return () => window.clearInterval(iv);
  });

  const btn = (key: 'shoot' | 'pass' | 'move' | 'sprint', label: string, cls: string) => ({
    className: `w2-hoops-btn ${cls} ${down[key] === true ? 'w2-hoops-down' : ''}`,
    children: label,
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      view.startAudio();
      input.current = { ...input.current, [key]: true };
      setDown(d => ({ ...d, [key]: true }));
      emit();
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      input.current = { ...input.current, [key]: false };
      setDown(d => ({ ...d, [key]: false }));
      emit();
    },
    onPointerCancel: () => {
      input.current = { ...input.current, [key]: false };
      setDown(d => ({ ...d, [key]: false }));
      emit();
    },
  });

  return (
    <>
      <div
        className="w2-hoops-stickzone pointer-events-auto"
        onPointerDown={e => {
          const st = stick.current;
          st.id = e.pointerId;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          st.ox = e.clientX;
          st.oy = e.clientY;
          st.sx = st.sy = 0;
          setKnob({ x: 0, y: 0, ox: st.ox, oy: st.oy });
          view.startAudio();
        }}
        onPointerMove={e => {
          const st = stick.current;
          if (e.pointerId !== st.id) return;
          let dx = (e.clientX - st.ox) / STICK_R;
          let dy = -(e.clientY - st.oy) / STICK_R;
          const m = Math.hypot(dx, dy);
          if (m > 1) {
            dx /= m;
            dy /= m;
          }
          st.sx = dx;
          st.sy = dy;
          setKnob({ x: dx, y: dy, ox: st.ox, oy: st.oy });
          emit();
        }}
        onPointerUp={e => {
          const st = stick.current;
          if (e.pointerId !== st.id) return;
          st.id = null;
          st.sx = st.sy = 0;
          setKnob(null);
          emit();
        }}
      >
        {knob !== null ? (
          <div
            className="w2-hoops-stick"
            style={{ left: knob.ox, top: knob.oy, position: 'fixed' }}
          >
            <div
              className="w2-hoops-knob"
              style={{ transform: `translate(${knob.x * STICK_R}px, ${-knob.y * STICK_R}px)` }}
            />
          </div>
        ) : (
          <div className="w2-hoops-stick w2-hoops-stick-idle">
            <div className="w2-hoops-knob" />
          </div>
        )}
      </div>
      <div className="w2-hoops-btns pointer-events-auto">
        <button type="button" {...btn('shoot', 'SHOOT', 'w2-hoops-shoot')} />
        <button type="button" {...btn('pass', 'PASS', 'w2-hoops-pass')} />
        <button type="button" {...btn('move', 'MOVE', 'w2-hoops-move')} />
        <button type="button" {...btn('sprint', 'TURBO', 'w2-hoops-sprint')} />
      </div>
    </>
  );
}

const F = "'Londrina Solid','Arial Black',Impact,system-ui,sans-serif";

const CSS = `
.w2-hoops,.w2-hoops *{font-family:${F} !important}
.w2-hoops-letterbox{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 9vh 0 #000,inset 0 -9vh 0 #000;animation:w2hlb .35s ease-out}
@keyframes w2hlb{from{box-shadow:inset 0 0 0 #000,inset 0 0 0 #000}}
.w2-hoops-bug{position:absolute;top:10px;left:50%;transform:translateX(-50%) skewX(-8deg);display:flex;align-items:stretch;filter:drop-shadow(5px 5px 0 #d22209) drop-shadow(0 8px 18px rgba(0,0,0,.45))}
.w2-hoops-team{display:flex;align-items:center;gap:10px;background:#111;color:#fff;padding:4px 14px;border-bottom:5px solid var(--tc)}
.w2-hoops-right{flex-direction:row}
.w2-hoops-tname{font-size:clamp(11px,1.6vw,16px);letter-spacing:.06em;color:var(--tc);text-shadow:0 1px 0 #000;white-space:nowrap}
.w2-hoops-pts{font-size:clamp(26px,4.2vw,42px);line-height:1;color:#fff;min-width:1.4em;text-align:center;animation:w2hpop .45s cubic-bezier(.2,1.8,.4,1)}
.w2-hoops-poss .w2-hoops-tname::after{content:' ●';color:#ffd400}
.w2-hoops-right.w2-hoops-poss .w2-hoops-tname::after{content:''}
.w2-hoops-right.w2-hoops-poss .w2-hoops-tname::before{content:'● ';color:#ffd400}
.w2-hoops-mid{display:flex;flex-direction:column;align-items:center;justify-content:center;background:#ffd400;color:#000;padding:2px 12px;min-width:64px}
.w2-hoops-clock{font-size:clamp(22px,3.4vw,32px);line-height:1}
.w2-hoops-mid span{font-size:10px;letter-spacing:.14em}
.w2-hoops-hot{color:#d22209;animation:w2hblink .5s steps(2) infinite}
@keyframes w2hblink{50%{opacity:.35}}
@keyframes w2hpop{0%{transform:scale(1.9);color:#ffd400}100%{transform:scale(1)}}
.w2-hoops-meter{position:absolute;left:0;top:0;width:22px;pointer-events:none}
.w2-hoops-tube{position:relative;width:16px;height:96px;border-radius:9px;background:rgba(0,0,0,.6);border:3px solid #fff;overflow:hidden;box-shadow:0 4px 0 #000}
.w2-hoops-sweet{position:absolute;left:0;right:0;background:#3ddc84;box-shadow:0 0 14px 4px #3ddc84;animation:w2hglow .6s ease-in-out infinite alternate}
@keyframes w2hglow{from{opacity:.65}to{opacity:1}}
.w2-hoops-fill{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(#ffd400,#ff8a00);mix-blend-mode:screen}
.w2-hoops-green{background:linear-gradient(#b8ffcf,#3ddc84)}
.w2-hoops-over{background:linear-gradient(#ff7a6a,#d22209)}
.w2-hoops-res{position:absolute;left:24px;top:30px;font-size:22px;font-style:italic;white-space:nowrap;text-shadow:0 2px 0 #000,0 0 14px rgba(0,0,0,.7);animation:w2hpop .4s cubic-bezier(.2,1.8,.4,1)}
.w2-hoops-res-p{color:#3ddc84}.w2-hoops-res-g{color:#ffd400}.w2-hoops-res-b{color:#ff6a55}
.w2-hoops-callouts{position:absolute;left:0;right:0;top:24%;display:flex;flex-direction:column;align-items:center;gap:10px}
.w2-hoops-call{display:flex;flex-direction:column;align-items:center;transform:rotate(var(--r));animation:w2hcall 2.2s cubic-bezier(.2,1.6,.35,1) forwards}
.w2-hoops-call b{font-style:italic;font-weight:900;letter-spacing:.02em;line-height:.9;white-space:nowrap;-webkit-text-stroke:2px #000;paint-order:stroke fill}
.w2-hoops-call span{margin-top:6px;background:#000;color:#fff;font-size:13px;letter-spacing:.2em;padding:2px 10px}
.w2-hoops-s0 b{font-size:clamp(16px,2.6vw,24px);background:#111;color:#fff;padding:4px 12px;-webkit-text-stroke:0;box-shadow:4px 4px 0 #d22209}
.w2-hoops-s1 b{font-size:clamp(30px,5.4vw,60px);background:#ffd400;color:#000;padding:6px 18px;-webkit-text-stroke:0;box-shadow:7px 7px 0 #d22209}
.w2-hoops-s2 b{font-size:clamp(44px,9.5vw,118px);color:#ffd400;text-shadow:0 6px 0 #d22209,0 12px 0 #000,0 0 40px rgba(0,0,0,.6)}
.w2-hoops-s2.w2-hoops-t-red b{color:#fff;text-shadow:0 6px 0 #d22209,0 12px 0 #000}
.w2-hoops-s2.w2-hoops-t-blue b{color:#fff;text-shadow:0 6px 0 #2f8bff,0 12px 0 #000}
.w2-hoops-s1.w2-hoops-t-white b{background:#fff}
.w2-hoops-s1.w2-hoops-t-blue b{background:#2f8bff;color:#fff;box-shadow:7px 7px 0 #000}
.w2-hoops-t-fire b{background:linear-gradient(180deg,#fff7a8 0%,#ffd400 30%,#ff7a00 65%,#d22209 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:2px #3a0700;text-shadow:none;filter:drop-shadow(0 0 18px rgba(255,120,0,.9)) drop-shadow(0 6px 0 #000);animation:w2hfire .25s steps(2) infinite}
.w2-hoops-s1.w2-hoops-t-fire b{background-color:transparent;box-shadow:none}
@keyframes w2hfire{50%{filter:drop-shadow(0 0 26px rgba(255,170,0,1)) drop-shadow(0 6px 0 #000)}}
@keyframes w2hcall{0%{opacity:0;transform:rotate(var(--r)) scale(2.6)}10%{opacity:1;transform:rotate(var(--r)) scale(.92)}16%{transform:rotate(var(--r)) scale(1.04)}22%{transform:rotate(var(--r)) scale(1)}82%{opacity:1;transform:rotate(var(--r)) scale(1.03)}100%{opacity:0;transform:rotate(var(--r)) scale(1.1) translateY(-20px)}}
.w2-hoops-cam{position:absolute;top:12px;right:12px;background:rgba(10,12,20,.6);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:4px 12px;font-size:13px}
.w2-hoops-final{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 40%,rgba(30,40,70,.35),rgba(5,6,12,.78));animation:w2hfade .6s ease-out}
@keyframes w2hfade{from{opacity:0}}
.w2-hoops-final-card{display:flex;flex-direction:column;align-items:center;gap:6px;max-width:min(680px,calc(100vw - 24px));max-height:calc(100vh - 24px);padding:16px 16px 18px;background:#fff;color:#000;box-shadow:10px 10px 0 #d22209,0 20px 60px rgba(0,0,0,.6);transform:rotate(-1.5deg);animation:w2hcard .7s cubic-bezier(.2,1.6,.35,1)}
@keyframes w2hcard{from{transform:rotate(-8deg) scale(.4);opacity:0}}
.w2-hoops-final-kicker{background:#000;color:#ffd400;font-size:14px;letter-spacing:.35em;padding:2px 12px}
.w2-hoops-final-title{font-size:clamp(40px,8vw,84px);font-style:italic;line-height:.9;color:var(--tc);text-shadow:0 5px 0 #000}
.w2-hoops-final-score{display:flex;gap:14px;align-items:center;font-size:clamp(34px,6vw,60px);line-height:1}
.w2-hoops-final-score i{font-style:normal;color:#999}
.w2-hoops-table-wrap{overflow:auto;max-width:100%}
.w2-hoops-table{border-collapse:collapse;font-size:clamp(12px,1.8vw,16px);margin-top:4px}
.w2-hoops-table th{background:#000;color:#ffd400;font-weight:400;letter-spacing:.1em;padding:3px 8px;font-size:.8em}
.w2-hoops-table td{padding:3px 8px;text-align:center;border-bottom:1px solid #ddd;white-space:nowrap}
.w2-hoops-table .text-left{text-align:left}
.w2-hoops-me td{background:#fff3b0}
.w2-hoops-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
.w2-hoops-mvp{font-style:normal;background:#d22209;color:#fff;font-size:.7em;padding:1px 5px;margin-left:6px;letter-spacing:.1em}
.w2-hoops-final-btns{display:flex;gap:12px;align-items:center;margin-top:10px}
.w2-hoops-leave{color:#333;text-decoration:underline;font-size:15px}
.w2-hoops-stickzone{position:absolute;left:0;bottom:0;width:45%;height:55%;touch-action:none}
.w2-hoops-stick{position:absolute;width:${STICK_R * 2}px;height:${STICK_R * 2}px;margin:-${STICK_R}px 0 0 -${STICK_R}px;border-radius:50%;background:rgba(255,255,255,.12);border:3px solid rgba(255,255,255,.45);display:flex;align-items:center;justify-content:center}
.w2-hoops-stick-idle{left:${STICK_R + 28}px;bottom:${STICK_R + 28}px;top:auto;margin:0 0 -${STICK_R}px -${STICK_R}px;opacity:.6}
.w2-hoops-knob{width:50px;height:50px;border-radius:50%;background:#ffd400;box-shadow:0 4px 0 #a88a00}
.w2-hoops-btns{position:absolute;right:14px;bottom:18px;width:210px;height:210px;touch-action:none}
.w2-hoops-btn{position:absolute;border-radius:50%;color:#fff;font-size:15px;letter-spacing:.04em;display:flex;align-items:center;justify-content:center;touch-action:none;box-shadow:0 5px 0 rgba(0,0,0,.55);transition:transform .05s}
.w2-hoops-down{transform:translateY(4px) scale(.96);box-shadow:0 1px 0 rgba(0,0,0,.55)}
.w2-hoops-shoot{right:0;bottom:0;width:104px;height:104px;background:#d22209;font-size:21px;border:4px solid #fff}
.w2-hoops-pass{right:118px;bottom:6px;width:72px;height:72px;background:#2f8bff;border:3px solid #fff}
.w2-hoops-move{right:8px;bottom:118px;width:72px;height:72px;background:#111;border:3px solid #ffd400;color:#ffd400}
.w2-hoops-sprint{right:104px;bottom:96px;width:62px;height:62px;background:#ffd400;color:#000;border:3px solid #000;font-size:13px}
.w2-hoops-tag span{font-size:12px;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:999px}
@media (max-width:640px){.w2-hoops-callouts{top:20%}.w2-hoops-bug{top:6px}}
`;
