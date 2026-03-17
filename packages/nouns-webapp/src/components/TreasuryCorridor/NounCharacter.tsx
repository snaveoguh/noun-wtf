/**
 * NounCharacter — First-person camera controller with WASD/arrow key movement.
 * Moves through the corridor with smooth acceleration/deceleration.
 * Mouse look for camera rotation. Spacebar toggles auto-walk.
 */
import { useRef, useEffect, useCallback, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const MOVE_SPEED = 0.12;
const MOUSE_SENSITIVITY = 0.002;
const DAMPING = 0.88;
const CORRIDOR_WIDTH = 16;
const EYE_HEIGHT = 2.5;
const CORRIDOR_LENGTH = 240;
const AUTO_WALK_SPEED = 0.04;

interface Props {
  onPositionChange?: (z: number) => void;
}

export default function NounCharacter({ onPositionChange }: Props) {
  const { camera, gl } = useThree();
  const velocityRef = useRef(new THREE.Vector3(0, 0, 0));
  const keysRef = useRef<Set<string>>(new Set());
  const mouseDownRef = useRef(false);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const autoWalkRef = useRef(false);
  const [autoWalk, setAutoWalk] = useState(false);
  const posRef = useRef(new THREE.Vector3(0, EYE_HEIGHT, 4));

  // Initialize camera position
  useEffect(() => {
    camera.position.set(0, EYE_HEIGHT, 4);
    camera.lookAt(0, EYE_HEIGHT, -10);
  }, [camera]);

  // Keyboard handlers
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    keysRef.current.add(e.key.toLowerCase());
    if (e.key === ' ') {
      e.preventDefault();
      autoWalkRef.current = !autoWalkRef.current;
      setAutoWalk(autoWalkRef.current);
    }
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keysRef.current.delete(e.key.toLowerCase());
  }, []);

  // Mouse look handlers
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 0) { // left click
      mouseDownRef.current = true;
      gl.domElement.style.cursor = 'none';
    }
  }, [gl]);

  const handleMouseUp = useCallback(() => {
    mouseDownRef.current = false;
    gl.domElement.style.cursor = 'grab';
  }, [gl]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!mouseDownRef.current) return;
    yawRef.current -= e.movementX * MOUSE_SENSITIVITY;
    pitchRef.current -= e.movementY * MOUSE_SENSITIVITY;
    pitchRef.current = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitchRef.current));
  }, []);

  // Right click prevention
  const handleContext = useCallback((e: Event) => e.preventDefault(), []);

  useEffect(() => {
    const el = gl.domElement;
    el.style.cursor = 'grab';

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    el.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    el.addEventListener('contextmenu', handleContext);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      el.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('contextmenu', handleContext);
    };
  }, [gl, handleKeyDown, handleKeyUp, handleMouseDown, handleMouseUp, handleMouseMove, handleContext]);

  useFrame(() => {
    const keys = keysRef.current;
    const vel = velocityRef.current;
    const pos = posRef.current;

    // Compute movement direction relative to camera yaw
    const forward = new THREE.Vector3(
      -Math.sin(yawRef.current),
      0,
      -Math.cos(yawRef.current),
    );
    const right = new THREE.Vector3(
      Math.cos(yawRef.current),
      0,
      -Math.sin(yawRef.current),
    );

    // Input acceleration
    const accel = new THREE.Vector3(0, 0, 0);
    if (keys.has('w') || keys.has('arrowup')) accel.add(forward);
    if (keys.has('s') || keys.has('arrowdown')) accel.sub(forward);
    if (keys.has('a') || keys.has('arrowleft')) accel.sub(right);
    if (keys.has('d') || keys.has('arrowright')) accel.add(right);

    // Auto-walk
    if (autoWalkRef.current) {
      accel.add(forward.clone().multiplyScalar(AUTO_WALK_SPEED / MOVE_SPEED));
    }

    if (accel.lengthSq() > 0) {
      accel.normalize().multiplyScalar(MOVE_SPEED);
    }

    vel.add(accel);
    vel.multiplyScalar(DAMPING);

    // Apply velocity
    pos.add(vel);

    // Wall collisions
    const wallLimit = CORRIDOR_WIDTH / 2 - 1;
    pos.x = Math.max(-wallLimit, Math.min(wallLimit, pos.x));
    pos.y = EYE_HEIGHT;
    // Corridor bounds: z from ~5 (entrance) to -CORRIDOR_LENGTH (end)
    pos.z = Math.max(-CORRIDOR_LENGTH + 2, Math.min(5, pos.z));

    // Update camera position
    camera.position.copy(pos);

    // Update camera rotation from mouse look
    const euler = new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    // Report position for data panel visibility
    onPositionChange?.(pos.z);
  });

  return (
    <>
      {/* HUD: auto-walk indicator */}
      {autoWalk && (
        <group position={[0, 0, 0]}>
          {/* This is handled in the HTML overlay instead */}
        </group>
      )}
    </>
  );
}
