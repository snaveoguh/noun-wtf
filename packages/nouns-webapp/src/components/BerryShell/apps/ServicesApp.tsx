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

import { GlassButton, GlassChip } from '@/liquid-sand/glass';
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
    // Solid sand surface — no nested glass over text
    <div
      style={{
        background: 'var(--ls-sand-50)',
        borderRadius: 'var(--ls-r-md)',
        border: '1px solid var(--ls-border-glass)',
        padding: 16,
      }}
    >
      <div className="grid items-center" style={{ gridTemplateColumns: '1fr auto', gap: 12 }}>
        <div className="min-w-0">
          <div
            className="flex items-center"
            style={{
              fontFamily: 'var(--ls-font-sans)',
              fontSize: 'var(--ls-text-md)',
              lineHeight: 1.3,
              color: 'var(--ls-fg-primary)',
              gap: 8,
              flexWrap: 'wrap',
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
                fontSize: 'var(--ls-text-xs)',
                fontFamily: 'var(--ls-font-mono)',
              }}
            >
              {rec.service.id}
            </span>
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 'var(--ls-text-sm)',
              lineHeight: 1.4,
              color: 'var(--ls-fg-secondary)',
            }}
          >
            {rec.service.description ?? STATUS_LABELS[rec.status]}
          </div>
          {rec.lastError && (
            <div
              style={{
                marginTop: 8,
                fontSize: 'var(--ls-text-xs)',
                lineHeight: 1.4,
                color: 'var(--ls-danger)',
                fontFamily: 'var(--ls-font-mono)',
              }}
            >
              error: {rec.lastError}
            </div>
          )}
        </div>
        <div className="flex" style={{ gap: 4 }}>
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
    </div>
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
      {/* Header — solid sand, NOT nested glass */}
      <div
        className="flex items-center"
        style={{
          padding: '12px 16px',
          gap: 8,
          background: 'var(--ls-sand-100)',
          borderBottom: '1px solid var(--ls-border-glass)',
        }}
      >
        <Settings size={16} />
        <span
          style={{
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-lg)',
            lineHeight: 1.3,
            fontWeight: 700,
          }}
        >
          Services
        </span>
      </div>
      <div className="overflow-auto flex-1 flex flex-col" style={{ padding: 16, gap: 8 }}>
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

      {/* Recent events footer — solid sand, no nested glass */}
      <div
        className="flex items-center"
        style={{
          padding: '8px 16px',
          gap: 8,
          background: 'var(--ls-sand-100)',
          borderTop: '1px solid var(--ls-border-glass)',
          borderBottom: '1px solid var(--ls-border-glass)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-md)',
            lineHeight: 1.3,
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
          // Solid sand, not glass tint
          background: 'var(--ls-sand-50)',
          padding: 8,
        }}
      >
        {log.length === 0 ? (
          <div
            style={{
              fontFamily: 'var(--ls-font-mono)',
              fontSize: 'var(--ls-text-xs)',
              lineHeight: 1.4,
              padding: '6px 12px',
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
                  fontSize: 'var(--ls-text-xs)',
                  lineHeight: 1.5,
                  padding: '4px 12px',
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
