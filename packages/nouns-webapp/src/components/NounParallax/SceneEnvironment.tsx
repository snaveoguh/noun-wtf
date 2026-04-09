/**
 * SceneEnvironment — Holographic card background + distant planet with noun sprites.
 * Main noun sits front-center like a shiny card.
 * Behind it: a distant green planet with colorful spike columns and 5 tiny
 * randomly-generated noun sprites walking around. Small orbiting mini-planets drift by.
 */
import { useEffect, useMemo, useRef } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { Sparkles } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ─── Holographic Background Sphere ─────────────────────────────────

function HoloBackground() {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vWorldPosition;
        vec3 holo(float t) {
          return vec3(0.5) + vec3(0.5) * cos(6.283 * (vec3(1.0) * t + vec3(0.0, 0.1, 0.2)));
        }
        void main() {
          vec3 norm = normalize(vWorldPosition);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float angle = dot(viewDir, norm);
          float holoT = angle * 2.0 + norm.y * 0.5 + uTime * 0.05;
          vec3 holoColor = holo(holoT);
          // Clear sky with subtle holo tint — not washed out
          vec3 topSky = vec3(0.55, 0.78, 0.98);
          vec3 horizonSky = vec3(0.88, 0.90, 0.92);
          vec3 bottomSky = vec3(0.35, 0.60, 0.30);
          float h = norm.y;
          vec3 base;
          if (h > 0.0) {
            base = mix(horizonSky, topSky, clamp(h * 2.0, 0.0, 1.0));
          } else {
            base = mix(horizonSky, bottomSky, clamp(-h * 3.0, 0.0, 1.0));
          }
          vec3 color = mix(base, holoColor, 0.06);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
  }, []);

  return (
    <mesh material={material} renderOrder={-1}
      onBeforeRender={() => { material.uniforms.uTime.value = performance.now() / 1000; }}
    >
      <sphereGeometry args={[100, 32, 32]} />
    </mesh>
  );
}

// ─── Distant Planet with Spike Columns ─────────────────────────────

const PR = 12; // planet radius
const PP: [number, number, number] = [0, -18, -55]; // planet position (far back, below)

function DistantPlanet() {
  const columns = useMemo(() => {
    const colors = [
      '#ff6b1a', '#ff4488', '#44dd22', '#ffcc00', '#ff3355',
      '#22cc88', '#ff8800', '#88dd00', '#ff2266', '#44bb44',
      '#ffaa22', '#33cc66', '#ff5533', '#66dd44', '#ee4422',
    ];
    return Array.from({ length: 15 }, (_, i) => {
      const phi = (i / 15) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const theta = 0.15 + Math.random() * 0.45;
      const sx = Math.sin(theta) * Math.cos(phi);
      const sy = Math.cos(theta);
      const sz = Math.sin(theta) * Math.sin(phi);
      return {
        pos: [PP[0] + sx * PR, PP[1] + sy * PR, PP[2] + sz * PR] as [number, number, number],
        normal: [sx, sy, sz] as [number, number, number],
        h: 1.5 + Math.random() * 3.5,
        r: 0.25 + Math.random() * 0.5,
        color: colors[i],
      };
    });
  }, []);

  return (
    <group>
      {/* eslint-disable react/no-unknown-property */}
      <mesh position={PP}>
        <sphereGeometry args={[PR, 32, 32]} />
        <meshLambertMaterial color="#2a8a2a" />
      </mesh>
      {columns.map((c, i) => {
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(...c.normal),
        );
        return (
          <group key={i} position={c.pos} quaternion={q}>
            <mesh position={[0, c.h / 2, 0]}>
              <cylinderGeometry args={[c.r * 0.8, c.r, c.h, 8]} />
              <meshLambertMaterial color={c.color} />
            </mesh>
            <mesh position={[0, c.h, 0]}>
              <sphereGeometry args={[c.r * 0.8, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshLambertMaterial color={c.color} />
            </mesh>
          </group>
        );
      })}
      {/* eslint-enable react/no-unknown-property */}
    </group>
  );
}

// ─── Walking Noun Sprites on Planet ────────────────────────────────

function randomSeed() {
  return {
    background: Math.floor(Math.random() * ImageData.bgcolors.length),
    body: Math.floor(Math.random() * ImageData.images.bodies.length),
    accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
    head: Math.floor(Math.random() * ImageData.images.heads.length),
    glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
  };
}

function NounSprite({ seed, orbitAngle, orbitSpeed }: {
  seed: ReturnType<typeof randomSeed>;
  orbitAngle: number;
  orbitSpeed: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const texRef = useRef<THREE.Texture | null>(null);

  // Generate SVG texture
  useEffect(() => {
    try {
      const { parts, background } = getNounData(seed);
      const svg = buildSVG(parts, ImageData.palette, background);
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.needsUpdate = true;
        texRef.current = tex;
        if (meshRef.current) {
          (meshRef.current.material as THREE.MeshBasicMaterial).map = tex;
          (meshRef.current.material as THREE.MeshBasicMaterial).needsUpdate = true;
        }
      };
      img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch { /* skip broken seeds */ }
  }, [seed]);

  // Walk around planet surface
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime() * orbitSpeed + orbitAngle;
    const theta = 0.3; // stay near top of planet
    const phi = t;
    const surfR = PR + 0.6; // slightly above surface
    const x = PP[0] + Math.sin(theta) * Math.cos(phi) * surfR;
    const y = PP[1] + Math.cos(theta) * surfR;
    const z = PP[2] + Math.sin(theta) * Math.sin(phi) * surfR;
    meshRef.current.position.set(x, y, z);
    // Billboard: always face camera
    meshRef.current.lookAt(0, 0, 35);
  });

  return (
    /* eslint-disable react/no-unknown-property */
    <mesh ref={meshRef}>
      <planeGeometry args={[1.2, 1.2]} />
      <meshBasicMaterial transparent toneMapped={false} />
    </mesh>
    /* eslint-enable react/no-unknown-property */
  );
}

function WalkingNouns() {
  const sprites = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => ({
      seed: randomSeed(),
      orbitAngle: (i / 5) * Math.PI * 2,
      orbitSpeed: 0.08 + Math.random() * 0.06,
    }));
  }, []);

  return (
    <>
      {sprites.map((s, i) => (
        <NounSprite key={i} seed={s.seed} orbitAngle={s.orbitAngle} orbitSpeed={s.orbitSpeed} />
      ))}
    </>
  );
}

// ─── Small Orbiting Mini-Planets ───────────────────────────────────

function OrbitingPlanets() {
  const planets = useMemo(() => {
    const colors = ['#ff6644', '#4488ff', '#ffaa22', '#aa44ff'];
    return Array.from({ length: 4 }, (_, i) => ({
      orbitRadius: 22 + i * 6,
      orbitSpeed: 0.03 + i * 0.01,
      phase: (i / 4) * Math.PI * 2,
      size: 0.8 + Math.random() * 1.2,
      color: colors[i],
      y: PP[1] + (Math.random() - 0.5) * 8,
    }));
  }, []);

  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.children.forEach((child, i) => {
      const p = planets[i];
      if (!p) return;
      const angle = t * p.orbitSpeed + p.phase;
      child.position.set(
        PP[0] + Math.cos(angle) * p.orbitRadius,
        p.y + Math.sin(t * 0.1 + p.phase) * 2,
        PP[2] + Math.sin(angle) * p.orbitRadius,
      );
    });
  });

  return (
    <group ref={groupRef}>
      {planets.map((p, i) => (
        /* eslint-disable react/no-unknown-property */
        <mesh key={i}>
          <sphereGeometry args={[p.size, 12, 12]} />
          <meshLambertMaterial color={p.color} />
        </mesh>
        /* eslint-enable react/no-unknown-property */
      ))}
    </group>
  );
}

// ─── Main Export ───────────────────────────────────────────────────

export default function SceneEnvironment() {
  return (
    <>
      <HoloBackground />
      <DistantPlanet />
      <WalkingNouns />
      <OrbitingPlanets />

      {/* eslint-disable react/no-unknown-property */}
      <Sparkles count={80} scale={[40, 25, 35]} size={1} speed={0.1} opacity={0.2} color="#ffffff" position={[0, 2, 0]} />
      <Sparkles count={50} scale={[50, 30, 40]} size={2} speed={0.15} opacity={0.3} color="#ffffff" position={[0, 3, -10]} />
      <Sparkles count={30} scale={[60, 35, 50]} size={3.5} speed={0.05} opacity={0.15} color="#e0d8ff" position={[0, 5, -15]} />
      <Sparkles count={25} scale={[35, 20, 30]} size={2.5} speed={0.08} opacity={0.12} color="#ffd4a0" position={[0, 0, -5]} />
      <Sparkles count={100} scale={[30, 18, 25]} size={0.8} speed={0.4} opacity={0.35} color="#ffffff" position={[0, 1, 2]} />
      {/* eslint-enable react/no-unknown-property */}
    </>
  );
}
