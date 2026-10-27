// ── Noun Breaks HUD: crew totals, beat track, grades, combo, move calls,
//    judges' cards, the winner screen and phone controls. Sticker style,
//    like HoopsHud. ─────────────────────────────────────────────────────

import type { BreakKey, CrewId, HitGrade, JudgeCard } from '../contract';
import type { BreakHudState, BreakHudStore } from './hudStore';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  barsLeft,
  cardTotal,
  cardVotes,
  formingText,
  GRADE_COLOR,
  GRADE_LABEL,
  KEY_GLYPH,
  laneItems,
  turnLeft,
} from './hudStore';
import { moveName } from './moves';

const PAD_KEY = 'noun-breaks-pad';

/** Desktop: the clickable pad is on unless the player hid it (remembered). */
function usePadPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(PAD_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      window.localStorage.setItem(PAD_KEY, v ? 'on' : 'off');
    } catch {
      /* storage blocked: just this session */
    }
  };
  return [on, set];
}

export interface BreakHudProps {
  hud: BreakHudStore;
  /** On-screen arrows + A/B → a key press. Omit to hide them. */
  onKey?: (k: BreakKey) => void;
  /**
   * Force the big touch pad on / off (default: coarse pointers). Fine
   * pointers get a small clickable pad instead, which the player can hide.
   */
  touch?: boolean;
  /** First touch: unlock audio. */
  onGesture?: () => void;
  onRematch?: () => void;
  onLeave?: () => void;
  /** Draw the winner screen (off when net/ shows its own results). */
  showFinal?: boolean;
}

export function BreakHud({
  hud,
  onKey,
  touch,
  onGesture,
  onRematch,
  onLeave,
  showFinal = true,
}: BreakHudProps) {
  const s = useSyncExternalStore(hud.subscribe, hud.get);
  const coarse = useCoarse();
  const [padOn, setPadOn] = usePadPref();
  const big = touch ?? coarse;
  const canPad = onKey !== undefined && s.winner === null;
  const showTouch = canPad && big;
  const showMini = canPad && !big && padOn;
  const now = useNow(250);
  const calls = s.calls.filter(c => now - c.at < 1800);
  return (
    <div
      className={`w2-brk pointer-events-none absolute inset-0 z-20 select-none overflow-hidden ${showTouch ? 'w2-brk-touch' : ''}`}
    >
      <style>{CSS}</style>
      <TopBar s={s} hud={hud} />
      {s.banner !== null && now - s.banner.at < 1900 && (
        <div key={s.banner.id} className={`w2-brk-banner w2-brk-t-${s.banner.tone}`}>
          <b>{s.banner.text}</b>
          {s.banner.sub !== undefined && <span>{s.banner.sub}</span>}
        </div>
      )}
      <div className="w2-brk-calls">
        {calls.slice(-2).map(c => (
          <div
            key={c.id}
            className={`w2-brk-call ${c.big ? 'w2-brk-call-big' : ''} ${c.landed ? '' : 'w2-brk-call-bail'}`}
          >
            <b>{c.landed ? `${c.text}!` : `${c.text}… BAILED`}</b>
            {c.landed && c.points > 0 && <span>+{c.points}</span>}
          </div>
        ))}
      </div>
      {s.track !== null && s.winner === null && <Track hud={hud} s={s} coarse={big} />}
      {s.reveal !== null &&
        s.winner === null &&
        (s.phase === 'judging' || now - s.reveal.at < 6500) && (
          <CardReveal key={s.reveal.round} s={s} card={s.reveal.card} round={s.reveal.round} />
        )}
      {showFinal && s.winner !== null && <Winner s={s} onRematch={onRematch} onLeave={onLeave} />}
      {showTouch && <Pad onKey={onKey!} onGesture={onGesture} />}
      {showMini && <Pad onKey={onKey!} onGesture={onGesture} mini />}
      {canPad && !big && (
        <button
          type="button"
          className="w2-brk-padtoggle pointer-events-auto"
          onClick={() => setPadOn(!padOn)}
        >
          {padOn ? 'hide pad' : 'show clickable pad'}
        </button>
      )}
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

/** Re-render every `ms` while mounted (expiring calls / banners). */
function useNow(ms: number) {
  const [n, setN] = useState(() => performance.now());
  useEffect(() => {
    const iv = window.setInterval(() => setN(performance.now()), ms);
    return () => window.clearInterval(iv);
  }, [ms]);
  return n;
}

// ── top bar: crew totals, round, turn timer ─────────────────────────────

function TopBar({ s, hud }: { s: BreakHudState; hud: BreakHudStore }) {
  const [a, b] = s.crews;
  const timer = useRef<HTMLDivElement>(null);
  const timerTxt = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const l = hud.live;
      const left = turnLeft(l.beat, l.turn);
      if (timer.current !== null) timer.current.style.transform = `scaleX(${left.toFixed(3)})`;
      if (timerTxt.current !== null)
        timerTxt.current.textContent = l.turn !== null ? barsLeft(l.beat, l.turn) : '';
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [hud]);
  const upCrew = s.up?.crew ?? null;
  return (
    <div className="w2-brk-top">
      <div
        className={`w2-brk-crew ${upCrew === 0 ? 'w2-brk-crew-up' : ''}`}
        style={{ ['--cc' as string]: a.color }}
      >
        <span className="w2-brk-cname">{a.name}</span>
        <b key={`a${a.total}`} className="w2-brk-total">
          {a.total}
        </b>
      </div>
      <div className="w2-brk-mid">
        <span className="w2-brk-round">
          {s.phase === 'intro'
            ? 'GET READY'
            : s.winner !== null
              ? 'FINAL'
              : `ROUND ${Math.max(1, s.round + 1)}/${s.rounds}`}
        </span>
        <div className="w2-brk-timer">
          <div
            ref={timer}
            className="w2-brk-timer-fill"
            style={{ background: upCrew !== null ? s.crews[upCrew].color : '#fff' }}
          />
        </div>
        <span ref={timerTxt} className="w2-brk-bars" />
      </div>
      <div
        className={`w2-brk-crew w2-brk-crew-r ${upCrew === 1 ? 'w2-brk-crew-up' : ''}`}
        style={{ ['--cc' as string]: b.color }}
      >
        <b key={`b${b.total}`} className="w2-brk-total">
          {b.total}
        </b>
        <span className="w2-brk-cname">{b.name}</span>
      </div>
      {s.song !== null && s.phase === 'intro' && <div className="w2-brk-song">{s.song}</div>}
      {s.up !== null && s.phase === 'turn' && (
        <div className="w2-brk-up" style={{ ['--cc' as string]: s.crews[s.up.crew].color }}>
          {s.up.local ? 'YOUR TURN' : `${s.up.name.toUpperCase()} IS UP`}
        </div>
      )}
    </div>
  );
}

// ── rhythm lane + grade flash + combo + controls legend ─────────────────
//
// Notes scroll right to left onto the HIT LINE, which pulses on the beat.
// A hit note bursts at the line in its grade's colour (OK hits say EARLY /
// LATE); a miss keeps scrolling past marked MISS; a note whose move already
// broke greys out. A redrawn plan's new notes glide in from the right
// instead of popping up. Your own presses flash in the ring at once (the
// grade follows when the sim has judged it).

const AHEAD = 4;
const POOL = 24;
const BURSTS = 6;
const ENTER_MS = 320;
const name = (m: string) => moveName(m);

function Track({ hud, s, coarse }: { hud: BreakHudStore; s: BreakHudState; coarse: boolean }) {
  const lane = useRef<HTMLDivElement>(null);
  const notes = useRef<(HTMLDivElement | null)[]>([]);
  const ticks = useRef<(HTMLDivElement | null)[]>([]);
  const bursts = useRef<(HTMLDivElement | null)[]>([]);
  const pressEl = useRef<HTMLDivElement>(null);
  const formEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let owner: string | null = null;
    let nextBurst = 0;
    const seen = new Map<string, { at: number; from: number | null }>();
    const burst = new Set<string>();
    const fire = (grade: HitGrade, timing: string | undefined, key: BreakKey, x: number) => {
      const b = bursts.current[nextBurst];
      nextBurst = (nextBurst + 1) % BURSTS;
      // Only the newest burst keeps its words (they overlap on quick notes)
      for (const o of bursts.current) o?.classList.add('w2-brk-burst-old');
      if (b === null || b === undefined) return;
      b.style.setProperty('--gc', GRADE_COLOR[grade]);
      b.style.setProperty('--bx', `${x.toFixed(1)}px`);
      b.innerHTML = `<i>${KEY_GLYPH[key]}</i><b>${GRADE_LABEL[grade]}</b>${timing !== undefined ? `<span>${timing}</span>` : ''}`;
      b.classList.remove('w2-brk-burst-go', 'w2-brk-burst-old');
      void b.offsetWidth; // restart the animation
      b.classList.add('w2-brk-burst-go');
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = lane.current;
      if (el === null) return;
      const w = el.clientWidth;
      // The hit line sits a fifth of the way in, so a miss is seen scrolling past it
      const hitX = Math.max(52, Math.round(w * 0.2));
      const span = w - hitX - 18;
      const l = hud.live;
      const now = performance.now();
      const who = hud.state.track?.id ?? null;
      if (who !== owner) {
        owner = who;
        seen.clear();
        burst.clear();
      }
      const items = laneItems(l.lane, l.prompts, l.beat, AHEAD, name);
      let k = 0;
      for (const it of items) {
        if (it.status === 'hit') {
          // Hit: it bursts on the line, and leaves the lane
          if (!burst.has(it.id)) {
            burst.add(it.id);
            if (it.x > -0.3 && it.grade !== undefined)
              fire(it.grade, it.timing, it.key, hitX + Math.max(-0.08, it.x) * span);
          }
          continue;
        }
        if (k >= POOL) break;
        const n = notes.current[k++];
        if (n === null || n === undefined) continue;
        let x = it.x;
        let e = seen.get(it.id);
        if (e === undefined) {
          e = { at: now, from: it.status === 'pending' && x < 0.9 ? 1.08 : null };
          seen.set(it.id, e);
        }
        if (e.from !== null) {
          const t = Math.min(1, (now - e.at) / ENTER_MS);
          x = e.from + (x - e.from) * (1 - (1 - t) ** 3);
          if (t >= 1) e.from = null;
        }
        n.style.display = 'flex';
        n.style.opacity = it.alpha.toFixed(2);
        n.style.transform = `translate(${(hitX + x * span).toFixed(1)}px,-50%) scale(${it.down ? 1.12 : 1})`;
        const sig = `${it.key}|${it.status}|${it.label ?? ''}`;
        if (n.dataset.k !== sig) {
          n.dataset.k = sig;
          n.className = `w2-brk-note w2-brk-k-${it.key} w2-brk-n-${it.status}`;
          n.innerHTML =
            KEY_GLYPH[it.key] +
            (it.label !== undefined && it.status !== 'miss'
              ? `<em class="w2-brk-nlabel">${it.label}</em>`
              : '') +
            (it.status === 'miss' ? '<em class="w2-brk-nmiss">MISS</em>' : '');
        }
      }
      for (; k < POOL; k++) {
        const n = notes.current[k];
        if (n !== null && n !== undefined) n.style.display = 'none';
      }
      if (seen.size > 200) for (const id of [...seen.keys()].slice(0, 100)) seen.delete(id);
      // Beat lines scroll with the notes
      const b0 = Math.floor(l.beat);
      for (let i = 0; i < 6; i++) {
        const t = ticks.current[i];
        if (t === null || t === undefined) continue;
        const beat = b0 + i;
        const x = (beat - l.beat) / AHEAD;
        if (x < -0.05 || x > 1) {
          t.style.display = 'none';
          continue;
        }
        t.style.display = 'block';
        t.style.transform = `translateX(${(hitX + x * span).toFixed(1)}px)`;
        t.className = `w2-brk-tick ${((beat % 4) + 4) % 4 === 0 ? 'w2-brk-tick-down' : ''}`;
      }
      // The hit line pulses on the beat (harder on the downbeat)
      const ph = ((l.beat % 1) + 1) % 1;
      const down = ((Math.floor(l.beat) % 4) + 4) % 4 === 0 ? 1.4 : 1;
      el.style.setProperty('--pulse', (Math.exp(-ph * 6) * down).toFixed(3));
      el.style.setProperty('--hitx', `${hitX}px`);
      // Your press, in the ring, right away
      const p = pressEl.current;
      if (p !== null) {
        const last = l.presses[l.presses.length - 1];
        const age = last !== undefined ? now - last.at : Infinity;
        if (age < 180) {
          if (p.dataset.k !== last.key) {
            p.dataset.k = last.key;
            p.textContent = KEY_GLYPH[last.key];
          }
          p.style.opacity = (1 - age / 180).toFixed(2);
        } else p.style.opacity = '0';
      }
      // The move forming
      const f = formEl.current;
      if (f !== null) {
        const fm =
          l.forming !== null && l.forming !== undefined && l.forming.id === owner
            ? l.forming
            : null;
        const txt = formingText(fm, name);
        if (f.dataset.k !== txt) {
          f.dataset.k = txt;
          f.textContent = txt;
          f.className = `w2-brk-forming ${fm?.landed === true ? 'w2-brk-forming-done' : ''}`;
        }
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [hud]);
  const local = s.track?.local === true;
  const crew = s.track?.crew ?? s.up?.crew ?? null;
  const f = s.flash;
  // Your own hits show on the lane; a wrong key is called out big, with the right one
  const showFlash =
    f !== null && performance.now() - f.at < 700 && (!local || f.wrong !== undefined);
  return (
    <div className={`w2-brk-trackwrap ${local ? '' : 'w2-brk-spect'}`}>
      {showFlash && (
        <div key={f.id} className="w2-brk-grade" style={{ color: GRADE_COLOR[f.grade] }}>
          {f.wrong !== undefined ? `WRONG KEY · ${KEY_GLYPH[f.wrong]}` : GRADE_LABEL[f.grade]}
        </div>
      )}
      <div ref={formEl} className="w2-brk-forming" />
      <div
        ref={lane}
        className="w2-brk-lane"
        style={{ ['--cc' as string]: crew !== null ? s.crews[crew].color : '#fff' }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={`t${i}`} ref={el => void (ticks.current[i] = el)} className="w2-brk-tick" />
        ))}
        <div className="w2-brk-hitline">
          <div ref={pressEl} className="w2-brk-press" />
        </div>
        <div className="w2-brk-hitlabel">HIT</div>
        {Array.from({ length: POOL }, (_, i) => (
          <div
            key={i}
            ref={el => void (notes.current[i] = el)}
            className="w2-brk-note"
            style={{ display: 'none' }}
          />
        ))}
        {Array.from({ length: BURSTS }, (_, i) => (
          <div key={`b${i}`} ref={el => void (bursts.current[i] = el)} className="w2-brk-burst" />
        ))}
      </div>
      {s.combo >= 2 && (
        <div key={`c${s.combo}`} className="w2-brk-combo">
          <b>{s.combo}</b>
          <span>COMBO</span>
        </div>
      )}
      <div className="w2-brk-score">{s.turnScore}</div>
      {local && (
        <div className="w2-brk-legend">
          {coarse ? (
            <>
              tap the pad on the beat · <b className="w2-brk-lk-a">A</b>{' '}
              <b className="w2-brk-lk-b">B</b> = the round buttons
            </>
          ) : (
            <>
              <b>← ↑ → ↓</b> / <b>WASD</b> · <b className="w2-brk-lk-a">A</b> = <b>J</b> or{' '}
              <b>SPACE</b> · <b className="w2-brk-lk-b">B</b> = <b>K</b>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── judges' cards ───────────────────────────────────────────────────────

const CATS: [
  keyof Pick<JudgeCard, 'technique' | 'musicality' | 'originality' | 'power'>,
  string,
][] = [
  ['technique', 'TECHNIQUE'],
  ['musicality', 'MUSICALITY'],
  ['originality', 'ORIGINALITY'],
  ['power', 'POWER'],
];

function CardReveal({ s, card, round }: { s: BreakHudState; card: JudgeCard; round: number }) {
  const votes = cardVotes(card);
  const win: CrewId = votes[1] > votes[0] ? 1 : 0;
  return (
    <div className="w2-brk-reveal">
      <div className="w2-brk-reveal-kick">JUDGES · ROUND {round + 1}</div>
      <div className="w2-brk-cards">
        {card.votes
          .map((v, i) => ({ v, n: i + 1 }))
          .map(({ v, n }) => (
            <div
              key={`J${n}`}
              className="w2-brk-card"
              style={{
                ['--cc' as string]: s.crews[v].color,
                animationDelay: `${0.25 + (n - 1) * 0.45}s`,
              }}
            >
              <i>J{n}</i>
              <b>{v === 0 ? '◀' : '▶'}</b>
              <span>{s.crews[v].name}</span>
            </div>
          ))}
      </div>
      <table className="w2-brk-cats" style={{ animationDelay: '1.7s' }}>
        <tbody>
          {CATS.map(([k, label]) => (
            <tr key={k}>
              <td style={{ color: s.crews[0].color }}>{card[k][0]}</td>
              <th>{label}</th>
              <td style={{ color: s.crews[1].color }}>{card[k][1]}</td>
            </tr>
          ))}
          <tr className="w2-brk-cats-tot">
            <td style={{ color: s.crews[0].color }}>{cardTotal(card, 0)}</td>
            <th>
              {votes[0] === votes[1]
                ? 'SPLIT'
                : `${votes[win]}–${votes[1 - win]} ${s.crews[win].name}`}
            </th>
            <td style={{ color: s.crews[1].color }}>{cardTotal(card, 1)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── winner ──────────────────────────────────────────────────────────────

function Winner({
  s,
  onRematch,
  onLeave,
}: {
  s: BreakHudState;
  onRematch?: () => void;
  onLeave?: () => void;
}) {
  const w = s.winner;
  const tie = w === 'tie' || w === null;
  const col = tie ? '#fff' : s.crews[w].color;
  const mine = !tie && s.crews[w].dancers.some(d => d.local);
  const anyLocal = s.crews.some(c => c.dancers.some(d => d.local));
  const title = tie
    ? 'IT’S A DRAW'
    : anyLocal
      ? mine
        ? 'YOU WIN!'
        : 'YOU LOSE'
      : `${s.crews[w].name} WINS`;
  const rounds = s.cards.map((c, i) => ({ v: cardVotes(c), n: i + 1 }));
  return (
    <div className="w2-brk-final">
      <div className="w2-brk-final-card pointer-events-auto" style={{ ['--cc' as string]: col }}>
        <div className="w2-brk-final-kick">BATTLE OVER</div>
        <div className="w2-brk-final-title">{title}</div>
        {!tie && anyLocal && <div className="w2-brk-final-sub">{s.crews[w].name} TAKES IT</div>}
        <div className="w2-brk-final-score">
          <b style={{ color: s.crews[0].color }}>{s.crews[0].total}</b>
          <i>–</i>
          <b style={{ color: s.crews[1].color }}>{s.crews[1].total}</b>
        </div>
        {rounds.length > 0 && (
          <div className="w2-brk-final-rounds">
            {rounds.map(({ v, n }) => {
              const r: CrewId | null = v[0] === v[1] ? null : v[0] > v[1] ? 0 : 1;
              return (
                <span key={`R${n}`} style={{ background: r === null ? '#888' : s.crews[r].color }}>
                  R{n} {v[0]}–{v[1]}
                </span>
              );
            })}
          </div>
        )}
        {(onRematch !== undefined || onLeave !== undefined) && (
          <div className="w2-brk-final-btns">
            {onRematch !== undefined && (
              <button type="button" className="w2-brk-btn" onClick={onRematch}>
                RUN IT BACK
              </button>
            )}
            {onLeave !== undefined && (
              <button type="button" className="w2-brk-leave" onClick={onLeave}>
                leave the cypher
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── phone controls: arrows + A / B, big thumb targets ───────────────────

function Pad({
  onKey,
  onGesture,
  mini = false,
}: {
  onKey: (k: BreakKey) => void;
  onGesture?: () => void;
  /** Desktop: small, clickable with the mouse. */
  mini?: boolean;
}) {
  const [down, setDown] = useState<Partial<Record<BreakKey, boolean>>>({});
  const btn = (k: BreakKey, cls: string) => ({
    className: `w2-brk-pbtn ${cls} ${down[k] === true ? 'w2-brk-pdown' : ''}`,
    children: KEY_GLYPH[k],
    'aria-label': k,
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* a synthetic pointer: nothing to capture, the press still counts */
      }
      onGesture?.();
      onKey(k);
      setDown(d => ({ ...d, [k]: true }));
    },
    onPointerUp: () => setDown(d => ({ ...d, [k]: false })),
    onPointerCancel: () => setDown(d => ({ ...d, [k]: false })),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  return (
    <>
      <div className={`w2-brk-dpad pointer-events-auto ${mini ? 'w2-brk-mini' : ''}`}>
        <button type="button" {...btn('up', 'w2-brk-p-up')} />
        <button type="button" {...btn('left', 'w2-brk-p-left')} />
        <button type="button" {...btn('right', 'w2-brk-p-right')} />
        <button type="button" {...btn('down', 'w2-brk-p-down')} />
      </div>
      <div className={`w2-brk-ab pointer-events-auto ${mini ? 'w2-brk-mini w2-brk-mini-r' : ''}`}>
        <button type="button" {...btn('b', 'w2-brk-p-b')} />
        <button type="button" {...btn('a', 'w2-brk-p-a')} />
      </div>
    </>
  );
}

const F = "'Londrina Solid','Arial Black',Impact,system-ui,sans-serif";

const CSS = `
.w2-brk,.w2-brk *{font-family:${F} !important}
.w2-brk{--pad-h:0px}
.w2-brk-touch{--pad-h:150px}
.w2-brk-top{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:stretch;filter:drop-shadow(5px 5px 0 #000) drop-shadow(0 8px 18px rgba(0,0,0,.45))}
.w2-brk-crew{display:flex;align-items:center;gap:10px;background:#111;color:#fff;padding:4px 14px;border-bottom:5px solid var(--cc);transform:skewX(-8deg);transition:background .2s}
.w2-brk-crew-up{background:var(--cc)}
.w2-brk-crew-up .w2-brk-cname{color:#000}
.w2-brk-cname{font-size:clamp(11px,1.6vw,16px);letter-spacing:.06em;color:var(--cc);white-space:nowrap;max-width:28vw;overflow:hidden;text-overflow:ellipsis}
.w2-brk-total{font-size:clamp(24px,4vw,40px);line-height:1;min-width:1.6em;text-align:center;animation:w2bpop .45s cubic-bezier(.2,1.8,.4,1)}
.w2-brk-mid{display:flex;flex-direction:column;align-items:center;justify-content:center;background:#ffd400;color:#000;padding:3px 12px;min-width:92px;gap:2px;transform:skewX(-8deg)}
.w2-brk-round{font-size:12px;letter-spacing:.14em;white-space:nowrap}
.w2-brk-timer{width:76px;height:7px;background:rgba(0,0,0,.25);border:2px solid #000}
.w2-brk-timer-fill{height:100%;transform-origin:left;transform:scaleX(0)}
.w2-brk-bars{font-size:11px;letter-spacing:.1em;min-height:12px}
.w2-brk-up{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%) rotate(-2deg);background:var(--cc);color:#000;padding:2px 14px;font-size:clamp(14px,2.2vw,20px);letter-spacing:.08em;white-space:nowrap;box-shadow:4px 4px 0 #000;animation:w2bpop .5s cubic-bezier(.2,1.8,.4,1)}
@keyframes w2bpop{0%{transform:scale(1.8)}100%{transform:scale(1)}}
.w2-brk-song{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#000;color:#ffd400;font-size:13px;letter-spacing:.08em;padding:1px 10px;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis}
.w2-brk-up{animation:w2bslide .45s cubic-bezier(.2,1.6,.35,1)}
@keyframes w2bslide{from{opacity:0;transform:translateX(-50%) translateY(-12px) rotate(-6deg)}}
.w2-brk-banner{position:absolute;left:0;right:0;top:30%;display:flex;flex-direction:column;align-items:center;animation:w2bcall 1.9s cubic-bezier(.2,1.6,.35,1) forwards}
.w2-brk-banner b{font-size:clamp(44px,9vw,110px);font-style:italic;line-height:.9;color:#ffd400;text-shadow:0 6px 0 #d22209,0 12px 0 #000,0 0 40px rgba(0,0,0,.6);white-space:nowrap}
.w2-brk-banner span{margin-top:8px;background:#000;color:#fff;font-size:15px;letter-spacing:.2em;padding:3px 12px}
.w2-brk-t-white b{color:#fff}
.w2-brk-t-red b{color:#fff;text-shadow:0 6px 0 #ff2d6f,0 12px 0 #000}
.w2-brk-t-blue b{color:#fff;text-shadow:0 6px 0 #2fd4ff,0 12px 0 #000}
@keyframes w2bcall{0%{opacity:0;transform:scale(2.6) rotate(-4deg)}10%{opacity:1;transform:scale(.92) rotate(-2deg)}18%{transform:scale(1.04) rotate(-2deg)}80%{opacity:1;transform:scale(1.02) rotate(-2deg)}100%{opacity:0;transform:scale(1.1) rotate(-2deg) translateY(-20px)}}
.w2-brk-calls{position:absolute;right:4%;top:24%;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.w2-brk-call{display:flex;align-items:baseline;gap:8px;transform:rotate(-3deg);animation:w2bmove 1.8s cubic-bezier(.2,1.6,.35,1) forwards}
.w2-brk-call b{font-size:clamp(22px,3.6vw,40px);font-style:italic;background:#fff;color:#000;padding:2px 12px;box-shadow:5px 5px 0 #000;white-space:nowrap}
.w2-brk-call-big b{background:#ffd400;font-size:clamp(28px,4.8vw,56px);box-shadow:6px 6px 0 #d22209}
.w2-brk-call-bail b{background:#333;color:#ff6a55}
.w2-brk-call span{font-size:clamp(18px,2.6vw,28px);color:#3ddc84;text-shadow:0 3px 0 #000}
@keyframes w2bmove{0%{opacity:0;transform:translateX(40px) rotate(-3deg)}12%{opacity:1;transform:translateX(-6px) rotate(-3deg)}20%{transform:translateX(0) rotate(-3deg)}80%{opacity:1}100%{opacity:0;transform:translateY(-16px) rotate(-3deg)}}
.w2-brk-trackwrap{position:absolute;left:50%;bottom:calc(64px + var(--pad-h));transform:translateX(-50%);width:min(620px,94vw);display:flex;flex-direction:column;align-items:stretch}
.w2-brk-spect{opacity:.72;width:min(440px,80vw)}
.w2-brk-lane{position:relative;height:66px;background:linear-gradient(90deg,rgba(0,0,0,.72),rgba(0,0,0,.45));border:3px solid #fff;border-radius:40px;overflow:hidden;box-shadow:0 5px 0 #000}
.w2-brk-spect .w2-brk-lane{height:48px}
.w2-brk-hitline{position:absolute;left:calc(var(--hitx,46px) - 27px);top:5px;bottom:5px;width:54px;border-radius:50%;border:5px solid var(--cc);background:rgba(255,255,255,calc(.06 + .22*var(--pulse,0)));box-shadow:0 0 calc(6px + 22px*var(--pulse,0)) var(--cc),inset 0 0 calc(10px*var(--pulse,0)) #fff;transform:scale(calc(1 + .14*var(--pulse,0)));z-index:1;display:flex;align-items:center;justify-content:center}
.w2-brk-spect .w2-brk-hitline{width:40px;left:calc(var(--hitx,46px) - 20px)}
.w2-brk-hitlabel{position:absolute;left:calc(var(--hitx,46px) - 14px);bottom:-1px;font-size:9px;letter-spacing:.16em;color:var(--cc);z-index:2}
.w2-brk-press{font-size:30px;line-height:1;color:#fff;opacity:0;text-shadow:0 0 10px var(--cc),0 2px 0 #000}
.w2-brk-n-dead{background:#555 !important;color:#999 !important;border-color:#333 !important;box-shadow:none !important}
.w2-brk-n-miss{background:#2a1010 !important;color:#ff4a3d !important;border-color:#ff4a3d !important}
.w2-brk-nmiss{position:absolute;top:-7px;right:-14px;font-style:normal;font-size:11px;letter-spacing:.08em;color:#fff;background:#ff4a3d;border:2px solid #000;padding:0 4px;line-height:1.15;transform:rotate(8deg)}
.w2-brk-nlabel{position:absolute;bottom:100%;left:0;font-style:normal;font-size:9px;letter-spacing:.08em;color:#fff;white-space:nowrap;text-shadow:0 1px 0 #000;margin-bottom:1px}
.w2-brk-burst{position:absolute;left:0;top:50%;width:0;height:0;pointer-events:none;opacity:0;z-index:3;transform:translateX(var(--bx,46px))}
.w2-brk-burst i{position:absolute;left:-27px;top:-27px;width:54px;height:54px;border-radius:50%;border:5px solid var(--gc);font-style:normal;display:flex;align-items:center;justify-content:center;font-size:26px;color:var(--gc);box-shadow:0 0 18px var(--gc)}
.w2-brk-burst b{position:absolute;left:30px;top:-24px;font-size:22px;font-style:italic;color:var(--gc);-webkit-text-stroke:1.5px #000;paint-order:stroke fill;white-space:nowrap;text-shadow:0 3px 0 #000}
.w2-brk-burst span{position:absolute;left:32px;top:2px;font-size:12px;letter-spacing:.12em;background:#000;color:#fff;padding:0 5px;white-space:nowrap}
.w2-brk-burst-go{animation:w2bburst .62s ease-out forwards}
.w2-brk-burst-go i{animation:w2bring .62s ease-out forwards}
.w2-brk-burst-old b,.w2-brk-burst-old span{display:none}
@keyframes w2bburst{0%{opacity:1}70%{opacity:1}100%{opacity:0}}
@keyframes w2bring{0%{transform:scale(.7);background:var(--gc);color:#000}40%{transform:scale(1.45);background:transparent}100%{transform:scale(1.9);opacity:0}}
.w2-brk-forming{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);font-size:clamp(16px,2.4vw,22px);font-style:italic;color:#fff;background:rgba(0,0,0,.7);padding:0 12px;letter-spacing:.06em;white-space:nowrap;min-height:0}
.w2-brk-forming:empty{display:none}
.w2-brk-forming-done{color:#3ddc84}
.w2-brk-legend{margin-top:9px;align-self:center;font-size:clamp(11px,1.6vw,14px);letter-spacing:.06em;color:#fff;background:rgba(0,0,0,.6);padding:2px 10px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.w2-brk-legend b{font-weight:400;color:#ffd400}
.w2-brk-legend b.w2-brk-lk-a{color:#ff6a5d}
.w2-brk-legend b.w2-brk-lk-b{color:#5aa2ff}
/* Desktop: small, above the site's bottom bar and NOUN FM chip */
.w2-brk-mini{transform:scale(.6);transform-origin:bottom left;opacity:.85;bottom:120px !important}
.w2-brk-mini-r{transform-origin:bottom right}
.w2-brk-mini .w2-brk-pbtn{cursor:pointer}
.w2-brk-padtoggle{position:absolute;right:14px;bottom:218px;font-size:11px;letter-spacing:.06em;color:#fff;background:rgba(0,0,0,.55);padding:2px 8px;border-radius:999px}
.w2-brk-tick{position:absolute;top:10px;bottom:10px;left:0;width:2px;background:rgba(255,255,255,.18)}
.w2-brk-tick-down{background:rgba(255,212,0,.5);width:3px}
.w2-brk-note{position:absolute;left:0;top:50%;width:46px;height:46px;margin-left:-23px;border-radius:50%;align-items:center;justify-content:center;font-size:28px;line-height:1;color:#000;background:#fff;border:3px solid #000;box-shadow:0 3px 0 rgba(0,0,0,.6)}
.w2-brk-spect .w2-brk-note{width:34px;height:34px;margin-left:-17px;font-size:20px}
.w2-brk-k-a{background:#ff4a3d;color:#fff}
.w2-brk-k-b{background:#2f8bff;color:#fff}
.w2-brk-k-up,.w2-brk-k-down{background:#ffd400}
.w2-brk-grade{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);font-size:clamp(34px,6vw,64px);font-style:italic;-webkit-text-stroke:2px #000;paint-order:stroke fill;text-shadow:0 5px 0 #000;white-space:nowrap;animation:w2bgrade .7s cubic-bezier(.2,1.8,.4,1) forwards}
.w2-brk-spect .w2-brk-grade{font-size:clamp(22px,3.4vw,34px)}
@keyframes w2bgrade{0%{opacity:0;transform:translateX(-50%) scale(1.9)}15%{opacity:1;transform:translateX(-50%) scale(.95)}25%{transform:translateX(-50%) scale(1)}75%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-14px)}}
.w2-brk-combo{position:absolute;right:-6px;bottom:calc(100% + 4px);display:flex;flex-direction:column;align-items:center;transform:rotate(6deg);animation:w2bpop .35s cubic-bezier(.2,1.8,.4,1)}
.w2-brk-combo b{font-size:clamp(28px,4.4vw,46px);line-height:.9;color:#ffd400;text-shadow:0 4px 0 #000}
.w2-brk-combo span{font-size:12px;letter-spacing:.2em;background:#000;color:#fff;padding:1px 6px}
.w2-brk-score{position:absolute;left:-4px;bottom:calc(100% + 6px);font-size:clamp(18px,2.6vw,26px);background:#000;color:#fff;padding:1px 10px;transform:rotate(-4deg);box-shadow:3px 3px 0 var(--cc,#ffd400)}
.w2-brk-reveal{position:absolute;left:50%;top:11%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;width:min(560px,96vw);animation:w2bfade .35s ease-out}
@keyframes w2bfade{from{opacity:0}}
.w2-brk-reveal-kick{background:#000;color:#ffd400;font-size:14px;letter-spacing:.3em;padding:2px 12px}
.w2-brk-cards{display:flex;gap:clamp(8px,2vw,18px);perspective:600px}
.w2-brk-card{width:clamp(64px,11vw,96px);height:clamp(78px,13vw,112px);background:var(--cc);border:5px solid #fff;box-shadow:6px 6px 0 #000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;opacity:0;animation:w2bflip .55s cubic-bezier(.2,1.5,.4,1) forwards}
.w2-brk-card i{font-style:normal;font-size:12px;letter-spacing:.2em;background:#000;padding:0 6px}
.w2-brk-card b{font-size:clamp(34px,6vw,54px);line-height:1;text-shadow:0 3px 0 #000}
.w2-brk-card span{font-size:clamp(11px,1.7vw,15px);text-shadow:0 2px 0 #000;text-align:center;padding:0 4px}
@keyframes w2bflip{0%{opacity:0;transform:rotateY(90deg) translateY(30px)}100%{opacity:1;transform:rotateY(0) translateY(0)}}
.w2-brk-cats{background:#fff;color:#000;border-collapse:collapse;box-shadow:6px 6px 0 #000;opacity:0;animation:w2bfadein .4s ease-out forwards;font-size:clamp(13px,2vw,17px)}
@keyframes w2bfadein{to{opacity:1}}
.w2-brk-cats th{font-weight:400;letter-spacing:.14em;font-size:.78em;padding:3px 14px;background:#000;color:#fff;white-space:nowrap}
.w2-brk-cats td{padding:3px 14px;text-align:center;font-size:1.25em;-webkit-text-stroke:1px #000;paint-order:stroke fill}
.w2-brk-cats-tot th{background:#ffd400;color:#000}
.w2-brk-cats-tot td{font-size:1.5em}
.w2-brk-final{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 40%,rgba(30,20,50,.3),rgba(5,6,12,.78));animation:w2bfade .6s ease-out}
.w2-brk-final-card{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(600px,calc(100vw - 24px));padding:16px 22px 20px;background:#fff;color:#000;box-shadow:10px 10px 0 var(--cc),0 20px 60px rgba(0,0,0,.6);transform:rotate(-1.5deg);animation:w2bcard .7s cubic-bezier(.2,1.6,.35,1)}
@keyframes w2bcard{from{transform:rotate(-8deg) scale(.4);opacity:0}}
.w2-brk-final-kick{background:#000;color:#ffd400;font-size:14px;letter-spacing:.35em;padding:2px 12px}
.w2-brk-final-title{font-size:clamp(42px,9vw,90px);font-style:italic;line-height:.9;color:var(--cc);-webkit-text-stroke:3px #000;paint-order:stroke fill;text-shadow:0 6px 0 #000;text-align:center}
.w2-brk-final-sub{font-size:16px;letter-spacing:.2em}
.w2-brk-final-score{display:flex;gap:14px;align-items:center;font-size:clamp(34px,6vw,60px);line-height:1}
.w2-brk-final-score b{-webkit-text-stroke:2px #000;paint-order:stroke fill}
.w2-brk-final-score i{font-style:normal;color:#999}
.w2-brk-final-rounds{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.w2-brk-final-rounds span{color:#000;padding:2px 8px;font-size:14px;letter-spacing:.08em;border:2px solid #000}
.w2-brk-final-btns{display:flex;gap:14px;align-items:center;margin-top:8px}
.w2-brk-btn{background:#d22209;color:#fff;font-size:20px;padding:8px 18px;border:3px solid #000;box-shadow:4px 4px 0 #000}
.w2-brk-leave{color:#333;text-decoration:underline;font-size:15px}
.w2-brk-dpad{position:absolute;left:14px;bottom:14px;width:184px;height:184px;touch-action:none}
.w2-brk-ab{position:absolute;right:14px;bottom:18px;width:196px;height:150px;touch-action:none}
.w2-brk-pbtn{position:absolute;display:flex;align-items:center;justify-content:center;font-size:30px;color:#000;background:#fff;border:4px solid #000;border-radius:16px;box-shadow:0 6px 0 rgba(0,0,0,.6);touch-action:none;transition:transform .04s}
.w2-brk-pdown{transform:translateY(5px) scale(.95);box-shadow:0 1px 0 rgba(0,0,0,.6)}
.w2-brk-p-up{left:62px;top:0;width:62px;height:62px;background:#ffd400}
.w2-brk-p-down{left:62px;bottom:0;width:62px;height:62px;background:#ffd400}
.w2-brk-p-left{left:0;top:61px;width:62px;height:62px}
.w2-brk-p-right{right:0;top:61px;width:62px;height:62px}
.w2-brk-p-a{right:0;bottom:20px;width:94px;height:94px;border-radius:50%;background:#ff4a3d;color:#fff;font-size:36px}
.w2-brk-p-b{left:0;bottom:0;width:80px;height:80px;border-radius:50%;background:#2f8bff;color:#fff;font-size:32px}
.w2-brk-touch .w2-brk-calls{top:30%}
@media (max-width:640px){.w2-brk-top{top:6px}.w2-brk-calls{right:3%;top:22%}.w2-brk-reveal{top:13%}}
/* Narrow phones: the d-pad and A/B have to share 360-400 px */
@media (max-width:440px){.w2-brk-dpad{left:8px;bottom:12px;width:162px;height:162px}.w2-brk-p-up,.w2-brk-p-down{left:54px;width:54px;height:54px}.w2-brk-p-left,.w2-brk-p-right{top:54px;width:54px;height:54px}.w2-brk-ab{right:8px;width:168px;height:140px}.w2-brk-p-a{width:86px;height:86px}.w2-brk-p-b{width:66px;height:66px;bottom:2px}.w2-brk-touch{--pad-h:140px}}
@media (pointer:coarse){.w2-brk-top{top:46px}}
`;
