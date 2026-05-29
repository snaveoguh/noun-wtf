// ── Movement Tuning Panel ────────────────────────────────────────────
//
// In-browser live tuner for movement feel. Toggle with backslash (\).
// Reads/writes the live TUNING singleton directly (outside React's
// render cycle) — sliders push patches via setTuning, preset buttons
// swap whole snapshots. The game loop reads TUNING every frame, so
// changes are felt instantly with no reload.

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  TUNING,
  TUNING_FIELDS,
  PRESET_NAMES,
  applyPreset,
  setTuning,
  activePreset,
  type MovementTuning,
  type PresetName,
} from './movementTuning';
import {
  ARENA_TUNING,
  ARENA_TUNING_FIELDS,
  setArenaTuning,
  type ArenaTuning,
} from './arenaTuning';

const GROUP_ORDER = ['Speed', 'Accel', 'Jump', 'Bhop', 'Dash', 'Slide', 'Wallrun'];

export function MovementTuningPanel(): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<PresetName>(activePreset());
  // Bump to force a re-render after a live mutation (TUNING is mutable,
  // not React state — we read it directly and tick this to repaint).
  const [, force] = useState(0);
  const repaint = () => force(n => n + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backslash') {
        // Don't steal the key while typing in an input.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof TUNING_FIELDS>();
    for (const f of TUNING_FIELDS) {
      const arr = m.get(f.group) ?? [];
      arr.push(f);
      m.set(f.group, arr);
    }
    return GROUP_ORDER.filter(g => m.has(g)).map(g => [g, m.get(g)!] as const);
  }, []);

  if (!open) {
    return (
      <div style={hintStyle} onClick={() => setOpen(true)}>
        \ tune
      </div>
    );
  }

  const onPreset = (name: PresetName) => {
    applyPreset(name);
    setPreset(name);
    repaint();
  };

  const onSlide = (key: keyof MovementTuning, value: number) => {
    setTuning({ [key]: value } as Partial<MovementTuning>);
    // A manual tweak means we've left the pristine preset.
    repaint();
  };

  const onArenaSlide = (key: keyof ArenaTuning, value: number) => {
    setArenaTuning({ [key]: value } as Partial<ArenaTuning>);
    repaint();
  };

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>MOVEMENT</span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>\ to hide</span>
      </div>

      <div style={presetRowStyle}>
        {PRESET_NAMES.map(name => (
          <button
            key={name}
            onClick={() => onPreset(name)}
            style={{
              ...presetBtnStyle,
              ...(preset === name ? presetBtnActiveStyle : null),
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <div style={scrollStyle}>
        {grouped.map(([group, fields]) => (
          <div key={group} style={{ marginBottom: 10 }}>
            <div style={groupLabelStyle}>{group}</div>
            {fields.map(f => {
              const val = TUNING[f.key] as number;
              return (
                <div key={f.key} style={rowStyle}>
                  <label style={fieldLabelStyle}>{f.label}</label>
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={val}
                    onChange={e => onSlide(f.key, parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: '#ff3df0' }}
                  />
                  <span style={valStyle}>{Number.isInteger(f.step) ? val : val.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        ))}

        {/* Sea-raid enemy pacing — separate live singleton (ARENA_TUNING).
            Spawn/wave knobs apply to the next spawn or wave; speed/hp are
            baked per monster as it surfaces. */}
        <div style={{ marginBottom: 10 }}>
          <div style={groupLabelStyle}>Arena</div>
          {ARENA_TUNING_FIELDS.map(f => {
            const val = ARENA_TUNING[f.key] as number;
            return (
              <div key={f.key} style={rowStyle}>
                <label style={fieldLabelStyle}>{f.label}</label>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={val}
                  onChange={e => onArenaSlide(f.key, parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: '#ff3df0' }}
                />
                <span style={valStyle}>{Number.isInteger(f.step) ? val : val.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const MonoFont =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace';

const hintStyle: React.CSSProperties = {
  position: 'fixed',
  top: 90,
  left: 8,
  zIndex: 50,
  pointerEvents: 'auto',
  cursor: 'pointer',
  fontFamily: MonoFont,
  fontSize: 11,
  color: '#ff3df0',
  background: 'rgba(0,0,0,0.5)',
  border: '1px solid rgba(255,61,240,0.4)',
  borderRadius: 4,
  padding: '2px 6px',
  userSelect: 'none',
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 8,
  zIndex: 50,
  pointerEvents: 'auto',
  width: 280,
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: MonoFont,
  fontSize: 11,
  color: '#e6e6e6',
  background: 'rgba(8,8,12,0.92)',
  border: '1px solid rgba(255,61,240,0.35)',
  borderRadius: 8,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  backdropFilter: 'blur(6px)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  color: '#ff3df0',
};

const presetRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  padding: '8px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const presetBtnStyle: React.CSSProperties = {
  flex: '1 0 auto',
  cursor: 'pointer',
  fontFamily: MonoFont,
  fontSize: 10,
  color: '#bbb',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4,
  padding: '4px 6px',
};

const presetBtnActiveStyle: React.CSSProperties = {
  color: '#000',
  background: '#ff3df0',
  borderColor: '#ff3df0',
  fontWeight: 700,
};

const scrollStyle: React.CSSProperties = {
  overflowY: 'auto',
  padding: '8px 10px',
};

const groupLabelStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 1,
  textTransform: 'uppercase',
  opacity: 0.5,
  marginBottom: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 3,
};

const fieldLabelStyle: React.CSSProperties = {
  width: 92,
  flexShrink: 0,
  fontSize: 10,
  opacity: 0.85,
};

const valStyle: React.CSSProperties = {
  width: 34,
  flexShrink: 0,
  textAlign: 'right',
  fontSize: 10,
  color: '#ff3df0',
};
