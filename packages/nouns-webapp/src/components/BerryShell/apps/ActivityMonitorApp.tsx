/**
 * Activity Monitor — BerryOS process + bus + perf inspector.
 *
 * Tabs:
 *   Apps         running apps (one row per registered descriptor; "running" =
 *                ≥1 window or focused). Force Quit closes every window for
 *                that appId and emits `app:terminating`.
 *   Events       live tail of bus traffic with filter / pause / clear. Each
 *                row expandable to a pretty-printed payload.
 *   Services     placeholder until the services system lands. Reads
 *                berryRegistry.capabilities() to surface declared services per
 *                app for now.
 *   Performance  60-sample sparklines for window count + event rate, plus a
 *                live uptime read-out.
 *
 * Self-registers via `berryRegistry.register(...)` at module import time.
 * Boots the bus history wrapper on first render so the Events tab has data
 * even when launched late in the session.
 */

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
} from 'react';

import { berryRegistry } from '../system/berryRegistry';
import {
  clearHistory,
  getBootTimestamp,
  getHistory,
  replayEvent,
  replaySequence,
  startBusHistory,
  subscribeHistory,
  type BusHistoryEntry,
} from '../system/busHistory';
import {
  CATEGORY_COLOR,
  categoryFor,
  chipStyle,
  compactJson,
  dangerButtonStyle,
  formatDuration,
  formatTime,
  inputStyle,
  MONO_FONT,
  subtleButtonStyle,
  tableBodyStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableHeaderRowStyle,
  tableRowStyle,
  tableShellStyle,
  tabBarStyle,
  tabButtonStyle,
  toolbarStyle,
  type EventCategory,
} from '../system/devtoolsStyles';
import { windowStore, type BerryWindowState } from '../store/windowStore';

type Tab = 'apps' | 'events' | 'services' | 'performance';

/* ----------------------------------------------------------------------- */
/* Hooks                                                                    */
/* ----------------------------------------------------------------------- */

function useWindows(): BerryWindowState[] {
  return useSyncExternalStore(
    cb => windowStore.subscribe(cb),
    () => windowStore.getState().windows,
    () => windowStore.getState().windows,
  );
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Subscribes to the bus history and yields the latest entries, optionally
 * paused. When paused, accumulated events still capture into history (the
 * underlying buffer keeps moving) — we just stop re-rendering with new ones.
 */
function useLiveHistory(paused: boolean): BusHistoryEntry[] {
  const [entries, setEntries] = useState<BusHistoryEntry[]>(() => getHistory().slice().reverse());
  useEffect(() => {
    if (paused) return undefined;
    setEntries(getHistory().slice().reverse());
    const off = subscribeHistory(entry => {
      setEntries(prev => {
        const next = [entry, ...prev];
        if (next.length > 600) next.length = 600;
        return next;
      });
    });
    return off;
  }, [paused]);
  return entries;
}

/* ----------------------------------------------------------------------- */
/* Apps tab                                                                 */
/* ----------------------------------------------------------------------- */

interface RunningAppRow {
  appId: string;
  name: string;
  icon: string;
  windowCount: number;
  firstOpenedTs: number;
  lastActiveTs: number;
}

function buildRunningApps(
  windows: BerryWindowState[],
  history: BusHistoryEntry[],
): RunningAppRow[] {
  const byApp = new Map<string, RunningAppRow>();
  for (const desc of berryRegistry.list()) {
    byApp.set(desc.id, {
      appId: desc.id,
      name: desc.name,
      icon: desc.icon,
      windowCount: 0,
      firstOpenedTs: 0,
      lastActiveTs: 0,
    });
  }
  for (const w of windows) {
    const row = byApp.get(w.appId) ?? {
      appId: w.appId,
      name: w.title || w.appId,
      icon: w.icon || '🖼️',
      windowCount: 0,
      firstOpenedTs: 0,
      lastActiveTs: 0,
    };
    row.windowCount += 1;
    byApp.set(w.appId, row);
  }
  for (const entry of history) {
    if (!entry.sourceAppId) continue;
    const row = byApp.get(entry.sourceAppId);
    if (!row) continue;
    if (!row.firstOpenedTs || entry.timestamp < row.firstOpenedTs) {
      if (entry.name === 'window:created' || entry.name === 'app:launched') {
        row.firstOpenedTs = entry.timestamp;
      }
    }
    if (entry.timestamp > row.lastActiveTs) row.lastActiveTs = entry.timestamp;
  }
  return Array.from(byApp.values())
    .filter(r => r.windowCount > 0)
    .sort((a, b) => b.lastActiveTs - a.lastActiveTs);
}

function AppsTab() {
  const windows = useWindows();
  const now = useNow(1000);
  const [history, setHistory] = useState<BusHistoryEntry[]>(() => getHistory());
  useEffect(() => {
    setHistory(getHistory());
    const off = subscribeHistory(() => setHistory(getHistory()));
    return off;
  }, []);
  const rows = useMemo(() => buildRunningApps(windows, history), [windows, history]);

  const cols = '32px 1fr 80px 100px 130px 100px';
  return (
    <div style={tableShellStyle}>
      <div style={{ ...tableHeaderRowStyle, gridTemplateColumns: cols }}>
        <div style={tableHeaderCellStyle}></div>
        <div style={tableHeaderCellStyle}>App</div>
        <div style={{ ...tableHeaderCellStyle, textAlign: 'right' }}>Windows</div>
        <div style={{ ...tableHeaderCellStyle, textAlign: 'right' }}>Runtime</div>
        <div style={{ ...tableHeaderCellStyle, textAlign: 'right' }}>Last Active</div>
        <div style={{ ...tableHeaderCellStyle, borderRight: 'none' }}></div>
      </div>
      <div style={tableBodyStyle}>
        {rows.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#8e8e93', fontSize: 13, lineHeight: 1.4 }}>
            No apps running.
          </div>
        )}
        {rows.map((r, i) => {
          const runtime = r.firstOpenedTs ? now - r.firstOpenedTs : 0;
          const lastActive = r.lastActiveTs ? now - r.lastActiveTs : 0;
          return (
            <div
              key={r.appId}
              style={{ ...tableRowStyle(i % 2 === 1), gridTemplateColumns: cols }}
            >
              <div style={{ ...tableCellStyle, textAlign: 'center' }}>{r.icon}</div>
              <div style={tableCellStyle}>
                {/* HIG: 17pt body text for app name */}
                <span style={{ fontWeight: 600, fontSize: 15, fontFamily: 'var(--ls-font-sans, -apple-system, system-ui, sans-serif)' }}>{r.name}</span>
                <span style={{ color: '#8e8e93', marginLeft: 8, fontSize: 11, fontFamily: MONO_FONT }}>
                  {r.appId}
                </span>
              </div>
              <div style={{ ...tableCellStyle, textAlign: 'right' }}>{r.windowCount}</div>
              <div style={{ ...tableCellStyle, textAlign: 'right' }}>
                {runtime ? formatDuration(runtime) : '—'}
              </div>
              <div style={{ ...tableCellStyle, textAlign: 'right' }}>
                {lastActive < 2000 ? (
                  <span style={{ color: '#28cd41' }}>● now</span>
                ) : (
                  formatDuration(lastActive) + ' ago'
                )}
              </div>
              <div style={{ ...tableCellStyle, borderRight: 'none', textAlign: 'right' }}>
                <button
                  type="button"
                  style={dangerButtonStyle}
                  onClick={() => forceQuit(r.appId, windows)}
                  title={`Force quit ${r.name}`}
                >
                  Force Quit
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function forceQuit(appId: string, windows: BerryWindowState[]): void {
  const targets = windows.filter(w => w.appId === appId);
  if (!targets.length) return;
  // The windowStore.close() helper already emits app:terminating + terminated
  // when the last window for an appId closes. Iterate in id-order so the
  // event sequence stays predictable in the Events tab.
  for (const t of targets) windowStore.close(t.id);
}

/* ----------------------------------------------------------------------- */
/* Events tab                                                               */
/* ----------------------------------------------------------------------- */

function EventsTab() {
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [stepIndex, setStepIndex] = useState<number>(-1);
  const [activeReplay, setActiveReplay] = useState<{ cancel: () => void } | null>(null);
  const entries = useLiveHistory(paused);

  const filtered = useMemo(() => {
    if (!filter.trim()) return entries;
    const f = filter.trim().toLowerCase();
    const appIdMatch = f.match(/^appid:(.+)$/);
    if (appIdMatch) {
      const target = appIdMatch[1]?.trim();
      return entries.filter(e => e.sourceAppId === target);
    }
    return entries.filter(
      e =>
        e.name.toLowerCase().includes(f) ||
        (e.sourceAppId ?? '').toLowerCase().includes(f) ||
        compactJson(e.payload, 200).toLowerCase().includes(f),
    );
  }, [entries, filter]);

  function toggleExpand(id: number): void {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function step(): void {
    // Step through the visible (filtered) list newest → oldest, replaying
    // the next entry on each click.
    const list = [...filtered].reverse(); // chronological for stepping
    const nextIdx = stepIndex + 1;
    if (nextIdx >= list.length) {
      setStepIndex(-1);
      return;
    }
    const target = list[nextIdx];
    if (target) replayEvent(target.id);
    setStepIndex(nextIdx);
  }

  function playRange(): void {
    if (filtered.length === 0) return;
    const ids = filtered.map(e => e.id).sort((a, b) => a - b);
    const fromId = ids[0]!;
    const toId = ids[ids.length - 1]!;
    if (activeReplay) activeReplay.cancel();
    const handle = replaySequence(fromId, toId, replaySpeed);
    setActiveReplay(handle);
    handle.done.then(() => setActiveReplay(null));
  }

  function replayOne(): void {
    if (selected != null) replayEvent(selected);
  }

  const cols = '90px 200px 1fr 130px 90px';

  return (
    <div style={tableShellStyle}>
      <div style={toolbarStyle}>
        <input
          style={inputStyle}
          placeholder="Filter — substring or appId:foo"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button
          type="button"
          style={subtleButtonStyle}
          onClick={() => setPaused(p => !p)}
          title={paused ? 'Resume live updates' : 'Pause live updates'}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button
          type="button"
          style={subtleButtonStyle}
          onClick={() => {
            clearHistory();
            setExpanded(new Set());
            setStepIndex(-1);
          }}
        >
          Clear
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: '#c0c0c0' }} />
        <button
          type="button"
          style={subtleButtonStyle}
          onClick={replayOne}
          disabled={selected == null}
          title="Re-emit the selected event onto the live bus"
        >
          ↻ Replay
        </button>
        <button
          type="button"
          style={subtleButtonStyle}
          onClick={step}
          title="Step through filtered events one at a time"
        >
          ⏭ Step
        </button>
        <button
          type="button"
          style={subtleButtonStyle}
          onClick={playRange}
          title="Replay the filtered range at original timing × speed"
        >
          ▶ Play
        </button>
        <select
          value={replaySpeed}
          onChange={e => setReplaySpeed(Number(e.target.value))}
          style={{ ...subtleButtonStyle, padding: '2px 4px' }}
          title="Replay speed multiplier"
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={5}>5×</option>
          <option value={10}>10×</option>
        </select>
        {activeReplay && (
          <button
            type="button"
            style={dangerButtonStyle}
            onClick={() => {
              activeReplay.cancel();
              setActiveReplay(null);
            }}
          >
            Stop
          </button>
        )}
        <span style={{ marginLeft: 'auto', color: '#8e8e93', fontSize: 11 }}>
          {filtered.length} / {entries.length}
        </span>
      </div>
      <div style={{ ...tableHeaderRowStyle, gridTemplateColumns: cols }}>
        <div style={tableHeaderCellStyle}>Time</div>
        <div style={tableHeaderCellStyle}>Event</div>
        <div style={tableHeaderCellStyle}>Payload</div>
        <div style={tableHeaderCellStyle}>Source App</div>
        <div style={{ ...tableHeaderCellStyle, borderRight: 'none', textAlign: 'right' }}>#</div>
      </div>
      <div style={tableBodyStyle}>
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#8e8e93', fontSize: 13, lineHeight: 1.4 }}>
            {paused ? 'Paused.' : 'No events captured yet — open a window.'}
          </div>
        )}
        {filtered.map((e, i) => {
          const cat = categoryFor(e.name);
          const tint = CATEGORY_COLOR[cat];
          const isExpanded = expanded.has(e.id);
          const isSelected = selected === e.id;
          const rowBg = isSelected
            ? '#dbeafe'
            : i % 2 === 1
              ? `linear-gradient(90deg, ${tint.bg} 0%, ${tint.bg} 100%)`
              : '#ffffff';
          return (
            <Fragment key={e.id}>
              <div
                onClick={() => setSelected(e.id)}
                onDoubleClick={() => toggleExpand(e.id)}
                style={{
                  ...tableRowStyle(i % 2 === 1, rowBg),
                  gridTemplateColumns: cols,
                  cursor: 'pointer',
                  borderLeft: `2px solid ${tint.dot}`,
                }}
              >
                <div style={{ ...tableCellStyle, color: '#3c3c43' }}>{formatTime(e.timestamp)}</div>
                <div style={tableCellStyle}>
                  <span style={chipStyle(cat)}>● {e.name}</span>
                </div>
                <div style={tableCellStyle}>{compactJson(e.payload)}</div>
                <div style={{ ...tableCellStyle, color: tint.fg }}>
                  {e.sourceAppId ?? '—'}
                </div>
                <div
                  style={{ ...tableCellStyle, borderRight: 'none', textAlign: 'right', color: '#8e8e93' }}
                >
                  {e.id}
                </div>
              </div>
              {isExpanded && (
                <div
                  style={{
                    background: '#1d1d1f',
                    color: '#f4f4f4',
                    padding: '12px 16px',
                    fontFamily: MONO_FONT,
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    borderBottom: '1px solid #efefef',
                  }}
                >
                  {prettyJson(e.payload)}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function prettyJson(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

/* ----------------------------------------------------------------------- */
/* Services tab                                                             */
/* ----------------------------------------------------------------------- */

function ServicesTab() {
  // Future services system not present yet — surface declared capabilities
  // per registered app so the panel isn't empty. When a real service registry
  // lands, swap the source.
  const apps = berryRegistry.list();
  const cols = '32px 1fr 1fr 90px';
  return (
    <div style={tableShellStyle}>
      <div style={{ ...tableHeaderRowStyle, gridTemplateColumns: cols }}>
        <div style={tableHeaderCellStyle}></div>
        <div style={tableHeaderCellStyle}>App</div>
        <div style={tableHeaderCellStyle}>Capabilities</div>
        <div style={{ ...tableHeaderCellStyle, borderRight: 'none', textAlign: 'right' }}>
          Status
        </div>
      </div>
      <div style={tableBodyStyle}>
        {apps.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#8e8e93', fontSize: 13, lineHeight: 1.4 }}>
            No services registered.
          </div>
        )}
        {apps.map((a, i) => (
          <div
            key={a.id}
            style={{ ...tableRowStyle(i % 2 === 1), gridTemplateColumns: cols }}
          >
            <div style={{ ...tableCellStyle, textAlign: 'center' }}>{a.icon}</div>
            <div style={{ ...tableCellStyle, fontWeight: 600 }}>{a.name}</div>
            <div style={{ ...tableCellStyle, color: '#3c3c43' }}>
              {(a.capabilities ?? []).join(', ') || '—'}
            </div>
            <div
              style={{
                ...tableCellStyle,
                borderRight: 'none',
                textAlign: 'right',
                color: '#1f7a31',
              }}
            >
              ● ready
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Performance tab                                                          */
/* ----------------------------------------------------------------------- */

const PERF_SAMPLES = 60;

function usePerfSamples(): { windows: number[]; rate: number[]; lastTotal: number } {
  const windowsArr = useWindows();
  const [windowsSamples, setWindowsSamples] = useState<number[]>(() =>
    Array.from({ length: PERF_SAMPLES }, () => 0),
  );
  const [rateSamples, setRateSamples] = useState<number[]>(() =>
    Array.from({ length: PERF_SAMPLES }, () => 0),
  );
  const lastCountRef = useRef<number>(getHistory().length);
  const totalRef = useRef<number>(getHistory().length);

  useEffect(() => {
    // Update the rolling rate every second by counting how many entries the
    // history grew by since last sample.
    const id = window.setInterval(() => {
      const current = getHistory().length;
      const captured = current; // not strictly equal to total ids, but a stable
                                // proxy for "entries currently in buffer"
      // delta = entries appended since last tick (clamp at 0 for ring overflow)
      const delta = Math.max(0, totalRef.current === 0 ? captured : captured - lastCountRef.current);
      lastCountRef.current = captured;
      totalRef.current = captured;
      setRateSamples(prev => {
        const next = prev.slice(1);
        next.push(delta);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setWindowsSamples(prev => {
      const next = prev.slice(1);
      next.push(windowsArr.length);
      return next;
    });
  }, [windowsArr.length]);

  // Tick once per second to push the *current* window count even when nothing
  // changes — prevents the chart from flatlining at the previous value.
  useEffect(() => {
    const id = window.setInterval(() => {
      setWindowsSamples(prev => {
        const next = prev.slice(1);
        next.push(prev[prev.length - 1] ?? 0);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return { windows: windowsSamples, rate: rateSamples, lastTotal: totalRef.current };
}

function Sparkline(props: {
  samples: number[];
  color: string;
  fill: string;
  width?: number;
  height?: number;
}) {
  const { samples, color, fill } = props;
  const w = props.width ?? 320;
  const h = props.height ?? 60;
  const max = Math.max(1, ...samples);
  const stepX = w / Math.max(1, samples.length - 1);
  const points = samples
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  const area = `0,${h} ${points} ${w},${h}`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block', background: '#fff', border: '1px solid #d4d4d4', borderRadius: 4 }}
    >
      <polygon points={area} fill={fill} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function PerformanceTab() {
  const { windows, rate } = usePerfSamples();
  const now = useNow(1000);
  const uptime = now - getBootTimestamp();
  const currentRate = rate[rate.length - 1] ?? 0;
  const avgRate = rate.reduce((a, b) => a + b, 0) / Math.max(1, rate.length);

  const stat: CSSProperties = {
    fontVariantNumeric: 'tabular-nums',
    fontFamily: MONO_FONT,
    // HIG: 28pt+ headline
    fontSize: 28,
    lineHeight: 1.2,
    fontWeight: 700,
    color: '#1d1d1f',
  };
  const label: CSSProperties = {
    fontSize: 11,
    lineHeight: 1.4,
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: 600,
  };

  return (
    // HIG 8pt grid: 16pt content padding
    <div style={{ flex: 1, padding: 16, overflow: 'auto', background: '#f4f4f6' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          maxWidth: 720,
        }}
      >
        <Card title="Uptime" sub="Since boot">
          <div style={stat}>{formatDuration(uptime)}</div>
        </Card>
        <Card title="Open Windows" sub="Live">
          <div style={stat}>{windows[windows.length - 1] ?? 0}</div>
        </Card>
        <Card title="Event Rate" sub="Events / sec — current">
          <div style={stat}>{currentRate}</div>
          <div style={label}>avg {avgRate.toFixed(1)}/s</div>
        </Card>
        <Card title="Buffer" sub="Bus history capacity">
          <div style={stat}>{getHistory().length} / 500</div>
        </Card>
        <div style={{ gridColumn: '1 / -1' }}>
          <Card title="Window Count" sub="Last 60s">
            <Sparkline samples={windows} color="#007aff" fill="rgba(0,122,255,0.18)" />
          </Card>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Card title="Event Rate" sub="Events / sec, last 60s">
            <Sparkline samples={rate} color="#28cd41" fill="rgba(40,205,65,0.18)" />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card(props: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #d4d4d4',
        borderRadius: 8,
        padding: 16,
        boxShadow: '0 1px 0 rgba(0,0,0,0.03)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.4,
          color: '#8e8e93',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {props.title}
        {props.sub && (
          <span style={{ color: '#aeaeae', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
            — {props.sub}
          </span>
        )}
      </div>
      {props.children}
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Shell                                                                    */
/* ----------------------------------------------------------------------- */

const TAB_LABELS: Record<Tab, string> = {
  apps: 'Apps',
  events: 'Events',
  services: 'Services',
  performance: 'Performance',
};

const TAB_ORDER: readonly Tab[] = ['apps', 'events', 'services', 'performance'];

function ActivityMonitorApp(): ReactElement {
  const [tab, setTab] = useState<Tab>('events');
  // Lazy-boot: starting here means the wrapper is alive even if BerryShell
  // never imported it directly.
  useEffect(() => {
    startBusHistory();
  }, []);
  const live = useLiveHistory(false);

  // Per-category counters in the toolbar so the user sees the spread at a
  // glance — same colors used in the Events tab table tints.
  const counts = useMemo(() => {
    const acc: Record<EventCategory, number> = {
      window: 0,
      app: 0,
      system: 0,
      notification: 0,
      auction: 0,
      service: 0,
      permission: 0,
      hotkey: 0,
      other: 0,
    };
    for (const e of live) acc[categoryFor(e.name)] += 1;
    return acc;
  }, [live]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#ececec',
        fontFamily: 'var(--theme-font-display)',
        color: '#1d1d1f',
      }}
    >
      <div style={tabBarStyle}>
        {TAB_ORDER.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={tabButtonStyle(tab === t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 'auto',
            padding: '0 6px 4px 0',
            fontSize: 10,
            color: '#3c3c43',
          }}
        >
          {(Object.keys(counts) as EventCategory[])
            .filter(k => counts[k] > 0)
            .map(k => (
              <span key={k} style={chipStyle(k)}>
                {k} {counts[k]}
              </span>
            ))}
        </div>
      </div>
      {tab === 'apps' && <AppsTab />}
      {tab === 'events' && <EventsTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'performance' && <PerformanceTab />}
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Self-registration                                                        */
/* ----------------------------------------------------------------------- */

berryRegistry.register({
  id: 'activity-monitor',
  name: 'Activity Monitor',
  icon: '📊',
  component: ActivityMonitorApp,
  defaultWindow: { w: 720, h: 480 },
  capabilities: ['system:lifecycle'],
});

export default ActivityMonitorApp;
