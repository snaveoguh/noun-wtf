// ── Noun World's in-game HUD: one ring, top-right ───────────────────────
//
//   top-right     the round minimap (a speed arc round it) is the anchor.
//                 Badges sit on its left rim: COIN, respect, score / best,
//                 the van cargo. The speed sits just under it, then the
//                 utility icons (mic, radio, time of day, missions, replays,
//                 stats, chat, help, NOUN FM, settings): one row on desktop,
//                 one column down the right edge on phones
//   modes         HIDE & SEEK, FREESTYLE, leave-game chips: one row (under
//                 the icons on desktop, the top-left corner on phones)
//   top-centre    one stack of toasts that fade: "E: …" prompts, trick
//                 names, records, mission updates, hide & seek status
//   bottom-left   chat
// Panels (stats, the missions tracker, replays) open under the ring.
//
// Other UIs render into these places through hud/slots.tsx. Positions come
// from ringLayout.ts (pure, tested against the phone's play zone and thumb
// pad). The `data-w2hud` ids are the settings panel's show / hide / scale
// hooks (settings/hudCss.ts): keep them when moving things.

import type { Game, HudState } from '../Game';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { nounFm } from '@/components/NounFm/NounFmStation';

import { SprayPanel } from '../graffiti/SprayPanel';
import { RespectBanner, RespectMeter } from '../respect/RespectHud';
import { SettingsCog } from '../settings/SettingsPanel';
import { ControlsHelp } from '../ui/ControlsHelp';
import { HudDrag } from '../ui/HudDrag';
import { useIsTouch } from '../ui/TouchControls';
import { WorldMap } from '../ui/WorldMap';

import { IconButton } from './IconButton';
import { HudIcon, type IconName } from './icons';
import { compactNum, hudLayout, type HudLayout } from './ringLayout';
import { useSlotRef } from './slots';
import { StatsButton, StatsPanel } from './StatsPanel';
import { stickCorner } from './thumbLayout';
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

/** The speed arc fills at this (km/h). */
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

/** The site-wide NOUN FM player is off (its pill is tucked into the icon row in game). */
function useNounFmOff(): boolean {
  const fm = nounFm();
  return useSyncExternalStore(fm.subscribe, () => fm.getView().phase === 'off');
}

export function RingHud({
  game,
  showHelp,
  onHelp,
  onShop,
  onFm,
  onChat,
}: {
  game: Game;
  showHelp: boolean;
  onHelp: () => void;
  onShop: () => void;
  onFm: () => void;
  onChat: () => void;
}) {
  const hud = useHud(game);
  const now = performance.now();
  const banked = hud.banked && now - hud.banked.at < 2600 ? hud.banked : null;
  const pad = hud.inputMode === 'gamepad';
  const touch = useIsTouch();
  const vp = useViewport();
  const L = hudLayout(vp.w, vp.h, touch);
  const [statsOpen, setStatsOpen] = useState(false);
  const toastsRef = useSlotRef('toasts');
  const panelsRef = useSlotRef('panels');

  // While the HUD is up the site's NOUN FM pill hides (its icon is in the
  // row) and a playing NOUN FM tile moves clear of the thumb buttons
  useEffect(() => {
    document.body.setAttribute('data-w2hud-on', '');
    return () => document.body.removeAttribute('data-w2hud-on');
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0" data-hud="ring">
      {/* Speed lines once a mountain run outpaces the plaza (CSS only) */}
      {hud.mode === 'board' && hud.speed > 20 && (
        <div className="w2-speedlines" style={{ opacity: Math.min(0.75, (hud.speed - 20) / 45) }} />
      )}
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

      {/* ── Top-right: the ring ── */}
      <Ring
        game={game}
        hud={hud}
        L={L}
        touch={touch}
        showHelp={showHelp}
        onHelp={onHelp}
        onChat={onChat}
        statsOpen={statsOpen}
        onStats={() => {
          if (!statsOpen) void game.refreshStats();
          setStatsOpen(o => !o);
        }}
      />

      {/* Panels open under the ring (desktop) or beside the icon column (phones) */}
      <div
        ref={panelsRef}
        className="w2h-panels absolute z-40 flex flex-col items-end gap-1.5"
        style={panelsPos(L)}
      >
        {statsOpen && (
          <StatsPanel stats={hud.stats} mine={hud.mine} me={game.name} players={hud.players} />
        )}
      </div>

      {/* ── Top-centre: one stack of toasts ── */}
      <div
        ref={toastsRef}
        className="w2h-toasts absolute left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1.5"
        style={{ top: `calc(${L.toastTop}px + env(safe-area-inset-top))` }}
      >
        {hud.shop && (
          <button type="button" className="w2-prompt" onClick={onShop}>
            <kbd>{touch ? 'TAP' : 'E'}</kbd>
            <HudIcon name="shop" size={18} />
            ENTER BOARD SHOP
          </button>
        )}
        {hud.fmDecks && (
          <button type="button" className="w2-prompt" onClick={onFm} data-fm="open">
            <kbd>{touch ? 'TAP' : 'E'}</kbd>
            <HudIcon name="decks" size={18} />
            COMMUNITY RADIO DECKS
          </button>
        )}
        {(hud.combo !== null || banked !== null || hud.manualBalance !== null) && (
          <div data-w2hud="combo" className="w2h-combo flex flex-col items-center text-center">
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
        )}
        {hud.radio.on && now - hud.radio.at < 4500 && (
          <div key={hud.radio.at} data-w2hud="toasts" className="w2-nowplaying w2h-np">
            <HudIcon name="radio" size={22} />
            <div>
              <span>
                NOW PLAYING
                {hud.radio.label.startsWith('COMMUNITY RADIO') ? ' ON COMMUNITY RADIO' : ''}
              </span>
              <b>{hud.radio.label}</b>
              <em>
                {RADIO_STATIONS.findIndex(r => r.mode === hud.radio.mode) + 1}/
                {RADIO_STATIONS.length} · {touch ? 'tap the radio to switch' : 'M to switch'}
              </em>
            </div>
          </div>
        )}
        {hud.toast !== null && now - hud.toast.at < 5000 && (
          <div key={hud.toast.at} data-w2hud="toasts" className="w2-nowplaying">
            <span>{hud.toast.tag ?? '⌐◨-◨ 19 km out'}</span>
            <b>{hud.toast.text}</b>
          </div>
        )}
      </div>

      {/* ── Bottom-left: chat (above the stick's corner on phones) ── */}
      <div
        data-w2hud="chat"
        className="w2h-chat absolute flex flex-col items-start gap-1"
        style={chatPos(vp.w, vp.h, touch)}
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

      {/* FPS / quality: a dev readout, behind its setting (off by default) */}
      {!touch && (
        <div data-w2hud="fps" className="w2h-fps absolute left-3 top-2">
          {hud.fps} fps · {hud.quality}
          {hud.baked ? ' · baked GI' : ''} · cam {hud.camMode}
        </div>
      )}

      {!touch && !game.van2.driving && <SprayPanel game={game} />}

      {/* Controls card (H, or the keyboard icon) */}
      {showHelp && hud.inputMode !== 'touch' && <ControlsHelp pad={pad} />}
    </div>
  );
}

/** Where the panels column opens. */
function panelsPos(L: HudLayout): React.CSSProperties {
  if (L.kind === 'desk')
    return {
      right: L.right,
      top: L.top + (L.modes.at === 'ring' ? L.modes.y : 0) + 40,
    };
  // Phones: left of the icon column, from the toasts' line down
  return {
    right: `calc(${L.right + L.icon + 8}px + env(safe-area-inset-right))`,
    top: `calc(${L.kind === 'portrait' ? L.top + L.size + 6 : L.toastTop}px + env(safe-area-inset-top))`,
    maxWidth: 'calc(100vw - 80px)',
  };
}

/** Chat: bottom-left; on phones above the stick's corner, right of the side buttons. */
function chatPos(W: number, H: number, touch: boolean): React.CSSProperties {
  if (!touch)
    return {
      left: 'calc(16px + env(safe-area-inset-left))',
      bottom: 'calc(16px + env(safe-area-inset-bottom))',
      maxWidth: '34vw',
    };
  const c = stickCorner(W, H);
  return {
    left: `calc(${c.left + 44 + 8}px + env(safe-area-inset-left))`,
    bottom: `calc(${c.bottom + c.size + 12}px + env(safe-area-inset-bottom))`,
    maxWidth: '58vw',
  };
}

/** The map, its rim badges, the speed line, the icons and the mode chips. */
function Ring({
  game,
  hud,
  L,
  touch,
  showHelp,
  onHelp,
  onChat,
  statsOpen,
  onStats,
}: {
  game: Game;
  hud: HudState;
  L: HudLayout;
  touch: boolean;
  showHelp: boolean;
  onHelp: () => void;
  onChat: () => void;
  statsOpen: boolean;
  onStats: () => void;
}) {
  const coin = useCoin(game);
  const fmOff = useNounFmOff();
  const utilRef = useSlotRef('util');
  const modesRef = useSlotRef('modes');
  const rimRef = useSlotRef('rim');
  const ud = game.missions.ud.active;
  const kmh = Math.round(hud.speed * 3.6);
  const board = hud.mode === 'board';
  const size = L.size;
  const frac = board ? Math.min(1, kmh / RING_KMH) : 0;
  // A 270° arc, open at the bottom-left (the badges' side)
  const r = size / 2 - 3;
  const arc = 2 * Math.PI * r * 0.75;
  const mtn = hud.mountain;
  const best = Math.max(hud.best, hud.mineCombo ?? 0);

  // Badge i at rim slot i (rim), or all in one row (landscape phones)
  const at = (i: number): React.CSSProperties => {
    const s = L.slots[L.badgeMode === 'rim' ? i : 0];
    if (s === undefined) return { display: 'none' };
    return { right: size - s.x, top: s.y, height: L.badgeH, maxWidth: L.badgeW };
  };
  const badges = [
    coin !== null ? (
      <span
        key="coin"
        className="w2h-badge2 w2h-coin"
        title="COIN (trade at the van and the town markets)"
      >
        <HudIcon name="coin" size={touch ? 14 : 18} />
        <b className="w2h-num">{compactNum(coin)}</b>
      </span>
    ) : (
      <span key="coin" />
    ),
    <span key="respect" className="w2h-rimrespect">
      <RespectMeter respect={game.respect} />
    </span>,
    <span
      key="session"
      data-w2hud="session"
      className="w2h-badge2 w2h-score"
      title={`Points this session ${hud.session.toLocaleString()} · best ${best.toLocaleString()}`}
    >
      <HudIcon name="star" size={touch ? 14 : 18} />
      <b className="w2h-num">{compactNum(hud.session)}</b>
      <small>BEST {compactNum(best)}</small>
    </span>,
    // The van cargo (TradeUi renders into it)
    <span key="rim" ref={rimRef} className="w2h-rimslot" />,
  ];

  const icons = (
    <div
      data-w2hud="system"
      className={`w2h-icons flex ${L.icons.dir === 'column' ? 'flex-col items-end' : 'flex-row items-center justify-end'}`}
      style={{
        gap: L.gap,
        ...(L.icons.at === 'ring'
          ? { position: 'absolute', right: 0, top: L.icons.y }
          : {
              position: 'absolute',
              left: `calc(${L.icons.left}px + env(safe-area-inset-left))`,
              top: `calc(${L.icons.top}px + env(safe-area-inset-top))`,
            }),
        ['--w2h-ib' as string]: `${L.icon}px`,
      }}
    >
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
            : `Radio off: tune in (M): ${RADIO_STATIONS.map(s => s.name).join(' → ')} → off`
        }
        onClick={() => game.cycleRadio()}
        onContextMenu={() => game.nextRadioTrack()}
      />
      {hud.radio.on && !touch && (
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
      {/* Missions and replays (MissionsUi, RecordsUi) */}
      <span ref={utilRef} className="contents" />
      <StatsButton stats={hud.stats} open={statsOpen} onToggle={onStats} />
      <IconButton icon="chat" label="Chat (Enter)" onClick={onChat} />
      {!touch && (
        <IconButton
          icon="help"
          on={showHelp}
          label={showHelp ? 'Hide controls (H)' : 'Controls (H)'}
          onClick={onHelp}
        />
      )}
      {fmOff && (
        <IconButton
          icon="fm"
          label="NOUN FM: deep cuts, videos and podcasts (site radio)"
          onClick={() => nounFm().tuneIn()}
          data={{ 'data-nounfm-tuck': '' }}
        />
      )}
      <SettingsCog game={game} />
    </div>
  );

  const modes = (
    <div
      ref={modesRef}
      className={`w2h-modes flex flex-wrap items-center gap-1.5 ${L.modes.at === 'ring' ? 'justify-end' : 'justify-start'}`}
      style={
        L.modes.at === 'ring'
          ? { position: 'absolute', right: 0, top: L.modes.y, width: 420 }
          : {
              position: 'absolute',
              left: `calc(${L.modes.left}px + env(safe-area-inset-left))`,
              top: `calc(${L.modes.top}px + env(safe-area-inset-top))`,
              maxWidth: L.modes.maxW,
            }
      }
    />
  );

  return (
    <>
      <HudDrag
        id="ring"
        className="w2h-ringbox absolute z-30"
        style={{
          right: `calc(${L.right}px + env(safe-area-inset-right))`,
          top: `calc(${L.top}px + env(safe-area-inset-top))`,
          width: size,
          height: size,
        }}
      >
        <div className="w2h-ring" style={{ width: size, height: size }}>
          <div className="w2h-mapdisc" />
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
            {/* Open at the bottom-left, where the badges sit */}
            <g transform={`rotate(180 ${size / 2} ${size / 2})`}>
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

        {/* Badges on the rim */}
        {L.badgeMode === 'rim' ? (
          badges.map((b, i) => (
            <div
              key={b.key}
              className="w2h-rim absolute flex items-center justify-end"
              style={at(i)}
            >
              {b}
            </div>
          ))
        ) : (
          <div
            className="w2h-rim w2h-rimrow absolute flex flex-row-reverse items-center gap-1"
            style={{
              right: size - (L.slots[0]?.x ?? 0),
              top: L.slots[0]?.y ?? 0,
              height: L.badgeH,
            }}
          >
            {badges}
          </div>
        )}

        {/* Speed, small, just under the map */}
        <div
          className="w2h-speedline absolute flex items-center justify-end gap-1.5"
          style={{ right: 0, top: size, height: L.speedH, width: L.speedW }}
        >
          {!touch && mtn !== null && (
            <span className="w2h-stat" title={`${mtn.surface}, streak ${mtn.streak}s`}>
              <HudIcon name={mtn.surface === 'snow' ? 'snow' : 'mountain'} size={14} />
              <b className="w2h-num w2h-sm">{(mtn.down / 1000).toFixed(2)} km</b>
            </span>
          )}
          {!touch && (
            <span
              className="w2h-stat"
              data-w2hud="session"
              title={`${hud.players} online${hud.connected ? '' : ' (offline)'}`}
            >
              <HudIcon name="people" size={14} />
              <b className="w2h-num w2h-sm">{hud.players}</b>
              <i className={`w2h-dot ${hud.connected ? 'w2h-up' : ''}`} />
            </span>
          )}
          <span
            className="w2h-stat w2h-speed"
            data-w2hud="speed"
            title={board ? 'Speed' : 'On foot'}
          >
            {!touch && <HudIcon name={board ? 'board' : 'walk'} size={16} />}
            <b className="w2h-num">{kmh}</b>
            <span className="w2h-small">KM/H</span>
          </span>
        </div>

        {L.icons.at === 'ring' && icons}
        {L.modes.at === 'ring' && modes}
      </HudDrag>
      {L.icons.at === 'screen' && icons}
      {L.modes.at === 'screen' && modes}
    </>
  );
}
