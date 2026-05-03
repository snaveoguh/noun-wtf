/**
 * Permission prompt — Mac-style alert sheet.
 *
 * Listens for `permission:requested` and queues prompts (one at a time so
 * stacked apps don't drown the user). User picks Allow / Deny / Always
 * Allow; the choice is persisted via `permissionsStore.set` which also
 * emits `permission:granted` / `permission:denied` to resolve the awaiting
 * `requestPermission` promise.
 *
 * Mounted once at the BerryShell root.
 */

import { useEffect, useState } from 'react';

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

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 5000,
  background: 'rgba(20, 20, 30, 0.35)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 80,
};

const sheetStyle: React.CSSProperties = {
  width: 420,
  background: '#fff',
  border: '1px solid #888',
  borderRadius: 6,
  boxShadow:
    '0 12px 40px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.95)',
  fontFamily: 'var(--theme-font-display, -apple-system, BlinkMacSystemFont, sans-serif)',
  color: '#1a1a1a',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '14px 16px 8px 16px',
  fontSize: 13,
  fontWeight: 700,
};

const bodyStyle: React.CSSProperties = {
  padding: '0 16px 14px 16px',
  fontSize: 12,
  color: '#333',
  lineHeight: 1.45,
};

const footerStyle: React.CSSProperties = {
  borderTop: '1px solid #ddd',
  background: '#f6f6f6',
  padding: '10px 12px',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const baseButtonStyle: React.CSSProperties = {
  fontFamily: 'var(--theme-font-display, -apple-system, BlinkMacSystemFont, sans-serif)',
  fontSize: 12,
  padding: '5px 14px',
  borderRadius: 6,
  border: '1px solid #888',
  cursor: 'pointer',
  background: '#fff',
  color: '#222',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.95)',
};

const primaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: 'linear-gradient(180deg, #6ea8e8 0%, #2e74c8 100%)',
  borderColor: '#1a4f8a',
  color: '#fff',
  fontWeight: 700,
  textShadow: '0 1px 0 rgba(0, 0, 0, 0.35)',
};

export default function PermissionPrompt() {
  const [queue, setQueue] = useState<PendingPrompt[]>([]);

  useEffect(() => {
    return extendedBus.on('permission:requested', payload => {
      setQueue(prev => {
        // Dedupe: if the same appId+capability is already queued, don't add
        // another. Multiple call sites for the same permission share a
        // single pending promise (see permissions.ts), so this just keeps
        // the UI clean.
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
    // Allow once = grant, but also queue an immediate reset so the next
    // time the app asks it prompts again. We schedule the reset for the
    // next event-loop tick so the awaiting `requestPermission` promise
    // resolves true first; otherwise the reset would race the resolve.
    permissionsStore.set(current.appId, current.capability, 'granted');
    const { appId, capability } = current;
    setTimeout(() => {
      // Only reset back to prompt if it's still 'granted' — the user
      // might have toggled it via the Permissions app in the meantime.
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
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="berry-perm-title">
      <div style={sheetStyle}>
        <div style={headerStyle} id="berry-perm-title">
          <span style={{ fontSize: 16, marginRight: 6 }} aria-hidden>
            🔐
          </span>
          "{current.appId}" wants permission
        </div>
        <div style={bodyStyle}>
          The app <strong>{current.appId}</strong> wants to {meta.description}.
          <div style={{ marginTop: 8, color: '#666', fontSize: 11 }}>
            Capability: <code>{current.capability}</code>
          </div>
          {queue.length > 1 && (
            <div style={{ marginTop: 6, color: '#888', fontSize: 11 }}>
              {queue.length - 1} more request{queue.length - 1 === 1 ? '' : 's'} queued
            </div>
          )}
        </div>
        <div style={footerStyle}>
          <button type="button" onClick={deny} style={baseButtonStyle}>
            Don't Allow
          </button>
          <button type="button" onClick={allowOnce} style={baseButtonStyle}>
            Allow Once
          </button>
          <button type="button" onClick={allowAlways} style={primaryButtonStyle}>
            Always Allow
          </button>
        </div>
      </div>
    </div>
  );
}
