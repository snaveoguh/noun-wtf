/**
 * ClockApp — tabbed Clock / World Clock / Stopwatch / Timer.
 *
 * Subscribes to the (possibly absent) `system:tick` heartbeat for ticking; if
 * the time daemon isn't online, falls back to a 1s setInterval. The Now tab's
 * SVG analog clock uses requestAnimationFrame for the second hand so it
 * sweeps smoothly even between system ticks.
 *
 * Self-registers via `berryRegistry.register(...)`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { ALL_BERRY_EVENT_NAMES, berryBus } from '../system/eventBus';
import { berryRegistry } from '../system/berryRegistry';

// ---------------------------------------------------------------------------
// Shared tick hook — system:tick when available, setInterval otherwise.
// ---------------------------------------------------------------------------

function useSystemTick(intervalMs = 1000): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const hasSystemTick = ALL_BERRY_EVENT_NAMES.includes('system:tick' as never);
    if (hasSystemTick) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const off = (berryBus as any).on('system:tick', () => setTick(Date.now()));
      return () => off();
    }
    const id = window.setInterval(() => setTick(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return tick;
}

// ---------------------------------------------------------------------------
// Tabs scaffolding
// ---------------------------------------------------------------------------

type Tab = 'now' | 'world' | 'stopwatch' | 'timer';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'now', label: 'Now' },
  { id: 'world', label: 'World Clock' },
  { id: 'stopwatch', label: 'Stopwatch' },
  { id: 'timer', label: 'Timer' },
];

// ---------------------------------------------------------------------------
// Now tab — big digital + SVG analog clock
// ---------------------------------------------------------------------------

function NowTab(): ReactElement {
  // Digital clock ticks once per second; analog hands animate with rAF for
  // the smooth second-hand sweep.
  useSystemTick(1000);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setNow(new Date());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hours = now.getHours();
  const mins = now.getMinutes();
  const secs = now.getSeconds() + now.getMilliseconds() / 1000;

  // Analog: hour 30°/h, minute 6°/m, second 6°/s.
  const hourAngle = ((hours % 12) + mins / 60) * 30;
  const minAngle = (mins + secs / 60) * 6;
  const secAngle = secs * 6;

  const digital = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div
      style={{
        display: 'flex',
        gap: 24,
        padding: 16,
        height: '100%',
        boxSizing: 'border-box',
        alignItems: 'center',
      }}
    >
      {/* Analog */}
      <svg viewBox="-100 -100 200 200" width={160} height={160} aria-label="Analog clock">
        <defs>
          <radialGradient id="face" cx="0" cy="0" r="100" fx="-30" fy="-30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e5e5e5" />
          </radialGradient>
        </defs>
        <circle cx="0" cy="0" r="98" fill="url(#face)" stroke="#222" strokeWidth="2" />
        {/* Hour ticks */}
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const x1 = Math.sin(a) * 84;
          const y1 = -Math.cos(a) * 84;
          const x2 = Math.sin(a) * 92;
          const y2 = -Math.cos(a) * 92;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#222" strokeWidth="2" />;
        })}
        {/* Minute ticks */}
        {Array.from({ length: 60 }, (_, i) => {
          if (i % 5 === 0) return null;
          const a = (i * 6 * Math.PI) / 180;
          const x1 = Math.sin(a) * 88;
          const y1 = -Math.cos(a) * 88;
          const x2 = Math.sin(a) * 92;
          const y2 = -Math.cos(a) * 92;
          return <line key={`m-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#888" strokeWidth="0.6" />;
        })}
        {/* Hour hand */}
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="-50"
          stroke="#1a1a1a"
          strokeWidth="5"
          strokeLinecap="round"
          transform={`rotate(${hourAngle})`}
        />
        {/* Minute hand */}
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="-72"
          stroke="#1a1a1a"
          strokeWidth="3"
          strokeLinecap="round"
          transform={`rotate(${minAngle})`}
        />
        {/* Second hand */}
        <line
          x1="0"
          y1="10"
          x2="0"
          y2="-80"
          stroke="#d3553e"
          strokeWidth="1.4"
          strokeLinecap="round"
          transform={`rotate(${secAngle})`}
        />
        <circle cx="0" cy="0" r="4" fill="#1a1a1a" />
        <circle cx="0" cy="0" r="2" fill="#d3553e" />
      </svg>

      {/* Digital */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--theme-font-mono, "SFMono-Regular", Menlo, monospace)',
            fontSize: 44,
            fontWeight: 700,
            color: 'var(--theme-text-primary)',
            letterSpacing: 1,
            lineHeight: 1.1,
          }}
        >
          {digital}
        </div>
        <div
          style={{
            fontFamily: 'var(--theme-font-display)',
            fontSize: 13,
            color: 'var(--theme-text-muted)',
            marginTop: 6,
          }}
        >
          {date}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// World Clock
// ---------------------------------------------------------------------------

const CITIES: ReadonlyArray<{ name: string; tz: string; flag: string }> = [
  { name: 'New York', tz: 'America/New_York', flag: '🇺🇸' },
  { name: 'London', tz: 'Europe/London', flag: '🇬🇧' },
  { name: 'Tokyo', tz: 'Asia/Tokyo', flag: '🇯🇵' },
  { name: 'Singapore', tz: 'Asia/Singapore', flag: '🇸🇬' },
  { name: 'Sydney', tz: 'Australia/Sydney', flag: '🇦🇺' },
];

function WorldClockTab(): ReactElement {
  useSystemTick(1000);
  const now = new Date();
  return (
    <div style={{ padding: 12 }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {CITIES.map(c => {
          const time = now.toLocaleTimeString('en-US', {
            timeZone: c.tz,
            hour: '2-digit',
            minute: '2-digit',
          });
          const date = now.toLocaleDateString('en-US', {
            timeZone: c.tz,
            weekday: 'short',
          });
          // Derive a tz offset string like "GMT+9" for the secondary line.
          const offset = (() => {
            try {
              const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: c.tz,
                timeZoneName: 'short',
              }).formatToParts(now);
              return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
            } catch {
              return '';
            }
          })();
          return (
            <li
              key={c.tz}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 8px',
                borderBottom: '1px solid var(--theme-border)',
                fontFamily: 'var(--theme-font-display)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }} aria-hidden>{c.flag}</span>
                <div>
                  <div style={{ fontSize: 14, color: 'var(--theme-text-primary)' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>
                    {date} · {offset}
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontFamily: 'var(--theme-font-mono, "SFMono-Regular", Menlo, monospace)',
                  fontSize: 22,
                  fontWeight: 600,
                  color: 'var(--theme-text-primary)',
                }}
              >
                {time}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stopwatch
// ---------------------------------------------------------------------------

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function fmtCS(elapsedMs: number): string {
  const totalCs = Math.floor(elapsedMs / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hr = Math.floor(totalMin / 60);
  return hr > 0
    ? `${pad(hr)}:${pad(min)}:${pad(sec)}.${pad(cs)}`
    : `${pad(min)}:${pad(sec)}.${pad(cs)}`;
}

function StopwatchTab(): ReactElement {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const startedAt = useRef<number | null>(null);
  const accumulated = useRef(0);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      if (startedAt.current != null) {
        setElapsed(accumulated.current + (performance.now() - startedAt.current));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const start = useCallback(() => {
    startedAt.current = performance.now();
    setRunning(true);
  }, []);
  const stop = useCallback(() => {
    if (startedAt.current != null) {
      accumulated.current += performance.now() - startedAt.current;
      startedAt.current = null;
    }
    setRunning(false);
  }, []);
  const reset = useCallback(() => {
    startedAt.current = null;
    accumulated.current = 0;
    setElapsed(0);
    setLaps([]);
    setRunning(false);
  }, []);
  const lap = useCallback(() => {
    setLaps(l => [elapsed, ...l]);
  }, [elapsed]);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', boxSizing: 'border-box' }}>
      <div
        style={{
          fontFamily: 'var(--theme-font-mono, "SFMono-Regular", Menlo, monospace)',
          fontSize: 42,
          fontWeight: 700,
          color: 'var(--theme-text-primary)',
          textAlign: 'center',
          padding: '8px 0',
          letterSpacing: 1,
        }}
      >
        {fmtCS(elapsed)}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {!running ? (
          <button type="button" onClick={start} style={btnStyle('go')}>
            Start
          </button>
        ) : (
          <button type="button" onClick={stop} style={btnStyle('stop')}>
            Stop
          </button>
        )}
        <button type="button" onClick={running ? lap : reset} style={btnStyle('neutral')}>
          {running ? 'Lap' : 'Reset'}
        </button>
      </div>
      {laps.length > 0 && (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid var(--theme-border)',
            borderRadius: 4,
            padding: 4,
          }}
        >
          {laps.map((t, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 8px',
                fontFamily: 'var(--theme-font-mono, "SFMono-Regular", Menlo, monospace)',
                fontSize: 12,
                color: 'var(--theme-text-secondary)',
                borderBottom: i === laps.length - 1 ? 'none' : '1px solid var(--theme-border)',
              }}
            >
              <span>Lap {laps.length - i}</span>
              <span>{fmtCS(t)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

/**
 * Play a "boot chime" — best-effort. We try the global `playBootChime` (set
 * by the boot sequence agent if present) first; otherwise generate a short
 * sine ping with WebAudio so the timer always makes a sound.
 */
function playChime(): void {
  try {
    const global = window as unknown as { playBootChime?: () => void };
    if (typeof global.playBootChime === 'function') {
      global.playBootChime();
      return;
    }
  } catch { /* fallthrough to webaudio */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.start(now);
    osc.stop(now + 0.65);
    osc.onended = () => ctx.close();
  } catch {
    /* WebAudio unavailable / blocked — silent. */
  }
}

function TimerTab(): ReactElement {
  const [hours, setHours] = useState(0);
  const [mins, setMins] = useState(5);
  const [secs, setSecs] = useState(0);
  const [running, setRunning] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const totalMs = useRef(0);

  useEffect(() => {
    if (!running || remainingMs == null) return;
    let raf = 0;
    const loop = () => {
      if (startedAt.current != null) {
        const remaining = totalMs.current - (performance.now() - startedAt.current);
        if (remaining <= 0) {
          setRemainingMs(0);
          setRunning(false);
          startedAt.current = null;
          playChime();
          return;
        }
        setRemainingMs(remaining);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, remainingMs]);

  const start = useCallback(() => {
    const total = hours * 3600_000 + mins * 60_000 + secs * 1000;
    if (total <= 0) return;
    totalMs.current = total;
    startedAt.current = performance.now();
    setRemainingMs(total);
    setRunning(true);
  }, [hours, mins, secs]);

  const stop = useCallback(() => {
    setRunning(false);
    startedAt.current = null;
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    setRemainingMs(null);
    startedAt.current = null;
  }, []);

  const display = useMemo(() => {
    const ms = remainingMs ?? hours * 3600_000 + mins * 60_000 + secs * 1000;
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }, [remainingMs, hours, mins, secs]);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', height: '100%', boxSizing: 'border-box' }}>
      <div
        style={{
          fontFamily: 'var(--theme-font-mono, "SFMono-Regular", Menlo, monospace)',
          fontSize: 48,
          fontWeight: 700,
          color: remainingMs === 0 ? 'var(--theme-accent)' : 'var(--theme-text-primary)',
          letterSpacing: 1,
        }}
      >
        {display}
      </div>
      {remainingMs == null ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SpinInput label="hr" value={hours} onChange={setHours} max={23} />
          <span>:</span>
          <SpinInput label="min" value={mins} onChange={setMins} max={59} />
          <span>:</span>
          <SpinInput label="sec" value={secs} onChange={setSecs} max={59} />
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        {!running ? (
          <button type="button" onClick={start} style={btnStyle('go')}>
            Start
          </button>
        ) : (
          <button type="button" onClick={stop} style={btnStyle('stop')}>
            Pause
          </button>
        )}
        <button type="button" onClick={reset} style={btnStyle('neutral')}>
          Reset
        </button>
      </div>
    </div>
  );
}

function SpinInput({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  max: number;
}): ReactElement {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 11, color: 'var(--theme-text-muted)' }}>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={e => {
          const n = Math.max(0, Math.min(max, parseInt(e.target.value || '0', 10)));
          onChange(Number.isNaN(n) ? 0 : n);
        }}
        style={{
          width: 48,
          textAlign: 'center',
          fontFamily: 'var(--theme-font-mono, "SFMono-Regular", Menlo, monospace)',
          fontSize: 20,
          padding: 4,
          border: '1px solid var(--theme-border-strong)',
          borderRadius: 4,
          background: 'var(--theme-bg-card)',
          color: 'var(--theme-text-primary)',
        }}
      />
      <span style={{ fontFamily: 'var(--theme-font-display)' }}>{label}</span>
    </label>
  );
}

function btnStyle(kind: 'go' | 'stop' | 'neutral'): React.CSSProperties {
  const bg =
    kind === 'go'
      ? 'linear-gradient(180deg, #4ec76b 0%, #2c9c4b 100%)'
      : kind === 'stop'
        ? 'linear-gradient(180deg, #e85a5a 0%, #c83333 100%)'
        : 'linear-gradient(180deg, #f0f0f0 0%, #d8d8d8 100%)';
  const color = kind === 'neutral' ? '#1a1a1a' : '#fff';
  return {
    background: bg,
    color,
    border: '1px solid rgba(0, 0, 0, 0.4)',
    borderRadius: 6,
    padding: '6px 18px',
    fontFamily: 'var(--theme-font-display)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 1px 2px rgba(0,0,0,0.2)',
    minWidth: 80,
  };
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function ClockApp(): ReactElement {
  const [tab, setTab] = useState<Tab>('now');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--theme-bg-card)',
        fontFamily: 'var(--theme-font-display)',
      }}
    >
      {/* Tab bar */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 0,
          padding: '6px 8px 0',
          borderBottom: '1px solid var(--theme-border)',
          background:
            'linear-gradient(180deg, #f6f6f6 0%, #e6e6e6 100%)',
        }}
      >
        {TABS.map(t => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontFamily: 'var(--theme-font-display)',
                fontWeight: active ? 600 : 400,
                background: active ? 'var(--theme-bg-card)' : 'transparent',
                color: active ? 'var(--theme-text-primary)' : 'var(--theme-text-muted)',
                border: '1px solid var(--theme-border)',
                borderBottom: active ? '1px solid var(--theme-bg-card)' : '1px solid var(--theme-border)',
                borderRadius: '6px 6px 0 0',
                marginRight: 2,
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'now' && <NowTab />}
        {tab === 'world' && <WorldClockTab />}
        {tab === 'stopwatch' && <StopwatchTab />}
        {tab === 'timer' && <TimerTab />}
      </div>
    </div>
  );
}

berryRegistry.register({
  id: 'clock',
  name: 'Clock',
  icon: '🕐',
  component: ClockApp,
  defaultWindow: { w: 420, h: 380 },
  capabilities: [],
});

export default ClockApp;
