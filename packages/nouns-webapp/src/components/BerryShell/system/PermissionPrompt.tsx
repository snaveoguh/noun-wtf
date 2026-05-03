/**
 * Permission prompt — Mac-style alert sheet.
 *
 * Liquid Sand chrome: rendered inside `<GlassModal>` with `<GlassButton>`
 * actions and a monoline `<Key>` icon. Listens for `permission:requested` and
 * queues prompts (one at a time so stacked apps don't drown the user). User
 * picks Allow / Deny / Always Allow; the choice is persisted via
 * `permissionsStore.set` which also emits `permission:granted` /
 * `permission:denied` to resolve the awaiting `requestPermission` promise.
 *
 * Mounted once at the BerryShell root.
 */

import { useEffect, useState } from 'react';

import { GlassButton, GlassModal } from '@/liquid-sand/glass';
import { Key } from '@/liquid-sand/icons';

import { extendedBus } from './extendedBus';
import {
  type BerryCapability,
  describeCapability,
  permissionsStore,
} from './permissions';

interface PendingPrompt {
  appId: string;
  capability: BerryCapability;
}

export default function PermissionPrompt() {
  const [queue, setQueue] = useState<PendingPrompt[]>([]);

  useEffect(() => {
    return extendedBus.on('permission:requested', payload => {
      setQueue(prev => {
        // Dedupe: same appId+capability, don't add another. Multiple call
        // sites for the same permission share a single pending promise (see
        // permissions.ts), so this just keeps the UI clean.
        const exists = prev.some(
          p => p.appId === payload.appId && p.capability === payload.capability,
        );
        return exists ? prev : [...prev, payload];
      });
    });
  }, []);

  if (queue.length === 0) return null;
  const current = queue[0];
  const meta = describeCapability(current.capability);

  function shift() {
    setQueue(prev => prev.slice(1));
  }

  function deny() {
    permissionsStore.set(current.appId, current.capability, 'denied');
    shift();
  }

  function allowOnce() {
    permissionsStore.set(current.appId, current.capability, 'granted');
    const { appId, capability } = current;
    setTimeout(() => {
      if (permissionsStore.status(appId, capability) === 'granted') {
        permissionsStore.set(appId, capability, 'prompt');
      }
    }, 0);
    shift();
  }

  function allowAlways() {
    permissionsStore.set(current.appId, current.capability, 'granted');
    shift();
  }

  return (
    <GlassModal
      open
      onScrimClick={deny}
      size="md"
      aria-labelledby="berry-perm-title"
      style={{
        marginTop: 80,
        padding: 0,
        fontFamily: 'var(--ls-font-sans)',
      }}
    >
      <div style={{ padding: '20px 22px 12px' }}>
        <div
          id="berry-perm-title"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ls-fg-primary)',
            marginBottom: 8,
          }}
        >
          <Key size={18} />
          <span>"{current.appId}" wants permission</span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ls-fg-secondary)',
            lineHeight: 1.5,
          }}
        >
          The app <strong>{current.appId}</strong> wants to {meta.description}.
          <div style={{ marginTop: 8, color: 'var(--ls-fg-muted)', fontSize: 11 }}>
            Capability:{' '}
            <code
              style={{
                fontFamily: 'var(--ls-font-mono)',
                background: 'var(--ls-glass-tint)',
                padding: '1px 6px',
                borderRadius: 'var(--ls-r-sm)',
              }}
            >
              {current.capability}
            </code>
          </div>
          {queue.length > 1 && (
            <div style={{ marginTop: 6, color: 'var(--ls-fg-muted)', fontSize: 11 }}>
              {queue.length - 1} more request{queue.length - 1 === 1 ? '' : 's'} queued
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          borderTop: '1px solid var(--ls-border-glass)',
          padding: '12px 14px',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        <GlassButton variant="ghost" size="sm" onClick={deny}>
          Don't Allow
        </GlassButton>
        <GlassButton variant="default" size="sm" onClick={allowOnce}>
          Allow Once
        </GlassButton>
        <GlassButton variant="primary" size="sm" onClick={allowAlways}>
          Always Allow
        </GlassButton>
      </div>
    </GlassModal>
  );
}
