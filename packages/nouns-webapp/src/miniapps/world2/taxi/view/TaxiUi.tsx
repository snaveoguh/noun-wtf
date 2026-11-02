// ── NOUN TAXI HUD: the meter, the guide arrow, tips, receipts, results ────

import type { TaxiUi as TaxiUiState } from './TaxiSystem';
import type { Game } from '../../Game';

import { useSyncExternalStore } from 'react';

import { GRADE_LINE } from '../sim/pay';

const OFF: TaxiUiState | null = null;

function useTaxi(game: Game | null): TaxiUiState | null {
  return useSyncExternalStore(
    fn => (game === null ? () => {} : game.taxi.subscribe(fn)),
    () => (game === null ? OFF : game.taxi.ui),
  );
}

const clock = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t}`;
};

const dist = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`;

const BEST_NAME: Record<string, string> = {
  coin: 'MOST COIN',
  fares: 'MOST FARES',
  longest: 'LONGEST HAUL',
  bestChain: 'BIGGEST COMBO',
};

export function TaxiUi({ game, touch }: { game: Game; touch: boolean }) {
  const v = useTaxi(game);
  if (v === null || (!v.cab && v.results === null && v.hitch === null && v.chat === null))
    return null;
  const r = v.ride;
  const low = r !== null && r.kind === 'fare' && r.clock < 10;
  const chat = v.chat;
  const mute = (
    <button
      type="button"
      className="tx-mute pointer-events-auto"
      aria-pressed={v.chatMuted}
      aria-label={v.chatMuted ? 'Unmute cab chatter' : 'Mute cab chatter'}
      title={v.chatMuted ? 'chatter muted · tap to unmute' : 'mute the chatter'}
      onClick={() => game.taxi.chatter.setMuted(!v.chatMuted)}
    >
      {v.chatMuted ? '🔇' : '🗣'}
    </button>
  );
  return (
    <div className="tx-ui pointer-events-none" data-touch={touch ? '1' : '0'}>
      <style>{CSS}</style>
      {v.cab && (
        <div className={`tx-meter${low ? 'low' : ''}`}>
          {mute}
          <div className="tx-light">
            {r === null
              ? 'NOUN CAB · FOR HIRE'
              : r.kind === 'hitch'
                ? '👍 HITCHHIKER'
                : 'NOUN CAB · HIRED'}
          </div>
          {v.onShift && (
            <div className="tx-row">
              <span className="tx-k">SHIFT</span>
              <b className={`tx-clock${r === null && v.shiftClock < 10 ? 'hot' : ''}`}>
                {clock(v.shiftClock)}
              </b>
              {r !== null && r.kind === 'fare' && (
                <>
                  <span className="tx-k">FARE</span>
                  <b className={`tx-clock${low ? 'hot' : ''}`}>{clock(r.clock)}</b>
                </>
              )}
            </div>
          )}
          {r !== null ? (
            <>
              <div className="tx-dest">
                <i style={{ transform: `rotate(${-r.bearing}rad)` }}>▲</i>
                <span>
                  {r.icon} {r.dest}
                </span>
                <b>{r.arriving ? 'STOP HERE' : dist(r.left)}</b>
              </div>
              {r.kind === 'fare' && (
                <div className="tx-row tx-small">
                  <span>{r.name}</span>
                  <span>TIPS +{Math.round(r.tips)}</span>
                  {r.mult > 1 && <span className="tx-mult">×{r.mult}</span>}
                </div>
              )}
            </>
          ) : v.waiting.length > 0 ? (
            <div className="tx-wait">
              {v.waiting.slice(0, 2).map((w, i) => (
                <div key={i} className="tx-dest tx-small">
                  <i style={{ transform: `rotate(${-w.bearing}rad)` }}>▲</i>
                  <span>
                    🚕 {w.name} → {w.icon} {w.dest}
                  </span>
                  <b>{dist(w.d)}</b>
                </div>
              ))}
              <div className="tx-help">
                {touch
                  ? 'stop beside a fare to pick them up'
                  : 'stop beside a waving fare · they hop in'}
              </div>
            </div>
          ) : (
            <div className="tx-help">looking for fares… drive the ring road or into a town</div>
          )}
          {v.coin !== null && <div className="tx-coin">🪙 {v.coin}</div>}
        </div>
      )}
      {!v.cab && v.hitch !== null && v.hitch.d < 120 && (
        <div className="tx-meter tx-hint">
          👍 {v.hitch.name} wants a ride to {v.hitch.dest} · {Math.round(v.hitch.d)} m · stop beside
          them
        </div>
      )}
      {!v.cab && chat !== null && (
        <div className="tx-meter tx-mini">
          {mute}
          <span>🚕 {chat.name}</span>
        </div>
      )}
      {v.said !== null ? (
        <div className="tx-said" key={v.said.at}>
          <span>{v.said.name}</span> {v.said.text}
        </div>
      ) : chat !== null && chat.state === 'radio' ? (
        <div className="tx-said tx-quiet" data-chat="radio">
          📻 radio on · {chat.name} goes quiet
        </div>
      ) : chat !== null && !chat.muted && chat.text !== null ? (
        <div className="tx-said tx-chat" key={chat.at} data-chat="line">
          <span>{chat.name}</span> {chat.text}
          {chat.voice === 'loading' && <em>voice loading…</em>}
        </div>
      ) : null}
      <div className="tx-pops">
        {v.pops.map(p => (
          <b key={p.at} className={p.good ? '' : 'bad'}>
            {p.text}
          </b>
        ))}
      </div>
      {v.receipt !== null && (
        <div className="tx-receipt" key={v.receipt.at}>
          <div className="tx-grade">{v.receipt.kind === 'hitch' ? '👍' : v.receipt.grade}</div>
          <div>
            <b>
              {v.receipt.kind === 'hitch' ? 'THANKS FOR THE LIFT' : GRADE_LINE[v.receipt.grade]}
            </b>
            <div className="tx-small">
              FARE {v.receipt.fare}
              {v.receipt.speedTip > 0 && ` · SPEED +${v.receipt.speedTip}`}
              {v.receipt.styleTip > 0 && ` · STYLE +${v.receipt.styleTip}`}
            </div>
            <div className="tx-total">
              +{v.receipt.total} COIN{v.onShift ? ` · +${v.receipt.bonusTime}s` : ''}
            </div>
          </div>
        </div>
      )}
      {v.results !== null && (
        <div className="tx-res-wrap pointer-events-auto">
          <div className="tx-res">
            <div className="tx-title">SHIFT OVER</div>
            <div className="tx-big">🪙 {v.results.totals.coin}</div>
            <div className="tx-grid">
              <span>FARES</span>
              <b>{v.results.totals.fares}</b>
              <span>TIPS</span>
              <b>{v.results.totals.tips}</b>
              <span>DRIVEN WITH FARES</span>
              <b>{dist(v.results.totals.metres)}</b>
              <span>LONGEST HAUL</span>
              <b>{dist(v.results.totals.longest)}</b>
              <span>BEST COMBO</span>
              <b>×{v.results.totals.bestChain}</b>
              <span>LONGEST AIR</span>
              <b>{v.results.totals.longestAir.toFixed(1)}s</b>
              <span>TOP SPEED</span>
              <b>{v.results.totals.topKmh} km/h</b>
              <span>LOST FARES</span>
              <b>{v.results.totals.bails}</b>
            </div>
            {v.results.beat.length > 0 && (
              <div className="tx-pb">
                NEW BEST: {v.results.beat.map(b => BEST_NAME[b] ?? b).join(' · ')}
              </div>
            )}
            <div className="tx-small tx-bests">
              BESTS · 🪙 {v.results.bests.coin} · {v.results.bests.fares} fares ·{' '}
              {dist(v.results.bests.longest)} haul
            </div>
            <button type="button" onClick={() => game.taxi.dismiss()}>
              {v.cab ? 'BACK ON SHIFT ▸' : 'CLOSE'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.tx-ui{position:fixed;inset:0;z-index:31;font-family:system-ui,sans-serif;color:#fff}
.tx-meter{position:absolute;left:50%;transform:translateX(-50%);top:calc(64px + var(--w2-safe-top, env(safe-area-inset-top)));min-width:260px;max-width:min(380px,calc(100vw - 32px));padding:6px 12px 8px;border-radius:14px;background:rgba(14,12,6,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:2px solid #ffd400;box-shadow:0 3px 0 #b88a00}
.tx-meter.low{animation:txpulse .6s ease-in-out infinite alternate}
.tx-light{font:900 11px/1.2 system-ui,sans-serif;letter-spacing:.14em;color:#ffd400;text-align:center}
.tx-row{display:flex;align-items:baseline;justify-content:center;gap:8px;margin-top:3px}
.tx-k{font:800 9px/1 system-ui,sans-serif;letter-spacing:.12em;opacity:.7}
.tx-clock{font:900 24px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;min-width:44px;text-align:left}
.tx-clock.hot{color:#ff5d5d}
.tx-dest{display:flex;align-items:center;gap:8px;margin-top:4px;font:800 13px/1.2 system-ui,sans-serif}
.tx-dest i{font-style:normal;color:#3ee86a;font-size:18px;display:inline-block;transition:transform .12s linear}
.tx-dest span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tx-dest b{font-variant-numeric:tabular-nums;color:#ffd400}
.tx-small{font:700 11px/1.3 system-ui,sans-serif;opacity:.9}
.tx-row.tx-small{justify-content:space-between}
.tx-mult{color:#3ee86a;font-weight:900}
.tx-help{font:600 10px/1.3 system-ui,sans-serif;opacity:.65;text-align:center;margin-top:4px}
.tx-coin{position:absolute;right:8px;top:5px;font:800 10px/1 system-ui,sans-serif;opacity:.8}
.tx-mute{position:absolute;left:4px;top:2px;width:30px;height:24px;padding:0;border:0;border-radius:8px;background:transparent;font:16px/24px system-ui,sans-serif;cursor:pointer;color:#fff}
.tx-mute[aria-pressed="true"]{background:rgba(255,93,93,.25)}
.tx-mini{display:flex;align-items:center;justify-content:center;min-width:180px;padding:4px 12px 4px 38px;font:800 12px/24px system-ui,sans-serif}
.tx-mini .tx-mute{top:0}
.tx-chat{line-height:1.35}
.tx-chat em{display:block;font:600 10px/1.2 system-ui,sans-serif;opacity:.55;margin-top:2px}
.tx-quiet{background:rgba(14,12,6,.62);color:#ffd400;font-size:11px}
.tx-hint{font:700 12px/1.3 system-ui,sans-serif;text-align:center;border-color:#3ee86a;box-shadow:0 3px 0 #1e8a3c}
.tx-said{position:absolute;left:50%;transform:translateX(-50%);top:calc(178px + var(--w2-safe-top, env(safe-area-inset-top)));max-width:min(360px,calc(100vw - 32px));background:#fff;color:#111;border-radius:12px;padding:5px 10px;font:700 13px/1.3 system-ui,sans-serif;animation:txin .2s ease-out}
.tx-said span{font-weight:900;color:#c48f00;margin-right:4px}
.tx-pops{position:absolute;left:50%;top:30%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px}
.tx-pops b{font:900 italic 22px/1.1 system-ui,sans-serif;color:#ffd400;text-shadow:2px 2px 0 #b03a00;white-space:nowrap;animation:txpop .35s ease-out}
.tx-pops b.bad{color:#ff5d5d;text-shadow:2px 2px 0 #3a0a0a}
.tx-receipt{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(200px + env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;padding:8px 14px;border-radius:14px;background:rgba(14,12,6,.72);border:2px solid #ffd400;animation:txin .25s ease-out}
.tx-grade{font:900 italic 40px/1 system-ui,sans-serif;color:#ffd400;text-shadow:3px 3px 0 #b03a00}
.tx-total{font:900 18px/1.2 system-ui,sans-serif;color:#3ee86a}
.tx-res-wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}
.tx-res{width:min(360px,calc(100vw - 32px));padding:16px 18px;border-radius:18px;background:#16130a;border:3px solid #ffd400;box-shadow:0 5px 0 #b88a00;text-align:center}
.tx-title{font:900 italic 26px/1 system-ui,sans-serif;color:#ffd400;letter-spacing:.04em}
.tx-big{font:900 38px/1.2 system-ui,sans-serif;margin:6px 0}
.tx-grid{display:grid;grid-template-columns:1fr auto;gap:3px 12px;text-align:left;font:700 12px/1.3 system-ui,sans-serif}
.tx-grid span{opacity:.7}
.tx-pb{margin-top:8px;font:900 12px/1.3 system-ui,sans-serif;color:#3ee86a}
.tx-bests{margin-top:6px;opacity:.6}
.tx-res button{margin-top:12px;width:100%;padding:10px;border-radius:12px;border:0;background:#ffd400;color:#111;font:900 15px/1 system-ui,sans-serif;cursor:pointer}
@media (max-width:600px){
  .tx-meter{top:calc(96px + var(--w2-safe-top, env(safe-area-inset-top)));min-width:0;width:calc(100vw - 150px);max-width:300px;padding:4px 8px 6px}
  .tx-clock{font-size:19px}
  .tx-dest{font-size:12px}
  .tx-said{top:calc(196px + var(--w2-safe-top, env(safe-area-inset-top)));font-size:12px}
  .tx-pops b{font-size:17px}
  .tx-receipt{bottom:calc(250px + env(safe-area-inset-bottom))}
  .tx-coin{display:none}
}
@keyframes txpop{from{transform:scale(1.5);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes txin{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes txpulse{from{border-color:#ffd400}to{border-color:#ff5d5d}}
`;
