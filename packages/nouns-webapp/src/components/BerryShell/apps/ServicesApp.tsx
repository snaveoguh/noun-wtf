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

import { berryRegistry } from '../system/berryRegistry';
import { extendedBus, useAllExtendedEvents } from '../system/extendedBus';
import {
  type ServiceRecord,
  type ServiceStatus,
  serviceManager,
  useServices,
} from '../system/services';

const STATUS_COLORS: Record<ServiceStatus, string> = {
  running: '#3eb371',
  starting: '#e8c43a',
  failed: '#d24747',
  stopped: '#888',
};

const STATUS_LABELS: Record<ServiceStatus, string> = {
  running: 'Running',
  starting: 'Starting…',
  failed: 'Failed',
  stopped: 'Stopped',
};

const headerStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontFamily: 'var(--theme-font-display)',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--theme-text-primary)',
  borderBottom: '1px solid var(--theme-border, #999)',
  background: 'var(--theme-bg-secondary, #efefef)',
};

const buttonStyle: React.CSSProperties = {
  fontFamily: 'var(--theme-font-display)',
  fontSize: 10,
  padding: '2px 8px',
  border: '1px solid var(--theme-border-strong, #888)',
  background: 'var(--theme-bg-card, #fff)',
  color: 'var(--theme-text-primary)',
  cursor: 'pointer',
  borderRadius: 4,
};

const eventRowStyle: React.CSSProperties = {
  fontFamily: 'var(--theme-font-mono, ui-monospace, Menlo, monospace)',
  fontSize: 10,
  padding: '2px 12px',
  color: 'var(--theme-text-secondary, #555)',
  borderBottom: '1px dotted var(--theme-border, #ddd)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

function StatusDot({ status }: { status: ServiceStatus }) {
  return (
    <span
      title={STATUS_LABELS[status]}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: STATUS_COLORS[status],
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 0 4px rgba(0,0,0,0.18)',
        marginRight: 6,
      }}
    />
  );
}

function ServiceRow({ rec }: { rec: ServiceRecord }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px dotted var(--theme-border, #ccc)',
      }}
    >
      <div>
        <div
          style={{
            fontFamily: 'var(--theme-font-display)',
            fontSize: 12,
            color: 'var(--theme-text-primary)',
          }}
        >
          <StatusDot status={rec.status} />
          <strong>{rec.service.name}</strong>{' '}
          <span style={{ color: 'var(--theme-text-muted)', fontSize: 11 }}>
            {rec.service.id}
          </span>
        </div>
        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--theme-text-secondary)' }}>
          {rec.service.description ?? STATUS_LABELS[rec.status]}
        </div>
        {rec.lastError && (
          <div
            style={{
              marginTop: 2,
              fontSize: 10,
              color: '#a83232',
              fontFamily: 'var(--theme-font-mono, monospace)',
            }}
          >
            error: {rec.lastError}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          style={buttonStyle}
          disabled={rec.status === 'running' || rec.status === 'starting'}
          onClick={() => void serviceManager.start(rec.service.id)}
        >
          Start
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={rec.status === 'stopped'}
          onClick={() => void serviceManager.stop(rec.service.id)}
        >
          Stop
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => void serviceManager.restart(rec.service.id)}
        >
          Restart
        </button>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={headerStyle}>Services</div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {services.length === 0 ? (
          <div
            style={{
              padding: 16,
              fontSize: 12,
              color: 'var(--theme-text-muted)',
              fontFamily: 'var(--theme-font-display)',
            }}
          >
            No services registered.
          </div>
        ) : (
          services.map(rec => <ServiceRow key={rec.service.id} rec={rec} />)
        )}
      </div>
      <div
        style={{
          ...headerStyle,
          borderTop: '1px solid var(--theme-border, #999)',
          borderBottom: 'none',
        }}
      >
        Recent events
      </div>
      <div
        style={{
          maxHeight: 150,
          overflow: 'auto',
          background: 'var(--theme-bg-tertiary, #fafafa)',
        }}
      >
        {log.length === 0 ? (
          <div style={eventRowStyle}>(no events yet)</div>
        ) : (
          log
            .slice()
            .reverse()
            .map(entry => (
              <div key={entry.key} style={eventRowStyle}>
                <span style={{ color: 'var(--theme-text-muted)' }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>{' '}
                <strong>{entry.event}</strong>{' '}
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
