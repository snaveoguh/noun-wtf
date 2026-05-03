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

import { GlassButton, GlassChip, GlassPanel } from '@/liquid-sand/glass';
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
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 px-4 py-2.5 flex items-center gap-2"
        style={{
          background: 'var(--ls-glass-light)',
          backdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
          WebkitBackdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
          borderBottom: '1px solid var(--ls-border-glass)',
        }}
      >
        <Lock size={14} />
        <span
          style={{
            fontFamily: 'var(--ls-font-display)',
            fontSize: 'var(--ls-text-md)',
            fontWeight: 700,
          }}
        >
          Privacy &amp; Security
        </span>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {apps.map(app => (
          <GlassPanel key={app.appId} padded radius="lg" tone="auto">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span aria-hidden style={{ fontSize: 18 }}>
                  {app.icon}
                </span>
                <div className="flex flex-col">
                  <span
                    style={{
                      fontFamily: 'var(--ls-font-display)',
                      fontSize: 'var(--ls-text-sm)',
                      fontWeight: 700,
                      color: 'var(--ls-fg-primary)',
                    }}
                  >
                    {app.name}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--ls-font-mono)',
                      fontSize: 10,
                      color: 'var(--ls-fg-muted)',
                      letterSpacing: 0.4,
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
                    className="grid items-center gap-3 py-2"
                    style={{
                      gridTemplateColumns: '1fr auto',
                      borderTop: '1px solid var(--ls-border-glass)',
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Key size={12} style={{ color: 'var(--ls-fg-secondary)' }} />
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 'var(--ls-text-sm)',
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
                          color: 'var(--ls-fg-muted)',
                          marginTop: 2,
                          paddingLeft: 18,
                        }}
                      >
                        {describeCapability(cap.id).description}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 justify-end">
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
          </GlassPanel>
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
