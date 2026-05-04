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

import { GlassButton, GlassChip } from '@/liquid-sand/glass';
import { Key, Lock } from '@/liquid-sand/icons';

import { berryRegistry } from '../system/berryRegistry';
import {
  type BerryCapability,
  CAPABILITIES,
  describeCapability,
  type PermissionStatus,
  permissionsStore,
  usePermissionsState,
} from '../system/permissions';

const STATUS_TONE: Record<PermissionStatus, 'success' | 'danger' | 'neutral'> = {
  granted: 'success',
  denied: 'danger',
  prompt: 'neutral',
};

function StatusPill({ status }: { status: PermissionStatus }) {
  return (
    <GlassChip tone={STATUS_TONE[status]} size="xs" style={{ minWidth: 60, justifyContent: 'center' }}>
      {status}
    </GlassChip>
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
      <div
        className="flex flex-col items-center justify-center text-center p-6 h-full"
        style={{
          fontFamily: 'var(--ls-font-sans)',
          fontSize: 'var(--ls-text-sm)',
          color: 'var(--ls-fg-muted)',
        }}
      >
        <Lock size={28} style={{ marginBottom: 8, opacity: 0.5 }} />
        <div>No apps registered yet. As apps register themselves they'll appear here.</div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full overflow-auto"
      style={{
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
      }}
    >
      {/* Sticky header — solid sand, NOT glass (window already has glass) */}
      <div
        className="sticky top-0 z-10 flex items-center"
        style={{
          padding: '12px 16px',
          gap: 8,
          background: 'var(--ls-sand-100)',
          borderBottom: '1px solid var(--ls-border-glass)',
        }}
      >
        <Lock size={16} />
        <span
          style={{
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-lg)',
            lineHeight: 1.3,
            fontWeight: 700,
          }}
        >
          Privacy &amp; Security
        </span>
      </div>

      <div className="flex flex-col" style={{ padding: 16, gap: 16 }}>
        {apps.map(app => (
          // Solid sand surface — no nested glass
          <div
            key={app.appId}
            style={{
              background: 'var(--ls-sand-50)',
              borderRadius: 'var(--ls-r-lg)',
              border: '1px solid var(--ls-border-glass)',
              padding: 16,
            }}
          >
            <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 8 }}>
              <div className="flex items-center" style={{ gap: 12 }}>
                <span aria-hidden style={{ fontSize: 22 }}>
                  {app.icon}
                </span>
                <div className="flex flex-col">
                  <span
                    style={{
                      fontFamily: 'var(--ls-font-sans)',
                      fontSize: 'var(--ls-text-lg)',
                      lineHeight: 1.3,
                      fontWeight: 700,
                      color: 'var(--ls-fg-primary)',
                    }}
                  >
                    {app.name}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--ls-font-mono)',
                      fontSize: 'var(--ls-text-xs)',
                      lineHeight: 1.4,
                      color: 'var(--ls-fg-muted)',
                      letterSpacing: 0.4,
                      marginTop: 2,
                    }}
                  >
                    {app.appId}
                  </span>
                </div>
              </div>
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={() => permissionsStore.resetApp(app.appId)}
                title="Clear all stored decisions for this app"
              >
                Reset
              </GlassButton>
            </div>
            <div className="flex flex-col">
              {CAPABILITIES.map(cap => {
                const status = permissionsStore.status(app.appId, cap.id);
                const declared = app.capabilities.includes(cap.id);
                return (
                  <div
                    key={cap.id}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: '1fr auto',
                      gap: 16,
                      padding: '12px 0',
                      minHeight: 44,
                      borderTop: '1px solid var(--ls-border-glass)',
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <Key size={14} style={{ color: 'var(--ls-fg-secondary)' }} />
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 'var(--ls-text-md)',
                            lineHeight: 1.3,
                            color: 'var(--ls-fg-primary)',
                          }}
                        >
                          {cap.label}
                        </span>
                        {declared && (
                          <GlassChip tone="accent" size="xs">
                            declared
                          </GlassChip>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--ls-text-xs)',
                          lineHeight: 1.4,
                          color: 'var(--ls-fg-muted)',
                          marginTop: 4,
                          paddingLeft: 22,
                        }}
                      >
                        {describeCapability(cap.id).description}
                      </div>
                    </div>
                    <div className="flex items-center justify-end" style={{ gap: 8 }}>
                      <StatusPill status={status} />
                      {status === 'granted' ? (
                        <GlassButton
                          variant="default"
                          size="sm"
                          onClick={() => permissionsStore.set(app.appId, cap.id, 'denied')}
                        >
                          Revoke
                        </GlassButton>
                      ) : (
                        <GlassButton
                          variant="primary"
                          size="sm"
                          onClick={() => permissionsStore.set(app.appId, cap.id, 'granted')}
                        >
                          Allow
                        </GlassButton>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
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
