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

import {
  GlassButton,
  GlassInput,
  GlassTabs,
} from '@/liquid-sand/glass';
import { Globe } from '@/liquid-sand/icons';

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
  { id: 'world', label: 'World' },
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
    // HIG 8pt grid: 16pt content padding, 16pt section gap
    <div className="flex h-full box-border items-center" style={{ padding: 16, gap: 16 }}>
      {/* Analog */}
      <svg viewBox="-100 -100 200 200" width={160} height={160} aria-label="Analog clock">
        <defs>
          <radialGradient id="face" cx="0" cy="0" r="100" fx="-30" fy="-30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--ls-sand-50)" />
            <stop offset="100%" stopColor="var(--ls-sand-200)" />
          </radialGradient>
        </defs>
        <circle cx="0" cy="0" r="98" fill="url(#face)" stroke="var(--ls-sand-700)" strokeWidth="2" />
        {/* Hour ticks */}
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const x1 = Math.sin(a) * 84;
          const y1 = -Math.cos(a) * 84;
          const x2 = Math.sin(a) * 92;
          const y2 = -Math.cos(a) * 92;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ls-sand-700)" strokeWidth="2" strokeLinecap="round" />;
        })}
        {/* Minute ticks */}
        {Array.from({ length: 60 }, (_, i) => {
          if (i % 5 === 0) return null;
          const a = (i * 6 * Math.PI) / 180;
          const x1 = Math.sin(a) * 88;
          const y1 = -Math.cos(a) * 88;
          const x2 = Math.sin(a) * 92;
          const y2 = -Math.cos(a) * 92;
          return <line key={`m-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ls-sand-500)" strokeWidth="0.6" />;
        })}
        {/* Hour hand */}
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="-50"
          stroke="var(--ls-fg-primary)"
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
          stroke="var(--ls-fg-primary)"
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
          stroke="var(--ls-accent)"
          strokeWidth="1.4"
          strokeLinecap="round"
          transform={`rotate(${secAngle})`}
        />
        <circle cx="0" cy="0" r="4" fill="var(--ls-fg-primary)" />
        <circle cx="0" cy="0" r="2" fill="var(--ls-accent)" />
      </svg>

      {/* Digital — HIG: 34pt large title with tabular-nums, 13pt date below */}
      <div className="flex-1 min-w-0">
        <div
          style={{
            fontFamily: 'var(--ls-font-mono)',
            fontSize: 'var(--ls-text-3xl)',
            fontWeight: 700,
            color: 'var(--ls-fg-primary)',
            letterSpacing: 0.5,
            lineHeight: 1.15,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {digital}
        </div>
        <div
          style={{
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-sm)',
            lineHeight: 1.4,
            color: 'var(--ls-fg-secondary)',
            marginTop: 8,
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

const CITIES: ReadonlyArray<{ name: string; tz: string }> = [
  { name: 'New York', tz: 'America/New_York' },
  { name: 'London', tz: 'Europe/London' },
  { name: 'Tokyo', tz: 'Asia/Tokyo' },
  { name: 'Singapore', tz: 'Asia/Singapore' },
  { name: 'Sydney', tz: 'Australia/Sydney' },
];

function WorldClockTab(): ReactElement {
  useSystemTick(1000);
  const now = new Date();
  return (
    // HIG 8pt grid: 16pt content padding, 8pt item gap
    <div className="flex flex-col" style={{ padding: 16, gap: 8 }}>
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
          // Solid sand surface, not nested glass — HIG visionOS rule
          <div
            key={c.tz}
            style={{
              background: 'var(--ls-sand-50)',
              borderRadius: 'var(--ls-r-md)',
              border: '1px solid var(--ls-border-glass)',
              padding: 16,
              minHeight: 44,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Globe size={20} style={{ color: 'var(--ls-fg-secondary)', flexShrink: 0 }} />
                <div className="min-w-0">
                  <div
                    style={{
                      fontSize: 'var(--ls-text-lg)',
                      lineHeight: 1.3,
                      color: 'var(--ls-fg-primary)',
                      fontWeight: 600,
                    }}
                  >
                    {c.name}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--ls-text-xs)',
                      lineHeight: 1.4,
                      color: 'var(--ls-fg-muted)',
                      marginTop: 2,
                    }}
                  >
                    {date} · {offset}
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 'var(--ls-text-xl)',
                  lineHeight: 1.2,
                  fontWeight: 600,
                  color: 'var(--ls-fg-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {time}
              </div>
            </div>
          </div>
        );
      })}
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
    // HIG 8pt grid: 16pt content padding, 16pt section gap
    <div className="flex flex-col h-full box-border" style={{ padding: 16, gap: 16 }}>
      {/* Stopwatch display — 34pt large title */}
      <div
        className="text-center"
        style={{
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 'var(--ls-text-3xl)',
          fontWeight: 700,
          color: 'var(--ls-fg-primary)',
          letterSpacing: 0.5,
          lineHeight: 1.2,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {fmtCS(elapsed)}
      </div>
      <div className="flex justify-center" style={{ gap: 8 }}>
        {!running ? (
          <GlassButton variant="primary" size="md" onClick={start}>
            Start
          </GlassButton>
        ) : (
          <GlassButton variant="danger" size="md" onClick={stop}>
            Stop
          </GlassButton>
        )}
        <GlassButton variant="default" size="md" onClick={running ? lap : reset}>
          {running ? 'Lap' : 'Reset'}
        </GlassButton>
      </div>
      {laps.length > 0 && (
        // Solid surface — no nested glass over text
        <div
          className="flex-1 overflow-auto"
          style={{
            background: 'var(--ls-sand-50)',
            borderRadius: 'var(--ls-r-md)',
            border: '1px solid var(--ls-border-glass)',
          }}
        >
          {laps.map((t, i) => (
            <div
              key={i}
              className="flex justify-between"
              style={{
                fontFamily: 'var(--ls-font-mono)',
                fontSize: 'var(--ls-text-sm)',
                lineHeight: 1.4,
                color: 'var(--ls-fg-secondary)',
                padding: '8px 16px',
                borderBottom:
                  i === laps.length - 1 ? 'none' : '1px solid var(--ls-border-glass)',
                fontVariantNumeric: 'tabular-nums',
                minHeight: 32,
                alignItems: 'center',
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
    <div className="flex flex-col items-center h-full box-border" style={{ padding: 16, gap: 16 }}>
      <div
        style={{
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 'var(--ls-text-3xl)',
          fontWeight: 700,
          color: remainingMs === 0 ? 'var(--ls-accent)' : 'var(--ls-fg-primary)',
          letterSpacing: 0.5,
          lineHeight: 1.2,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {display}
      </div>
      {remainingMs == null ? (
        <div className="flex items-center" style={{ gap: 8 }}>
          <SpinInput label="hr" value={hours} onChange={setHours} max={23} />
          <span style={{ color: 'var(--ls-fg-muted)', fontSize: 'var(--ls-text-lg)' }}>:</span>
          <SpinInput label="min" value={mins} onChange={setMins} max={59} />
          <span style={{ color: 'var(--ls-fg-muted)', fontSize: 'var(--ls-text-lg)' }}>:</span>
          <SpinInput label="sec" value={secs} onChange={setSecs} max={59} />
        </div>
      ) : null}
      <div className="flex" style={{ gap: 8 }}>
        {!running ? (
          <GlassButton variant="primary" size="md" onClick={start}>
            Start
          </GlassButton>
        ) : (
          <GlassButton variant="danger" size="md" onClick={stop}>
            Pause
          </GlassButton>
        )}
        <GlassButton variant="default" size="md" onClick={reset}>
          Reset
        </GlassButton>
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
    <label className="flex flex-col items-center" style={{ fontSize: 'var(--ls-text-xs)', lineHeight: 1.4, color: 'var(--ls-fg-muted)', gap: 4 }}>
      <GlassInput
        type="number"
        min={0}
        max={max}
        value={String(value)}
        onChange={e => {
          const n = Math.max(0, Math.min(max, parseInt(e.target.value || '0', 10)));
          onChange(Number.isNaN(n) ? 0 : n);
        }}
        wrapperClassName="!w-16"
        style={{
          textAlign: 'center',
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 'var(--ls-text-lg)',
          fontVariantNumeric: 'tabular-nums',
          minHeight: 32,
        }}
      />
      <span style={{ fontFamily: 'var(--ls-font-sans)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function ClockApp(): ReactElement {
  const [tab, setTab] = useState<Tab>('now');

  return (
    <div
      className="flex flex-col h-full"
      style={{
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
      }}
    >
      {/* Tab bar */}
      <div className="flex justify-center px-3 py-2.5">
        <GlassTabs value={tab} onValueChange={v => setTab(v as Tab)} size="sm">
          {TABS.map(t => (
            <GlassTabs.Item key={t.id} value={t.id}>
              {t.label}
            </GlassTabs.Item>
          ))}
        </GlassTabs>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
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
