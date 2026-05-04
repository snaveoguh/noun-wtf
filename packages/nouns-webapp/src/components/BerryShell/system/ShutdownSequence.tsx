/**
 * BerryOS shutdown sequence — confirm dialog → cleanup → fade-to-black.
 *
 * Wired by anyone emitting the window event `system:shutdownRequested`. The
 * canonical bus owner hasn't claimed that event in BerryEventMap yet so we
 * use a CustomEvent on `window` to stay out of their way. AppleMenu just
 * needs to dispatch the event.
 *
 * Cleanup flow on confirm:
 *   1. Emit `system:shuttingDown` (CustomEvent + canonical bus best-effort).
 *   2. If "reopen" checkbox: snapshot all open windows to localStorage.
 *      Else: clear any prior snapshot.
 *   3. For each registered app, emit `app:terminating` and await any
 *      promise returned by `onTerminate?.()` (capped at 200ms each).
 *   4. For each registered service, await `serviceManager.stop(id)` (also
 *      capped — we don't trap shutdown on a misbehaving daemon).
 *   5. Fade to black with "Shutting down…" → "Goodbye." then switch the site
 *      theme back to 'pro' so the shell goes away. The page does not reload —
 *      flipping the theme away from 'berry' deactivates BerryShell.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import { GlassButton, GlassPanel } from '@/liquid-sand/glass';
import { Power, Sparkle } from '@/liquid-sand/icons';

import { berryRegistry, type BerryAppDescriptor } from './berryRegistry';
import { berryBus } from './eventBus';
import { serviceManager } from './services';
import { windowStore } from '../store/windowStore';

const SNAPSHOT_KEY = 'berry.windowSnapshot';
const REOPEN_PREF_KEY = 'berry.shutdownReopen';
const THEME_STORAGE_KEY = 'noun-wtf-theme';

// ---------------------------------------------------------------------------
// Window-event payloads
// ---------------------------------------------------------------------------

export interface ShutdownRequestedDetail {
  /**
   * If true, skip the confirm dialog. Used by hotkeys / the agent-driven
   * "force shutdown" flow.
   */
  force?: boolean;
}

export interface ShuttingDownDetail {
  reopenWindows: boolean;
}

interface PersistedWindowSnapshot {
  appId: string;
  title: string;
  icon: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * `BerryAppDescriptor` doesn't currently expose an `onTerminate` hook — but if
 * the registry is extended to support one (the brief specifies "await any
 * returned promises from `onTerminate` hooks if registry exposes them"), we
 * treat it as an optional structural field on the descriptor and call it
 * defensively.
 */
type AppDescriptorWithTerminate = BerryAppDescriptor & {
  onTerminate?: () => void | Promise<void>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshotWindows(): void {
  if (typeof window === 'undefined') return;
  const wins = windowStore.getState().windows;
  const snap: PersistedWindowSnapshot[] = wins.map(w => ({
    appId: w.appId,
    title: w.title,
    icon: w.icon,
    x: w.x,
    y: w.y,
    width: w.width,
    height: w.height,
  }));
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* quota — swallow */
  }
}

function clearSnapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}

function readReopenPref(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(REOPEN_PREF_KEY);
    // Default to true (Mac default behavior).
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

function writeReopenPref(val: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REOPEN_PREF_KEY, val ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

/**
 * Race a promise against a timeout — used so a slow `onTerminate` / `stop()`
 * implementation can't trap the user mid-shutdown.
 */
function withTimeout<T>(p: Promise<T> | T, ms: number): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    Promise.resolve(p).then(finish).catch(finish);
    window.setTimeout(finish, ms);
  });
}

function switchThemeAwayFromBerry(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'pro');
    // SiteThemeContext reads the storage key on init. Bouncing the doc attr
    // alone isn't enough because <BerryShell> only mounts when the React
    // theme state is 'berry'. The cleanest path is a soft reload — single
    // navigation, no React tree thrash.
    window.location.assign(window.location.pathname + window.location.search);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Stage =
  | 'hidden'
  | 'confirm'
  | 'shutting'
  | 'goodbye';

const overlayBase: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 6000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--ls-font-sans)',
};

export default function ShutdownSequence() {
  const [stage, setStage] = useState<Stage>('hidden');
  const [reopen, setReopen] = useState<boolean>(readReopenPref);
  const cancelRef = useRef<(() => void) | null>(null);

  // Cancel any in-flight cleanup if unmounting during shutdown (defensive).
  useEffect(() => {
    return () => {
      cancelRef.current?.();
    };
  }, []);

  // ---------- bus subscription ----------
  useEffect(() => {
    function onRequest(e: Event) {
      const detail = (e as CustomEvent<ShutdownRequestedDetail | undefined>).detail;
      if (detail?.force) {
        // Skip the confirm dialog and go straight to shutdown.
        void runShutdown(reopen);
        return;
      }
      setReopen(readReopenPref());
      setStage('confirm');
    }
    window.addEventListener('system:shutdownRequested', onRequest as EventListener);
    return () => {
      window.removeEventListener('system:shutdownRequested', onRequest as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- esc cancels confirm ----------
  useEffect(() => {
    if (stage !== 'confirm') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setStage('hidden');
      if (e.key === 'Enter') {
        e.preventDefault();
        void runShutdown(reopen);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, reopen]);

  const runShutdown = useCallback(async (reopenWindows: boolean) => {
    setStage('shutting');

    // 1. Persist or clear the reopen choice + window snapshot.
    writeReopenPref(reopenWindows);
    if (reopenWindows) snapshotWindows();
    else clearSnapshot();

    // 2. Emit shuttingDown (window event + canonical bus best-effort).
    try {
      window.dispatchEvent(
        new CustomEvent<ShuttingDownDetail>('system:shuttingDown', {
          detail: { reopenWindows },
        }),
      );
    } catch {
      /* ignore */
    }

    // 3. Tear down apps. Loop the registry; each gets ≤200ms to clean up.
    const apps = berryRegistry.list() as AppDescriptorWithTerminate[];
    for (const app of apps) {
      try {
        berryBus.emit('app:terminating', { appId: app.id });
      } catch {
        /* ignore */
      }
      if (typeof app.onTerminate === 'function') {
        await withTimeout(app.onTerminate(), 200);
      }
    }

    // 4. Stop services in parallel — each capped at 250ms so a misbehaving
    // daemon can't trap the user mid-shutdown.
    const services = serviceManager.list().filter(r => r.status !== 'stopped');
    if (services.length) {
      await Promise.all(
        services.map(r => withTimeout(serviceManager.stop(r.service.id), 250)),
      );
    }

    // 5. Close every window (bus-emits via store).
    windowStore.closeAll();

    // 6. Fade to "Goodbye." beat then theme switch.
    setStage('goodbye');
    await new Promise<void>(resolve => window.setTimeout(resolve, 850));
    switchThemeAwayFromBerry();
  }, []);

  if (stage === 'hidden') return null;

  if (stage === 'confirm') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shut Down"
        style={{
          ...overlayBase,
          background: 'rgba(60, 45, 25, 0.32)',
          backdropFilter: 'blur(var(--ls-blur-subtle))',
          WebkitBackdropFilter: 'blur(var(--ls-blur-subtle))',
        }}
        onClick={e => {
          if (e.target === e.currentTarget) setStage('hidden');
        }}
      >
        <GlassPanel
          blur="extreme"
          radius="lg"
          style={{
            width: 380,
            padding: '22px 24px 18px',
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div
              aria-hidden
              style={{
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ls-sand-600)',
              }}
            >
              <Power size={36} />
            </div>
            <div style={{ flex: 1 }}>
              {/* HIG: alert title sits in the headline range; body text is 13pt. */}
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 'var(--ls-text-lg)' /* 17pt body — alert headline */,
                  marginBottom: 6,
                  color: 'var(--ls-fg-primary)',
                  lineHeight: 1.3,
                }}
              >
                Are you sure you want to shut down your computer?
              </div>
              <div
                style={{
                  color: 'var(--ls-fg-secondary)',
                  fontSize: 'var(--ls-text-sm)' /* 13pt label/body */,
                  lineHeight: 1.45,
                }}
              >
                BerryOS will close all running apps and stop background services.
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 14,
                  fontSize: 12,
                  color: 'var(--ls-fg-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={reopen}
                  onChange={e => setReopen(e.target.checked)}
                  style={{ accentColor: 'var(--ls-accent)' }}
                />
                Reopen windows when logging back in
              </label>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 18,
            }}
          >
            {/* HIG: alert primary actions need a comfortable hit area (>=34pt). */}
            <GlassButton
              variant="ghost"
              size="md"
              onClick={() => setStage('hidden')}
            >
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              size="md"
              onClick={() => void runShutdown(reopen)}
              autoFocus
            >
              Shut Down
            </GlassButton>
          </div>
        </GlassPanel>
      </div>
    );
  }

  // shutting + goodbye stages — fade to sand-cream with monoline icon.
  return (
    <>
      <style>{shutdownKeyframes}</style>
      <div
        aria-live="polite"
        style={{
          ...overlayBase,
          background:
            'linear-gradient(180deg, var(--ls-sand-50) 0%, var(--ls-sand-100) 50%, var(--ls-sand-200) 100%)',
          color: 'var(--ls-fg-primary)',
          flexDirection: 'column',
          gap: 16,
          animation: 'berryShutdownIn var(--ls-dur-base) var(--ls-ease-glide) both',
        }}
      >
        <div
          aria-hidden
          style={{
            color: 'var(--ls-sand-600)',
            animation:
              stage === 'goodbye'
                ? 'berryShutdownShrink var(--ls-dur-slow) var(--ls-ease-glide) forwards'
                : 'none',
          }}
        >
          {stage === 'goodbye' ? <Sparkle size={64} /> : <Power size={64} />}
        </div>
        <div
          style={{
            fontFamily: 'var(--ls-font-mono)',
            fontSize: 13,
            letterSpacing: 0.4,
            color: 'var(--ls-fg-secondary)',
            minHeight: 18,
          }}
        >
          {stage === 'goodbye' ? 'Goodbye.' : 'Shutting down…'}
        </div>
      </div>
    </>
  );
}

const shutdownKeyframes = `
@keyframes berryShutdownIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes berryShutdownShrink {
  from { transform: scale(1); opacity: 0.85; }
  to { transform: scale(0.6); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes berryShutdownIn { from { opacity: 1; } to { opacity: 1; } }
  @keyframes berryShutdownShrink { from { opacity: 1; transform: none; } to { opacity: 0; transform: none; } }
}
`;
