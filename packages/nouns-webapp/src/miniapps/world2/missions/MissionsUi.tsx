// ── Missions HUD: tracker, talk prompt, dialogue / journal panel, toasts ──
//
// The tracker is a `data-w2hud="missions"` block, so the settings cog's HUD
// toggle hides it. E (or a tap on the prompt) talks to whoever's in range,
// X opens the journal, Esc closes. While a panel is open the game takes no
// keys (MissionSystem.openPanel).

import type { Game } from '../Game';
import type { MissionSystem, Talkable } from './MissionSystem';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { MISSIONS, NPCS, TIER_NAMES, type MissionDef, type NpcId } from './defs';
import { DONE_LINE, GREETING, LOCKED_LINE, ORACLE_RIDDLES } from './dialogue';
import { progressOf, unlockedFor } from './progress';

function useMissions(sys: MissionSystem) {
  useSyncExternalStore(sys.subscribe, sys.getVersion);
  return sys;
}

/** Re-render every `ms` (timers, toasts fading). */
function useTick(ms: number, on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(id);
  }, [ms, on]);
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

const nameOf = (t: Talkable) => (t === 'door' ? 'the door' : NPCS[t].name);

export function MissionsUi({ game, touch }: { game: Game; touch: boolean }) {
  const sys = useMissions(game.missions);
  const [hidden, setHidden] = useState(false);
  const ticking = sys.parcel !== null || sys.race !== null || sys.toast !== null;
  useTick(250, ticking);

  // Keys: E talks, X journal, Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (game.showroom) return;
      if (sys.panel !== null) {
        if (e.code === 'Escape' || e.code === 'KeyX' || e.code === 'KeyE') {
          e.preventDefault();
          e.stopPropagation();
          sys.openPanel(null);
        }
        return;
      }
      if (e.code === 'KeyE' && sys.near !== null) {
        // Capture phase: the game's own E (board on/off) never sees it
        e.preventDefault();
        e.stopPropagation();
        sys.talk();
      } else if (e.code === 'KeyX') {
        e.preventDefault();
        sys.openPanel('journal');
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [game, sys]);

  const now = performance.now();
  const race = sys.raceView();
  const tracked = sys.tracked();
  const toMeet = sys.toMeet();
  const title =
    sys.state.title !== null ? MISSIONS.find(m => m.id === sys.state.title)?.reward : null;

  return (
    <>
      {/* Tracker */}
      <div
        data-w2hud="missions"
        className={`w2-mtrack pointer-events-auto absolute ${touch ? 'left-2 top-[92px] w-[200px]' : 'left-3 top-[30%] w-[250px]'}`}
      >
        <button type="button" className="w2-mhead" onClick={() => sys.openPanel('journal')}>
          <span>⌐◨-◨ MISSIONS</span>
          <i>{touch ? 'tap' : 'X'}</i>
        </button>
        <button
          type="button"
          className="w2-mfold"
          onClick={() => setHidden(h => !h)}
          aria-label={hidden ? 'Show missions' : 'Fold missions'}
        >
          {hidden ? '▸' : '▾'}
        </button>
        {!hidden && (
          <div className="w2-mlist">
            {title && <div className="w2-mtitle">“{title}”</div>}
            {sys.ud.active && <div className="w2-mud">⌀ the Upside Down — nothing here counts</div>}
            {sys.parcel !== null && (
              <div className="w2-mrow w2-mhot">
                📦 Parcel for Cap · {mmss((sys.parcel.until - now) / 1000)}
              </div>
            )}
            {tracked.slice(0, touch ? 2 : 4).map(m => (
              <TrackRow key={m.id} sys={sys} m={m} />
            ))}
            {toMeet.slice(0, touch ? 1 : 2).map(n => (
              <div key={n} className="w2-mrow w2-mmeet">
                Talk to <b>{NPCS[n].name}</b>
                <small>{NPCS[n].where}</small>
              </div>
            ))}
            {tracked.length === 0 && toMeet.length === 0 && (
              <div className="w2-mrow">All done. You are The One?</div>
            )}
          </div>
        )}
      </div>

      {/* The Upside Down note (also when the tracker's hidden) */}
      {sys.ud.active && (
        <div className="w2-udnote pointer-events-auto absolute left-1/2 top-[84px] -translate-x-1/2">
          ⌀ the Upside Down — nothing here counts
          <button type="button" onClick={() => sys.leaveUpsideDown()}>
            leave
          </button>
        </div>
      )}

      {/* Talk prompt */}
      {sys.near !== null && sys.panel === null && (
        <button
          type="button"
          className="w2-talk pointer-events-auto absolute left-1/2 top-[34%] -translate-x-1/2"
          onClick={() => sys.talk()}
        >
          {sys.near === 'door'
            ? sys.ud.active
              ? 'THE DOOR: GO BACK'
              : 'THE DEEPEST DOOR'
            : `TALK TO ${NPCS[sys.near].name.toUpperCase()}`}{' '}
          — {touch ? 'TAP' : 'E'}
        </button>
      )}

      {/* Race */}
      {race !== null && (
        <div className="w2-race pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2">
          {race.count > 0 ? (
            <b className="w2-racecount">{Math.ceil(race.count)}</b>
          ) : race.over ? (
            <b className="w2-racecount">{race.over.won ? 'YOU WIN' : 'TWINS WIN'}</b>
          ) : (
            <>
              <div>
                YOU <i style={{ width: `${(race.you / race.m) * 100}%` }} />
                <span>{(race.you / 1000).toFixed(2)} km</span>
              </div>
              <div>
                TWINS{' '}
                <i className="w2-racet" style={{ width: `${(race.twins / race.m) * 100}%` }} />
                <span>{(race.twins / 1000).toFixed(2)} km</span>
              </div>
            </>
          )}
          {race.count > 0 && <small>stay at the line… first to {race.m / 1000} km down</small>}
        </div>
      )}

      {/* Toast */}
      {sys.toast !== null && now - sys.toast.at < 5000 && (
        <div
          key={sys.toast.at}
          className={`w2-nowplaying w2-mtoast absolute left-1/2 top-40 -translate-x-1/2 ${sys.toast.kind === 'fail' ? 'w2-mfail' : ''}`}
        >
          <span>
            {sys.toast.kind === 'done'
              ? '⌐◨-◨ MISSION COMPLETE'
              : sys.toast.kind === 'fail'
                ? '⌐◨-◨ MISSION'
                : '⌐◨-◨ MISSIONS'}
          </span>
          <b>{sys.toast.title}</b>
          {sys.toast.reward && <span>title unlocked: “{sys.toast.reward}”</span>}
        </div>
      )}

      {sys.panel !== null && <Panel sys={sys} who={sys.panel} />}
    </>
  );
}

function TrackRow({ sys, m }: { sys: MissionSystem; m: MissionDef }) {
  const p = progressOf(sys.state, m);
  return (
    <div className="w2-mrow">
      <b>{m.title}</b>
      <small>{m.goal}</small>
      {p.label !== '' && (
        <div className="w2-mbar">
          <i style={{ width: `${Math.round(p.f * 100)}%` }} />
          <span>{p.label}</span>
        </div>
      )}
    </div>
  );
}

function Panel({ sys, who }: { sys: MissionSystem; who: Talkable | 'journal' }) {
  return (
    <div className="w2-mpanel-wrap pointer-events-auto absolute inset-0 z-40 flex items-center justify-center p-3">
      <div className="w2-panel w2-mpanel flex max-h-[86vh] w-[440px] max-w-full flex-col gap-2 overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div className="text-base font-bold">
            {who === 'journal' ? '⌐◨-◨ Missions journal' : nameOf(who)}
            {who !== 'journal' && who !== 'door' && (
              <span className="ml-2 text-xs opacity-60">
                Noun {NPCS[who].nouns.map(n => `#${n}`).join(' + ')}
              </span>
            )}
          </div>
          <button type="button" className="w2-chip text-xs" onClick={() => sys.openPanel(null)}>
            close ✕
          </button>
        </div>
        {who === 'journal' ? (
          <Journal sys={sys} />
        ) : who === 'door' ? (
          <Door sys={sys} />
        ) : (
          <Talk sys={sys} npc={who} />
        )}
      </div>
    </div>
  );
}

function MissionCard({ sys, m }: { sys: MissionSystem; m: MissionDef }) {
  const done = sys.state.done[m.id] !== undefined;
  const p = progressOf(sys.state, m);
  return (
    <div className={`w2-mcard ${done ? 'w2-mdone' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <b>
          {done ? '✓ ' : ''}
          {m.title}
        </b>
        <span className={`w2-mtier w2-mtier${m.tier}`}>{TIER_NAMES[m.tier]}</span>
      </div>
      <div className="w2-mflav">“{m.flavour}”</div>
      <div>{m.goal}</div>
      {!done && p.label !== '' && (
        <div className="w2-mbar">
          <i style={{ width: `${Math.round(p.f * 100)}%` }} />
          <span>{p.label}</span>
        </div>
      )}
      {m.obj.k === 'record' && !done && !sys.recordsLive() && (
        <div className="text-[11px] opacity-60">
          Records only save online, so this can’t finish here.
        </div>
      )}
      <div className="text-[11px] opacity-60">reward: title “{m.reward}”</div>
    </div>
  );
}

function Talk({ sys, npc }: { sys: MissionSystem; npc: NpcId }) {
  const s = sys.state;
  const met = s.met[npc] !== undefined;
  const open = unlockedFor(s, npc);
  const line = MISSIONS.filter(m => m.npc === npc);
  const [riddle, setRiddle] = useState(() => Math.floor(Math.random() * ORACLE_RIDDLES.length));
  const [plain, setPlain] = useState(false);
  const locked = open === null && line.some(m => s.done[m.id] === undefined);
  const r = ORACLE_RIDDLES[riddle % ORACLE_RIDDLES.length]!;

  return (
    <>
      <div className="w2-mline">
        {npc === 'oracle'
          ? met
            ? open === null
              ? DONE_LINE.oracle
              : 'Back again. Good. Here’s something to chew on with your cookie.'
            : GREETING.oracle
          : locked
            ? LOCKED_LINE[npc]
            : open === null
              ? DONE_LINE[npc]
              : GREETING[npc]}
      </div>
      {npc === 'oracle' && met && (
        <div className="w2-mriddle">
          <div>“{r.text}”</div>
          {plain && <div className="w2-mplain">{r.plain}</div>}
          <div className="mt-1 flex gap-2">
            <button type="button" className="w2-chip text-xs" onClick={() => setRiddle(n => n + 1)}>
              another riddle
            </button>
            <button type="button" className="w2-chip text-xs" onClick={() => setPlain(p => !p)}>
              {plain ? 'hide' : 'what does that mean?'}
            </button>
          </div>
        </div>
      )}
      {open !== null && <MissionCard sys={sys} m={open} />}
      {open !== null && !met && (
        <button type="button" className="w2-maccept" onClick={() => sys.accept(npc)}>
          {npc === 'oracle' ? 'Take a cookie — I’m in' : 'Accept'}
        </button>
      )}
      {open !== null && met && npc === 'courier' && open.obj.k === 'deliver' && (
        <button
          type="button"
          className="w2-maccept"
          disabled={sys.parcel !== null}
          onClick={() => sys.takeParcel()}
        >
          {sys.parcel !== null ? 'Parcel in hand: go!' : 'Take the parcel (the clock starts)'}
        </button>
      )}
      {open !== null && met && npc === 'twins' && open.obj.k === 'race' && (
        <button type="button" className="w2-maccept" onClick={() => sys.startRace()}>
          Line up: race the Twins
        </button>
      )}
      {npc === 'oracle' && met && <OracleSends sys={sys} />}
      {line.some(m => s.done[m.id] !== undefined) && (
        <div className="text-[11px] opacity-70">
          Done with {NPCS[npc].name}:{' '}
          {line
            .filter(m => s.done[m.id] !== undefined)
            .map(m => m.title)
            .join(' · ')}
        </div>
      )}
      <button
        type="button"
        className="w2-chip self-start text-xs"
        onClick={() => sys.openPanel('journal')}
      >
        missions journal (X)
      </button>
    </>
  );
}

/** The Oracle points you at the rest of the cast. */
function OracleSends({ sys }: { sys: MissionSystem }) {
  const who = sys.toMeet().filter(n => n !== 'oracle');
  if (sys.state.done['wake-up'] === undefined || who.length === 0) return null;
  return (
    <div className="w2-mline text-xs">
      Others are waiting for you:
      <ul className="mt-1 list-disc pl-4">
        {who.map(n => (
          <li key={n}>
            <b>{NPCS[n].name}</b>, {NPCS[n].where}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Door({ sys }: { sys: MissionSystem }) {
  if (sys.ud.active)
    return (
      <>
        <div className="w2-mline">The door hums. On the other side, your own sky.</div>
        <button type="button" className="w2-maccept" onClick={() => sys.throughDoor()}>
          Step back through
        </button>
      </>
    );
  if (!sys.doorOpen())
    return (
      <div className="w2-mline">
        A door with nothing behind it, and no handle. Locked. The Keymaker would know.
      </div>
    );
  return (
    <>
      <div className="w2-mline">
        The key fits. Beyond the door, the same bowl, the same hill, wrong. The ground barely holds
        you there, and nothing you do there counts.
      </div>
      <button type="button" className="w2-maccept w2-mud" onClick={() => sys.throughDoor()}>
        Step through into the Upside Down
      </button>
    </>
  );
}

function Journal({ sys }: { sys: MissionSystem }) {
  const s = sys.state;
  const npcs = Object.keys(NPCS) as NpcId[];
  const earned = MISSIONS.filter(m => s.done[m.id] !== undefined);
  const count = earned.length;
  return (
    <>
      <div className="text-xs opacity-70">
        {count} / {MISSIONS.length} done. Talk to the characters to take their missions; the Oracle
        by the fountain starts it all.
        {!sys.recordsLive() && ' Offline: record missions (speed, hang time) can’t finish here.'}
      </div>
      {earned.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          Title:
          <button
            type="button"
            className={`w2-chip text-xs ${s.title === null ? 'w2-on' : ''}`}
            onClick={() => sys.setTitle(null)}
          >
            none
          </button>
          {earned.map(m => (
            <button
              key={m.id}
              type="button"
              className={`w2-chip text-xs ${s.title === m.id ? 'w2-on' : ''}`}
              onClick={() => sys.setTitle(m.id)}
            >
              {m.reward}
            </button>
          ))}
        </div>
      )}
      {npcs.map(n => {
        const line = MISSIONS.filter(m => m.npc === n);
        const seen =
          s.met[n] !== undefined ||
          line.some(m => s.done[m.id] !== undefined || unlockedFor(s, n) === m);
        if (!seen) return null;
        return (
          <div key={n} className="w2-mnpc">
            <div className="text-sm font-bold">
              {NPCS[n].name}{' '}
              <span className="text-[11px] font-normal opacity-60">
                Noun {NPCS[n].nouns.map(x => `#${x}`).join(' + ')} · {NPCS[n].where}
              </span>
            </div>
            {s.met[n] === undefined ? (
              <div className="text-xs opacity-80">Go and talk to them.</div>
            ) : (
              line
                .filter(m => s.done[m.id] !== undefined || unlockedFor(s, n) === m)
                .map(m => <MissionCard key={m.id} sys={sys} m={m} />)
            )}
          </div>
        );
      })}
    </>
  );
}

export const MISSIONS_CSS = `
.w2-npctag i{font-style:normal;font-size:9px;opacity:.65;letter-spacing:.04em;margin-left:4px}
.w2-npctag span{border:1px solid rgba(255,212,0,.45)}
.w2-npcbang{color:#ffd400;font-size:14px}
.w2-mtrack{font-family:system-ui,sans-serif;font-size:12px;background:rgba(10,12,20,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:6px 8px;color:#fff}
.w2-mhead{display:flex;justify-content:space-between;width:calc(100% - 22px);font-weight:800;letter-spacing:.08em;font-size:11px;color:#ffd400}
.w2-mhead i{font-style:normal;opacity:.6;font-weight:400;border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:0 4px}
.w2-mfold{position:absolute;right:8px;top:4px;opacity:.7}
.w2-mlist{display:flex;flex-direction:column;gap:6px;margin-top:4px}
.w2-mrow{display:flex;flex-direction:column;gap:1px;line-height:1.25}
.w2-mrow small{opacity:.7;font-size:10.5px}
.w2-mhot{color:#ffd400;font-weight:700}
.w2-mmeet b{color:#ffd400}
.w2-mtitle{font-style:italic;color:#ffd400;font-size:11px}
.w2-mbar{position:relative;height:14px;background:rgba(255,255,255,.12);border-radius:4px;overflow:hidden;margin-top:2px}
.w2-mbar i{position:absolute;left:0;top:0;bottom:0;background:#3ddc84}
.w2-mbar span{position:relative;font-size:10px;padding-left:4px;line-height:14px;text-shadow:0 1px 1px #000}
.w2-mud{color:#ff6b6b}
.w2-udnote{font-family:system-ui,sans-serif;font-size:12px;background:rgba(30,0,4,.75);border:1px solid #c81d25;color:#ffb3b3;border-radius:999px;padding:4px 6px 4px 12px;display:flex;gap:8px;align-items:center;white-space:nowrap}
.w2-udnote button{background:#c81d25;color:#fff;border-radius:999px;padding:1px 10px}
.w2-talk{background:#ffd400;color:#000;padding:10px 18px;font-size:17px;font-weight:900;font-style:italic;box-shadow:6px 6px 0 #d22209;font-family:system-ui,sans-serif;white-space:nowrap}
.w2-mpanel{color:#fff;font-size:13px;line-height:1.4}
.w2-mline{background:rgba(255,255,255,.06);border-radius:10px;padding:8px 10px}
.w2-mriddle{border-left:3px solid #ffd400;padding:4px 10px;font-style:italic}
.w2-mplain{font-style:normal;font-size:12px;opacity:.8;margin-top:4px}
.w2-mcard{border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:3px}
.w2-mdone{opacity:.6}
.w2-mflav{font-style:italic;opacity:.8;font-size:12px}
.w2-mtier{font-size:10px;letter-spacing:.1em;text-transform:uppercase;border-radius:4px;padding:0 5px}
.w2-mtier1{background:#2b6;color:#000}.w2-mtier2{background:#28f;color:#fff}.w2-mtier3{background:#f80;color:#000}.w2-mtier4{background:#ffd400;color:#000;box-shadow:0 0 10px #ffd400}
.w2-maccept{background:#ffd400;color:#000;font-weight:900;font-style:italic;padding:8px 14px;box-shadow:4px 4px 0 #d22209;align-self:flex-start}
.w2-maccept:disabled{opacity:.6}
.w2-maccept.w2-mud{background:#c81d25;color:#fff;box-shadow:4px 4px 0 #300}
.w2-mnpc{display:flex;flex-direction:column;gap:6px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px}
.w2-race{font-family:system-ui,sans-serif;background:rgba(10,12,20,.7);border-radius:12px;padding:8px 12px;min-width:240px;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#fff;align-items:stretch;text-align:center}
.w2-race div{position:relative;display:flex;align-items:center;gap:6px;text-align:left}
.w2-race div i{display:block;height:8px;background:#3ddc84;border-radius:4px;min-width:2px}
.w2-race div i.w2-racet{background:#ff638d}
.w2-race div span{margin-left:auto;font-variant-numeric:tabular-nums}
.w2-racecount{font-size:42px;font-style:italic;color:#ffd400}
.w2-mtoast{z-index:30}
.w2-mfail{background:#fff;box-shadow:6px 6px 0 #555}
`;
