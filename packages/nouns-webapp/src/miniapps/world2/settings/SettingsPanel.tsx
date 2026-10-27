// ── Settings cog + panel ─────────────────────────────────────────────────
//
// The ⚙ sits in the top-right HUD group (it stays when the rest of that
// group is hidden). The panel is portalled to <body> so the draggable HUD
// group around the cog can't drag it or clip it; while it's open the game
// gets no keys and Esc closes it. HUD show/hide and scale are a generated
// stylesheet over `data-w2hud` blocks, so the HUD code only tags its blocks.

import type { Game } from '../Game';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { createPortal } from 'react-dom';

import { voiceMutes } from '../audio/voice/booth/runtime';
import { report as reportVoice } from '../audio/voice/booth/voiceSync';
import { npcVoice } from '../audio/voice/cast';
import { HOUSE_MODEL_BYTES, PIPER_MODEL_BYTES } from '../audio/voice/ttsVoice';
import VoiceBooth from '../booth/VoiceBooth';
import { HudIcon } from '../hud/icons';
import { installState, subscribeInstall } from '../pwa/install';
import { InstallButton } from '../pwa/InstallButton';
import { resetHudPositions } from '../ui/HudDrag';
import { cleanName, NAME_MAX, renameRider } from '../ui/riderName';
import { worldPause } from '../worldPause';

import { hudCss } from './hudCss';
import {
  CAM_MODES,
  HUD_ITEMS,
  HUD_SCALE_MAX,
  HUD_SCALE_MIN,
  LOOK_SENS_MAX,
  LOOK_SENS_MIN,
  QUALITIES,
  VOICE_MODES,
  bootedQuality,
  settings,
  type AudioLevels,
  type WorldSettings,
} from './store';

function useSettings(): WorldSettings {
  return useSyncExternalStore(settings.subscribe, settings.get);
}

export function HudPrefsStyle() {
  const s = useSettings();
  return <style>{hudCss(s)}</style>;
}

export function SettingsCog({ game }: { game: Game }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-w2cog=""
        data-tip="Settings"
        className={`w2h-ib ${open ? 'w2h-on' : ''}`}
        onPointerDown={e => e.stopPropagation()}
        onClick={() => setOpen(o => !o)}
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
      >
        <HudIcon name="cog" size={20} />
      </button>
      {open && createPortal(<Panel game={game} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

const label = (v: number) => `${Math.round(v * 100)}%`;

/** YOU: change the rider's name (for anyone who skipped it at the start). */
function NameRow({ game }: { game: Game }) {
  const [name, setName] = useState(game.name);
  const [saved, setSaved] = useState(false);
  const save = () => {
    const n = renameRider(game, name);
    if (n === null) return setName(game.name);
    setName(n);
    setSaved(true);
  };
  return (
    <Section title="YOU">
      <form
        className="flex items-center gap-2"
        onSubmit={e => {
          e.preventDefault();
          save();
        }}
      >
        <input
          aria-label="Your name"
          value={name}
          maxLength={NAME_MAX}
          spellCheck={false}
          onChange={e => {
            setName(cleanName(e.target.value));
            setSaved(false);
          }}
          onBlur={save}
          className="min-w-0 flex-1 rounded-lg border border-white/20 bg-black/40 px-3 py-2 font-bold tracking-wide text-white outline-none focus:border-[#ffd400]"
        />
        <button
          type="submit"
          className="rounded-lg bg-[#ffd400] px-3 py-2 text-xs font-black text-black"
        >
          {saved ? 'SAVED ✓' : 'SAVE'}
        </button>
      </form>
    </Section>
  );
}

function Panel({ game, onClose }: { game: Game; onClose: () => void }) {
  const s = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const lastPreview = useRef(0);

  // Keys belong to the panel: the game's input is off, Esc closes
  useEffect(() => {
    game.input.setEnabled(false);
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (!(e.target instanceof Node) || ref.current?.contains(e.target) !== true)
        e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    // Backgrounded behind the NounOS desk: get out of the way
    const iv = window.setInterval(() => {
      if (worldPause.get()) close.current();
    }, 400);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearInterval(iv);
      game.input.setEnabled(!worldPause.get());
    };
  }, [game]);

  const setAudio = (patch: Partial<AudioLevels>, preview: boolean | 'npc') => {
    settings.update({ audio: patch });
    // Live preview through the bus being set (throttled while dragging): a
    // board pop for SFX, a word from the Oracle for character voices
    const now = performance.now();
    if (preview !== false && now - lastPreview.current > (preview === 'npc' ? 700 : 140)) {
      lastPreview.current = now;
      game.unlockAudio();
      if (preview === 'npc') game.voice.speak({ text: 'Hello.', voice: npcVoice('oracle') });
      else game.audio.pop(0.7);
    }
  };

  const a = s.audio;
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[900]"
      onPointerDown={e => {
        // (React bubbles portal events through the HUD drag handle: stop here)
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={e => e.stopPropagation()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-label="Noun World settings"
        data-w2settings=""
        className="w2-panel w2-settings absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-b-none text-sm text-white outline-none sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:max-h-[calc(100vh-80px)] sm:w-[380px] sm:rounded-b-[14px]"
        style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-between">
          <b className="text-base tracking-wide">⚙ SETTINGS</b>
          <button
            type="button"
            className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold"
            onClick={onClose}
          >
            close <span className="opacity-60">esc</span>
          </button>
        </div>

        <NameRow game={game} />

        <Section title="AUDIO">
          <Slider
            name="Master"
            value={a.master}
            fmt={label}
            onChange={v => setAudio({ master: v }, true)}
          />
          <Slider
            name="Skate SFX"
            value={a.sfx}
            fmt={label}
            onChange={v => setAudio({ sfx: v }, true)}
          />
          <Slider
            name="Radio / COMMUNITY RADIO"
            value={a.radio}
            fmt={label}
            onChange={v => setAudio({ radio: v }, false)}
          />
          <Slider
            name="Voice chat"
            value={a.voice}
            fmt={label}
            onChange={v => setAudio({ voice: v }, false)}
          />
          <Slider
            name="Character voices"
            value={a.npc}
            fmt={label}
            onChange={v => setAudio({ npc: v }, 'npc')}
          />
          <Toggle
            name={a.muted ? '🔇 Muted' : '🔊 Mute all'}
            on={a.muted}
            onClick={() => setAudio({ muted: !a.muted }, false)}
          />
        </Section>

        <Section title="VOICES">
          <Choice
            name="Real character voices"
            options={VOICE_MODES}
            value={s.voices}
            onChange={m => {
              settings.update({ voices: m });
              // Picked by hand: load now (the click is the opt-in), then say hello
              game.unlockAudio();
              if (m !== 'off' && game.realVoicesOn()) {
                game.tts.load();
                void game.tts
                  .whenReady()
                  .then(() =>
                    game.voice.speak({ text: 'Hello there.', voice: npcVoice('oracle') }),
                  );
              }
            }}
          />
          <VoiceStatus game={game} />
          <div className="grid grid-cols-2 gap-1.5">
            <Toggle
              name="Rider callouts"
              on={s.callouts}
              onClick={() => settings.update({ callouts: !s.callouts })}
            />
            <Toggle
              name="Clean mode"
              on={s.cleanVoices}
              onClick={() => settings.update({ cleanVoices: !s.cleanVoices })}
            />
          </div>
          <VoiceBoothEntry game={game} />
        </Section>

        <Section title="HUD">
          <div className="grid grid-cols-2 gap-1.5">
            {HUD_ITEMS.map(h => (
              <Toggle
                key={h.id}
                name={h.label}
                on={s.hud[h.id]}
                onClick={() => settings.update({ hud: { [h.id]: !s.hud[h.id] } })}
              />
            ))}
          </div>
          <Slider
            name="HUD scale"
            value={s.hudScale}
            min={HUD_SCALE_MIN}
            max={HUD_SCALE_MAX}
            step={0.05}
            fmt={v => `${v.toFixed(2)}×`}
            onChange={v => settings.update({ hudScale: v })}
          />
          <button
            type="button"
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold"
            onClick={() => resetHudPositions()}
            data-w2reset=""
          >
            Reset HUD positions
          </button>
        </Section>

        <Section title="GAMEPLAY & GRAPHICS">
          <Choice
            name="Performance"
            options={QUALITIES}
            value={s.quality}
            onChange={q => settings.update({ quality: q })}
          />
          <p className="text-xs opacity-70">
            Auto picks for your device and steps down if it struggles. Running {perfLabel(game)}.
          </p>
          {s.quality !== (bootedQuality.param ?? bootedQuality.setting) && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-[#ffd400]/15 px-3 py-2 text-xs">
              <span>Performance changes on reload (running {game.hud.quality}).</span>
              <button
                type="button"
                className="w2-sel rounded-full bg-[#ffd400] px-3 py-1 font-bold"
                onClick={() => {
                  // A ?q= param would override the saved choice
                  const u = new URL(window.location.href);
                  u.searchParams.delete('q');
                  window.location.replace(u.toString());
                }}
              >
                reload
              </button>
            </div>
          )}
          <Choice
            name="Camera (C)"
            options={CAM_MODES}
            value={s.camMode}
            onChange={m => settings.update({ camMode: m })}
          />
          <Slider
            name="Mouse sensitivity"
            value={s.lookSens}
            min={LOOK_SENS_MIN}
            max={LOOK_SENS_MAX}
            step={0.05}
            fmt={v => `${v.toFixed(2)}×`}
            onChange={v => settings.update({ lookSens: v })}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <Toggle
              name="Invert mouse Y"
              on={s.invertY}
              onClick={() => settings.update({ invertY: !s.invertY })}
            />
            <Toggle
              name="Reduce motion"
              on={s.reduceMotion}
              onClick={() => settings.update({ reduceMotion: !s.reduceMotion })}
            />
          </div>
        </Section>

        <AppSection />

        <button
          type="button"
          className="self-start text-xs underline opacity-60"
          onClick={() => settings.reset()}
        >
          reset all settings
        </button>
      </div>
    </div>
  );
}

/** Voice Booth: the way in, the voice switches, and other riders' voices (mute / report). */
function VoiceBoothEntry({ game }: { game: Game }) {
  const s = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-w2booth=""
        className="w2-sel min-h-[40px] rounded-xl bg-[#ffd400] px-3 text-xs font-bold text-black"
        onClick={() => {
          game.unlockAudio();
          setOpen(true);
        }}
      >
        🎙 VOICE BOOTH: record your rider’s callouts
      </button>
      <div className="grid grid-cols-2 gap-1.5">
        <Toggle
          name="Use my voice"
          on={s.myVoice}
          onClick={() => settings.update({ myVoice: !s.myVoice })}
        />
        <Toggle
          name="Hear other players' voices"
          on={s.hearVoices}
          onClick={() => settings.update({ hearVoices: !s.hearVoices })}
        />
        <Toggle
          name="Use my voice model"
          on={s.modelVoice}
          onClick={() => settings.update({ modelVoice: !s.modelVoice })}
        />
        <Toggle
          name="Others hear my model voice"
          on={s.modelShare}
          onClick={() => settings.update({ modelShare: !s.modelShare })}
        />
      </div>
      <OtherVoices game={game} />
      {open &&
        createPortal(
          <div
            className="pointer-events-auto fixed inset-0 z-[950] flex justify-center overflow-y-auto bg-black/70 p-0 sm:p-6"
            onPointerDown={e => {
              e.stopPropagation();
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div
              className="w2-panel h-fit min-h-full w-full max-w-[680px] rounded-none sm:min-h-0 sm:rounded-[14px]"
              style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
            >
              <VoiceBooth
                onClose={() => setOpen(false)}
                modelState={() => game.voices.modelState()}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Riders here who share a voice: mute it, or report it to the moderators. */
function OtherVoices({ game }: { game: Game }) {
  const [, tick] = useState(0);
  const [note, setNote] = useState('');
  useEffect(() => {
    const iv = window.setInterval(() => tick(n => n + 1), 1500);
    return () => window.clearInterval(iv);
  }, []);
  const riders = [...game.net.players.values()].filter(p => p.voiceTag !== '');
  if (riders.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-w2voices-list="">
      <span className="text-xs">Riders with their own voice</span>
      {riders.map(p => {
        const muted = voiceMutes.has(p.voiceTag);
        return (
          <div
            key={p.id}
            className="flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-1.5 text-xs"
          >
            <span className="flex-1 truncate">{p.name || 'noun'}</span>
            <button
              type="button"
              className="rounded-full bg-white/10 px-2 py-1 font-bold"
              onClick={() => {
                voiceMutes.set(p.voiceTag, !muted);
                tick(n => n + 1);
              }}
            >
              {muted ? 'unmute' : 'mute'}
            </button>
            <button
              type="button"
              className="rounded-full bg-white/10 px-2 py-1 font-bold text-[#ff8080]"
              onClick={() => {
                voiceMutes.set(p.voiceTag, true);
                void reportVoice(p.voiceTag, { reason: 'reported in game' })
                  .then(() => setNote(`Reported ${p.name || 'noun'}'s voice and muted it.`))
                  .catch(() => setNote(`Muted ${p.name || 'noun'} (report didn't send).`));
              }}
            >
              report
            </button>
          </div>
        );
      })}
      {note !== '' && <span className="text-[11px] opacity-70">{note}</span>}
    </div>
  );
}

/** Where the real voices are: off, waiting, downloading, ready or failed. */
function VoiceStatus({ game }: { game: Game }) {
  const st = useSyncExternalStore(game.tts.subscribe.bind(game.tts), game.tts.getStatus);
  useSettings(); // re-render on a mode change
  const mb = (b: number) => `${Math.round(b / 1e6)} MB`;
  let text: string;
  if (!game.realVoicesOn())
    text =
      game.voiceMode === 'off'
        ? 'Off: characters babble.'
        : `Babble on this device. Pick "on" for real voices (${mb(PIPER_MODEL_BYTES + HOUSE_MODEL_BYTES)} download, once).`;
  else if (st.state === 'idle')
    text = `Real voices load the first time someone speaks (${mb(PIPER_MODEL_BYTES + HOUSE_MODEL_BYTES)}, once, then cached).`;
  else if (st.state === 'loading')
    text =
      st.total > 0
        ? `Downloading voices… ${Math.round((st.loaded / st.total) * 100)}% of ${mb(st.total)}`
        : 'Loading voices…';
  else if (st.state === 'ready')
    text = `Real voices ready${st.cached ? ' (cached)' : ''}: every Noun has their own.`;
  else text = `Voices failed to load (${st.error}). Babbling instead.`;
  return (
    <p className="text-xs opacity-70" data-w2voices={st.state}>
      {text} Piper neural TTS, runs on your device. Voices from the LibriTTS-R dataset (CC BY 4.0)
      via the Piper libritts_r model.
    </p>
  );
}

/** "low · 75% res · no shadows": the tier plus any step-downs it's taken. */
function perfLabel(game: Game): string {
  const l = game.gfx.lite;
  const parts: string[] = [game.gfx.quality];
  if (game.gfx.quality === 'low' && l.scale < 1) parts.push(`${Math.round(l.scale * 100)}% res`);
  if (!l.shadows) parts.push('no shadows');
  if (!l.post) parts.push('no outlines');
  return parts.join(' · ');
}

/** Install Noun World as an app (only when the browser can, or on iOS Safari). */
function AppSection() {
  const state = useSyncExternalStore(subscribeInstall, installState, () => 'none' as const);
  if (state === 'none') return null;
  return (
    <Section title="APP">
      {state === 'installed' ? (
        <div className="text-xs opacity-70">Running as an installed app.</div>
      ) : (
        <InstallButton className="self-start" />
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-bold tracking-[0.2em] opacity-60">{title}</div>
      {children}
    </div>
  );
}

function Slider({
  name,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  fmt,
  onChange,
}: {
  name: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex justify-between text-xs">
        <span>{name}</span>
        <b className="tabular-nums">{fmt(value)}</b>
      </span>
      <input
        type="range"
        className="w2-range"
        aria-label={name}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle({ name, on, onClick }: { name: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`flex min-h-[36px] items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-xs font-bold ${on ? 'bg-[#3ddc84]/25 ring-1 ring-[#3ddc84]' : 'bg-white/10 opacity-70'}`}
      onClick={onClick}
    >
      <span>{name}</span>
      <span className="text-[10px]">{on ? 'ON' : 'OFF'}</span>
    </button>
  );
}

function Choice<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs">{name}</span>
      <div className="flex gap-1" role="radiogroup" aria-label={name}>
        {options.map(o => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === value}
            className={`min-h-[34px] flex-1 rounded-xl px-2 text-xs font-bold ${o === value ? 'w2-sel bg-[#ffd400]' : 'bg-white/10'}`}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
