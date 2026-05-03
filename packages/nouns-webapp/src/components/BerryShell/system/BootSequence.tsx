/**
 * BerryOS boot sequence — full-screen splash that wraps the desktop on first
 * mount. Fades to reveal BerryShell once the boot phases finish.
 *
 * Phases (each emits `system:bootProgress` with `{ phase, progress: 0-1 }`):
 *   1. Checking hardware…    ~200ms (viewport + wallet snapshot)
 *   2. Loading services…     ~600ms (waits for `service:started` events,
 *                                     emits per-service progress)
 *   3. Mounting filesystems… ~300ms (waits for vfs seed if vfs exists)
 *   4. Starting applications… ~400ms (counts berryRegistry.list().length)
 *   5. Welcome to BerryOS    1000ms pause then fade
 *
 * After the welcome pause we emit `system:bootComplete` (via window event,
 * since the canonical bus' BerryEventMap doesn't include progress yet) AND
 * the canonical `berryBus.emit('system:bootComplete', {})` so the rest of the
 * codebase can hang reactions off the existing typed bus.
 *
 * "Fast boot" — once the user has booted once, the localStorage flag
 * `berry.bootedOnce` is set. Subsequent loads collapse phases 1-4 to ~250ms
 * each (still emit events for completeness) so the splash doesn't get stale.
 * If the user enables `berry.fastBoot=true` we skip the splash entirely.
 *
 * Restore: after `system:bootComplete` we look for a saved window snapshot
 * (written by ShutdownSequence) and replay each entry through the
 * windowStore. Snapshot is keyed on `berry.windowSnapshot`.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { GlassPanel } from '@/liquid-sand/glass';
import { Sandglass } from '@/liquid-sand/icons';

import { berryRegistry } from './berryRegistry';
import { berryBus } from './eventBus';
import { extendedBus } from './extendedBus';
import { playLoginChime } from './loginChime';
import { serviceManager } from './services';
import { windowStore, type BerryWindowConfig } from '../store/windowStore';

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

interface PhaseDef {
  /** Stable id used by `system:bootProgress` consumers. */
  id: 'hardware' | 'services' | 'filesystem' | 'apps' | 'welcome';
  label: string;
  /** Default duration in ms when there's no async signal to wait on. */
  durationMs: number;
}

const FRESH_PHASES: readonly PhaseDef[] = [
  { id: 'hardware', label: 'Checking hardware…', durationMs: 200 },
  { id: 'services', label: 'Loading services…', durationMs: 600 },
  { id: 'filesystem', label: 'Mounting filesystems…', durationMs: 300 },
  { id: 'apps', label: 'Starting applications…', durationMs: 400 },
  { id: 'welcome', label: 'Welcome to BerryOS', durationMs: 1000 },
];

const FAST_PHASES: readonly PhaseDef[] = FRESH_PHASES.map(p =>
  p.id === 'welcome' ? { ...p, durationMs: 350 } : { ...p, durationMs: 200 },
);

const BOOTED_FLAG = 'berry.bootedOnce';
const FAST_BOOT_FLAG = 'berry.fastBoot';
const SNAPSHOT_KEY = 'berry.windowSnapshot';

// ---------------------------------------------------------------------------
// Window-event payloads (these aren't in BerryEventMap; we use CustomEvent so
// the canonical bus stays under its owner's control).
// ---------------------------------------------------------------------------

export interface BootStartedDetail {
  fast: boolean;
  phaseCount: number;
}

export interface BootProgressDetail {
  phase: PhaseDef['id'];
  label: string;
  progress: number; // 0..1 inside the phase
  overall: number; // 0..1 across all phases
}

export interface BootCompleteDetail {
  fast: boolean;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBoolFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function setBoolFlag(key: string, val: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, val ? 'true' : 'false');
  } catch {
    /* ignore quota */
  }
}

function readSnapshot(): PersistedWindowSnapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PersistedWindowSnapshot =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as PersistedWindowSnapshot).appId === 'string',
    );
  } catch {
    return [];
  }
}

interface BerryVfsShim {
  isReady?: () => boolean;
  ready?: () => Promise<void>;
}

/**
 * The vfs may or may not be present (other agent's surface). Looking it up via
 * window globals keeps us decoupled — services + registry are well-defined and
 * imported directly above.
 */
function getVfs(): BerryVfsShim | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { berryVfs?: BerryVfsShim };
  return w.berryVfs ?? null;
}

function emitProgress(detail: BootProgressDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BootProgressDetail>('system:bootProgress', { detail }));
}

function emitStarted(detail: BootStartedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BootStartedDetail>('system:bootStarted', { detail }));
}

function emitComplete(detail: BootCompleteDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BootCompleteDetail>('system:bootComplete', { detail }));
}

// ---------------------------------------------------------------------------
// Phase runners — return Promises that resolve when the phase completes.
// ---------------------------------------------------------------------------

interface ProgressEmitter {
  (phase: PhaseDef, progress: number, overall: number): void;
}

function tickPhase(
  phase: PhaseDef,
  emit: ProgressEmitter,
  overallStart: number,
  overallSpan: number,
): Promise<void> {
  return new Promise(resolve => {
    const start = performance.now();
    const dur = Math.max(60, phase.durationMs);
    let raf = 0;
    const step = () => {
      const elapsed = performance.now() - start;
      const p = Math.min(1, elapsed / dur);
      emit(phase, p, overallStart + overallSpan * p);
      if (p < 1) {
        raf = window.requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    raf = window.requestAnimationFrame(step);
    // Safety cleanup if unmounted mid-phase — caller awaits resolve so this is
    // belt-and-braces.
    void raf;
  });
}

async function runHardware(
  phase: PhaseDef,
  emit: ProgressEmitter,
  overallStart: number,
  overallSpan: number,
): Promise<void> {
  // Real signals: viewport size + presence of an injected wallet provider.
  // We synchronously read both then ride the phase timer for visual sake.
  if (typeof window !== 'undefined') {
    void (window.innerWidth + window.innerHeight);
    const w = window as Window & { ethereum?: unknown };
    void w.ethereum;
  }
  await tickPhase(phase, emit, overallStart, overallSpan);
}

async function runServices(
  phase: PhaseDef,
  emit: ProgressEmitter,
  overallStart: number,
  overallSpan: number,
): Promise<void> {
  // If the service manager has registered services, drive progress from the
  // real `service:started` events. Otherwise just ride the phase timer.
  const knownServices = serviceManager.list();
  const total = knownServices.length;

  if (total === 0) {
    await tickPhase(phase, emit, overallStart, overallSpan);
    return;
  }

  // Already-running services count toward "started" immediately so a re-mount
  // of the splash doesn't stall waiting for events that already fired.
  let started = knownServices.filter(s => s.status === 'running').length;
  emit(phase, started / total, overallStart + overallSpan * (started / total));

  const off = extendedBus.on('service:started', () => {
    started = Math.min(total, started + 1);
    const p = started / total;
    emit(phase, p, overallStart + overallSpan * p);
  });

  // Race: max-duration safety net so a hung service doesn't block boot.
  const safety = new Promise<void>(resolve => {
    window.setTimeout(resolve, Math.max(phase.durationMs, 1500));
  });
  const allStarted = new Promise<void>(resolve => {
    const id = window.setInterval(() => {
      if (started >= total) {
        window.clearInterval(id);
        resolve();
      }
    }, 60);
  });

  await Promise.race([allStarted, safety]);
  off();
  emit(phase, 1, overallStart + overallSpan);
}

async function runFilesystem(
  phase: PhaseDef,
  emit: ProgressEmitter,
  overallStart: number,
  overallSpan: number,
): Promise<void> {
  const vfs = getVfs();
  // No vfs yet — just ride the timer.
  if (!vfs) {
    await tickPhase(phase, emit, overallStart, overallSpan);
    return;
  }
  if (vfs.isReady?.()) {
    emit(phase, 1, overallStart + overallSpan);
    return;
  }
  emit(phase, 0.1, overallStart + overallSpan * 0.1);
  try {
    if (vfs.ready) {
      await Promise.race([
        vfs.ready(),
        new Promise<void>(resolve => window.setTimeout(resolve, 1500)),
      ]);
    }
  } catch {
    /* swallow — boot continues regardless */
  }
  emit(phase, 1, overallStart + overallSpan);
}

async function runApps(
  phase: PhaseDef,
  emit: ProgressEmitter,
  overallStart: number,
  overallSpan: number,
): Promise<void> {
  const apps = berryRegistry.list();
  const total = apps.length;

  if (total === 0) {
    await tickPhase(phase, emit, overallStart, overallSpan);
    return;
  }

  // Ramp through the apps over the configured duration.
  const per = Math.max(40, Math.floor(phase.durationMs / total));
  for (let i = 0; i < total; i++) {
    await new Promise(resolve => window.setTimeout(resolve, per));
    const p = (i + 1) / total;
    emit(phase, p, overallStart + overallSpan * p);
  }
}

// ---------------------------------------------------------------------------
// Restore saved windows
// ---------------------------------------------------------------------------

function restoreSavedWindows(): void {
  const snap = readSnapshot();
  if (!snap.length) return;
  // Defer one frame so any auto-open windows from BerryShell mount first.
  window.requestAnimationFrame(() => {
    snap.forEach(entry => {
      const config: BerryWindowConfig = {
        appId: entry.appId,
        title: entry.title,
        icon: entry.icon,
        width: entry.width,
        height: entry.height,
        x: entry.x,
        y: entry.y,
      };
      windowStore.open(config);
    });
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BootSequenceProps {
  children: ReactNode;
  /**
   * Force-skip the splash. Useful in tests or when an embedder wants the
   * shell up immediately.
   */
  skip?: boolean;
}

type Stage = 'booting' | 'fading' | 'done';

export default function BootSequence({ children, skip }: BootSequenceProps) {
  const fastBoot = readBoolFlag(FAST_BOOT_FLAG);
  const bootedOnce = readBoolFlag(BOOTED_FLAG);

  // Determine initial stage. Skip + fastBoot collapse the splash entirely.
  const initialStage: Stage = skip || fastBoot ? 'done' : 'booting';
  const phases = bootedOnce ? FAST_PHASES : FRESH_PHASES;

  const [stage, setStage] = useState<Stage>(initialStage);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [progressInPhase, setProgressInPhase] = useState(0);
  const ranOnce = useRef(false);

  // The boot loop runs exactly once. Strict-mode double-mount is guarded by
  // ranOnce so we don't fire the chime twice in dev.
  useEffect(() => {
    if (initialStage === 'done') {
      // Still emit complete + restore so consumers downstream don't differ.
      emitComplete({ fast: true });
      try {
        berryBus.emit('system:bootComplete', {});
      } catch {
        /* ignore */
      }
      restoreSavedWindows();
      return;
    }
    if (ranOnce.current) return;
    ranOnce.current = true;

    let cancelled = false;
    emitStarted({ fast: bootedOnce, phaseCount: phases.length });

    const overallShare = 1 / phases.length;
    const emit: ProgressEmitter = (phase, progress, overall) => {
      if (cancelled) return;
      setProgressInPhase(progress);
      emitProgress({
        phase: phase.id,
        label: phase.label,
        progress,
        overall,
      });
    };

    (async () => {
      for (let i = 0; i < phases.length && !cancelled; i++) {
        setPhaseIndex(i);
        setProgressInPhase(0);
        const phase = phases[i];
        const overallStart = i * overallShare;
        switch (phase.id) {
          case 'hardware':
            await runHardware(phase, emit, overallStart, overallShare);
            break;
          case 'services':
            await runServices(phase, emit, overallStart, overallShare);
            break;
          case 'filesystem':
            await runFilesystem(phase, emit, overallStart, overallShare);
            break;
          case 'apps':
            await runApps(phase, emit, overallStart, overallShare);
            break;
          case 'welcome':
            await tickPhase(phase, emit, overallStart, overallShare);
            break;
        }
      }
      if (cancelled) return;
      // Mark "we've booted at least once" so subsequent loads use FAST_PHASES.
      setBoolFlag(BOOTED_FLAG, true);
      emitComplete({ fast: bootedOnce });
      try {
        berryBus.emit('system:bootComplete', {});
      } catch {
        /* ignore */
      }
      // Audio cue tied to bootComplete (best-effort).
      try {
        playLoginChime();
      } catch {
        /* ignore */
      }
      // Restore saved windows now that downstream listeners can react.
      restoreSavedWindows();
      // Begin fade.
      setStage('fading');
      window.setTimeout(() => {
        if (!cancelled) setStage('done');
      }, 450);
    })().catch(() => {
      // Even on failure we want the desktop to appear — never trap the user
      // on the boot splash.
      setStage('done');
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentPhase = phases[Math.min(phaseIndex, phases.length - 1)];

  return (
    <>
      {/* Inline keyframes — no animation libraries, no CSS modules to add. */}
      <style>{splashKeyframes}</style>

      {children}

      {stage !== 'done' && (
        <div
          role="status"
          aria-live="polite"
          aria-label="BerryOS boot sequence"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 5000,
            // Soft sand gradient — same family as the desktop backdrop so the
            // splash → desktop fade reads as one continuous surface.
            background:
              'linear-gradient(180deg, var(--ls-sand-50) 0%, var(--ls-sand-100) 50%, var(--ls-sand-200) 100%)',
            color: 'var(--ls-fg-primary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
            opacity: stage === 'fading' ? 0 : 1,
            // Glide easing matches Liquid Sand transitions used elsewhere.
            transition: 'opacity var(--ls-dur-slow) var(--ls-ease-glide)',
            pointerEvents: stage === 'fading' ? 'none' : 'auto',
            fontFamily: 'var(--ls-font-sans)',
          }}
        >
          <GlassPanel
            blur="extreme"
            radius="lg"
            glow
            style={{
              padding: '32px 40px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 20,
              minWidth: 280,
              animation:
                'berryBootIn var(--ls-dur-slow) var(--ls-ease-glide) both',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 64,
                height: 64,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ls-sand-600)',
                animation: 'berryBootPulse 2.4s ease-in-out infinite',
              }}
            >
              <Sandglass size={48} />
            </div>
            {/* HIG large title (34pt) — anchors the splash visually. */}
            <div
              style={{
                fontFamily: 'var(--ls-font-sans)',
                fontSize: 'var(--ls-text-3xl)',
                fontWeight: 600,
                letterSpacing: -0.5,
                color: 'var(--ls-fg-primary)',
                lineHeight: 1.05,
                textAlign: 'center',
              }}
            >
              BerryOS
            </div>
            {/* HIG subhead caption (13pt). */}
            <div
              style={{
                fontFamily: 'var(--ls-font-sans)',
                fontSize: 'var(--ls-text-sm)',
                color: 'var(--ls-fg-secondary)',
                marginTop: -8,
                letterSpacing: 0.2,
                textAlign: 'center',
              }}
            >
              a desktop for crypto misfits
            </div>
            <div
              role="progressbar"
              aria-label={currentPhase?.label ?? 'Booting'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressInPhase * 100)}
              style={{
                width: 220,
                height: 4,
                borderRadius: 'var(--ls-r-full)',
                background: 'var(--ls-glass-tint)',
                overflow: 'hidden',
                boxShadow: 'inset 0 1px 1px rgba(60,45,25,0.10)',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(progressInPhase * 100)}%`,
                  background:
                    'linear-gradient(90deg, var(--ls-sand-300) 0%, var(--ls-sand-500) 100%)',
                  transition: 'width 80ms linear',
                  boxShadow: '0 0 8px rgba(184,147,82,0.55)',
                }}
              />
            </div>
            <div
              style={{
                fontFamily: 'var(--ls-font-mono)',
                fontSize: 12,
                letterSpacing: 0.4,
                color: 'var(--ls-fg-secondary)',
                minHeight: 16,
                textAlign: 'center',
              }}
            >
              {currentPhase?.label ?? ''}
            </div>
          </GlassPanel>
        </div>
      )}
    </>
  );
}

const splashKeyframes = `
@keyframes berryBootPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.04); opacity: 0.85; }
}
@keyframes berryBootIn {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
/* HIG: respect Reduce Motion — collapse all splash animation to a static fade. */
@media (prefers-reduced-motion: reduce) {
  @keyframes berryBootPulse { from { opacity: 1; } to { opacity: 1; } }
  @keyframes berryBootIn { from { opacity: 1; transform: none; } to { opacity: 1; transform: none; } }
}
`;
