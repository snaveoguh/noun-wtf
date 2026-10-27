// ── NOUN PARKOUR HUD: route menu, countdown, timer + splits, results ─────

import type { CourseView } from './ParkourCourse';
import type { Game } from '../../Game';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { fmtDelta, fmtTime } from '../sim/route';

const OFF: CourseView | null = null;

function useCourse(game: Game | null): CourseView | null {
  return useSyncExternalStore(
    fn => (game === null ? () => {} : game.parkour.course.subscribe(fn)),
    () => (game === null ? OFF : game.parkour.course.view),
  );
}

/** A route is on (countdown / running / results). */
export function useParkourActive(game: Game | null): boolean {
  const v = useCourse(game);
  return v !== null && (v.phase === 'countdown' || v.phase === 'running' || v.phase === 'results');
}

/**
 * Touch pad labels on foot: JUMP, and the duck button by context (SLIDE
 * running, DROP hanging / on a pole, ROLL falling). Null on the board.
 */
export function useParkourLabels(game: Game): { jump: string; duck: string } | null {
  const read = () => {
    const p = game.player;
    if (p === undefined || p.mode !== 'foot') return null;
    const m = game.parkour.motor.move;
    const duck =
      m !== null && (m.k === 'hang' || m.k === 'pole' || m.k === 'wallrun' || m.k === 'wallup')
        ? 'DROP'
        : !p.footGrounded
          ? 'ROLL'
          : Math.hypot(p.vel.x, p.vel.z) > 4
            ? 'SLIDE'
            : 'DUCK';
    return { jump: 'JUMP', duck };
  };
  const [labels, set] = useState(read);
  useEffect(() => {
    const t = window.setInterval(() => {
      const n = read();
      set(o => (o?.duck === n?.duck && o?.jump === n?.jump ? o : n));
    }, 150);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);
  return labels;
}

const Stars = ({ n }: { n: number }) => (
  <span className="pk-stars" aria-label={`${n} of 3 stars`}>
    {[0, 1, 2].map(i => (
      <i key={i} className={i < n ? 'on' : ''}>
        ★
      </i>
    ))}
  </span>
);

const MEDAL: Record<string, string> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' };

export function ParkourUi({ game, touch }: { game: Game; touch: boolean }) {
  const v = useCourse(game);
  const [, tick] = useState(0);
  // K on foot: the route menu (K is only a trick key on the board)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyK' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
        return;
      const c = game.parkour.course;
      if (c.view.phase === 'menu') c.close();
      else if (c.view.phase === 'off' && game.player.mode === 'foot') c.open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);
  // Toasts and split flashes fade on their own clock
  useEffect(() => {
    if (v === null || v.phase !== 'running') return;
    const t = window.setInterval(() => tick(n => n + 1), 250);
    return () => window.clearInterval(t);
  }, [v?.phase, v]);
  if (v === null || v.phase === 'off') return null;
  const c = game.parkour.course;
  const now = performance.now();

  if (v.phase === 'menu')
    return (
      <div className="pk-ui pk-menu-wrap pointer-events-auto">
        <style>{CSS}</style>
        <div className="pk-menu">
          <button type="button" className="pk-x" onClick={() => c.close()} aria-label="close">
            ✕
          </button>
          <h2>NOUN PARKOUR</h2>
          <p className="pk-tag">RUN THE ROOFS · BEAT YOUR GHOST</p>
          <div className="pk-cards">
            {v.routes.map(r => (
              <button
                type="button"
                key={r.id}
                className="pk-card"
                style={{ '--rc': r.color } as React.CSSProperties}
                onClick={() => c.start(r.id)}
              >
                <b>{r.name}</b>
                <span className="pk-blurb">{r.blurb}</span>
                <span className="pk-row">
                  <Stars n={r.stars} />
                  <span>{r.best !== null ? fmtTime(r.best) : '—'}</span>
                </span>
                <span className="pk-medals">
                  <i className="g">{fmtTime(r.gold)}</i>
                  <i className="s">{fmtTime(r.silver)}</i>
                  <i className="b">{fmtTime(r.bronze)}</i>
                </span>
                <span className="pk-go">RUN ▸</span>
              </button>
            ))}
          </div>
          <p className="pk-help">
            {touch
              ? 'JUMP by walls to wall-run · JUMP at ledges and lamp posts · SLIDE while running'
              : 'SHIFT+SPACE by a wall: wall run · SPACE at a wall: run up it · Q: slide / roll / drop · R: restart'}
          </p>
        </div>
      </div>
    );

  const r = v.route;
  const split = v.split !== null && now - v.split.at < 2200 ? v.split : null;
  return (
    <div className="pk-ui pointer-events-none">
      <style>{CSS}</style>
      {v.phase === 'countdown' && (
        <div className="pk-count" key={Math.ceil(v.count)}>
          {Math.ceil(v.count) > 0 ? Math.ceil(v.count) : 'GO'}
        </div>
      )}
      {(v.phase === 'running' || v.phase === 'countdown') && r !== null && (
        <>
          <div className="pk-top" style={{ '--rc': r.color } as React.CSSProperties}>
            <span className="pk-name">{r.name}</span>
            <span className="pk-time">{fmtTime(v.time)}</span>
            <span className="pk-cp">
              {Math.min(v.next + 1, r.checkpoints)}/{r.checkpoints}
            </span>
          </div>
          {split !== null && (
            <div
              className={`pk-split ${split.delta === null ? '' : split.delta <= 0 ? 'ahead' : 'behind'}`}
            >
              {split.delta === null ? `CHECKPOINT ${split.i + 1}` : fmtDelta(split.delta)}
            </div>
          )}
          {v.phase === 'running' && (
            <div className="pk-next">
              <i style={{ transform: `rotate(${-v.bearing}rad)` }}>▲</i>
              <span>
                {Math.round(v.dist)} m{v.hint !== '' ? ` · ${v.hint}` : ''}
              </span>
            </div>
          )}
          <div className="pk-toasts">
            {v.toasts
              .filter(t => now - t.at < 1400)
              .map(t => (
                <b key={t.id}>{t.text}</b>
              ))}
          </div>
          <div className="pk-btns pointer-events-auto">
            <button type="button" onClick={() => c.restart()}>
              ↺ {touch ? '' : 'R'}
            </button>
            <button type="button" onClick={() => c.quit()}>
              QUIT
            </button>
          </div>
        </>
      )}
      {v.phase === 'results' && v.result !== null && r !== null && (
        <div className="pk-menu-wrap pointer-events-auto">
          <div className="pk-res" style={{ '--rc': r.color } as React.CSSProperties}>
            <span className="pk-name">{r.name}</span>
            <span className="pk-big">{fmtTime(v.result.time)}</span>
            <Stars n={v.result.stars} />
            <span className="pk-medal">
              {v.result.medal !== null ? MEDAL[v.result.medal] : `BRONZE IS ${fmtTime(r.bronze)}`}
            </span>
            {v.result.best && <span className="pk-pb">NEW BEST</span>}
            {!v.result.best && v.result.prev !== null && (
              <span className="pk-prev">
                best {fmtTime(v.result.prev)} ({fmtDelta(v.result.time - v.result.prev)})
              </span>
            )}
            <div className="pk-res-btns">
              <button type="button" onClick={() => c.restart()}>
                RETRY
              </button>
              <button type="button" onClick={() => c.quit()}>
                ROUTES
              </button>
              <button type="button" onClick={() => c.close()}>
                DONE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const F = "'Londrina Solid','Arial Black',Impact,system-ui,sans-serif";

const CSS = `
.pk-ui{position:absolute;inset:0;z-index:30}
.pk-ui,.pk-ui *{font-family:${F}}
.pk-menu-wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,6,12,.35);padding:16px}
.pk-menu{position:relative;background:#111;color:#fff;padding:18px 20px 14px;max-width:880px;width:100%;max-height:calc(100% - 24px);overflow:auto;box-shadow:8px 8px 0 #ff2f8e;border:3px solid #fff}
.pk-menu h2{margin:0;font-size:44px;line-height:1;letter-spacing:.02em;color:#fff;text-shadow:4px 4px 0 #ff2f8e,7px 7px 0 #20d6ff}
.pk-tag{margin:6px 0 14px;color:#ffd400;font-size:15px;letter-spacing:.12em}
.pk-x{position:absolute;top:10px;right:12px;background:none;border:0;color:#fff;font-size:22px;cursor:pointer}
.pk-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.pk-card{display:flex;flex-direction:column;gap:6px;text-align:left;background:#1c1f2a;color:#fff;border:3px solid var(--rc);padding:12px;cursor:pointer;box-shadow:5px 5px 0 var(--rc);transition:transform .12s}
.pk-card:hover,.pk-card:focus-visible{transform:translate(-2px,-2px);box-shadow:7px 7px 0 var(--rc)}
.pk-card b{font-size:24px;line-height:1;color:var(--rc)}
.pk-blurb{font-size:13px;opacity:.85;font-family:system-ui,sans-serif;line-height:1.3}
.pk-row{display:flex;justify-content:space-between;align-items:center;font-size:18px}
.pk-medals{display:flex;gap:8px;font-size:12px}
.pk-medals i{font-style:normal;padding:1px 6px;border-radius:3px;color:#111}
.pk-medals .g{background:#ffd400}.pk-medals .s{background:#d6dbe4}.pk-medals .b{background:#e0a46a}
.pk-go{align-self:flex-end;background:var(--rc);color:#111;padding:2px 10px;font-size:16px}
.pk-help{margin:12px 0 0;font:12px/1.4 system-ui,sans-serif;opacity:.65}
.pk-stars i{font-style:normal;color:#444;font-size:20px}.pk-stars i.on{color:#ffd400}
.pk-count{position:absolute;top:28%;left:50%;transform:translateX(-50%);font-size:140px;color:#ffd400;text-shadow:6px 6px 0 #000,10px 10px 0 #ff2f8e;animation:pkpop .9s ease-out both}
@keyframes pkpop{0%{transform:translateX(-50%) scale(1.6);opacity:0}20%{transform:translateX(-50%) scale(1);opacity:1}100%{opacity:.85}}
.pk-top{position:absolute;top:10px;left:50%;transform:translateX(-50%) skewX(-8deg);display:flex;align-items:center;gap:12px;background:#111;color:#fff;padding:4px 16px;border-bottom:5px solid var(--rc);filter:drop-shadow(5px 5px 0 #000)}
.pk-name{font-size:16px;color:var(--rc);letter-spacing:.05em}
.pk-time{font-size:34px;font-variant-numeric:tabular-nums;min-width:118px;text-align:center}
.pk-cp{font-size:18px;opacity:.85}
.pk-split{position:absolute;top:70px;left:50%;transform:translateX(-50%);font-size:30px;padding:2px 14px;background:#111;color:#fff;filter:drop-shadow(4px 4px 0 #000)}
.pk-split.ahead{color:#5dff7a}.pk-split.behind{color:#ff5470}
.pk-next{position:absolute;top:118px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;color:#fff;font-size:18px;text-shadow:2px 2px 0 #000;white-space:nowrap}
.pk-next i{font-style:normal;color:#ffd400;display:inline-block;font-size:22px}
.pk-toasts{position:absolute;bottom:34%;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px}
.pk-toasts b{font-size:30px;color:#fff;text-shadow:3px 3px 0 #ff2f8e,5px 5px 0 #000;animation:pktoast 1.4s ease-out both;font-weight:400}
@keyframes pktoast{0%{transform:scale(1.5);opacity:0}12%{transform:scale(1);opacity:1}75%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}
.pk-btns{position:absolute;top:10px;right:12px;display:flex;gap:6px}
.pk-btns button,.pk-res-btns button{background:#111;color:#fff;border:2px solid #fff;padding:4px 12px;font-size:16px;cursor:pointer}
.pk-res{display:flex;flex-direction:column;align-items:center;gap:6px;background:#111;color:#fff;padding:18px 28px;border:3px solid var(--rc);box-shadow:8px 8px 0 var(--rc);min-width:260px}
.pk-big{font-size:64px;line-height:1;font-variant-numeric:tabular-nums}
.pk-medal{font-size:22px;color:#ffd400}
.pk-pb{font-size:20px;background:#ff2f8e;color:#fff;padding:0 10px}
.pk-prev{font:14px system-ui,sans-serif;opacity:.8}
.pk-res-btns{display:flex;gap:8px;margin-top:8px}
@media (max-width:640px){
  .pk-menu{padding:14px 12px}.pk-menu h2{font-size:32px}
  .pk-top{top:6px;gap:8px;padding:2px 10px}.pk-time{font-size:26px;min-width:92px}.pk-name{display:none}
  .pk-btns{top:auto;bottom:calc(200px + env(safe-area-inset-bottom));right:10px}
  .pk-count{font-size:100px}
  .pk-toasts b{font-size:24px}
}
`;
