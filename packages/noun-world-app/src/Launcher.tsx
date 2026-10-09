// App launcher: pick a mode before the game mounts (the game loads its level
// on mount, and the downhill drop-in needs the mountain, which is always
// part of the plaza level).

import { useState } from 'react';

import { type ControlSettings, loadBest, saveSettings } from './controls/settings';
import { tilt, Tilt } from './controls/tilt';

export type AppMode = 'downhill' | 'plaza';

export function Launcher({
  settings,
  onSettings,
  onPick,
}: {
  settings: ControlSettings;
  onSettings: (s: ControlSettings) => void;
  onPick: (mode: AppMode) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const best = loadBest();

  const pick = async (mode: AppMode) => {
    // iOS only grants motion access from inside a tap handler, so ask here.
    if (settings.tilt) {
      const r = await tilt.requestPermission();
      if (r !== 'granted') {
        const next = { ...settings, tilt: false };
        saveSettings(next);
        onSettings(next);
        setNote(
          r === 'denied'
            ? 'motion access denied: using the virtual stick (enable in Settings → Noun World → Motion)'
            : 'no motion sensor: using the virtual stick',
        );
      }
    }
    onPick(mode);
  };

  return (
    <div className="nw-launcher">
      <div className="nw-launcher-title">NOUN WORLD</div>
      <div className="nw-launcher-sub">hold your phone sideways · tilt to steer</div>
      <div className="nw-launcher-btns">
        <button type="button" className="nw-big nw-big-main" onClick={() => void pick('downhill')}>
          <span>⛰ DOWNHILL</span>
          <small>drop in at the arch · how far can you get without bailing?</small>
          {best.clear > 0 && (
            <small className="opacity-70">
              best {best.clear} m · {best.survival.toFixed(1)} s
            </small>
          )}
        </button>
        <button type="button" className="nw-big" onClick={() => void pick('plaza')}>
          <span>🛹 PLAZA</span>
          <small>free skate Noggle Plaza with everyone online</small>
        </button>
      </div>
      <label className="nw-launcher-tilt">
        <input
          type="checkbox"
          checked={settings.tilt && Tilt.supported()}
          disabled={!Tilt.supported()}
          onChange={e => {
            const next = { ...settings, tilt: e.target.checked };
            saveSettings(next);
            onSettings(next);
          }}
        />
        tilt steering {Tilt.supported() ? '' : '(not available on this device)'}
      </label>
      {note && <div className="nw-launcher-note">{note}</div>}
    </div>
  );
}
