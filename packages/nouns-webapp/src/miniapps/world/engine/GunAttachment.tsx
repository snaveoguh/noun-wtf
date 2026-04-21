// ── Gun Attachment — Parents weapon mesh to handslot.r bone ─────────
//
// Mirrors the voxel head attachment pattern from Character3D.tsx:
// traverse the skeleton, find 'handslot.r', add weapon mesh as child.
// The held mesh is picked dynamically from `weaponType` → WEAPON_DEFS,
// so adding a new weapon to the registry automatically works here.
//
// Muzzle flash: brief orange point light at barrel tip when firing.
// Spray can: rainbow hue-shifting emissive material (no muzzle flash).

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { WeaponType } from './weapons';
import { WEAPON_DEFS } from './weapons';

// ── Build a weapon mesh for hand attachment ─────────────────────────

function buildSprayCan(): THREE.Group {
  const group = new THREE.Group();
  // Body — rainbow emissive material (hue is animated in useFrame).
  const bodyMat = new THREE.MeshStandardMaterial({
    color: '#ff44ff',
    emissive: '#ff44ff',
    emissiveIntensity: 0.6,
    metalness: 0.3,
    roughness: 0.4,
  });
  bodyMat.name = 'sprayBodyMat';
  const bodyGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.14, 12);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.name = 'sprayBody';
  group.add(body);

  // Cap on top
  const capMat = new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.8 });
  const capGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12);
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = 0.08;
  group.add(cap);

  // Nozzle tip — tiny white dot
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 6, 6),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  );
  tip.position.y = 0.095;
  group.add(tip);

  return group;
}

function buildHandGun(type: WeaponType): THREE.Group {
  if (type === 'spray_can') return buildSprayCan();

  const def = WEAPON_DEFS[type];
  const color = def.color;
  const mat = new THREE.MeshBasicMaterial({ color });
  const darkMat = new THREE.MeshBasicMaterial({ color: '#222222' });

  const group = new THREE.Group();

  // Barrel — cylinder pointing forward (+Z in local hand space).
  // Shape/size is varied per weapon so players see a distinct silhouette.
  const barrelLength = type === 'shotgun' ? 3.5 : type === 'uzi' ? 1.8 : 2.0;
  const barrelRadius = type === 'shotgun' ? 0.25 : type === 'uzi' ? 0.15 : 0.18;
  const barrelGeo = new THREE.CylinderGeometry(barrelRadius, barrelRadius, barrelLength, 6);
  const barrel = new THREE.Mesh(barrelGeo, mat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = barrelLength / 2;
  barrel.name = 'barrel';
  group.add(barrel);

  // Receiver body
  const bodyW = type === 'shotgun' ? 0.6 : type === 'uzi' ? 0.45 : 0.4;
  const bodyH = type === 'shotgun' ? 0.4 : type === 'uzi' ? 0.5 : 0.35;
  const bodyD = type === 'shotgun' ? 0.8 : type === 'uzi' ? 0.7 : 0.5;
  const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = -barrelRadius * 0.8;
  group.add(body);

  // Grip
  const gripGeo = new THREE.BoxGeometry(0.22, 0.7, 0.3);
  const grip = new THREE.Mesh(gripGeo, darkMat);
  grip.position.set(0, -0.6, -0.05);
  grip.rotation.x = -0.15;
  group.add(grip);

  // Uzi magazine
  if (type === 'uzi') {
    const magGeo = new THREE.BoxGeometry(0.15, 0.6, 0.2);
    const mag = new THREE.Mesh(magGeo, darkMat);
    mag.position.set(0, -0.85, 0.2);
    group.add(mag);
  }

  // Shotgun pump grip
  if (type === 'shotgun') {
    const pumpGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.6, 6);
    const pump = new THREE.Mesh(pumpGeo, darkMat);
    pump.rotation.x = Math.PI / 2;
    pump.position.set(0, -0.22, 1.2);
    group.add(pump);
  }

  // Muzzle flash point light — starts invisible
  const flashLight = new THREE.PointLight('#ff8800', 0, 4);
  flashLight.name = 'muzzleFlash';
  flashLight.position.set(0, 0, barrelLength + 0.1);
  group.add(flashLight);

  // Muzzle flash sprite — small orange burst
  const flashSpriteMat = new THREE.SpriteMaterial({
    color: '#ffaa00',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
  });
  const flashSprite = new THREE.Sprite(flashSpriteMat);
  flashSprite.name = 'muzzleFlashSprite';
  flashSprite.scale.set(0.5, 0.5, 0.5);
  flashSprite.position.set(0, 0, barrelLength + 0.2);
  group.add(flashSprite);

  return group;
}

// ── GunAttachment Component ─────────────────────────────────────────

interface GunAttachmentProps {
  /** The loaded GLB scene (THREE.Group) — we traverse this to find handslot.r */
  sceneRef: React.RefObject<THREE.Group | null>;
  /** Currently equipped weapon, or null */
  weaponType: WeaponType | null;
  /** Muzzle flash countdown (frames remaining, >0 = flash visible) */
  muzzleFlash: number;
}

export function GunAttachment({ sceneRef, weaponType, muzzleFlash }: GunAttachmentProps) {
  const gunGroupRef = useRef<THREE.Group | null>(null);
  const handBoneRef = useRef<THREE.Bone | null>(null);
  const currentTypeRef = useRef<WeaponType | null>(null);

  // Find the handslot.r bone and attach/detach gun mesh
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Find the hand bone once
    if (!handBoneRef.current) {
      scene.traverse((child: THREE.Object3D) => {
        if (child.name === 'handslot.r' && (child as any).isBone) {
          handBoneRef.current = child as THREE.Bone;
        }
      });
    }

    const bone = handBoneRef.current;
    if (!bone) return;

    // Remove old gun if weapon changed
    if (gunGroupRef.current && currentTypeRef.current !== weaponType) {
      bone.remove(gunGroupRef.current);
      gunGroupRef.current = null;
      currentTypeRef.current = null;
    }

    // Attach new gun if weapon equipped
    if (weaponType && !gunGroupRef.current) {
      const gun = buildHandGun(weaponType);
      // Position/rotate to sit naturally in the hand
      // handslot.r points forward in the character's grip direction
      gun.scale.set(0.35, 0.35, 0.35);
      gun.position.set(0, 0, 0);
      gun.rotation.set(0, 0, 0);
      bone.add(gun);
      gunGroupRef.current = gun;
      currentTypeRef.current = weaponType;
    }

    // Show/hide based on equipped state
    if (gunGroupRef.current) {
      gunGroupRef.current.visible = weaponType !== null;
    }
  }, [sceneRef, weaponType]);

  // Per-frame effects:
  //  • gun types → muzzle flash on fire
  //  • spray_can → animated rainbow hue on body material
  const hueRef = useRef(0);
  useFrame(() => {
    const gun = gunGroupRef.current;
    if (!gun) return;

    // Spray can rainbow hue shift
    if (currentTypeRef.current === 'spray_can') {
      hueRef.current = (hueRef.current + 0.005) % 1;
      const h = hueRef.current;
      const body = gun.getObjectByName('sprayBody') as THREE.Mesh | undefined;
      if (body) {
        const mat = body.material as THREE.MeshStandardMaterial;
        mat.color.setHSL(h, 1, 0.5);
        mat.emissive.setHSL(h, 0.8, 0.3);
      }
      return;
    }

    // Gun muzzle flash
    const flashLight = gun.getObjectByName('muzzleFlash') as THREE.PointLight | undefined;
    const flashSprite = gun.getObjectByName('muzzleFlashSprite') as THREE.Sprite | undefined;

    if (flashLight) {
      flashLight.intensity = muzzleFlash > 0 ? 8 : 0;
    }
    if (flashSprite) {
      const spriteMat = flashSprite.material as THREE.SpriteMaterial;
      if (muzzleFlash > 0) {
        spriteMat.opacity = 0.9;
        // Random scale for flicker effect
        const s = 0.4 + Math.random() * 0.3;
        flashSprite.scale.set(s, s, s);
        // Random slight rotation for variety
        flashSprite.material.rotation = Math.random() * Math.PI * 2;
      } else {
        spriteMat.opacity = 0;
      }
    }
  });

  // This component doesn't render JSX — it imperatively attaches to the bone
  return null;
}
