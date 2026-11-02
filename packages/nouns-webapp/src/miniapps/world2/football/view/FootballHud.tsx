// ── Noun Football HUD: scoreboard, radar, the controlled player's tag +
//    power bar, banners, set-piece hints, shootout tally, replay wipe. ──
//
// Plain DOM + CSS in the world2 HUD's look (hud/hudStyle.ts: ink outlines,
// noun.wtf yellow / pink / cyan on dark ink, Londrina Solid). React renders
// only when `hud.state` changes; the radar, the tag and the power bar run
// off `hud.live` in their own rAF loop. Respects the safe-area vars.

import type { Banner, FootballHudState, HudStore } from './hudStore';

import { useEffect, useRef, useSyncExternalStore } from 'react';

export interface FootballHudProps {
  hud: HudStore;
  /** Tap the replay badge to skip (FootballMode wires it to stopReplay). */
  onSkipReplay?: () => void;
}

const SAFE_T = 'var(--w2-safe-top, env(safe-area-inset-top, 0px))';
const SAFE_L = 'var(--w2-safe-left, env(safe-area-inset-left, 0px))';
const SAFE_R = 'var(--w2-safe-right, env(safe-area-inset-right, 0px))';
const SAFE_B = 'var(--w2-safe-bottom, env(safe-area-inset-bottom, 0px))';

export function FootballHud({ hud, onSkipReplay }: FootballHudProps) {
  const s = useSyncExternalStore(hud.subscribe, hud.get);
  return (
    <div
      className="w2-fb pointer-events-none absolute inset-0 z-20 select-none overflow-hidden"
      data-football-hud
    >
      <style>{CSS}</style>
      {s.replay && <div className="w2-fb-letterbox" />}
      <ScoreBug s={s} />
      {s.shootout !== null && <Shootout s={s} />}
      <Banners list={s.banners} />
      {s.hint !== null && !s.replay && <div className="w2-fb-hint">{s.hint}</div>}
      {!s.replay && <Radar hud={hud} />}
      {!s.replay && <Tag hud={hud} s={s} />}
      {s.replay && (
        <button type="button" className="w2-fb-replay pointer-events-auto" onClick={onSkipReplay}>
          <b>REPLAY</b>
          {onSkipReplay !== undefined && <span>TAP TO SKIP</span>}
        </button>
      )}
      {s.wipe > 0 && <div key={s.wipe} className="w2-fb-wipe" />}
    </div>
  );
}

// ── Scoreboard (top-left) ───────────────────────────────────────────────

function ScoreBug({ s }: { s: FootballHudState }) {
  const [a, b] = s.teams;
  return (
    <div className="w2-fb-bug" data-fb-bug>
      <div className="w2-fb-row">
        <span
          className="w2-fb-kit"
          style={{ background: a.shirt, boxShadow: `inset 0 -5px 0 ${a.shorts}` }}
        />
        <span className={`w2-fb-short ${s.poss === 0 ? 'w2-fb-poss' : ''}`}>{a.short}</span>
        <b key={`a${s.score[0]}`} className="w2-fb-pts">
          {s.score[0]}
        </b>
        <i className="w2-fb-dash">–</i>
        <b key={`b${s.score[1]}`} className="w2-fb-pts">
          {s.score[1]}
        </b>
        <span className={`w2-fb-short ${s.poss === 1 ? 'w2-fb-poss' : ''}`}>{b.short}</span>
        <span
          className="w2-fb-kit"
          style={{ background: b.shirt, boxShadow: `inset 0 -5px 0 ${b.shorts}` }}
        />
      </div>
      <div className="w2-fb-clock">
        <span className="w2-fb-period">{s.period}</span>
        <b data-fb-clock>{s.clock}</b>
        {s.extra !== null && <span className="w2-fb-extra">{s.extra}</span>}
        {s.added !== null && s.extra === null && <span className="w2-fb-added">{s.added}</span>}
      </div>
    </div>
  );
}

function Shootout({ s }: { s: FootballHudState }) {
  const so = s.shootout!;
  const row = (t: 0 | 1) => {
    const k = so.kicks[t];
    const n = Math.max(5, k.length + (so.next === t ? 1 : 0));
    return (
      <div className="w2-fb-so-row">
        <span>{s.teams[t].short}</span>
        {Array.from({ length: n }, (_, i) => (
          <i
            key={i}
            className={
              i < k.length
                ? k[i]
                  ? 'w2-fb-so-in'
                  : 'w2-fb-so-miss'
                : i === k.length && so.next === t
                  ? 'w2-fb-so-next'
                  : ''
            }
          />
        ))}
      </div>
    );
  };
  return (
    <div className="w2-fb-so" data-fb-shootout>
      {row(0)}
      {row(1)}
    </div>
  );
}

// ── Banners ─────────────────────────────────────────────────────────────

function Banners({ list }: { list: Banner[] }) {
  if (list.length === 0) return null;
  return (
    <div className="w2-fb-banners">
      {list.map(b => (
        <div
          key={b.id}
          className={`w2-fb-banner w2-fb-b-${b.kind}`}
          style={{ ['--ms' as string]: `${b.ms}ms` }}
          data-fb-banner={b.kind}
        >
          <b>{b.text}</b>
          {b.sub !== undefined && <span>{b.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Radar (bottom-centre, canvas off hud.live) ──────────────────────────

function useLive(hud: HudStore, draw: (now: number) => void, deps: unknown[]) {
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      draw(now);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud, ...deps]);
}

function Radar({ hud }: { hud: HudStore }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef(0);
  const s = hud.state;
  const colors = [s.teams[0].shirt, s.teams[1].shirt];
  useLive(
    hud,
    now => {
      const c = ref.current;
      if (c === null || now - last.current < 33) return;
      last.current = now;
      const r = hud.live.radar;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (w === 0 || h === 0) return;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext('2d');
      if (g === null) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const pad = 4;
      const pw = w - pad * 2;
      const ph = h - pad * 2;
      // Pitch z runs across the radar, x up it
      const sx = (z: number) => pad + ((r.flip * z + 1) / 2) * pw;
      const sy = (x: number) => pad + ((1 - x) / 2) * ph;
      g.fillStyle = 'rgba(16,60,32,.72)';
      g.fillRect(pad, pad, pw, ph);
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.lineWidth = 1;
      g.strokeRect(pad + 0.5, pad + 0.5, pw - 1, ph - 1);
      g.beginPath();
      g.moveTo(w / 2, pad);
      g.lineTo(w / 2, h - pad);
      g.stroke();
      g.beginPath();
      g.arc(w / 2, h / 2, ph * 0.13, 0, Math.PI * 2);
      g.stroke();
      const box = ph * 0.6;
      const bd = pw * 0.157;
      g.strokeRect(pad + 0.5, h / 2 - box / 2, bd, box);
      g.strokeRect(w - pad - bd - 0.5, h / 2 - box / 2, bd, box);
      for (let i = 0; i < r.n; i++) {
        const x = sx(r.zs[i]);
        const y = sy(r.xs[i]);
        const me = i === r.me;
        g.beginPath();
        g.arc(x, y, me ? 4.2 : 3, 0, Math.PI * 2);
        g.fillStyle = colors[r.team[i]] ?? '#fff';
        g.fill();
        g.lineWidth = me ? 2 : 1;
        g.strokeStyle = me ? '#ffd400' : '#0b0b12';
        g.stroke();
      }
      g.beginPath();
      g.arc(sx(r.bz), sy(r.bx), 2.6, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = '#0b0b12';
      g.stroke();
    },
    [colors[0], colors[1]],
  );
  return <canvas ref={ref} className="w2-fb-radar" data-fb-radar />;
}

// ── The controlled player's tag + power bar (follows them on screen) ───

function Tag({ hud, s }: { hud: HudStore; s: FootballHudState }) {
  const box = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLSpanElement>(null);
  const stam = useRef<HTMLDivElement>(null);
  const pow = useRef<HTMLDivElement>(null);
  const powFill = useRef<HTMLDivElement>(null);
  const shown = useRef('');
  useLive(hud, () => {
    const el = box.current;
    if (el === null) return;
    const t = hud.live.tag;
    el.style.display = t.visible ? '' : 'none';
    if (!t.visible) return;
    el.style.transform = `translate(${Math.round(t.x)}px,${Math.round(t.y)}px) translate(-50%,-100%)`;
    const label = `${t.number} ${t.name}`;
    if (shown.current !== label && name.current !== null) {
      name.current.textContent = label;
      shown.current = label;
    }
    if (stam.current !== null) {
      stam.current.style.width = `${Math.round(Math.max(0, Math.min(1, t.stamina)) * 100)}%`;
      stam.current.style.background = t.stamina < 0.3 ? '#ff2f8e' : '#20d6ff';
    }
    const p = hud.live.power;
    if (pow.current !== null) pow.current.style.display = p.visible ? '' : 'none';
    if (powFill.current !== null && p.visible) {
      const v = Math.max(0, Math.min(1, p.value));
      powFill.current.style.width = `${Math.round(v * 100)}%`;
      powFill.current.style.background = v > 0.85 ? '#ff2f8e' : '#ffd400';
    }
  }, []);
  const team = s.localTeam ?? 0;
  return (
    <div
      ref={box}
      className="w2-fb-tag"
      style={{ display: 'none', ['--tc' as string]: s.teams[team].shirt }}
      data-fb-tag
    >
      <span ref={name} className="w2-fb-tag-name" />
      <div className="w2-fb-stam">
        <div ref={stam} />
      </div>
      <div ref={pow} className="w2-fb-pow" style={{ display: 'none' }}>
        <div ref={powFill} />
      </div>
      <i className="w2-fb-tag-arrow" />
    </div>
  );
}

const F = "'Londrina Solid','Arial Black',Impact,system-ui,sans-serif";

const CSS = `
.w2-fb,.w2-fb *{font-family:${F}}
.w2-fb-letterbox{position:absolute;inset:0;box-shadow:inset 0 8vh 0 #000,inset 0 -8vh 0 #000;animation:w2fblb .3s ease-out}
@keyframes w2fblb{from{box-shadow:inset 0 0 0 #000,inset 0 0 0 #000}}
.w2-fb-bug{position:absolute;top:calc(${SAFE_T} + 10px);left:calc(${SAFE_L} + 10px);display:flex;flex-direction:column;align-items:flex-start;gap:3px;filter:drop-shadow(3px 3px 0 #0b0b12) drop-shadow(0 6px 14px rgba(0,0,0,.35))}
.w2-fb-row{display:flex;align-items:center;gap:6px;background:rgba(11,11,18,.86);border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.28);border-radius:8px;padding:3px 8px;color:#fff}
.w2-fb-kit{width:12px;height:18px;border-radius:3px;border:1.5px solid #0b0b12;box-shadow:inset 0 -5px 0 #fff}
.w2-fb-short{font-size:17px;letter-spacing:.06em;line-height:1}
.w2-fb-poss{color:#ffd400}
.w2-fb-pts{font-size:24px;line-height:1;font-style:italic;min-width:.75em;text-align:center;font-variant-numeric:tabular-nums;animation:w2fbpop .5s cubic-bezier(.2,1.8,.4,1)}
@keyframes w2fbpop{0%{transform:scale(1.9);color:#ffd400}100%{transform:scale(1)}}
.w2-fb-dash{font-style:normal;opacity:.55}
.w2-fb-clock{display:flex;align-items:center;gap:6px;background:#ffd400;color:#0b0b12;border:2px solid #0b0b12;border-radius:6px;padding:1px 8px;margin-left:10px}
.w2-fb-clock b{font-size:18px;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.w2-fb-period{font:900 10px/1 system-ui,sans-serif;letter-spacing:.12em}
.w2-fb-extra,.w2-fb-added{background:#ff2f8e;color:#fff;border-radius:4px;padding:1px 5px;font-size:13px;line-height:1.1}
.w2-fb-so{position:absolute;top:calc(${SAFE_T} + 74px);left:calc(${SAFE_L} + 10px);display:flex;flex-direction:column;gap:3px;background:rgba(11,11,18,.82);border:2px solid #0b0b12;border-radius:8px;padding:5px 8px;color:#fff}
.w2-fb-so-row{display:flex;align-items:center;gap:5px}
.w2-fb-so-row span{width:32px;font-size:13px}
.w2-fb-so-row i{width:11px;height:11px;border-radius:50%;border:2px solid rgba(255,255,255,.5)}
.w2-fb-so-row .w2-fb-so-in{background:#3ddc84;border-color:#0b0b12}
.w2-fb-so-row .w2-fb-so-miss{background:#ff2f8e;border-color:#0b0b12}
.w2-fb-so-row .w2-fb-so-next{border-color:#ffd400;animation:w2fbblink .7s steps(2) infinite}
@keyframes w2fbblink{50%{opacity:.3}}
.w2-fb-banners{position:absolute;left:0;right:0;top:22%;display:flex;flex-direction:column;align-items:center;gap:10px}
.w2-fb-banner{display:flex;flex-direction:column;align-items:center;transform:rotate(-2deg);animation:w2fbcall var(--ms,2200ms) cubic-bezier(.2,1.6,.35,1) forwards}
.w2-fb-banner b{font-style:italic;line-height:.9;white-space:nowrap;padding:6px 18px;font-size:clamp(26px,5vw,52px);background:#ffd400;color:#0b0b12;border:3px solid #0b0b12;box-shadow:7px 7px 0 #ff2f8e}
.w2-fb-banner span{margin-top:7px;background:#0b0b12;color:#fff;font-size:clamp(12px,1.8vw,16px);letter-spacing:.14em;padding:3px 12px;white-space:nowrap}
.w2-fb-b-goal b{font-size:clamp(54px,12vw,140px);background:none;border:0;box-shadow:none;color:#ffd400;-webkit-text-stroke:3px #0b0b12;paint-order:stroke fill;text-shadow:0 7px 0 #ff2f8e,0 14px 0 #0b0b12}
.w2-fb-b-yellow b{background:#ffd400}
.w2-fb-b-red b{background:#e5242b;color:#fff}
.w2-fb-b-offside b,.w2-fb-b-woodwork b{background:#fff;box-shadow:7px 7px 0 #20d6ff}
.w2-fb-b-half b,.w2-fb-b-full b,.w2-fb-b-kickoff b{background:#0b0b12;color:#ffd400;box-shadow:7px 7px 0 #20d6ff}
.w2-fb-b-penalty b{background:#ff2f8e;color:#fff;box-shadow:7px 7px 0 #0b0b12}
.w2-fb-b-save b{background:#20d6ff}
@keyframes w2fbcall{0%{opacity:0;transform:rotate(-2deg) scale(2.4)}9%{opacity:1;transform:rotate(-2deg) scale(.94)}15%{transform:rotate(-2deg) scale(1.03)}20%{transform:rotate(-2deg) scale(1)}85%{opacity:1}100%{opacity:0;transform:rotate(-2deg) translateY(-16px)}}
.w2-fb-hint{position:absolute;left:50%;bottom:calc(${SAFE_B} + 136px);transform:translateX(-50%);white-space:nowrap;background:rgba(11,11,18,.82);color:#fff;border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,212,0,.6);border-radius:999px;padding:4px 14px;font-size:15px;letter-spacing:.06em}
.w2-fb-radar{position:absolute;left:50%;bottom:calc(${SAFE_B} + 10px);transform:translateX(-50%);width:200px;height:126px;border-radius:8px;border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.3),0 4px 12px rgba(0,0,0,.35)}
.w2-fb-tag{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:2px;will-change:transform}
.w2-fb-tag-name{background:#0b0b12;color:#fff;border:2px solid var(--tc);border-radius:6px;padding:1px 7px;font-size:14px;line-height:1.15;white-space:nowrap}
.w2-fb-stam,.w2-fb-pow{width:54px;height:6px;border-radius:3px;background:rgba(11,11,18,.75);border:1.5px solid #0b0b12;overflow:hidden}
.w2-fb-stam>div,.w2-fb-pow>div{height:100%;width:0}
.w2-fb-pow{width:70px;height:9px;border-color:#fff}
.w2-fb-tag-arrow{width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid #ffd400;filter:drop-shadow(0 2px 0 #0b0b12)}
.w2-fb-replay{position:absolute;top:calc(${SAFE_T} + 9vh + 10px);right:calc(${SAFE_R} + 14px);display:flex;flex-direction:column;align-items:flex-end;background:none;border:0;padding:0;color:#fff;cursor:pointer}
.w2-fb-replay b{background:#ff2f8e;color:#fff;font-style:italic;font-size:26px;padding:2px 14px;border:2px solid #0b0b12;box-shadow:4px 4px 0 #0b0b12;animation:w2fbblink 1.2s steps(2) infinite}
.w2-fb-replay span{margin-top:4px;font:800 10px system-ui,sans-serif;letter-spacing:.14em;text-shadow:0 1px 2px #000}
.w2-fb-wipe{position:absolute;inset:-10%;background:linear-gradient(100deg,transparent 0 30%,#ffd400 30% 46%,#ff2f8e 46% 54%,#20d6ff 54% 62%,transparent 62%);animation:w2fbwipe .55s ease-in forwards}
@keyframes w2fbwipe{from{transform:translateX(-110%)}to{transform:translateX(110%)}}
@media (max-width:600px){
  .w2-fb-short{font-size:14px}
  .w2-fb-pts{font-size:20px}
  .w2-fb-clock b{font-size:15px}
  .w2-fb-radar{width:128px;height:82px}
  .w2-fb-hint{bottom:calc(${SAFE_B} + 98px);font-size:12px;padding:3px 10px}
  .w2-fb-tag-name{font-size:12px}
  .w2-fb-replay b{font-size:20px}
}
@media (prefers-reduced-motion:reduce){
  .w2-fb *:not(.w2-fb-banner){animation-duration:.01ms!important;animation-iteration-count:1!important}
  .w2-fb-wipe{display:none}
  .w2-fb-banner{animation:w2fbfade var(--ms,2200ms) linear forwards}
  @keyframes w2fbfade{0%,90%{opacity:1}100%{opacity:0}}
}
`;
