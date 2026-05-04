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
import { GlassButton, GlassChip, GlassPanel } from '@/liquid-sand/glass';
import { CpuChip, Info, Wallet } from '@/liquid-sand/icons';

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
      className="flex flex-col h-full p-4 gap-4 box-border"
      style={{
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
      }}
    >
      {/* Hero — HIG: 34pt large title, 17pt body, 11pt caption */}
      <GlassPanel padded radius="lg" tone="auto">
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center"
            style={{
              width: 80,
              height: 80,
              borderRadius: 'var(--ls-r-lg)',
              background:
                'linear-gradient(180deg, var(--ls-sand-100) 0%, var(--ls-sand-300) 100%)',
              boxShadow:
                'var(--ls-shadow-inset-glass), 0 4px 12px rgba(60,45,25,0.18)',
            }}
            aria-hidden
          >
            <Info size={40} style={{ color: 'var(--ls-fg-primary)' }} />
          </div>
          <div className="min-w-0">
            <div
              style={{
                fontFamily: 'var(--ls-font-display)',
                fontSize: 'var(--ls-text-3xl)',
                fontWeight: 700,
                lineHeight: 1.15,
                color: 'var(--ls-fg-primary)',
              }}
            >
              BerryOS
            </div>
            <div
              style={{
                fontSize: 'var(--ls-text-lg)',
                lineHeight: 1.4,
                color: 'var(--ls-fg-secondary)',
                marginTop: 4,
              }}
            >
              {VERSION}
            </div>
            <div
              style={{
                fontSize: 'var(--ls-text-xs)',
                lineHeight: 1.4,
                color: 'var(--ls-fg-muted)',
                marginTop: 4,
              }}
            >
              noun.wtf desktop emulator
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* Stats */}
      <GlassPanel padded radius="lg" tone="auto">
        <div className="flex flex-col gap-3">
          <Row
            label="Memory"
            value={`${memoryMB} MB`}
            hint={`${windows.length} window${windows.length === 1 ? '' : 's'} open`}
          />
          <Row
            label="Storage"
            value={fmtBytes(storage.used)}
            hint={`of ${fmtBytes(storage.quota)} quota`}
          >
            <div
              style={{
                height: 6,
                borderRadius: 'var(--ls-r-full)',
                background: 'rgba(60,45,25,0.10)',
                overflow: 'hidden',
                marginTop: 6,
                boxShadow: 'inset 0 1px 2px rgba(60,45,25,0.10)',
              }}
              aria-label={`Storage ${storagePct.toFixed(1)}%`}
            >
              <div
                style={{
                  height: '100%',
                  width: `${storagePct}%`,
                  background: storagePct > 80 ? 'var(--ls-danger)' : 'var(--ls-accent)',
                  boxShadow: storagePct > 80 ? 'none' : 'var(--ls-shadow-glow)',
                  transition: 'width var(--ls-dur-base) var(--ls-ease-soft)',
                }}
              />
            </div>
          </Row>
          <Row label="Uptime" value={fmtUptime(uptimeMs)} hint="since boot" />
          <Row
            label="Wallet"
            value={
              account.isConnected && account.address ? (
                <span className="inline-flex items-center gap-1.5">
                  <Wallet size={14} />
                  <ShortAddress address={account.address} avatar={false} />
                </span>
              ) : (
                <GlassChip tone="neutral" size="sm">
                  Not connected
                </GlassChip>
              )
            }
          />
        </div>
      </GlassPanel>

      {/* Footer button */}
      <div className="mt-auto flex justify-end">
        <GlassButton variant="default" size="md" onClick={openActivityMonitor}>
          <CpuChip size={14} />
          System Report
        </GlassButton>
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
      <div className="flex justify-between items-baseline gap-3">
        <span
          style={{
            fontSize: 'var(--ls-text-xs)',
            lineHeight: 1.4,
            color: 'var(--ls-fg-muted)',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            fontWeight: 600,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 'var(--ls-text-md)',
            lineHeight: 1.4,
            fontWeight: 600,
            color: 'var(--ls-fg-primary)',
            fontVariantNumeric: 'tabular-nums',
            fontFamily: 'var(--ls-font-mono)',
          }}
        >
          {value}
        </span>
      </div>
      {hint && (
        <div style={{ fontSize: 'var(--ls-text-xs)', lineHeight: 1.4, color: 'var(--ls-fg-muted)', marginTop: 4 }}>
          {hint}
        </div>
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
