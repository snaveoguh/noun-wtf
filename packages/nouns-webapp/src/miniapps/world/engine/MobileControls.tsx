/**
 * MobileControls — Virtual joystick (left) + action buttons (right) for touch devices.
 * Feeds into the existing InputState system so game logic doesn't need changes.
 */
import { FC, useCallback, useEffect, useRef, useState } from 'react';
import type { InputState } from './input';

// ── Detect mobile ───────────────────────────────────────────────────

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// ── Joystick Component ──────────────────────────────────────────────

const JOYSTICK_SIZE = 120;
const KNOB_SIZE = 50;
const DEAD_ZONE = 0.15;

interface MobileControlsProps {
  inputRef: React.RefObject<InputState>;
  onJump?: () => void;
  onAttack?: () => void;
  onInteract?: () => void;
}

const MobileControls: FC<MobileControlsProps> = ({ inputRef, onJump, onAttack, onInteract }) => {
  const joystickRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const touchIdRef = useRef<number | null>(null);
  const centerRef = useRef({ x: 0, y: 0 });

  const handleJoystickStart = useCallback((e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch || !joystickRef.current) return;
    e.preventDefault();
    touchIdRef.current = touch.identifier;
    const rect = joystickRef.current.getBoundingClientRect();
    centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  const handleJoystickMove = useCallback((e: React.TouchEvent) => {
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

      // Feed into input state
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
  }, [inputRef]);

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

  return (
    <div data-mobile-controls style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      {/* ── Left: Virtual Joystick ── */}
      <div
        ref={joystickRef}
        onTouchStart={handleJoystickStart}
        onTouchMove={handleJoystickMove}
        onTouchEnd={handleJoystickEnd}
        onTouchCancel={handleJoystickEnd}
        style={{
          position: 'absolute',
          left: 24,
          bottom: 48,
          width: JOYSTICK_SIZE,
          height: JOYSTICK_SIZE,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
          border: '2px solid rgba(255,255,255,0.2)',
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
      >
        {/* Knob */}
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

      {/* ── Right: Action Buttons ── */}
      <div
        style={{
          position: 'absolute',
          right: 24,
          bottom: 48,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'center',
          pointerEvents: 'auto',
        }}
      >
        {/* Jump */}
        <ActionButton
          label="⬆"
          color="rgba(0,255,200,0.25)"
          borderColor="rgba(0,255,200,0.5)"
          onPress={onJump}
        />
        {/* Attack */}
        <div style={{ display: 'flex', gap: 12 }}>
          <ActionButton
            label="👊"
            color="rgba(255,100,100,0.25)"
            borderColor="rgba(255,100,100,0.5)"
            onPress={onAttack}
          />
          {/* Interact */}
          <ActionButton
            label="E"
            color="rgba(100,150,255,0.25)"
            borderColor="rgba(100,150,255,0.5)"
            onPress={onInteract}
          />
        </div>
      </div>
    </div>
  );
};

function ActionButton({
  label,
  color,
  borderColor,
  onPress,
}: {
  label: string;
  color: string;
  borderColor: string;
  onPress?: () => void;
}) {
  return (
    <button
      onTouchStart={(e) => {
        e.preventDefault();
        onPress?.();
      }}
      style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: color,
        border: `2px solid ${borderColor}`,
        color: '#fff',
        fontSize: 20,
        fontWeight: 'bold',
        fontFamily: 'monospace',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export default MobileControls;
