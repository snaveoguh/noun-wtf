/**
 * AboutApp — "About This Computer" panel.
 *
 * Reads:
 *   - Window count from windowStore (each window faked as 64MB).
 *   - LocalStorage usage estimated from byte length of stored values
 *     (5MB nominal quota — same number Safari/Chrome use).
 *   - Uptime from the `system:bootComplete` event timestamp; falls back to
 *     module-load time if boot already happened before this mounts.
 *   - Connected wallet via wagmi `useAccount`.
 *
 * "System Report" button launches Activity Monitor if it's registered;
 * silently no-ops otherwise.
 *
 * Self-registers via `berryRegistry.register(...)`.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { useAccount } from 'wagmi';

import ShortAddress from '@/components/ShortAddress';

import { APP_REGISTRY } from './registry';
import { berryRegistry } from '../system/berryRegistry';
import { berryBus } from '../system/eventBus';
import { useBerryWindows, windowStore } from '../store/windowStore';

const VERSION = 'BerryOS Sonoma 14.0';

// We snapshot a "fallback boot time" at module load so uptime has a reasonable
// number even when the boot daemon never fired the event. The bus subscriber
// below replaces it with the real value if/when the event arrives.
let bootTime = Date.now();
let bootCaptured = false;

berryBus.on('system:bootComplete', () => {
  // Only honour the FIRST event — re-emits during HMR shouldn't reset uptime.
  if (bootCaptured) return;
  bootCaptured = true;
  bootTime = Date.now();
});

function fmtUptime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Estimate localStorage usage in bytes. We sum `key.length + value.length`
 * over every entry; this is approximate (browser keys are stored as UTF-16
 * but the API exposes bytes-as-chars), close enough for an "About" readout.
 */
function localStorageBytes(): { used: number; quota: number } {
  if (typeof window === 'undefined') return { used: 0, quota: 5 * 1024 * 1024 };
  let used = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      const v = window.localStorage.getItem(k) ?? '';
      // Each char is up to 2 bytes in storage; stay consistent with the 5MB
      // nominal quota by counting chars.
      used += k.length + v.length;
    }
  } catch { /* private mode etc. */ }
  return { used, quota: 5 * 1024 * 1024 };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function useUptime(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now - bootTime;
}

function AboutApp(): ReactElement {
  const windows = useBerryWindows();
  const account = useAccount();
  const uptimeMs = useUptime();
  const storage = useMemo(() => localStorageBytes(), [uptimeMs]);

  const memoryMB = windows.length * 64;
  const storagePct = Math.min(100, (storage.used / storage.quota) * 100);

  function openActivityMonitor(): void {
    const def = APP_REGISTRY['activityMonitor'] ?? APP_REGISTRY['activity-monitor'] ?? APP_REGISTRY['activity'];
    if (!def) {
      // No Activity Monitor registered — emit a soft hint so other agents
      // can surface a notification or whatever.
      // eslint-disable-next-line no-console
      console.warn('[about] Activity Monitor not registered');
      return;
    }
    windowStore.open({
      appId: def.appId,
      title: def.title,
      icon: def.emoji,
      width: def.width,
      height: def.height,
    });
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'linear-gradient(180deg, #f8f8f8 0%, #ececec 100%)',
        fontFamily: 'var(--theme-font-display)',
        color: 'var(--theme-text-primary)',
        boxSizing: 'border-box',
      }}
    >
      {/* Hero */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '20px 22px 14px',
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 16,
            background: 'linear-gradient(180deg, #ffe9ee 0%, #fbb1c1 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 44,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 12px rgba(0,0,0,0.18)',
          }}
          aria-hidden
        >
          🍓
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>BerryOS</div>
          <div style={{ fontSize: 13, color: 'var(--theme-text-muted)', marginTop: 2 }}>{VERSION}</div>
          <div style={{ fontSize: 11, color: 'var(--theme-text-muted)', marginTop: 4 }}>
            noun.wtf desktop emulator
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: '0 22px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row label="Memory" value={`${memoryMB} MB`} hint={`${windows.length} window${windows.length === 1 ? '' : 's'} open`} />
        <Row
          label="Storage"
          value={fmtBytes(storage.used)}
          hint={`of ${fmtBytes(storage.quota)} quota`}
        >
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: 'rgba(0,0,0,0.08)',
              overflow: 'hidden',
              marginTop: 6,
            }}
            aria-label={`Storage ${storagePct.toFixed(1)}%`}
          >
            <div
              style={{
                height: '100%',
                width: `${storagePct}%`,
                background: storagePct > 80 ? '#e85a5a' : 'var(--theme-accent, #2b6cb0)',
              }}
            />
          </div>
        </Row>
        <Row label="Uptime" value={fmtUptime(uptimeMs)} hint="since boot" />
        <Row
          label="Wallet"
          value={
            account.isConnected && account.address ? (
              <ShortAddress address={account.address} avatar={false} />
            ) : (
              <span style={{ color: 'var(--theme-text-muted)' }}>Not connected</span>
            )
          }
        />
      </div>

      {/* Footer button */}
      <div
        style={{
          marginTop: 'auto',
          padding: '12px 22px 16px',
          borderTop: '1px solid var(--theme-border)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={openActivityMonitor}
          style={{
            padding: '6px 14px',
            fontFamily: 'var(--theme-font-display)',
            fontSize: 12,
            background: 'linear-gradient(180deg, #ffffff 0%, #e0e0e0 100%)',
            color: 'var(--theme-text-primary)',
            border: '1px solid var(--theme-border-strong)',
            borderRadius: 6,
            cursor: 'pointer',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 2px rgba(0,0,0,0.15)',
          }}
        >
          System Report…
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  children?: React.ReactNode;
}): ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, color: 'var(--theme-text-muted)' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{value}</span>
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>{hint}</div>
      )}
      {children}
    </div>
  );
}

berryRegistry.register({
  id: 'about',
  name: 'About This Computer',
  icon: '🍓',
  component: AboutApp,
  defaultWindow: { w: 420, h: 360 },
  capabilities: ['system:lifecycle'],
});

export default AboutApp;
