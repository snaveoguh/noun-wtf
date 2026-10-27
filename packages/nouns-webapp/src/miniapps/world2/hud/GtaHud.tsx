// ── Noun World's in-game HUD, GTA-style ─────────────────────────────────
//
// Corners, not columns:
//   bottom-left   the round minimap with a speed ring, a small stat rail
//                 beside it (speed, players online, the mountain run)
//   top-right     score, COIN + respect as icon + number, then one row of
//                 round icon buttons (mic, radio, time of day, stats, help,
//                 settings); every icon has a tooltip / long-press label
//   top-centre    the landmarks compass, slim (desktop)
//   transient     trick names, the now-playing card, banners, "E: shop"
//                 prompts: small toasts that fade
// Panels (stats, respect, map, missions, spray) open from their icon.
//
// The `data-w2hud` ids are the settings panel's show / hide / scale hooks
// (settings/hudCss.ts): keep them when moving things.

import type { Game, HudState } from '../Game';

import { useState, useSyncExternalStore } from 'react';

import { SprayPanel } from '../graffiti/SprayPanel';
import { RespectBanner, RespectMeter } from '../respect/RespectHud';
import { SettingsCog } from '../settings/SettingsPanel';
import { ControlsHelp } from '../ui/ControlsHelp';
import { HudDrag } from '../ui/HudDrag';
import { useIsTouch } from '../ui/TouchControls';
import { WorldMap } from '../ui/WorldMap';

import { IconButton } from './IconButton';
import { HudIcon, type IconName } from './icons';
import { StatsButton, StatsPanel } from './StatsPanel';
import { mapCluster } from './thumbLayout';
import { useViewport } from './useViewport';

/** The radio stations in M-cycle order, for the station toast. */
export const RADIO_STATIONS: { mode: 'fm' | 'beats'; name: string }[] = [
  { mode: 'fm', name: 'COMMUNITY RADIO' },
  { mode: 'beats', name: 'NOUN BEATS (hip-hop)' },
];

const TIME_ICON: Record<string, IconName> = {
  afternoon: 'sun',
  golden: 'golden',
  blue: 'blue',
  night: 'moon',
};
const TIME_NAME: Record<string, string> = {
  afternoon: 'afternoon',
  golden: 'golden hour',
  blue: 'blue hour',
  night: 'night',
};

/** The desktop minimap's diameter (with its ring), px. */
const DESK_MAP = 176;

/** The speed ring fills at this (km/h). */
const RING_KMH = 60;

const HELP_KEY = 'noun-world-help-seen';

/**
 * The controls card starts open once per browser (first visit, keyboard),
 * then folded behind its icon. Phones never start with it.
 */
export function initialHelp(): boolean {
  if (window.matchMedia?.('(pointer: coarse)').matches === true) return false;
  try {
    if (localStorage.getItem(HELP_KEY) !== null) return false;
    localStorage.setItem(HELP_KEY, '1');
  } catch {
    // no storage: show it, it folds with H
  }
  return true;
}

function useHud(game: Game): HudState {
  return useSyncExternalStore(
    cb => game.subscribe(cb),
    () => game.hud,
  );
}

function useCoin(game: Game): number | null {
  useSyncExternalStore(game.trade.subscribe, game.trade.getVersion);
  return game.trade.state?.coin ?? null;
}

export function GtaHud({
  game,
  showHelp,
  onHelp,
  onShop,
  onFm,
}: {
  game: Game;
  showHelp: boolean;
  onHelp: () => void;
  onShop: () => void;
  onFm: () => void;
}) {
  const hud = useHud(game);
  const coin = useCoin(game);
  const now = performance.now();
  const banked = hud.banked && now - hud.banked.at < 2600 ? hud.banked : null;
  const pad = hud.inputMode === 'gamepad';
  const touch = useIsTouch();
  const [statsOpen, setStatsOpen] = useState(false);
  const kmh = Math.round(hud.speed * 3.6);
  // Phones: the compact site tray owns the top 48 px
  const top = touch ? 'top-12' : 'top-3';
  const ud = game.missions.ud.active;

  return (
    <div className="pointer-events-none absolute inset-0" data-hud="gta">
      {/* Speed lines once a mountain run outpaces the plaza (CSS only) */}
      {hud.mode === 'board' && hud.speed > 20 && (
        <div className="w2-speedlines" style={{ opacity: Math.min(0.75, (hud.speed - 20) / 45) }} />
      )}

      {/* ── Bottom-left: round map + speed ring + stat rail ── */}
      <MapCluster game={game} hud={hud} touch={touch} kmh={kmh} ud={ud} />
      <RespectBanner respect={game.respect} sfx={game.sfx} />

      {/* ── Top-centre: landmarks compass (desktop; no room on phones) ── */}
      {!touch && (
        <div
          data-w2hud="compass"
          className="w2h-compass absolute left-1/2 top-2 h-8 w-0 -translate-x-1/2"
        >
          {hud.landmarks.slice(0, 4).map(l => {
            const deg = (((((l.bearing * 180) / Math.PI) % 360) + 540) % 360) - 180;
            if (Math.abs(deg) > 70) return null;
            return (
              <div key={l.name} style={{ transform: `translateX(calc(${deg * 3}px - 50%))` }}>
                <i />
                {l.name}
                <small>{l.dist}m</small>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Top-right: score, wallet, the icon row ── */}
      <HudDrag
        id="system"
        className={`absolute right-3 ${top} z-30 flex flex-col items-end gap-1.5`}
      >
        <div data-w2hud="session" className="w2h-score" title="Points this session">
          <HudIcon name="star" size={touch ? 16 : 20} />
          <b className="w2h-num">{hud.session.toLocaleString()}</b>
          <small>BEST {Math.max(hud.best, hud.mineCombo ?? 0).toLocaleString()}</small>
        </div>
        <div className="w2h-wallet">
          {coin !== null && (
            <span className="w2h-coin" title="COIN (trade at the van and the town markets)">
              <HudIcon name="coin" size={touch ? 16 : 18} />
              <b className="w2h-num">{coin.toLocaleString()}</b>
            </span>
          )}
          <RespectMeter respect={game.respect} />
        </div>
        <div data-w2cogrow="" className="w2h-row">
          <IconButton
            icon={hud.mic === 'off' ? 'mic' : hud.mic === 'muted' ? 'micMuted' : 'micLive'}
            on={hud.mic === 'on'}
            live={hud.mic === 'on' && hud.speaking}
            label={
              hud.mic === 'off'
                ? 'Join voice chat (V)'
                : hud.mic === 'muted'
                  ? 'Mic muted (V)'
                  : hud.speaking
                    ? 'Talking (V)'
                    : 'Mic live (V)'
            }
            onClick={() => void game.toggleMic()}
          />
          <IconButton
            icon={hud.radio.on ? 'radio' : 'radioOff'}
            on={hud.radio.on}
            label={
              hud.radio.on
                ? `${hud.radio.label}: change station (M${touch ? '' : ', right-click next track'})`
                : `Radio off: tune in (M): ${RADIO_STATIONS.map(r => r.name).join(' → ')} → off`
            }
            onClick={() => game.cycleRadio()}
            onContextMenu={() => game.nextRadioTrack()}
          />
          {hud.radio.on && (
            <IconButton
              icon="next"
              label={hud.radio.mode === 'beats' ? 'Next beat (.)' : 'Next track (.)'}
              onClick={() => game.nextRadioTrack()}
            />
          )}
          <IconButton
            icon={TIME_ICON[hud.timeOfDay] ?? 'sun'}
            label={`Time of day: ${TIME_NAME[hud.timeOfDay] ?? hud.timeOfDay} (P)`}
            onClick={() => game.cycleTimeOfDay()}
          />
          <StatsButton
            stats={hud.stats}
            open={statsOpen}
            onToggle={() => {
              if (!statsOpen) void game.refreshStats();
              setStatsOpen(o => !o);
            }}
          />
          {!touch && (
            <IconButton
              icon="help"
              on={showHelp}
              label={showHelp ? 'Hide controls (H)' : 'Controls (H)'}
              onClick={onHelp}
            />
          )}
          <SettingsCog game={game} />
        </div>
        {!touch && (
          <div data-w2hud="fps" className="w2h-fps">
            {hud.fps} fps · {hud.quality}
            {hud.baked ? ' · baked GI' : ''} · cam {hud.camMode}
          </div>
        )}
        {statsOpen && (
          <StatsPanel stats={hud.stats} mine={hud.mine} me={game.name} players={hud.players} />
        )}
      </HudDrag>

      {/* ── Toasts ── */}
      {hud.radio.on && now - hud.radio.at < 4500 && (
        <div
          key={hud.radio.at}
          data-w2hud="toasts"
          className={`w2-nowplaying w2h-np absolute left-1/2 ${touch ? 'top-[136px]' : 'top-12'} -translate-x-1/2`}
        >
          <HudIcon name="radio" size={22} />
          <div>
            <span>
              NOW PLAYING
              {hud.radio.label.startsWith('COMMUNITY RADIO') ? ' ON COMMUNITY RADIO' : ''}
            </span>
            <b>{hud.radio.label}</b>
            <em>
              {RADIO_STATIONS.findIndex(r => r.mode === hud.radio.mode) + 1}/{RADIO_STATIONS.length}{' '}
              · {touch ? 'tap the radio to switch' : 'M to switch'}
            </em>
          </div>
        </div>
      )}
      {hud.toast !== null && now - hud.toast.at < 5000 && (
        <div
          key={hud.toast.at}
          data-w2hud="toasts"
          className={`w2-nowplaying absolute left-1/2 ${touch ? 'top-[190px]' : 'top-[104px]'} -translate-x-1/2`}
        >
          <span>{hud.toast.tag ?? '⌐◨-◨ 19 km out'}</span>
          <b>{hud.toast.text}</b>
        </div>
      )}

      {/* ── Context prompts ── */}
      {hud.shop && (
        <button type="button" className="w2-prompt w2-prompt-at" onClick={onShop}>
          <kbd>{touch ? 'TAP' : 'E'}</kbd>
          <HudIcon name="shop" size={18} />
          ENTER BOARD SHOP
        </button>
      )}
      {hud.fmDecks && (
        <button type="button" className="w2-prompt w2-prompt-at" onClick={onFm} data-fm="open">
          <kbd>{touch ? 'TAP' : 'E'}</kbd>
          <HudIcon name="decks" size={18} />
          COMMUNITY RADIO DECKS
        </button>
      )}

      {/* ── Chat feed: over the map on desktop, under the top-left icons on phones ── */}
      <div
        data-w2hud="chat"
        className={`w2h-chat absolute flex flex-col gap-1 ${touch ? 'left-2 top-[100px] max-w-[62vw]' : 'left-3 max-w-[34vw]'}`}
        style={touch ? undefined : { bottom: DESK_MAP + 34 }}
      >
        {hud.chat
          .filter(c => now - c.at < 12000)
          .slice(touch ? -3 : -5)
          .map(c => (
            <div key={`${c.at}-${c.id}`}>
              <b>{c.name}</b>
              {c.text}
            </div>
          ))}
      </div>

      {/* ── Combo: trick name + score as a toast ── */}
      <div
        data-w2hud="combo"
        className={`w2h-combo absolute left-1/2 flex w-[80vw] -translate-x-1/2 flex-col items-center text-center ${touch ? 'top-[150px]' : 'bottom-[96px]'}`}
      >
        {hud.combo && (
          <>
            <div className="w2-combo-label">{hud.combo.label}</div>
            <div className="w2-combo-score">
              {hud.combo.score.toLocaleString()}
              {hud.combo.multiplier > 1 && <span> ×{hud.combo.multiplier}</span>}
            </div>
          </>
        )}
        {!hud.combo && banked && (
          <div key={banked.at} className={`w2-banked ${banked.bailed ? 'w2-bailed' : ''}`}>
            {banked.bailed ? 'BAILED' : `+${banked.points.toLocaleString()}`}
            <div className="text-sm opacity-80">{banked.label}</div>
          </div>
        )}
        {hud.manualBalance !== null && (
          <div className="mt-1 flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 text-xs font-bold">
              <span className="text-[#ffd400]">W ◀</span>
              <div className="h-2 w-40 rounded-full border border-black/60 bg-white/20">
                <div
                  className="h-2 w-2 rounded-full bg-[#ff2f8e]"
                  style={{
                    transform: `translateX(${(Math.max(-1, Math.min(1, hud.manualBalance)) + 1) * 76}px)`,
                  }}
                />
              </div>
              <span className="text-[#ffd400]">▶ S</span>
            </div>
            {!touch && <div className="text-[10px] opacity-80">W / S to balance</div>}
          </div>
        )}
      </div>

      {!touch && !game.van2.driving && <SprayPanel game={game} />}

      {/* Controls card (H, or the keyboard icon) */}
      {showHelp && hud.inputMode !== 'touch' && <ControlsHelp pad={pad} />}
    </div>
  );
}

/** The round minimap in its speed ring, and the small stats beside it. */
function MapCluster({
  game,
  hud,
  touch,
  kmh,
  ud,
}: {
  game: Game;
  hud: HudState;
  touch: boolean;
  kmh: number;
  ud: boolean;
}) {
  // Desktop gets a bigger map; phones take the corner the thumb layout gives
  const vp = useViewport();
  const size = touch ? mapCluster(vp.w, vp.h).size : DESK_MAP;
  const board = hud.mode === 'board';
  const frac = board ? Math.min(1, kmh / RING_KMH) : 0;
  // A 270° arc, open at the bottom
  const r = size / 2 - 3;
  const arc = 2 * Math.PI * r * 0.75;
  const mtn = hud.mountain;
  return (
    <HudDrag
      id="cluster"
      className="w2h-cluster absolute z-30"
      style={{
        left: `calc(${touch ? 8 : 14}px + env(safe-area-inset-left))`,
        bottom: `calc(${touch ? 8 : 14}px + env(safe-area-inset-bottom))`,
      }}
    >
      <div className="w2h-ring" style={{ width: size, height: size }}>
        {ud ? (
          // The Big Drop: the map's world is the one you left
          <div className="w2h-void" title="The Big Drop: off the map">
            <HudIcon name="snow" size={size / 3} />
          </div>
        ) : (
          <WorldMap game={game} touch={touch} docked />
        )}
        <svg
          className="w2h-arc"
          data-w2hud="speed"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
        >
          <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="#0b0b12"
              strokeWidth={6}
              strokeDasharray={`${arc} ${2 * Math.PI * r}`}
              strokeLinecap="round"
              opacity={0.75}
            />
            {frac > 0.005 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={frac > 0.8 ? '#ff2f8e' : '#ffd400'}
                strokeWidth={3.5}
                strokeDasharray={`${arc * frac} ${2 * Math.PI * r}`}
                strokeLinecap="round"
              />
            )}
          </g>
        </svg>
      </div>
      <div className="w2h-rail">
        {mtn !== null && (
          <div className="w2h-stat" title={`${mtn.surface}, streak ${mtn.streak}s`}>
            <HudIcon name={mtn.surface === 'snow' ? 'snow' : 'mountain'} size={16} />
            <b className="w2h-num w2h-sm">{(mtn.down / 1000).toFixed(2)} km</b>
            <span className="w2h-small">{mtn.streak}s</span>
          </div>
        )}
        <div
          className="w2h-stat"
          data-w2hud="session"
          title={`${hud.players} online${hud.connected ? '' : ' (offline)'}`}
        >
          <HudIcon name="people" size={16} />
          <b className="w2h-num w2h-sm">{hud.players}</b>
          <i className={`w2h-dot ${hud.connected ? 'w2h-up' : ''}`} />
        </div>
        <div className="w2h-stat w2h-speed" data-w2hud="speed" title={board ? 'Speed' : 'On foot'}>
          <HudIcon name={board ? 'board' : 'walk'} size={touch ? 16 : 20} />
          <b className="w2h-num">{kmh}</b>
          <span className="w2h-small">KM/H</span>
        </div>
      </div>
    </HudDrag>
  );
}
