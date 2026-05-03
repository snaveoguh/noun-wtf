/**
 * BerryOS lock screen — full-screen overlay above all windows.
 *
 * Triggered by:
 *   - Window event `system:lockRequested` (Apple menu / agents)
 *   - Direct hotkey `cmd+ctrl+q` (handled here so it works even if the
 *     hotkeys subsystem isn't initialised yet)
 *   - Auto-lock after 5 minutes of inactivity (pointer + keyboard idle)
 *
 * On lock: emits `system:locked` (CustomEvent on window).
 * On unlock: emits `system:unlocked` (CustomEvent on window) and triggers the
 * login chime.
 *
 * Auth is theatre — any click or keypress on the input dismisses the screen.
 * The stored "passcode" preference is intentionally not implemented; this is
 * a UI surface for the OS shell, not a security boundary.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAccount, useEnsAvatar, useEnsName } from 'wagmi';
import { mainnet } from 'wagmi/chains';

import { GlassChip, GlassInput, GlassPanel } from '@/liquid-sand/glass';
import { Lock, Sparkle } from '@/liquid-sand/icons';

import { playLoginChime } from './loginChime';
import { useCurrentWallpaper } from './wallpaper';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = 'berry.locked';

export interface LockedDetail {
  source: 'manual' | 'idle' | 'hotkey';
}

export interface UnlockedDetail {
  via: 'click' | 'input' | 'key';
}

function readPersistedLocked(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writePersistedLocked(v: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

function emitLocked(source: LockedDetail['source']): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<LockedDetail>('system:locked', { detail: { source } }));
}

function emitUnlocked(via: UnlockedDetail['via']): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<UnlockedDetail>('system:unlocked', { detail: { via } }));
}

function useNow(updateMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), updateMs);
    return () => window.clearInterval(id);
  }, [updateMs]);
  return now;
}

export default function LockScreen() {
  const [locked, setLocked] = useState<boolean>(readPersistedLocked);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wallpaper = useCurrentWallpaper();

  // ---------- wagmi / ENS for the avatar ----------
  const { address } = useAccount();
  const { data: ensName } = useEnsName({ address, chainId: mainnet.id });
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ?? undefined,
    chainId: mainnet.id,
  });

  // ---------- triggers ----------
  const lock = useCallback((source: LockedDetail['source']) => {
    setLocked(true);
    writePersistedLocked(true);
    emitLocked(source);
  }, []);

  const unlock = useCallback(
    (via: UnlockedDetail['via']) => {
      if (!locked) return;
      setLocked(false);
      writePersistedLocked(false);
      emitUnlocked(via);
      try {
        playLoginChime();
      } catch {
        /* ignore */
      }
    },
    [locked],
  );

  // Window event subscription.
  useEffect(() => {
    const onReq = (e: Event) => {
      const detail = (e as CustomEvent<{ source?: LockedDetail['source'] }>).detail;
      lock(detail?.source ?? 'manual');
    };
    window.addEventListener('system:lockRequested', onReq as EventListener);
    return () => window.removeEventListener('system:lockRequested', onReq as EventListener);
  }, [lock]);

  // Hotkey: cmd+ctrl+q.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.key === 'Meta') && e.ctrlKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault();
        lock('hotkey');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lock]);

  // Idle auto-lock timer.
  useEffect(() => {
    if (locked) return; // already locked — no need to track
    let timer = window.setTimeout(() => lock('idle'), IDLE_TIMEOUT_MS);
    let lastReset = performance.now();
    function reset() {
      // Cheap debounce — at most one reset per 750ms.
      const now = performance.now();
      if (now - lastReset < 750) return;
      lastReset = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lock('idle'), IDLE_TIMEOUT_MS);
    }
    window.addEventListener('pointermove', reset, { passive: true });
    window.addEventListener('keydown', reset);
    window.addEventListener('pointerdown', reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('pointerdown', reset);
    };
  }, [locked, lock]);

  // Focus the input when locked so the user can type to unlock.
  useEffect(() => {
    if (!locked) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [locked]);

  const now = useNow(1000);

  if (!locked) return null;

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const userLabel = ensName ?? (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Guest');

  return (
    <>
      <style>{lockKeyframes}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="BerryOS lock screen"
        onClick={() => unlock('click')}
        style={lockOverlayStyle}
      >
        {/* Blurred wallpaper layer */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: wallpaper.src,
            filter: 'blur(28px) brightness(0.85) saturate(0.95)',
            transform: 'scale(1.08)', // hide blur edges
          }}
        />
        {/* Sand-tone overlay — warms the blurred wallpaper toward the
            Liquid Sand palette so the giant glass clock reads cleanly. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at center, rgba(251,246,238,0.15) 0%, rgba(60,45,25,0.55) 100%)',
            mixBlendMode: 'normal',
          }}
        />

        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 18,
            textAlign: 'center',
            animation: 'berryLockIn var(--ls-dur-slow) var(--ls-ease-glide) both',
            fontFamily: 'var(--ls-font-sans)',
          }}
          onClick={e => e.stopPropagation() /* clicks inside the panel don't unlock; input/keys do */}
        >
          {/* Giant glass clock — central showpiece. */}
          <GlassPanel
            blur="extreme"
            radius="xl"
            glow
            style={{
              padding: '28px 56px',
              color: 'var(--ls-fg-on-dark)',
              minWidth: 360,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--ls-font-mono)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 86,
                fontWeight: 300,
                letterSpacing: -2,
                lineHeight: 1,
              }}
            >
              {time}
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: 'var(--ls-font-sans)',
                fontSize: 14,
                fontWeight: 400,
                opacity: 0.85,
                letterSpacing: 0.3,
              }}
            >
              {date}
            </div>
          </GlassPanel>

          {/* Avatar in a small frosted disc. */}
          <GlassPanel
            blur="medium"
            radius="full"
            style={{
              width: 96,
              height: 96,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              color: 'var(--ls-fg-on-dark)',
            }}
          >
            {ensAvatar ? (
              <img
                src={ensAvatar}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <Sparkle size={40} />
            )}
          </GlassPanel>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ls-fg-on-dark)',
              opacity: 0.9,
            }}
          >
            {userLabel}
          </div>

          {/* Password field — a small glass input pill. */}
          <div
            style={{ width: 240 }}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter') unlock('input');
            }}
          >
            <GlassInput
              ref={inputRef}
              type="password"
              placeholder="Enter password"
              aria-label="Enter password to unlock (any input unlocks)"
              style={{ textAlign: 'center' }}
            />
          </div>

          {/* Unlock chip — clarifies that any keypress dismisses. */}
          <GlassChip
            tone="accent"
            style={{ marginTop: 4, fontFamily: 'var(--ls-font-sans)' }}
          >
            <Lock size={11} />
            <span>Click anywhere or press Return to unlock</span>
          </GlassChip>
        </div>
      </div>
    </>
  );
}

const lockOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 5500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  overflow: 'hidden',
};

const lockKeyframes = `
@keyframes berryLockIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
`;
