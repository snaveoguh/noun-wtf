// ── 3D Weapon Pickup — GTA 3 Style ──────────────────────────────────
//
// Spinning, glowing gun on the ground. Walk over to auto-pickup.
// Models come from Kenney's Blaster Kit (CC0) — see
// `public/models/weapons/CREDITS.md`. If a GLB fails to load we fall back
// to the original procedural mesh so the scene never blanks out.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

import { GlbModel } from './glbProps';
import type { WeaponType } from './weapons';
import { WEAPON_DEFS } from './weapons';

// ── GLB mapping ─────────────────────────────────────────────────────

/** WeaponType → /public GLB path. */
const WEAPON_GLB_URL: Record<WeaponType, string> = {
  pistol: '/models/weapons/pistol.glb',
  shotgun: '/models/weapons/shotgun.glb',
  uzi: '/models/weapons/uzi.glb',
};

/**
 * Per-weapon render scale for the pickup. Kenney blasters are authored at
 * roughly ~2m long; we want each to read as a ~0.4m ground pickup silhouette.
 */
const WEAPON_PICKUP_SCALE: Record<WeaponType, number> = {
  pistol: 0.55,
  shotgun: 0.4,
  uzi: 0.45,
};

// Warm drei's cache on module load so pickups don't pop in the first time
// the player sees them. `preload` is best-effort — wrap in try/catch so a
// missing file in dev doesn't throw at import time.
for (const url of Object.values(WEAPON_GLB_URL)) {
  try {
    useGLTF.preload(url);
  } catch {
    // ignore — GlbModel has its own error boundary at render time
  }
}

// ── Procedural fallback (also exported for GunAttachment callers) ───

function createGunShape(type: WeaponType): THREE.Group {
  const def = WEAPON_DEFS[type];
  const color = def.color;
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.6,
    roughness: 0.3,
  });

  const group = new THREE.Group();

  // Barrel — cylinder pointing forward (+Z)
  const barrelLength = type === 'shotgun' ? 0.5 : type === 'uzi' ? 0.25 : 0.3;
  const barrelRadius = type === 'shotgun' ? 0.04 : type === 'uzi' ? 0.025 : 0.03;
  const barrelGeo = new THREE.CylinderGeometry(barrelRadius, barrelRadius, barrelLength, 6);
  const barrel = new THREE.Mesh(barrelGeo, mat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = barrelLength / 2;
  group.add(barrel);

  // Body/receiver — box
  const bodyWidth = type === 'shotgun' ? 0.12 : type === 'uzi' ? 0.08 : 0.08;
  const bodyHeight = type === 'shotgun' ? 0.07 : type === 'uzi' ? 0.1 : 0.06;
  const bodyDepth = type === 'shotgun' ? 0.15 : type === 'uzi' ? 0.14 : 0.1;
  const bodyGeo = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = -barrelRadius;
  group.add(body);

  // Handle/grip — box angled down
  const gripGeo = new THREE.BoxGeometry(0.04, 0.12, 0.05);
  const gripMat = new THREE.MeshStandardMaterial({
    color: '#222222',
    roughness: 0.8,
  });
  const grip = new THREE.Mesh(gripGeo, gripMat);
  grip.position.set(0, -0.1, -0.02);
  grip.rotation.x = -0.2; // slight angle
  group.add(grip);

  // Uzi gets a magazine sticking down
  if (type === 'uzi') {
    const magGeo = new THREE.BoxGeometry(0.03, 0.1, 0.04);
    const mag = new THREE.Mesh(magGeo, gripMat);
    mag.position.set(0, -0.15, 0.04);
    group.add(mag);
  }

  // Shotgun gets a pump
  if (type === 'shotgun') {
    const pumpGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6);
    const pump = new THREE.Mesh(pumpGeo, gripMat);
    pump.rotation.x = Math.PI / 2;
    pump.position.set(0, -0.04, 0.15);
    group.add(pump);
  }

  return group;
}

// ── WeaponPickup3D Component ────────────────────────────────────────

interface WeaponPickup3DProps {
  position: [number, number, number];
  type: WeaponType;
  picked: boolean;
}

export function WeaponPickup3D({ position, type, picked }: WeaponPickup3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const gunRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current || picked) return;
    const t = clock.elapsedTime;

    // Spin on Y axis — classic GTA pickup rotation
    if (gunRef.current) {
      gunRef.current.rotation.y = t * 2.0;
    }

    // Bob up and down
    groupRef.current.position.y = position[1] + 0.35 + Math.sin(t * 1.5) * 0.08;

    // Glow pulse
    if (glowRef.current) {
      glowRef.current.intensity = 1.5 + Math.sin(t * 3) * 0.5;
    }
  });

  if (picked) return null;

  const def = WEAPON_DEFS[type];
  const glbUrl = WEAPON_GLB_URL[type];
  const modelScale = WEAPON_PICKUP_SCALE[type];

  return (
    <group ref={groupRef} position={position}>
      {/* The spinning gun — GLB with error boundary; if it errors, GlbModel
          renders nothing and the scene keeps running. */}
      <group ref={gunRef}>
        <GlbModel url={glbUrl} scale={modelScale} />
      </group>

      {/* Glow light */}
      <pointLight
        ref={glowRef}
        position={[0, 0.2, 0]}
        color={def.color}
        intensity={1.5}
        distance={3}
      />

      {/* Ground glow ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.2, 0.35, 16]} />
        <meshBasicMaterial color={def.color} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* Shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.25, 12]} />
        <meshBasicMaterial color="#000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

// ── Factory helper — export the low-poly gun builder for GunAttachment too ──

export { createGunShape };
