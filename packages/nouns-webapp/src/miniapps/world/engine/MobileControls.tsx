/**
 * MobileControls — Virtual joystick (left) + arc of action buttons (right).
 *
 * 21 tiny buttons arranged in a curved arc along the right edge,
 * Nokia N-Gage style. Each button injects its key into InputState
 * so game logic doesn't need changes.
 *
 * Also has a swipe-up gesture on the right half to trigger jump.
 */
import { FC, useCallback, useEffect, useRef, useState } from 'react';
import type { InputState } from './input';

// ── Detect mobile ───────────────────────────────────────────────────

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// ── Button definitions ─────────────────────────────────────────────

interface ButtonDef {
  icon: string;
  key: string; // key to inject into InputState
  hold?: boolean; // true = key stays held while touching
  special?: 'jump' | 'shift'; // special handling
}

const BUTTONS: ButtonDef[] = [
  // Combat (warm reds/oranges)
  { icon: '👊', key: 'j' },
  { icon: '🦶', key: 'k' },
  { icon: '💥', key: 'h' },
  { icon: '⬆', key: 'u' },
  { icon: '🌀', key: 'q' },
  // Movement (greens)
  { icon: '⏫', key: ' ', special: 'jump' },
  { icon: '🏃', key: 'r', hold: true },
  { icon: '🛡', key: 'shift', hold: true, special: 'shift' },
  // Weapons/Items (blues)
  { icon: '🔫', key: 'f' },
  { icon: '✋', key: 'e' },
  // World actions (purples/pinks)
  { icon: '🛹', key: 'v' },
  { icon: '🎨', key: 'g' },
  { icon: '🎤', key: 'm' },
  { icon: '😄', key: 't' },
  // Camera (light blues)
  { icon: '🔍', key: 'z', hold: true },
  { icon: '1', key: '1' },
  { icon: '2', key: '2' },
  { icon: '3', key: '3' },
  { icon: '4', key: '4' },
  { icon: '5', key: '5' },
  // System
  { icon: '✕', key: 'escape' },
];

// Rainbow gradient colors for the arc (bottom → top)
const ARC_COLORS = [
  '#ff4444',
  '#ff5533',
  '#ff6622',
  '#ff8811',
  '#ffaa00', // reds → orange
  '#44ff88',
  '#22ddaa',
  '#00ccbb', // greens
  '#4488ff',
  '#5566ff', // blues
  '#aa44ff',
  '#cc33ee',
  '#ee33aa',
  '#ff44aa', // purples/pinks
  '#88ddff',
  '#99ccff',
  '#aabbff',
  '#bbccff',
  '#ccddff',
  '#ddeeff', // camera blues
  '#888888', // exit gray
];

// ── Grid layout — 3 columns, safe-area aware ──────────────────────

const BTN_SIZE = 30;
const BTN_GAP = 5;
const COLS = 3;
const MARGIN_RIGHT = 10;
const MARGIN_BOTTOM = 64; // extra room for iOS home indicator

function getButtonPosition(index: number): { right: number; bottom: number } {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const right = MARGIN_RIGHT + col * (BTN_SIZE + BTN_GAP);
  const bottom = MARGIN_BOTTOM + row * (BTN_SIZE + BTN_GAP);
  return { right, bottom };
}

// ── Joystick ───────────────────────────────────────────────────────

const JOYSTICK_SIZE = 120;
const KNOB_SIZE = 50;
const DEAD_ZONE = 0.15;

// ── Swipe detection constants ──────────────────────────────────────

const SWIPE_MIN_DIST = 50; // px vertical minimum
const SWIPE_MAX_TIME = 300; // ms maximum swipe duration

interface MobileControlsProps {
  inputRef: React.RefObject<InputState>;
  onJump?: () => void;
}

const MobileControls: FC<MobileControlsProps> = ({ inputRef, onJump }) => {
  const joystickRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const touchIdRef = useRef<number | null>(null);
  const centerRef = useRef({ x: 0, y: 0 });

  // Swipe tracking
  const swipeRef = useRef<{ id: number; startY: number; startTime: number } | null>(null);

  const handleJoystickStart = useCallback((e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch || !joystickRef.current) return;
    e.preventDefault();
    touchIdRef.current = touch.identifier;
    const rect = joystickRef.current.getBoundingClientRect();
    centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  const handleJoystickMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier !== touchIdRef.current) continue;

        const dx = touch.clientX - centerRef.current.x;
        const dy = touch.clientY - centerRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = JOYSTICK_SIZE / 2 - KNOB_SIZE / 2;
        const clampedDist = Math.min(dist, maxDist);
        const angle = Math.atan2(dy, dx);
        const nx = (Math.cos(angle) * clampedDist) / maxDist;
        const ny = (Math.sin(angle) * clampedDist) / maxDist;

        setKnobPos({ x: nx * maxDist, y: ny * maxDist });

        const input = inputRef.current;
        if (input) {
          input.keys.delete('w');
          input.keys.delete('s');
          input.keys.delete('a');
          input.keys.delete('d');
          if (ny < -DEAD_ZONE) input.keys.add('w');
          if (ny > DEAD_ZONE) input.keys.add('s');
          if (nx < -DEAD_ZONE) input.keys.add('a');
          if (nx > DEAD_ZONE) input.keys.add('d');
        }
      }
    },
    [inputRef],
  );

  const handleJoystickEnd = useCallback(() => {
    touchIdRef.current = null;
    setKnobPos({ x: 0, y: 0 });
    const input = inputRef.current;
    if (input) {
      input.keys.delete('w');
      input.keys.delete('s');
      input.keys.delete('a');
      input.keys.delete('d');
    }
  }, [inputRef]);

  // Prevent scrolling on touch
  useEffect(() => {
    const prevent = (e: TouchEvent) => {
      if ((e.target as HTMLElement)?.closest?.('[data-mobile-controls]')) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', prevent, { passive: false });
    return () => document.removeEventListener('touchmove', prevent);
  }, []);

  // ── Swipe-up-to-jump on right half of screen ─────────────────────

  const handleSwipeStart = useCallback((e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    // Ignore touches that start on a button or inside the joystick —
    // otherwise every button tap arms a swipe and the release fires a jump.
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, [data-joystick]')) return;
    // Only track swipes on right half (left half is joystick area)
    if (touch.clientX < window.innerWidth * 0.4) return;
    swipeRef.current = {
      id: touch.identifier,
      startY: touch.clientY,
      startTime: Date.now(),
    };
  }, []);

  const handleSwipeEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!swipeRef.current) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier !== swipeRef.current.id) continue;

        const dy = swipeRef.current.startY - touch.clientY; // positive = upward
        const dt = Date.now() - swipeRef.current.startTime;

        if (dy > SWIPE_MIN_DIST && dt < SWIPE_MAX_TIME) {
          // Swipe up detected — trigger jump
          onJump?.();
          const input = inputRef.current;
          if (input) {
            input.keys.add(' ');
            input.justPressed.add(' ');
            const now = Date.now();
            if (now - input.lastSpaceTime < 400) {
              input.spaceTaps++;
            } else {
              input.spaceTaps = 1;
            }
            input.lastSpaceTime = now;
            setTimeout(() => {
              inputRef.current?.keys.delete(' ');
            }, 100);
          }
        }
        swipeRef.current = null;
        break;
      }
    },
    [inputRef, onJump],
  );

  // ── Button press/release handlers ──────────────────────────────

  const handleButtonStart = useCallback(
    (def: ButtonDef) => {
      const input = inputRef.current;
      if (!input) return;

      if (def.special === 'jump') {
        // Use the physics-aware jump callback
        onJump?.();
        // Also inject space for skating tricks etc
        input.keys.add(' ');
        input.justPressed.add(' ');
        const now = Date.now();
        if (now - input.lastSpaceTime < 400) {
          input.spaceTaps++;
        } else {
          input.spaceTaps = 1;
        }
        input.lastSpaceTime = now;
        if (!def.hold) {
          setTimeout(() => {
            inputRef.current?.keys.delete(' ');
          }, 100);
        }
        return;
      }

      if (def.special === 'shift') {
        input.shiftHeld = true;
      }

      input.keys.add(def.key);
      input.justPressed.add(def.key);

      if (!def.hold) {
        setTimeout(() => {
          inputRef.current?.keys.delete(def.key);
        }, 100);
      }
    },
    [inputRef, onJump],
  );

  const handleButtonEnd = useCallback(
    (def: ButtonDef) => {
      const input = inputRef.current;
      if (!input) return;

      if (def.hold) {
        input.keys.delete(def.key);
      }
      if (def.special === 'shift') {
        input.shiftHeld = false;
      }
      if (def.special === 'jump' && def.hold) {
        input.keys.delete(' ');
      }
    },
    [inputRef],
  );

  // Grid dimensions for the tray background
  const totalRows = Math.ceil(BUTTONS.length / COLS);
  const gridW = COLS * (BTN_SIZE + BTN_GAP) - BTN_GAP;
  const gridH = totalRows * (BTN_SIZE + BTN_GAP) - BTN_GAP;

  return (
    <div
      data-mobile-controls
      onTouchStart={handleSwipeStart}
      onTouchEnd={handleSwipeEnd}
      onTouchCancel={() => {
        swipeRef.current = null;
      }}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}
    >
      {/* ── Left: Virtual Joystick ── */}
      <div
        ref={joystickRef}
        data-joystick
        onTouchStart={handleJoystickStart}
        onTouchMove={handleJoystickMove}
        onTouchEnd={handleJoystickEnd}
        onTouchCancel={handleJoystickEnd}
        style={{
          position: 'absolute',
          left: 24,
          bottom: 64,
          width: JOYSTICK_SIZE,
          height: JOYSTICK_SIZE,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
          border: '2px solid rgba(255,255,255,0.2)',
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: KNOB_SIZE,
            height: KNOB_SIZE,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.35)',
            border: '2px solid rgba(255,255,255,0.5)',
            transform: `translate(calc(-50% + ${knobPos.x}px), calc(-50% + ${knobPos.y}px))`,
            transition: touchIdRef.current !== null ? 'none' : 'transform 0.15s ease',
          }}
        />
      </div>

      {/* ── Right: Button tray background ── */}
      <div
        style={{
          position: 'absolute',
          right: MARGIN_RIGHT - 6,
          bottom: MARGIN_BOTTOM - 6,
          width: gridW + 12,
          height: gridH + 12,
          borderRadius: 14,
          background: 'rgba(0,0,0,0.25)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.08)',
          pointerEvents: 'none',
        }}
      />

      {/* ── Right: Arc of action buttons ── */}
      {BUTTONS.map((def, i) => {
        const pos = getButtonPosition(i);
        const color = ARC_COLORS[i % ARC_COLORS.length];
        return (
          <button
            key={def.key + i}
            onTouchStart={e => {
              e.preventDefault();
              handleButtonStart(def);
            }}
            onTouchEnd={e => {
              e.preventDefault();
              handleButtonEnd(def);
            }}
            onTouchCancel={() => handleButtonEnd(def)}
            style={{
              position: 'absolute',
              right: pos.right,
              bottom: pos.bottom,
              width: BTN_SIZE,
              height: BTN_SIZE,
              borderRadius: '50%',
              background: `${color}33`,
              border: `1.5px solid ${color}88`,
              color: '#fff',
              fontSize: /^\d$/.test(def.icon) ? 12 : 14,
              fontFamily: 'monospace',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
              touchAction: 'none',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
              boxShadow: `0 0 6px ${color}44`,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {def.icon}
          </button>
        );
      })}

      {/* Swipe hint — fades out after first swipe */}
      <div
        style={{
          position: 'absolute',
          right: MARGIN_RIGHT + gridW + 16,
          bottom: MARGIN_BOTTOM + gridH / 2 - 8,
          color: 'rgba(255,255,255,0.3)',
          fontSize: 11,
          fontFamily: 'monospace',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        swipe up = jump
      </div>
    </div>
  );
};

export default MobileControls;
