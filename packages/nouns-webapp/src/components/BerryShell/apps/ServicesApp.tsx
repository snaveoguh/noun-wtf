/**
 * ServicesApp — Activity Monitor for daemons.
 *
 * Lists every registered service with its status indicator and Start / Stop /
 * Restart buttons. Shows the last 10 service / permission / auction events
 * from the extended bus so you can see why a service failed or what just
 * triggered.
 *
 * Self-registers via `berryRegistry.register` on module load.
 */

import { useEffect, useState } from 'react';

import { GlassButton, GlassChip, GlassPanel } from '@/liquid-sand/glass';
import { Boot, Restart, Settings, Shutdown } from '@/liquid-sand/icons';

import { berryRegistry } from '../system/berryRegistry';
import { extendedBus, useAllExtendedEvents } from '../system/extendedBus';
import {
  type ServiceRecord,
  type ServiceStatus,
  serviceManager,
  useServices,
} from '../system/services';

const STATUS_COLORS: Record<ServiceStatus, string> = {
  running: 'var(--ls-success)',
  starting: 'var(--ls-sand-500)',
  failed: 'var(--ls-danger)',
  stopped: 'var(--ls-fg-muted)',
};

const STATUS_LABELS: Record<ServiceStatus, string> = {
  running: 'Running',
  starting: 'Starting…',
  failed: 'Failed',
  stopped: 'Stopped',
};

const STATUS_TONE: Record<ServiceStatus, 'success' | 'accent' | 'danger' | 'neutral'> = {
  running: 'success',
  starting: 'accent',
  failed: 'danger',
  stopped: 'neutral',
};

function StatusDot({ status }: { status: ServiceStatus }) {
  return (
    <span
      title={STATUS_LABELS[status]}
      aria-hidden
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: 'var(--ls-r-full)',
        background: STATUS_COLORS[status],
        boxShadow: `0 0 8px ${STATUS_COLORS[status]}, var(--ls-shadow-inset-glass)`,
        marginRight: 6,
      }}
    />
  );
}

function ServiceRow({ rec }: { rec: ServiceRecord }) {
  return (
    <GlassPanel padded radius="md" tone="auto" className="!p-3">
      <div className="grid items-center gap-2" style={{ gridTemplateColumns: '1fr auto' }}>
        <div className="min-w-0">
          <div
            className="flex items-center gap-1.5"
            style={{
              fontFamily: 'var(--ls-font-display)',
              fontSize: 'var(--ls-text-sm)',
              color: 'var(--ls-fg-primary)',
            }}
          >
            <StatusDot status={rec.status} />
            <strong>{rec.service.name}</strong>
            <GlassChip tone={STATUS_TONE[rec.status]} size="xs">
              {STATUS_LABELS[rec.status]}
            </GlassChip>
            <span
              style={{
                color: 'var(--ls-fg-muted)',
                fontSize: 11,
                marginLeft: 4,
                fontFamily: 'var(--ls-font-mono)',
              }}
            >
              {rec.service.id}
            </span>
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              color: 'var(--ls-fg-secondary)',
            }}
          >
            {rec.service.description ?? STATUS_LABELS[rec.status]}
          </div>
          {rec.lastError && (
            <div
              style={{
                marginTop: 4,
                fontSize: 10,
                color: 'var(--ls-danger)',
                fontFamily: 'var(--ls-font-mono)',
              }}
            >
              error: {rec.lastError}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          <GlassButton
            variant="default"
            size="sm"
            disabled={rec.status === 'running' || rec.status === 'starting'}
            onClick={() => void serviceManager.start(rec.service.id)}
          >
            <Boot size={12} />
            Start
          </GlassButton>
          <GlassButton
            variant="default"
            size="sm"
            disabled={rec.status === 'stopped'}
            onClick={() => void serviceManager.stop(rec.service.id)}
          >
            <Shutdown size={12} />
            Stop
          </GlassButton>
          <GlassButton
            variant="default"
            size="sm"
            onClick={() => void serviceManager.restart(rec.service.id)}
          >
            <Restart size={12} />
            Restart
          </GlassButton>
        </div>
      </div>
    </GlassPanel>
  );
}

interface LogEntry {
  event: string;
  payload: unknown;
  timestamp: number;
  key: string;
}

function ServicesApp() {
  const services = useServices();
  const [log, setLog] = useState<LogEntry[]>([]);

  // Seed the log with the bus history so the panel isn't empty if it opens
  // after services have already been started.
  useEffect(() => {
    const seed = extendedBus
      .history()
      .slice(-10)
      .map((r, i) => ({
        event: r.event,
        payload: r.payload,
        timestamp: r.timestamp,
        key: `${r.timestamp}-${i}`,
      }));
    setLog(seed);
  }, []);

  useAllExtendedEvents(record => {
    setLog(prev => {
      const next = [
        ...prev,
        {
          event: record.event,
          payload: record.payload,
          timestamp: record.timestamp,
          key: `${record.timestamp}-${prev.length}`,
        },
      ];
      // Keep last 10.
      return next.slice(-10);
    });
  });

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{
          background: 'var(--ls-glass-light)',
          backdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
          WebkitBackdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
          borderBottom: '1px solid var(--ls-border-glass)',
        }}
      >
        <Settings size={14} />
        <span
          style={{
            fontFamily: 'var(--ls-font-display)',
            fontSize: 'var(--ls-text-md)',
            fontWeight: 700,
          }}
        >
          Services
        </span>
      </div>
      <div className="overflow-auto flex-1 p-3 flex flex-col gap-2">
        {services.length === 0 ? (
          <div
            className="text-center"
            style={{
              padding: 16,
              fontSize: 12,
              color: 'var(--ls-fg-muted)',
            }}
          >
            No services registered.
          </div>
        ) : (
          services.map(rec => <ServiceRow key={rec.service.id} rec={rec} />)
        )}
      </div>

      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{
          background: 'var(--ls-glass-light)',
          backdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
          WebkitBackdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
          borderTop: '1px solid var(--ls-border-glass)',
          borderBottom: '1px solid var(--ls-border-glass)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ls-font-display)',
            fontSize: 'var(--ls-text-sm)',
            fontWeight: 700,
          }}
        >
          Recent events
        </span>
      </div>
      <div
        style={{
          maxHeight: 160,
          overflow: 'auto',
          background: 'var(--ls-glass-tint)',
          padding: 4,
        }}
      >
        {log.length === 0 ? (
          <div
            style={{
              fontFamily: 'var(--ls-font-mono)',
              fontSize: 10,
              padding: '4px 12px',
              color: 'var(--ls-fg-muted)',
            }}
          >
            (no events yet)
          </div>
        ) : (
          log
            .slice()
            .reverse()
            .map(entry => (
              <div
                key={entry.key}
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 10,
                  padding: '3px 12px',
                  color: 'var(--ls-fg-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span style={{ color: 'var(--ls-fg-muted)' }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>{' '}
                <strong style={{ color: 'var(--ls-accent)' }}>{entry.event}</strong>{' '}
                {entry.payload && typeof entry.payload === 'object'
                  ? JSON.stringify(entry.payload)
                  : String(entry.payload)}
              </div>
            ))
        )}
      </div>
    </div>
  );
}

berryRegistry.register({
  id: 'services',
  name: 'Services',
  icon: '⚙️',
  component: ServicesApp,
  defaultWindow: { w: 480, h: 360 },
  capabilities: ['system:lifecycle'],
});

export default ServicesApp;
