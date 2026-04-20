// ── CameraRig — Third-Person Action Camera ───────────────────────────
//
// Mounts inside <Canvas>. Every frame:
//   1. Reads target position (Object3D.position) + facing + velocity
//   2. Applies orbit angle from input (arrow keys, touch, gamepad)
//   3. Computes desired cam position (behind target, offsets, zoom dist)
//   4. Critically-damped spring toward that position
//   5. Spherecasts from target → desired, pushes in on collision
//   6. Velocity look-ahead biases the look-at point
//   7. Cinematic orbit drift layered on top during slo-mo
//   8. Spring FOV toward base +/- sprint/aim kick + slo-mo pulse
//   9. Writes back input.cameraAngle so movement stays camera-relative
//
// All physics uses the REAL useFrame delta — never scaled — so the rig
// stays smooth when the game is in slo-mo.

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { InputState } from '../input';
import type { CharacterState } from '../Character3D';
import {
  BIRDSEYE_DIST,
  BIRDSEYE_KEY,
  BIRDSEYE_Y_MULT,
  CAM_UP_OFFSET,
  CAMERA_ZOOM_PRESETS,
  CINEMATIC_ORBIT_AMP,
  CINEMATIC_ORBIT_FREQ,
  COLLISION_CLEARANCE,
  COLLISION_RAY_ORIGIN_Y,
  COLLISION_SNAP_IN,
  DEFAULT_ZOOM_INDEX,
  FOV_AIM_KICK,
  FOV_BASE,
  FOV_OMEGA,
  FOV_SLOMO_PULSE_AMP,
  FOV_SLOMO_PULSE_FREQ,
  FOV_SPRINT_KICK,
  FOV_UPDATE_THRESHOLD,
  LOOK_OMEGA_BASE,
  LOOK_OMEGA_SLOMO,
  LOOK_OMEGA_SPRINT,
  LOOKAHEAD_GAIN,
  LOOKAHEAD_MAX,
  POS_OMEGA_BASE,
  POS_OMEGA_SLOMO,
  POS_OMEGA_SPRINT,
  SHOULDER_OFFSET,
  TARGET_LOOK_HEIGHT,
  ZOOM_KEYS,
} from './rigConfig';

// The rig reads combat state defensively — slowMo may or may not be set,
// and the combat state type lives elsewhere in the engine. Use a minimal
// structural type so we don't coupling-couple with combat.ts imports.
interface SlowMoLike {
  factor: number;
  timer: number;
}

interface CombatStateLike {
  slowMo?: SlowMoLike | null;
  /** Optional aim signal; if a sibling system sets this, narrow FOV. */
  aiming?: boolean;
}

interface CameraRigProps {
  /**
   * Object the camera follows. Reads `.position` every frame.
   * Using an Object3D ref (vs bare Vector3) lets the rig pick up any
   * mesh/group — useful if the player is replaced or teleported.
   */
  target: React.RefObject<THREE.Object3D | null>;
  inputRef: React.RefObject<InputState | null>;
  playerCharState: React.RefObject<CharacterState | null>;
  combatRef: React.RefObject<CombatStateLike | null>;
  /**
   * Optional: the scene subtree used for collision raycasts. Bounded to
   * avoid raycasting against the whole scene (which is expensive and
   * hits things like HUD planes). If omitted, collision is disabled.
   */
  sceneRootRef?: React.RefObject<THREE.Object3D | null>;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Critically-damped second-order spring step.
 *
 * Integrates position + velocity toward `goal` using angular frequency
 * `omega` over real time `dt`. Analytic solution of:
 *    x'' + 2·omega·x' + omega²·(x - goal) = 0
 *
 * Returns the new position and mutates velocity in-place (via ref).
 */
function springScalar(
  current: number,
  velocity: { v: number },
  goal: number,
  omega: number,
  dt: number,
): number {
  // Clamp dt to avoid huge jumps after tab-blur
  const h = Math.min(dt, 1 / 20);
  const f = 1 + 2 * h * omega;
  const oo = omega * omega;
  const hoo = h * oo;
  const hhoo = h * hoo;
  const detInv = 1 / (f + hhoo);
  const detX = f * current + h * velocity.v + hhoo * goal;
  const detV = velocity.v + hoo * (goal - current);
  const newX = detX * detInv;
  const newV = detV * detInv;
  velocity.v = newV;
  return newX;
}

/** Spring a Vector3 in-place. `vel` holds per-axis velocity state. */
function springVec3(
  current: THREE.Vector3,
  vel: THREE.Vector3,
  goal: THREE.Vector3,
  omega: number,
  dt: number,
) {
  const vx = { v: vel.x };
  const vy = { v: vel.y };
  const vz = { v: vel.z };
  current.set(
    springScalar(current.x, vx, goal.x, omega, dt),
    springScalar(current.y, vy, goal.y, omega, dt),
    springScalar(current.z, vz, goal.z, omega, dt),
  );
  vel.set(vx.v, vy.v, vz.v);
}

// Module-level zoom index so the keydown listener (DOM) and the rig loop
// (three) share a single source of truth without prop-threading through
// WorldPage.tsx.
let currentZoomIndex = DEFAULT_ZOOM_INDEX;

export function setCameraZoomIndex(i: number) {
  currentZoomIndex = Math.max(0, Math.min(CAMERA_ZOOM_PRESETS.length - 1, i));
}

export function getCameraZoomIndex(): number {
  return currentZoomIndex;
}

// ── Component ────────────────────────────────────────────────────────

export function CameraRig({
  target,
  inputRef,
  playerCharState,
  combatRef,
  sceneRootRef,
}: CameraRigProps) {
  const { camera } = useThree();

  // Spring state
  const camPos = useRef(new THREE.Vector3());
  const camVel = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());
  const lookVel = useRef(new THREE.Vector3());
  const initialized = useRef(false);

  // FOV spring
  const fovCur = useRef(FOV_BASE);
  const fovVel = useRef({ v: 0 });
  const lastAppliedFov = useRef(FOV_BASE);

  // Orbit-from-input angle (yaw around target, 0 = looking -Z)
  const orbitYaw = useRef(0);
  // Orbit pitch from arrow-up/down (kept low — gameplay camera, not free-cam)
  const orbitPitch = useRef(0.12);

  // Cinematic orbit time accumulator (uses real time, not scaled)
  const cineT = useRef(0);

  // Reusable scratch vectors — avoid per-frame allocation
  const scratch = useRef({
    desired: new THREE.Vector3(),
    offset: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    rayDir: new THREE.Vector3(),
    rayOrigin: new THREE.Vector3(),
    raycaster: new THREE.Raycaster(),
    lookGoal: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
  });

  // Keyboard listener for zoom preset cycling (1-5 cycle, Z birdseye is
  // handled as a held key inside the frame loop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip if typing
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;

      const k = e.key;
      const idx = ZOOM_KEYS.indexOf(k);
      if (idx >= 0) {
        setCameraZoomIndex(idx);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useFrame((_, delta) => {
    // Real (unscaled) delta — rig stays smooth in slo-mo.
    const dt = Math.max(delta, 1 / 240);

    const targetObj = target.current;
    if (!targetObj) return;

    const input = inputRef.current;
    const pcs = playerCharState.current;
    const combat = combatRef.current;

    // ── Read slo-mo factor (defensive — 1.0 when normal speed) ────────
    const slowMoFactor =
      combat?.slowMo && typeof combat.slowMo.factor === 'number' ? combat.slowMo.factor : 1.0;
    const isSlomo = slowMoFactor < 1.0;
    const slomoIntensity = Math.max(0, 1 - slowMoFactor);

    // ── Read sprinting signal ────────────────────────────────────────
    // Sprint = R held (per input.ts / input keybinds) OR dashing state.
    const isSprinting =
      input?.keys.has('r') === true ||
      pcs?.state === 'dashing' ||
      // Skating → camera uses sprint-tight follow
      pcs?.isSkating === true;

    // ── Aim signal (narrow FOV) ──────────────────────────────────────
    // Read from combatRef if future code sets it, otherwise infer from
    // held weapon.
    const isAiming = combat?.aiming === true || pcs?.weaponEquipped != null;

    // ── Zoom preset + bird's-eye override ────────────────────────────
    const zoomOut = input?.keys.has(BIRDSEYE_KEY) === true;
    const preset =
      CAMERA_ZOOM_PRESETS[currentZoomIndex] ?? CAMERA_ZOOM_PRESETS[DEFAULT_ZOOM_INDEX]!;
    const wantDist = zoomOut ? BIRDSEYE_DIST : preset.dist;
    const wantPitch = zoomOut ? BIRDSEYE_Y_MULT : preset.y;

    // Spring-lerp the pitch separately so zoom snaps feel smooth.
    orbitPitch.current += (wantPitch - orbitPitch.current) * Math.min(1, dt * 3);

    // ── Integrate orbitYaw from input ────────────────────────────────
    // Arrow keys pan the camera (Spyro-style), gamepad right-stick also
    // writes input.cameraAngle in input.ts. We integrate arrow keys HERE
    // so the feel is framerate-independent + matches the rig's own dt.
    if (input) {
      const ARROW_PAN_SPEED = 2.2; // rad/sec — tune for comfort
      if (input.keys.has('arrowleft')) input.cameraAngle -= ARROW_PAN_SPEED * dt;
      if (input.keys.has('arrowright')) input.cameraAngle += ARROW_PAN_SPEED * dt;
      if (input.keys.has('arrowup'))
        orbitPitch.current = Math.max(0.04, orbitPitch.current - 1.4 * dt);
      if (input.keys.has('arrowdown'))
        orbitPitch.current = Math.min(0.95, orbitPitch.current + 1.4 * dt);
      orbitYaw.current = input.cameraAngle ?? orbitYaw.current;
    }

    // ── Compute desired camera position ──────────────────────────────
    const tpos = targetObj.position;

    // Forward = from target → camera (opposite of look direction).
    // yaw = 0 places camera at +Z (behind player who faces -Z).
    const cy = Math.cos(orbitYaw.current);
    const sy = Math.sin(orbitYaw.current);
    const cp = Math.cos(orbitPitch.current);
    const sp = Math.sin(orbitPitch.current);

    // Camera sits at target + (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch)) · dist
    scratch.current.offset.set(sy * cp, sp, cy * cp).multiplyScalar(wantDist);

    // Shoulder offset (lateral). v1 is 0, but keep infrastructure so a
    // future Q-to-swap is trivial.
    if (SHOULDER_OFFSET !== 0) {
      // "right" relative to orbit yaw (swap X/Z, negate one)
      scratch.current.right.set(cy, 0, -sy).multiplyScalar(SHOULDER_OFFSET);
      scratch.current.offset.add(scratch.current.right);
    }

    scratch.current.desired
      .copy(tpos)
      .add(scratch.current.offset)
      .add(scratch.current.up.clone().multiplyScalar(CAM_UP_OFFSET * wantDist));

    // ── Cinematic orbit drift on slo-mo ──────────────────────────────
    if (isSlomo) {
      cineT.current += dt;
      const amp = CINEMATIC_ORBIT_AMP * slomoIntensity;
      const t = cineT.current * CINEMATIC_ORBIT_FREQ;
      // Orbit drift — rotate offset in XZ around target.
      const orbX = Math.sin(t) * amp;
      // Apply by adding a small rotation to the offset about Y.
      const cosO = Math.cos(orbX);
      const sinO = Math.sin(orbX);
      const dx = scratch.current.desired.x - tpos.x;
      const dz = scratch.current.desired.z - tpos.z;
      scratch.current.desired.x = tpos.x + dx * cosO - dz * sinO;
      scratch.current.desired.z = tpos.z + dx * sinO + dz * cosO;
      // Vertical bob (small)
      scratch.current.desired.y += Math.cos(t * 0.7) * amp * 0.15;
    }

    // ── Collision push-in ────────────────────────────────────────────
    // Raycast from target+up to desired; if we hit something BETWEEN
    // target and desired, pull cam to hit.point - forward*clearance.
    const sceneRoot = sceneRootRef?.current;
    if (sceneRoot && wantDist > 0.5) {
      scratch.current.rayOrigin
        .copy(tpos)
        .add(scratch.current.up.clone().multiplyScalar(COLLISION_RAY_ORIGIN_Y));
      scratch.current.rayDir.copy(scratch.current.desired).sub(scratch.current.rayOrigin);
      const rayLen = scratch.current.rayDir.length();
      if (rayLen > 0.001) {
        scratch.current.rayDir.divideScalar(rayLen);
        scratch.current.raycaster.set(scratch.current.rayOrigin, scratch.current.rayDir);
        scratch.current.raycaster.far = rayLen;
        scratch.current.raycaster.near = 0;

        const children = sceneRoot.children ?? [];
        const hits = scratch.current.raycaster.intersectObjects(children, true);

        // Find first hit that isn't the target itself
        for (const hit of hits) {
          let p: THREE.Object3D | null = hit.object;
          let isTargetChild = false;
          while (p) {
            if (p === targetObj) {
              isTargetChild = true;
              break;
            }
            p = p.parent;
          }
          if (isTargetChild) continue;
          // Skip non-visible or non-solid objects (common: lines, helpers)
          if (hit.object.type === 'Line' || hit.object.type === 'LineSegments') continue;

          // Pull desired in to hit.point minus a small clearance along rayDir.
          const pullBack = COLLISION_CLEARANCE;
          scratch.current.desired
            .copy(hit.point)
            .sub(scratch.current.rayDir.clone().multiplyScalar(pullBack));
          break;
        }
      }
    }

    // ── Initialize cam on first frame ────────────────────────────────
    if (!initialized.current) {
      camPos.current.copy(scratch.current.desired);
      camVel.current.set(0, 0, 0);
      lookAt.current.copy(tpos);
      lookAt.current.y += TARGET_LOOK_HEIGHT;
      lookVel.current.set(0, 0, 0);
      initialized.current = true;
    }

    // ── Pos spring (with collision-snap-in fast path) ────────────────
    // Pick omega based on state
    const posOmega = isSlomo ? POS_OMEGA_SLOMO : isSprinting ? POS_OMEGA_SPRINT : POS_OMEGA_BASE;

    // If the desired position is a LOT closer than current (collision just
    // pulled it in), snap-lerp fast instead of spring — avoids clipping.
    const currToDesired = camPos.current.distanceTo(scratch.current.desired);
    const currDistFromTarget = camPos.current.distanceTo(tpos);
    const desiredDistFromTarget = scratch.current.desired.distanceTo(tpos);
    const movingInward = desiredDistFromTarget < currDistFromTarget - 0.1 && currToDesired > 0.1;

    if (movingInward) {
      camPos.current.lerp(scratch.current.desired, COLLISION_SNAP_IN);
      // Kill velocity so the spring doesn't fight the snap.
      camVel.current.multiplyScalar(0.5);
    } else {
      springVec3(camPos.current, camVel.current, scratch.current.desired, posOmega, dt);
    }

    camera.position.copy(camPos.current);

    // ── Look-at with velocity look-ahead ─────────────────────────────
    scratch.current.lookGoal.set(tpos.x, tpos.y + TARGET_LOOK_HEIGHT, tpos.z);

    if (pcs) {
      // CharacterState stores vx/vy — these are XZ-plane velocity in tile
      // units. Map them into world-space by assuming same scale as target.
      const vx = pcs.vx ?? 0;
      const vy = pcs.vy ?? 0;
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed > 0.01) {
        const scale = Math.min(LOOKAHEAD_MAX, speed * LOOKAHEAD_GAIN);
        const nx = vx / speed;
        const nz = vy / speed;
        scratch.current.lookGoal.x += nx * scale;
        scratch.current.lookGoal.z += nz * scale;
      }
    }

    const lookOmega = isSlomo
      ? LOOK_OMEGA_SLOMO
      : isSprinting
        ? LOOK_OMEGA_SPRINT
        : LOOK_OMEGA_BASE;
    springVec3(lookAt.current, lookVel.current, scratch.current.lookGoal, lookOmega, dt);
    camera.lookAt(lookAt.current);

    // ── FOV ──────────────────────────────────────────────────────────
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const pcam = camera as THREE.PerspectiveCamera;

      let fovGoal = FOV_BASE;
      if (isSprinting) fovGoal += FOV_SPRINT_KICK;
      if (isAiming) fovGoal += FOV_AIM_KICK;

      // Slo-mo pulse
      if (isSlomo) {
        const pulseFreq = FOV_SLOMO_PULSE_FREQ * slomoIntensity;
        const pulseAmp = FOV_SLOMO_PULSE_AMP * slomoIntensity;
        fovGoal += Math.sin(cineT.current * pulseFreq) * pulseAmp;
      }

      fovCur.current = springScalar(fovCur.current, fovVel.current, fovGoal, FOV_OMEGA, dt);

      if (Math.abs(fovCur.current - lastAppliedFov.current) > FOV_UPDATE_THRESHOLD) {
        pcam.fov = fovCur.current;
        pcam.updateProjectionMatrix();
        lastAppliedFov.current = fovCur.current;
      }
    }

    // ── Write back cameraAngle so movement stays camera-relative ─────
    if (input) {
      input.cameraAngle = orbitYaw.current;
    }
  });

  return null;
}

export default CameraRig;
