/**
 * SceneEnvironment — Holographic foil card background.
 * Dark base with iridescent rainbow orbs, shimmering dust, cosmic mist.
 * Reactive to tilt (gyro on mobile = holographic card effect).
 * tiltRef drives per-frame hue/shimmer shifts without re-renders.
 * lightingPreset tints the entire scene to match the noun's lighting.
 */
import { useEffect, useMemo, useRef } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { Sparkles } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { LightingPreset } from './index';
import { useHypercastleData } from '../../miniapps/terraforms/HypercastleView';

interface Tilt {
  x: number;
  y: number;
}

interface SceneEnvironmentProps {
  tiltRef?: React.RefObject<Tilt>;
  lightingPreset?: LightingPreset;
}

// ─── Scene tint per lighting preset ───────────────────────────────
const SCENE_TINTS: Record<
  string,
  { hueShift: number; saturation: number; brightness: number; skyTint: [number, number, number] }
> = {
  spotlight: { hueShift: 0, saturation: 0.7, brightness: 0.9, skyTint: [0.88, 0.88, 0.92] },
  studio: { hueShift: 0, saturation: 0.8, brightness: 1.0, skyTint: [0.9, 0.9, 0.92] },
  storefront: { hueShift: 0, saturation: 0.9, brightness: 1.0, skyTint: [0.88, 0.86, 0.84] },
  sunrise: { hueShift: 0.06, saturation: 1.0, brightness: 1.1, skyTint: [0.95, 0.82, 0.6] },
  twilight: { hueShift: 0.02, saturation: 1.0, brightness: 0.85, skyTint: [0.9, 0.65, 0.5] },
  ambient: { hueShift: -0.15, saturation: 1.0, brightness: 1.0, skyTint: [0.85, 0.7, 0.9] },
  none: { hueShift: 0, saturation: 0.3, brightness: 0.5, skyTint: [0.8, 0.8, 0.82] },
};

// ─── Holographic Foil Sky ──────────────────────────────────────────

function HoloSky({
  tiltRef,
  lightingPreset = 'storefront',
}: {
  tiltRef?: React.RefObject<Tilt>;
  lightingPreset?: LightingPreset;
}) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uTiltX: { value: 0 },
          uTiltY: { value: 0 },
          uSkyTint: { value: new THREE.Vector3(0.88, 0.86, 0.84) },
          uBrightness: { value: 1.0 },
        },
        vertexShader: `
      varying vec3 vPos;
      varying vec3 vViewDir;
      void main() {
        vPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vViewDir = normalize(cameraPosition - vPos);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
        fragmentShader: `
      uniform float uTime;
      uniform float uTiltX;
      uniform float uTiltY;
      uniform vec3 uSkyTint;
      uniform float uBrightness;
      varying vec3 vPos;
      varying vec3 vViewDir;

      vec3 holo(float t) {
        return vec3(0.5) + vec3(0.5) * cos(6.283 * (t + vec3(0.0, 0.33, 0.67)));
      }

      void main() {
        vec3 n = normalize(vPos);
        float fresnel = dot(vViewDir, n);

        // Chrome mirror base — tilt shifts the color bands, tinted by preset
        float chromeShift = sin(fresnel * 4.0 + n.x * 2.0 + uTime * 0.08 + uTiltX * 3.0) * 0.5 + 0.5;
        vec3 base = mix(uSkyTint * 0.95, uSkyTint * 1.05, chromeShift);

        // Holographic rainbow shimmer
        float holoT = fresnel * 3.0 + n.x * 1.5 + n.y * 0.8 + uTime * 0.04
                     + uTiltX * 2.5 + uTiltY * 1.8;
        vec3 rainbow = holo(holoT);

        // Holo swirl bands — concentric rings that shimmer like a real holo card
        float swirl1 = sin(fresnel * 8.0 + n.x * 4.0 + n.y * 3.0 + uTime * 0.12 + uTiltX * 4.0) * 0.5 + 0.5;
        float swirl2 = sin(fresnel * 12.0 - n.x * 3.0 + n.y * 5.0 + uTime * 0.08 - uTiltY * 3.0) * 0.5 + 0.5;
        float swirlMask = pow(swirl1 * swirl2, 0.8) * 0.25;

        // Mix rainbow in
        float tiltMag = length(vec2(uTiltX, uTiltY));
        float edgeFactor = pow(1.0 - abs(fresnel), 1.5);
        float rainbowMix = edgeFactor * 0.2 + 0.08 + tiltMag * 0.15 + swirlMask;
        vec3 color = mix(base, rainbow, rainbowMix);

        // Sparkle noise
        float sparkle = fract(sin(dot(n.xy * 400.0, vec2(12.9898, 78.233))) * 43758.5453);
        sparkle = pow(sparkle, 20.0) * 0.4;
        color += vec3(sparkle) * rainbow;

        color *= uBrightness;

        // Fade to transparent at top
        float topFade = smoothstep(0.15, 0.55, n.y);
        gl_FragColor = vec4(color, 1.0 - topFade);
      }`,
      }),
    [],
  );

  useFrame(() => {
    mat.uniforms.uTime.value = performance.now() / 1000;
    if (tiltRef?.current) {
      mat.uniforms.uTiltX.value = tiltRef.current.x;
      mat.uniforms.uTiltY.value = tiltRef.current.y;
    }
    const tint = SCENE_TINTS[lightingPreset] ?? SCENE_TINTS.storefront;
    mat.uniforms.uSkyTint.value.set(...tint.skyTint);
    mat.uniforms.uBrightness.value = tint.brightness;
  });

  return (
    <mesh material={mat} renderOrder={-1}>
      <sphereGeometry args={[110, 48, 48]} />
    </mesh>
  );
}

// ─── Iridescent Orbs ──────────────────────────────────────────────

function HoloOrbs({
  tiltRef,
  lightingPreset = 'storefront',
}: {
  tiltRef?: React.RefObject<Tilt>;
  lightingPreset?: LightingPreset;
}) {
  const ref = useRef<THREE.Group>(null);
  const orbs = useMemo(
    () =>
      Array.from({ length: 200 }, () => {
        // Silver / chrome holofoil palette
        const hueBucket = Math.random();
        let hue: number;
        if (hueBucket < 0.45)
          hue = 0.0 + Math.random() * 0.02; // silver/white (near-zero saturation below)
        else if (hueBucket < 0.65)
          hue = 0.55 + Math.random() * 0.1; // cool blue-steel
        else if (hueBucket < 0.8)
          hue = 0.75 + Math.random() * 0.1; // violet chrome
        else if (hueBucket < 0.9)
          hue = 0.47 + Math.random() * 0.06; // cyan flash
        else hue = 0.1 + Math.random() * 0.05; // warm gold accent
        return {
          pos: [
            (Math.random() - 0.5) * 200, // wider spread X
            (Math.random() - 0.5) * 100, // wider spread Y
            -75 + Math.random() * 85, // Z: -75 to +10 (some in front, mostly behind)
          ] as [number, number, number],
          size: 0.1 + Math.random() * 2.2,
          flatness: 0.08 + Math.random() * 0.15, // Y-scale: 0.08–0.23 (pressed flat)
          hue,
          speed: 0.05 + Math.random() * 0.2,
          phase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.3 + Math.random() * 1.0,
        };
      }),
    [],
  );

  useFrame(({ clock, camera }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const tilt = tiltRef?.current;
    const hueShift = tilt ? tilt.x * 0.35 + tilt.y * 0.2 : 0;
    const presetTint = SCENE_TINTS[lightingPreset] ?? SCENE_TINTS.storefront;

    ref.current.children.forEach((child, i) => {
      const o = orbs[i];
      if (!o) return;
      child.position.y = o.pos[1] + Math.sin(t * o.speed + o.phase) * 2;
      child.position.x = o.pos[0] + Math.cos(t * o.speed * 0.7 + o.phase) * 1.5;
      // Billboard: face camera so flat discs are always visible
      child.quaternion.copy(camera.quaternion);
      const pulse = 0.35 + Math.sin(t * o.pulseSpeed + o.phase) * 0.2;

      const shiftedHue = (((o.hue + hueShift + presetTint.hueShift + t * 0.005) % 1.0) + 1.0) % 1.0;
      const newColor = new THREE.Color().setHSL(
        shiftedHue,
        presetTint.saturation * 0.35,
        0.75 * presetTint.brightness,
      );
      if (!child.children || child.children.length < 4) return;
      const bodyMat = (child.children[1] as THREE.Mesh).material as
        | THREE.MeshBasicMaterial
        | undefined;
      const edgeMat = (child.children[2] as THREE.Mesh).material as
        | THREE.MeshBasicMaterial
        | undefined;
      const glowMat = (child.children[3] as THREE.Mesh).material as
        | THREE.MeshBasicMaterial
        | undefined;
      if (bodyMat) {
        bodyMat.color.copy(newColor);
        bodyMat.opacity = 0.6 + pulse * 0.2;
      }
      if (edgeMat) {
        edgeMat.color.copy(newColor);
        edgeMat.opacity = 0.2 + pulse * 0.1;
      }
      if (glowMat) {
        glowMat.color.copy(newColor);
      }
    });
  });

  return (
    <group ref={ref}>
      {orbs.map((o, i) => {
        const color = new THREE.Color().setHSL(o.hue, 0.3, 0.75);
        return (
          <group key={i} position={o.pos} scale={[1, o.flatness, 1]}>
            {}
            <mesh>
              <sphereGeometry args={[o.size * 0.35, 10, 10]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.9} toneMapped={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[o.size * 0.7, 10, 10]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[o.size, 10, 10]} />
              <meshBasicMaterial color={color} transparent opacity={0.25} toneMapped={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[o.size * 1.8, 8, 8]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.06}
                toneMapped={false}
                side={THREE.BackSide}
              />
            </mesh>
            {}
          </group>
        );
      })}
    </group>
  );
}

// ─── Holo Swirl Rings ─────────────────────────────────────────────

function HoloSwirls({
  tiltRef,
  lightingPreset = 'storefront',
}: {
  tiltRef?: React.RefObject<Tilt>;
  lightingPreset?: LightingPreset;
}) {
  const ref = useRef<THREE.Group>(null);
  const rings = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => ({
        radius: 15 + i * 10,
        thickness: 0.3 + i * 0.15,
        hue: i * 0.15,
        speed: (0.012 + i * 0.004) * (i % 2 ? 1 : -1),
        tiltY: (i - 3) * 0.1,
      })),
    [],
  );

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const tilt = tiltRef?.current;
    const presetTint = SCENE_TINTS[lightingPreset] ?? SCENE_TINTS.storefront;

    ref.current.children.forEach((child, i) => {
      const r = rings[i];
      if (!r) return;
      child.rotation.z = t * r.speed;
      // Tilt shifts the ring colors
      const tiltShift = tilt ? tilt.x * 0.3 : 0;
      const hue = (((r.hue + t * 0.02 + tiltShift + presetTint.hueShift) % 1.0) + 1.0) % 1.0;
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.color.setHSL(hue, presetTint.saturation, 0.6 * presetTint.brightness);
      }
    });
  });

  return (
    <group ref={ref} position={[0, 0, -40]}>
      {rings.map((r, i) => (
        <mesh key={i} rotation={[Math.PI / 2 + r.tiltY, 0, 0]}>
          <torusGeometry args={[r.radius, r.thickness, 8, 64]} />
          <meshBasicMaterial
            color={new THREE.Color().setHSL(r.hue, 0.9, 0.7)}
            transparent
            opacity={0.03}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── Hypercastle Backdrop (Terraforms parcels as drifting voxel cloud) ──

const HC_POSITION: [number, number, number] = [15, -8, -55];
const HC_SPAN = 38;
const hcTempObj = new THREE.Object3D();
const hcTempColor = new THREE.Color();

function Hypercastle() {
  const { parcels } = useHypercastleData();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) groupRef.current.rotation.y += 0.0008;
  });

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || parcels.length === 0) return;
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;
    for (const p of parcels) {
      if (p.sx < minX) minX = p.sx;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sy > maxY) maxY = p.sy;
      if (p.sz < minZ) minZ = p.sz;
      if (p.sz > maxZ) maxZ = p.sz;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const range = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    const scale = HC_SPAN / range;
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      hcTempObj.position.set((p.sx - cx) * scale, (p.sy - cy) * scale, (p.sz - cz) * scale);
      hcTempObj.scale.setScalar(0.55);
      hcTempObj.updateMatrix();
      mesh.setMatrixAt(i, hcTempObj.matrix);
      hcTempColor.set(p.color);
      mesh.setColorAt(i, hcTempColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [parcels]);

  // Fall back to the green planet while the parcel JSON is in flight (first-visit only).
  if (parcels.length === 0) return <Planet />;

  return (
    <group ref={groupRef} position={HC_POSITION}>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, parcels.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
      {/* faint atmospheric glow so the cloud reads as a coherent mass */}
      <mesh>
        <sphereGeometry args={[HC_SPAN * 0.6, 16, 16]} />
        <meshBasicMaterial
          color="#6688ff"
          transparent
          opacity={0.05}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ─── Distant Planet (fallback while hypercastle loads) ────────────

const PR = 8;
const PP: [number, number, number] = [15, -12, -65];

function Planet() {
  const cloudRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (cloudRef.current) cloudRef.current.rotation.y += 0.0005;
  });

  const cols = useMemo(() => {
    const c = [
      '#ff6b1a',
      '#ff4488',
      '#44dd22',
      '#ffcc00',
      '#ff3355',
      '#22cc88',
      '#ff8800',
      '#88dd00',
      '#ff2266',
      '#44bb44',
      '#ffaa22',
      '#33cc66',
    ];
    return Array.from({ length: 12 }, (_, i) => {
      const phi = (i / 12) * Math.PI * 2;
      const theta = 0.2 + Math.random() * 0.45;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      return { x, y, z, h: 1.5 + Math.random() * 3, r: 0.2 + Math.random() * 0.4, color: c[i] };
    });
  }, []);

  return (
    <group>
      {}
      <mesh position={PP}>
        <sphereGeometry args={[PR, 24, 24]} />
        <meshLambertMaterial color="#338833" />
      </mesh>
      <mesh ref={cloudRef} position={PP}>
        <sphereGeometry args={[PR * 1.04, 16, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.12} toneMapped={false} />
      </mesh>
      <mesh position={PP}>
        <sphereGeometry args={[PR * 1.15, 16, 16]} />
        <meshBasicMaterial
          color="#66bbff"
          transparent
          opacity={0.08}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>
      <mesh position={PP}>
        <sphereGeometry args={[PR * 1.3, 16, 16]} />
        <meshBasicMaterial
          color="#88ccff"
          transparent
          opacity={0.04}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>
      {cols.map((c, i) => {
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(c.x, c.y, c.z),
        );
        return (
          <group
            key={i}
            position={[PP[0] + c.x * PR, PP[1] + c.y * PR, PP[2] + c.z * PR]}
            quaternion={q}
          >
            <mesh position={[0, c.h / 2, 0]}>
              <cylinderGeometry args={[c.r * 0.7, c.r, c.h, 6]} />
              <meshLambertMaterial color={c.color} />
            </mesh>
            <mesh position={[0, c.h, 0]}>
              <sphereGeometry args={[c.r * 0.7, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshLambertMaterial color={c.color} />
            </mesh>
          </group>
        );
      })}
      {}
    </group>
  );
}

// ─── Noun Sprites ─────────────────────────────────────────────────

function NounSprite({ orbitAngle, orbitSpeed }: { orbitAngle: number; orbitSpeed: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const seed = useMemo(
    () => ({
      background: 0,
      body: Math.floor(Math.random() * ImageData.images.bodies.length),
      accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
      head: Math.floor(Math.random() * ImageData.images.heads.length),
      glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
    }),
    [],
  );

  useMemo(() => {
    try {
      const { parts } = getNounData(seed);
      let svg = buildSVG(parts, ImageData.palette, '');
      svg = svg.replace(/<rect[^>]*\/?>/g, '');
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.needsUpdate = true;
        if (meshRef.current) {
          const m = meshRef.current.material as THREE.MeshBasicMaterial;
          m.map = tex;
          m.transparent = true;
          m.needsUpdate = true;
        }
      };
      img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
      /* seed might be out of range */
    }
  }, [seed]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime() * orbitSpeed + orbitAngle;
    const r = PR + 0.6;
    meshRef.current.position.set(
      PP[0] + Math.sin(0.35) * Math.cos(t) * r,
      PP[1] + Math.cos(0.35) * r,
      PP[2] + Math.sin(0.35) * Math.sin(t) * r,
    );
    meshRef.current.lookAt(0, 0, 50);
  });

  return (
    <mesh ref={meshRef}>
      {}
      <planeGeometry args={[1.2, 1.2]} />
      <meshBasicMaterial transparent toneMapped={false} side={THREE.DoubleSide} />
      {}
    </mesh>
  );
}

// ─── Cigar Spaceships ─────────────────────────────────────────────

function Spaceships() {
  const ships = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => ({
        speed: 0.2 + Math.random() * 0.3,
        y: -5 + Math.random() * 20,
        z: -50 - Math.random() * 25,
        phase: Math.random() * 200,
        size: 0.3 + Math.random() * 0.4,
        color: ['#cc4444', '#4466cc', '#44aa44', '#cc8844'][i],
      })),
    [],
  );
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.children.forEach((ship, i) => {
      const s = ships[i];
      if (!s) return;
      ship.position.set(
        ((t * s.speed + s.phase) % 100) - 50,
        s.y + Math.sin(t * 0.15 + s.phase) * 1,
        s.z,
      );
    });
  });
  return (
    <group ref={ref}>
      {ships.map((s, i) => (
        <group key={i} rotation={[0, 0, Math.PI / 2]}>
          {}
          <mesh>
            <capsuleGeometry args={[s.size * 0.3, s.size * 2.5, 6, 8]} />
            <meshLambertMaterial color={s.color} />
          </mesh>
          <mesh position={[0, s.size, s.size * 0.25]}>
            <sphereGeometry args={[s.size * 0.2, 6, 6]} />
            <meshBasicMaterial color="#88ddff" toneMapped={false} />
          </mesh>
          <mesh position={[0, -s.size * 1.5, 0]}>
            <sphereGeometry args={[s.size * 0.2, 6, 6]} />
            <meshBasicMaterial color="#ffaa44" transparent opacity={0.6} toneMapped={false} />
          </mesh>
          {}
        </group>
      ))}
    </group>
  );
}

// ─── Lens Flare ──────────────────────────────────────────────────

function LensFlare({ tiltRef }: { tiltRef?: React.RefObject<Tilt> }) {
  const groupRef = useRef<THREE.Group>(null);

  // 1 main flare + 5 ghosts at different scales / offsets along the tilt axis
  const ghosts = useMemo(
    () => [
      { scale: 3.5, offset: 0, opacity: 0.18 }, // main bloom
      { scale: 1.2, offset: 0.35, opacity: 0.09 },
      { scale: 0.6, offset: 0.6, opacity: 0.12 },
      { scale: 2.0, offset: 0.85, opacity: 0.06 },
      { scale: 0.4, offset: 1.1, opacity: 0.1 },
      { scale: 1.5, offset: 1.4, opacity: 0.04 },
    ],
    [],
  );

  useFrame(({ camera }) => {
    if (!groupRef.current) return;
    const tilt = tiltRef?.current;
    // Flare position follows tilt (opposite direction like real lens flare)
    const tx = tilt ? -tilt.x * 25 : 0;
    const ty = tilt ? -tilt.y * 15 : 0;

    groupRef.current.children.forEach((child, i) => {
      const g = ghosts[i];
      if (!g) return;
      child.position.x = tx * g.offset;
      child.position.y = ty * g.offset + 3;
      child.quaternion.copy(camera.quaternion);
    });
  });

  return (
    <group ref={groupRef}>
      {ghosts.map((g, i) => (
        <mesh key={i} position={[0, 3, -5]}>
          <circleGeometry args={[g.scale, 32]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={g.opacity}
            toneMapped={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── Export ────────────────────────────────────────────────────────

export default function SceneEnvironment({
  tiltRef,
  lightingPreset = 'storefront',
}: SceneEnvironmentProps) {
  return (
    <>
      <HoloSky tiltRef={tiltRef} lightingPreset={lightingPreset} />
      <LensFlare tiltRef={tiltRef} />
      <HoloOrbs tiltRef={tiltRef} lightingPreset={lightingPreset} />
      <HoloSwirls tiltRef={tiltRef} lightingPreset={lightingPreset} />
      <Hypercastle />
      {Array.from({ length: 5 }, (_, i) => (
        <NounSprite key={i} orbitAngle={(i / 5) * Math.PI * 2} orbitSpeed={0.05 + i * 0.01} />
      ))}
      <Spaceships />

      {}
      <Sparkles
        count={120}
        scale={[60, 35, 50]}
        size={1.5}
        speed={0.12}
        opacity={0.25}
        color="#ffffff"
        position={[0, 3, -10]}
      />
      <Sparkles
        count={80}
        scale={[50, 30, 40]}
        size={1}
        speed={0.2}
        opacity={0.2}
        color="#aaccff"
        position={[0, 0, 0]}
      />
      <Sparkles
        count={50}
        scale={[65, 35, 50]}
        size={2.5}
        speed={0.05}
        opacity={0.12}
        color="#ffccaa"
        position={[0, 5, -15]}
      />
      <Sparkles
        count={100}
        scale={[40, 25, 35]}
        size={0.6}
        speed={0.35}
        opacity={0.3}
        color="#ffffff"
        position={[0, 2, 5]}
      />
      {}
    </>
  );
}
