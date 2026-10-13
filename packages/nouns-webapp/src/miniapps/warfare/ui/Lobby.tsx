// ── Lobby: pick a mode, map, crew size and bot skill over a live flyover ──

import type { Difficulty, MapId, ModeId, TeamSize } from '../sim/types';

import { useEffect } from 'react';

import { MAPS, MAP_ORDER } from '../sim/maps';
import { MODES, MODE_ORDER } from '../sim/modes';
import { LEVEL_TITLES, levelProgress, type Profile } from '../sim/progression';
import { WEAPONS, WEAPON_ORDER } from '../sim/weapons';

export interface LobbyChoice {
  mode: ModeId;
  map: MapId;
  size: TeamSize;
  difficulty: Difficulty;
}

const SIZES: TeamSize[] = [2, 4, 6];
const DIFFS: { d: Difficulty; label: string }[] = [
  { d: 0, label: 'CHILL' },
  { d: 1, label: 'NORMAL' },
  { d: 2, label: 'SWEATY' },
];

const KEYS: [string, string][] = [
  ['WASD', 'move'],
  ['MOUSE', 'aim (click to lock)'],
  ['LMB / RMB', 'fire / scope'],
  ['SPACE', 'jump'],
  ['SHIFT', 'sprint'],
  ['CTRL / C', 'crouch (hold / toggle)'],
  ['R', 'reload'],
  ['G', 'paint grenade'],
  ['1-5 / WHEEL / Q', 'blasters / last blaster'],
  ['V', 'third person'],
  ['TAB', 'scoreboard'],
  ['ESC', 'pause'],
];

export function Lobby({
  choice,
  onChange,
  onStart,
  profile,
  name,
  ready,
  sensitivity,
  onSensitivity,
  touch,
}: {
  choice: LobbyChoice;
  onChange: (c: LobbyChoice) => void;
  onStart: () => void;
  profile: Profile;
  name: string;
  ready: boolean;
  sensitivity: number;
  onSensitivity: (v: number) => void;
  touch: boolean;
}) {
  const lp = levelProgress(profile.rep);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && ready) onStart();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [ready, onStart]);
  const set = (p: Partial<LobbyChoice>) => onChange({ ...choice, ...p });
  return (
    <div className="wf-lobby" data-testid="wf-lobby">
      <div className="wf-lobby-inner">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="wf-title">
            NOUN<span>WARFARE</span>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="wf-sticker">PAINTBALL ⌐◨-◨ NO BLOOD, ALL SPLAT</div>
            <div className="wf-chip text-sm">
              playing as <b className="text-[#ffd400]">{name}</b>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-4">
            <div className="wf-panel">
              <div className="wf-h">MODE</div>
              <div className="wf-cards grid-cols-2">
                {MODE_ORDER.map(m => (
                  <button
                    type="button"
                    key={m}
                    className={`wf-card ${choice.mode === m ? 'on' : ''}`}
                    onClick={() => set({ mode: m })}
                    data-testid={`wf-mode-${m}`}
                  >
                    <b>{MODES[m].name}</b>
                    <small>{MODES[m].blurb}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="wf-panel">
              <div className="wf-h">MAP</div>
              <div className="wf-cards grid-cols-2">
                {MAP_ORDER.map(m => (
                  <button
                    type="button"
                    key={m}
                    className={`wf-card ${choice.map === m ? 'on' : ''}`}
                    onClick={() => set({ map: m })}
                    data-testid={`wf-map-${m}`}
                  >
                    <b>{MAPS[m].name}</b>
                    <small>{MAPS[m].blurb}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="wf-panel">
                <div className="wf-h">{choice.mode === 'ffa' ? 'PLAYERS' : 'CREW SIZE'}</div>
                <div className="wf-seg">
                  {SIZES.map(s => (
                    <button
                      type="button"
                      key={s}
                      className={choice.size === s ? 'on' : ''}
                      onClick={() => set({ size: s })}
                    >
                      {choice.mode === 'ffa' ? `${s * 2}` : `${s}v${s}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="wf-panel">
                <div className="wf-h">BOTS</div>
                <div className="wf-seg">
                  {DIFFS.map(({ d, label }) => (
                    <button
                      type="button"
                      key={d}
                      className={choice.difficulty === d ? 'on' : ''}
                      onClick={() => set({ difficulty: d })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="wf-panel">
              <div className="wf-h">REP</div>
              <div className="flex items-baseline justify-between">
                <div className="text-3xl font-black italic">LVL {lp.level}</div>
                <div className="text-sm opacity-80">{LEVEL_TITLES[lp.level - 1]}</div>
              </div>
              <div className="wf-bar mt-2">
                <i style={{ width: `${lp.need > 0 ? (lp.into / lp.need) * 100 : 100}%` }} />
              </div>
              <div className="mt-1 text-xs opacity-70" style={{ fontFamily: 'system-ui' }}>
                {lp.need > 0 ? `${lp.into} / ${lp.need} rep to next level` : 'max level'} ·{' '}
                {profile.matches} matches · {profile.wins} wins
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                {WEAPON_ORDER.map(w => {
                  const def = WEAPONS[w];
                  const locked = def.unlock > lp.level;
                  return (
                    <div key={w} className={`wf-gun ${locked ? 'locked' : ''}`} title={def.blurb}>
                      <span>
                        <span className="opacity-60">{def.key}</span> {def.name}
                      </span>
                      <i>{locked ? `🔒 LVL ${def.unlock}` : 'unlocked'}</i>
                    </div>
                  );
                })}
                <div className="wf-gun">
                  <span>
                    <span className="opacity-60">G</span> Paint Grenade
                  </span>
                  <i>x2 per life</i>
                </div>
              </div>
            </div>
            {!touch && (
              <div className="wf-panel">
                <div className="wf-h">CONTROLS</div>
                <div className="wf-keys">
                  {KEYS.map(([k, v]) => (
                    <div key={k} className="contents">
                      <b>{k}</b>
                      <span className="opacity-85">{v}</span>
                    </div>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-3 text-sm">
                  <span className="opacity-70">AIM SENS</span>
                  <input
                    type="range"
                    min={0.3}
                    max={2.5}
                    step={0.05}
                    value={sensitivity}
                    onChange={e => onSensitivity(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="w-10 text-right">{sensitivity.toFixed(2)}</span>
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 flex justify-center bg-gradient-to-t from-black/70 to-transparent pb-5 pt-10">
          <button
            type="button"
            className="wf-btn wf-pulse"
            onClick={onStart}
            disabled={!ready}
            data-testid="wf-start"
          >
            {ready ? `SPLAT IN ⌐◨-◨` : 'LOADING NOUNS…'}
          </button>
        </div>
      </div>
    </div>
  );
}
