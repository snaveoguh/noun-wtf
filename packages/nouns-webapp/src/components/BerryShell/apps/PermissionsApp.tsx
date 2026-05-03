/**
 * PermissionsApp — Privacy & Security panel.
 *
 * Renders a grid of registered apps × known capabilities. Each cell shows
 * the current decision (granted / denied / prompt) and lets the user toggle
 * it. A reset button per app wipes all decisions for that app so the next
 * request prompts again.
 *
 * Self-registers via `berryRegistry.register` on module load.
 */

import { useMemo } from 'react';

import { berryRegistry } from '../system/berryRegistry';
import {
  type BerryCapability,
  CAPABILITIES,
  describeCapability,
  type PermissionStatus,
  permissionsStore,
  usePermissionsState,
} from '../system/permissions';

const headerStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  background: 'var(--theme-bg-secondary, #efefef)',
  borderBottom: '1px solid var(--theme-border, #999)',
  padding: '8px 12px',
  fontFamily: 'var(--theme-font-display)',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--theme-text-primary)',
  zIndex: 1,
};

const sectionLabel: React.CSSProperties = {
  fontFamily: 'var(--theme-font-display)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: 'var(--theme-text-muted, #888)',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr 96px',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderBottom: '1px dotted var(--theme-border, #ccc)',
  fontSize: 12,
  fontFamily: 'var(--theme-font-display)',
  color: 'var(--theme-text-primary)',
};

const buttonStyle: React.CSSProperties = {
  fontFamily: 'var(--theme-font-display)',
  fontSize: 11,
  padding: '2px 8px',
  border: '1px solid var(--theme-border-strong, #888)',
  background: 'var(--theme-bg-card, #fff)',
  color: 'var(--theme-text-primary)',
  cursor: 'pointer',
  borderRadius: 4,
};

const statusColors: Record<PermissionStatus, string> = {
  granted: '#2a8c4a',
  denied: '#a83232',
  prompt: '#888',
};

function StatusPill({ status }: { status: PermissionStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 8,
        background: statusColors[status],
        color: '#fff',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: 700,
        minWidth: 56,
        textAlign: 'center',
      }}
    >
      {status}
    </span>
  );
}

interface AppRow {
  appId: string;
  name: string;
  icon: string;
  capabilities: readonly BerryCapability[];
}

function PermissionsApp() {
  const all = usePermissionsState();

  const apps: AppRow[] = useMemo(() => {
    // Combine the dynamic registry with anything that has a stored decision —
    // an app might have been uninstalled but still has stored permissions
    // we want to surface so the user can revoke.
    const map = new Map<string, AppRow>();
    for (const d of berryRegistry.list()) {
      map.set(d.id, {
        appId: d.id,
        name: d.name,
        icon: d.icon,
        capabilities: (d.capabilities ?? []) as readonly BerryCapability[],
      });
    }
    for (const key of Object.keys(all)) {
      const [appId] = key.split(':');
      if (!appId || map.has(appId)) continue;
      map.set(appId, { appId, name: appId, icon: '📦', capabilities: [] });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  if (apps.length === 0) {
    return (
      <div style={{ padding: 24, fontFamily: 'var(--theme-font-display)', fontSize: 12, color: 'var(--theme-text-muted)' }}>
        No apps registered yet. As apps register themselves they'll appear here.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div style={headerStyle}>Privacy &amp; Security</div>
      {apps.map(app => (
        <div key={app.appId}>
          <div
            style={{
              padding: '10px 12px 4px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              borderBottom: '1px solid var(--theme-border, #ddd)',
              background: 'var(--theme-bg-tertiary, #f7f7f7)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden style={{ fontSize: 16 }}>
                {app.icon}
              </span>
              <span
                style={{
                  fontFamily: 'var(--theme-font-display)',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--theme-text-primary)',
                }}
              >
                {app.name}
              </span>
              <span style={{ ...sectionLabel, marginLeft: 6 }}>{app.appId}</span>
            </div>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => permissionsStore.resetApp(app.appId)}
              title="Clear all stored decisions for this app"
            >
              Reset
            </button>
          </div>
          {CAPABILITIES.map(cap => {
            const status = permissionsStore.status(app.appId, cap.id);
            const declared = app.capabilities.includes(cap.id);
            return (
              <div key={cap.id} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 700 }}>{cap.label}</div>
                  <div style={{ ...sectionLabel, fontSize: 10, marginTop: 2 }}>
                    {cap.id}
                    {declared ? ' · declared' : ''}
                  </div>
                </div>
                <div style={{ color: 'var(--theme-text-secondary, #555)', fontSize: 11 }}>
                  {describeCapability(cap.id).description}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                  <StatusPill status={status} />
                  {status === 'granted' ? (
                    <button
                      type="button"
                      style={buttonStyle}
                      onClick={() => permissionsStore.set(app.appId, cap.id, 'denied')}
                    >
                      Revoke
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={buttonStyle}
                      onClick={() => permissionsStore.set(app.appId, cap.id, 'granted')}
                    >
                      Allow
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Self-register on module load. Side-effecting import — when the apps barrel
// (or boot loader) pulls this file in, the app shows up in the registry.
berryRegistry.register({
  id: 'permissions',
  name: 'Privacy & Security',
  icon: '🔐',
  component: PermissionsApp,
  defaultWindow: { w: 540, h: 420 },
  capabilities: ['system:lifecycle'],
});

export default PermissionsApp;
