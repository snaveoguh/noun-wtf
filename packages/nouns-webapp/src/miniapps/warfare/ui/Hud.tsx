// ── In-match HUD: crosshair, hit markers, ammo/health, feed, callouts,
//    damage arcs, screen paint, scores, zones, death + round overlays ──

import type { HudState, WarfareGame } from '../client/WarfareGame';

import { teamHex } from '../client/WarfareGame';
import { MODES, scoreLabel } from '../sim/modes';
import { TEAM_NAMES } from '../sim/types';
import { WEAPONS } from '../sim/weapons';

import { useHud } from './useHud';

const fmtTime = (s: number) => {
  if (!Number.isFinite(s)) return '--:--';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

export function Hud({
  game,
  onLeave,
  onLobby,
  onAgain,
}: {
  game: WarfareGame;
  onLeave: () => void;
  onLobby: () => void;
  onAgain: () => void;
}) {
  const h = useHud(game);
  if (h.phase !== 'play' && h.phase !== 'results') return null;
  const w = WEAPONS[h.weapon];
  const teams = MODES[h.mode].teams;
  const now = h.now;
  const sniperScope = h.scoped && h.weapon === 'longsplat';
  const hitAge = now - h.hit.t;
  const lowHp = h.alive && h.hp < 40;

  return (
    <div className="wf-hud" data-testid="wf-hud">
      {/* Scope */}
      {sniperScope && (
        <div className="wf-scope">
          <i style={{ left: 0, right: 0, top: '50%', height: 2, marginTop: -1 }} />
          <i style={{ top: 0, bottom: 0, left: '50%', width: 2, marginLeft: -1 }} />
        </div>
      )}
      {/* Low-health paint vignette */}
      <div className="wf-vignette" style={{ opacity: lowHp ? 0.45 + (40 - h.hp) / 80 : 0 }} />
      {/* Paint on the visor */}
      {h.screenPaint.map(s => (
        <div
          key={s.id}
          className="wf-paint"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.r}vmin`,
            height: `${s.r * 0.9}vmin`,
            marginLeft: `${-s.r / 2}vmin`,
            marginTop: `${-s.r / 2}vmin`,
            background: s.color,
          }}
        />
      ))}

      {/* Crosshair */}
      {h.alive && !sniperScope && h.matchPhase !== 'matchEnd' && (
        <div className="wf-cross">
          <div className="wf-dot" />
          {h.weapon !== 'launcher' && (
            <>
              <i style={{ left: -1, top: -h.spread - 8, width: 2, height: 7 }} />
              <i style={{ left: -1, top: h.spread + 1, width: 2, height: 7 }} />
              <i style={{ top: -1, left: -h.spread - 8, height: 2, width: 7 }} />
              <i style={{ top: -1, left: h.spread + 1, height: 2, width: 7 }} />
            </>
          )}
          {h.weapon === 'launcher' && (
            <i
              style={{
                left: -14,
                top: 10,
                width: 28,
                height: 2,
                background: 'transparent',
                borderBottom: '2px solid #fff',
              }}
            />
          )}
        </div>
      )}
      {hitAge < 0.25 && (
        <div
          key={h.hit.t}
          className={`wf-hitmark ${h.hit.kill ? 'kill' : ''} ${h.hit.head ? 'head' : ''}`}
        >
          {[45, 135, 225, 315].map(a => (
            <i key={a} style={{ transform: `rotate(${a}deg) translateY(-11px)` }} />
          ))}
        </div>
      )}
      {h.hit.kill && hitAge < 0.9 && (
        <div key={`k${h.hit.t}`} className="wf-killpop">
          {h.hit.head ? 'NOGGLE SPLAT!' : 'SPLAT!'}
        </div>
      )}
      {/* Damage direction */}
      {h.dmgDirs.map(d => (
        <div key={d.id} className="wf-dmg" style={{ transform: `rotate(${d.angle}rad)` }}>
          <i />
        </div>
      ))}

      {/* Top: scores / clock / zones */}
      <div className="wf-top">
        {teams ? (
          <>
            <div
              className="wf-score"
              style={{ background: teamHex(0), outline: h.myTeam === 0 ? '3px solid #ffd400' : '' }}
            >
              {h.scores[0]}
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="wf-clock">{fmtTime(h.timeLeft)}</div>
              <div
                className="text-[10px] tracking-[0.2em] opacity-80"
                style={{ fontFamily: 'system-ui' }}
              >
                {h.mode === 'elim'
                  ? `ROUND ${h.round} · FIRST TO ${h.target}`
                  : `${scoreLabel(h.mode)} TO ${h.target}`}
              </div>
            </div>
            <div
              className="wf-score"
              style={{ background: teamHex(1), outline: h.myTeam === 1 ? '3px solid #ffd400' : '' }}
            >
              {h.scores[1]}
            </div>
          </>
        ) : (
          <>
            <div className="wf-score" style={{ background: '#2b2f3a' }}>
              {h.myKills}
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="wf-clock">{fmtTime(h.timeLeft)}</div>
              <div
                className="text-[10px] tracking-[0.2em] opacity-80"
                style={{ fontFamily: 'system-ui' }}
              >
                FIRST TO {h.target}
              </div>
            </div>
            <div
              className="wf-score"
              style={{ background: h.ffaLead?.color ?? '#2b2f3a', fontSize: 16 }}
            >
              {h.ffaLead !== null ? `${h.ffaLead.name} ${h.ffaLead.kills}` : '-'}
            </div>
          </>
        )}
      </div>
      {h.zones.length > 0 && (
        <div className="absolute left-1/2 top-[74px] flex -translate-x-1/2 gap-2">
          {h.zones.map(z => {
            const fill = Math.abs(z.progress);
            const col = z.progress < 0 ? teamHex(0) : teamHex(1);
            return (
              <div
                key={z.id}
                className={`wf-zone ${z.contested ? 'contested' : ''}`}
                style={{ borderColor: z.owner === -1 ? '#fff' : teamHex(z.owner) }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: `${fill * 100}%`,
                    background: col,
                    opacity: z.owner === -1 ? 0.6 : 1,
                  }}
                />
                <span style={{ position: 'relative', textShadow: '0 1px 2px #000' }}>{z.id}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Kill feed */}
      <div className="wf-feed" data-testid="wf-feed">
        {h.feed.map(f => (
          <div key={f.id} className={f.mine ? 'mine' : ''}>
            {f.killer !== '' && <span style={{ color: f.kc }}>{f.killer}</span>}
            <em>
              {f.killer !== '' ? 'splatted' : ''} {f.head ? '⌐◨-◨' : ''}
            </em>
            <span style={{ color: f.vc }}>{f.victim}</span>
            <em>{f.killer !== '' ? `with ${f.weapon}` : f.weapon}</em>
          </div>
        ))}
      </div>

      {/* Centre: countdown, banners, callouts */}
      <div className="wf-center">
        {h.matchPhase === 'countdown' && h.countdown > 0 && (
          <>
            <div className="wf-count" key={Math.ceil(h.countdown)}>
              {Math.ceil(h.countdown)}
            </div>
            <div className="wf-sticker">
              {MODES[h.mode].name.toUpperCase()}
              {h.mode === 'elim' ? ` · ROUND ${h.round}` : ''}
            </div>
          </>
        )}
        {h.banner !== null && (
          <div
            key={h.banner.id}
            className="wf-banner"
            style={{
              background: h.banner.color === '#ffffff' ? '#ffd400' : h.banner.color,
              color: h.banner.color === '#ffffff' ? '#000' : '#fff',
            }}
          >
            <b>{h.banner.text}</b>
            <span>{h.banner.sub}</span>
          </div>
        )}
      </div>
      <div className="absolute left-1/2 top-[58%] flex -translate-x-1/2 flex-col items-center gap-1">
        {h.callouts.map(c => (
          <div key={c.id} className={`wf-callout t${c.tier}`}>
            {c.text}
          </div>
        ))}
      </div>

      {/* Health */}
      {h.alive && (
        <div className="wf-hp">
          <div className="wf-hpnum" style={{ color: lowHp ? '#ff5a4a' : '#fff' }}>
            {h.hp}
          </div>
          <div className="flex flex-col gap-1 pb-1">
            <div
              className="text-[10px] tracking-[0.25em] opacity-70"
              style={{ fontFamily: 'system-ui' }}
            >
              PAINT-FREE
            </div>
            <div className="wf-hpbar">
              <i
                style={{
                  width: `${h.hp}%`,
                  background: lowHp ? '#ff5a4a' : 'linear-gradient(90deg,#3ddc84,#c9ff6a)',
                }}
              />
            </div>
          </div>
        </div>
      )}
      {h.alive && h.protectedFor > 0.05 && <div className="wf-protect">SPAWN SHIELD</div>}

      {/* Ammo */}
      {h.alive && (
        <div className="wf-ammo">
          <div className="text-sm opacity-80">{w.name}</div>
          <div className="wf-ammonum">
            {h.reload > 0 ? (
              <span style={{ fontSize: 26 }}>RELOADING</span>
            ) : (
              <>
                {h.mag}
                <small> / {h.magSize}</small>
              </>
            )}
          </div>
          {h.reload > 0 && (
            <div className="wf-bar ml-auto mt-1 w-40">
              <i style={{ width: `${Math.min(100, h.reload * 100)}%` }} />
            </div>
          )}
          <div className="mt-1 text-sm">
            {'●'.repeat(h.grenades)}
            <span className="opacity-30">{'●'.repeat(Math.max(0, 2 - h.grenades))}</span>{' '}
            <span className="text-xs opacity-70">GRENADE</span>
          </div>
          <div className="wf-slots">
            {h.weapons.map(id => (
              <div key={id} className={`wf-slot ${id === h.weapon ? 'on' : ''}`}>
                {WEAPONS[id].key} {WEAPONS[id].short}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dead */}
      {!h.alive && h.matchPhase !== 'matchEnd' && (
        <div className="wf-dead">
          <b>SPLATTED</b>
          {h.killer !== null && (
            <div className="mt-2 text-xl">
              by <span style={{ color: h.killer.color }}>{h.killer.name}</span>{' '}
              <span className="opacity-70">with {h.killer.weapon}</span>
            </div>
          )}
          <div className="mt-2 text-lg opacity-90">
            {Number.isFinite(h.respawnIn)
              ? `back in ${Math.max(0, h.respawnIn).toFixed(1)}`
              : 'out until next round · spectating'}
          </div>
        </div>
      )}

      {/* Scoreboard */}
      {(h.showBoard || h.phase === 'results') && <Scoreboard h={h} />}

      {/* Paused */}
      {h.paused && h.phase === 'play' && (
        <div className="wf-overlay" data-testid="wf-paused">
          <div className="wf-title" style={{ fontSize: 'clamp(40px,7vw,80px)' }}>
            PAUSED
          </div>
          <button type="button" className="wf-btn wf-pulse" onClick={() => game.resume()}>
            {h.matchPhase === 'countdown' && h.round === 1 ? 'CLICK TO LOCK AIM' : 'BACK IN ⌐◨-◨'}
          </button>
          <button type="button" className="wf-btn alt sm" onClick={onLeave}>
            LEAVE MATCH
          </button>
        </div>
      )}

      {/* Results */}
      {h.phase === 'results' && h.results !== null && (
        <div
          className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="wf-banner" style={{ animation: 'none' }}>
            <b>{h.results.winner}</b>
            <span>{h.results.won ? 'YOU WON' : h.results.draw ? 'DRAW' : 'GOOD GAME'}</span>
          </div>
          <div className="wf-panel min-w-[260px] text-sm" style={{ fontFamily: 'system-ui' }}>
            {h.results.rep.lines.map(l => (
              <div key={l.label} className="flex justify-between gap-6">
                <span className="opacity-80">{l.label}</span>
                <b className="text-[#ffd400]">+{l.rep}</b>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-white/20 pt-1 text-base">
              <span>REP</span>
              <b className="text-[#ffd400]">+{h.results.rep.total}</b>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" className="wf-btn" onClick={onAgain} data-testid="wf-again">
              AGAIN
            </button>
            <button type="button" className="wf-btn alt" onClick={onLobby}>
              LOBBY
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Scoreboard({ h }: { h: HudState }) {
  const teams = MODES[h.mode].teams;
  const groups = teams ? [0, 1] : [-1];
  return (
    <div className="wf-board wf-panel" data-testid="wf-board">
      <div className="mb-2 flex items-center justify-between">
        <b className="text-2xl italic">{MODES[h.mode].name}</b>
        <span className="text-sm opacity-70">
          {teams ? `${h.scores[0]} — ${h.scores[1]}` : `first to ${h.target}`}
        </span>
      </div>
      {groups.map(g => (
        <table key={g} className="mb-2">
          <thead>
            <tr style={{ color: g >= 0 ? teamHex(g) : '#ffd400' }}>
              <th>{g >= 0 ? TEAM_NAMES[g as 0 | 1] : 'EVERY NOUN'}</th>
              <th>SPLATS</th>
              <th>OUTS</th>
              <th>ASSISTS</th>
              <th>SCORE</th>
            </tr>
          </thead>
          <tbody>
            {h.rows
              .filter(r => (g === -1 ? true : r.team === g))
              .map(r => (
                <tr key={r.id} className={`${r.me ? 'me' : ''} ${r.alive ? '' : 'dead'}`}>
                  <td>
                    <span style={{ color: r.color }}>■</span> {r.name}
                    {r.bot ? <span className="opacity-50"> bot</span> : null}
                  </td>
                  <td>{r.kills}</td>
                  <td>{r.deaths}</td>
                  <td>{r.assists}</td>
                  <td>{r.score + r.kills * 10}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
