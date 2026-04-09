/**
 * SceneEnvironment — Friendsies-inspired dreamy background.
 * Renders inside the R3F canvas behind the noun.
 * Uses drei Sparkles + Cloud + gradient sky sphere.
 * Lightweight: all instanced geometry, single draw calls.
 */
import { useMemo, useRef } from 'react';

import { Cloud, Sparkles } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ─── Gradient Sky Sphere ───────────────────────────────────────────

function GradientSky() {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          // Sky gradient: deep blue top → light blue → warm white at horizon → soft green below
          vec3 topColor = vec3(0.45, 0.75, 0.95);    // soft blue
          vec3 midColor = vec3(0.72, 0.88, 0.96);    // light blue
          vec3 horizonColor = vec3(0.95, 0.96, 0.90); // warm white
          vec3 groundColor = vec3(0.42, 0.72, 0.38);  // soft green

          vec3 color;
          if (h > 0.0) {
            float t = clamp(h * 2.0, 0.0, 1.0);
            color = mix(horizonColor, mix(midColor, topColor, t), t);
          } else {
            float t = clamp(-h * 3.0, 0.0, 1.0);
            color = mix(horizonColor, groundColor, t);
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
  }, []);

  return (
    <mesh material={material} renderOrder={-1}>
      <sphereGeometry args={[80, 32, 32]} />
    </mesh>
  );
}

// ─── Floating Orbs (the iconic Friendsies light balls) ─────────────

function FloatingOrbs() {
  const groupRef = useRef<THREE.Group>(null);
  const orbData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      position: [
        (Math.sin(i * 2.39) * 20) + (Math.random() - 0.5) * 10,
        3 + Math.random() * 12,
        -15 + (Math.cos(i * 1.73) * 15) + (Math.random() - 0.5) * 8,
      ] as [number, number, number],
      scale: 0.3 + Math.random() * 0.6,
      speed: 0.3 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      color: ['#ffffff', '#ffe4b5', '#e0f0ff', '#ffe8f0', '#e8ffe0'][i % 5],
    }));
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (!groupRef.current) return;
    groupRef.current.children.forEach((child, i) => {
      const d = orbData[i];
      if (!d) return;
      child.position.y = d.position[1] + Math.sin(t * d.speed + d.phase) * 1.5;
      child.position.x = d.position[0] + Math.sin(t * d.speed * 0.7 + d.phase) * 0.8;
    });
  });

  return (
    /* eslint-disable react/no-unknown-property */
    <group ref={groupRef}>
      {orbData.map((orb, i) => (
        <mesh key={i} position={orb.position}>
          <sphereGeometry args={[orb.scale, 16, 16]} />
          <meshBasicMaterial
            color={orb.color}
            transparent
            opacity={0.35}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
    /* eslint-enable react/no-unknown-property */
  );
}

// ─── Pastel Columns (the rounded tree/pillar shapes) ───────────────

function PastelColumns() {
  const columns = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2;
      const radius = 25 + (i % 3) * 8;
      return {
        position: [
          Math.sin(angle) * radius,
          0,
          Math.cos(angle) * radius - 20,
        ] as [number, number, number],
        height: 6 + Math.random() * 10,
        radius: 1.5 + Math.random() * 2,
        color: [
          '#f5c882', '#e8a860', '#c8e890', '#f5d890',
          '#e0c080', '#b8d880', '#f0c870', '#d0e088',
          '#e8b870', '#c0d880', '#ddb870', '#b0d070',
          '#e8c478', '#c8d878',
        ][i],
      };
    });
  }, []);

  return (
    /* eslint-disable react/no-unknown-property */
    <group>
      {columns.map((col, i) => (
        <group key={i} position={col.position}>
          {/* Column body */}
          <mesh position={[0, col.height / 2, 0]}>
            <cylinderGeometry args={[col.radius, col.radius * 1.1, col.height, 12]} />
            <meshLambertMaterial color={col.color} />
          </mesh>
          {/* Rounded top cap */}
          <mesh position={[0, col.height, 0]}>
            <sphereGeometry args={[col.radius, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshLambertMaterial color={col.color} />
          </mesh>
        </group>
      ))}
    </group>
    /* eslint-enable react/no-unknown-property */
  );
}

// ─── Ground Hill ───────────────────────────────────────────────────

function GroundHill() {
  return (
    /* eslint-disable react/no-unknown-property */
    <mesh position={[0, -18, -5]} rotation={[-0.1, 0, 0]}>
      <sphereGeometry args={[30, 32, 32]} />
      <meshLambertMaterial color="#4aad4a" />
    </mesh>
    /* eslint-enable react/no-unknown-property */
  );
}

// ─── Main Export ───────────────────────────────────────────────────

export default function SceneEnvironment() {
  return (
    <>
      <GradientSky />
      <GroundHill />
      <PastelColumns />
      <FloatingOrbs />
      {/* Drei sparkles — tiny twinkling particles */}
      {/* eslint-disable react/no-unknown-property */}
      <Sparkles
        count={80}
        scale={[50, 30, 40]}
        size={2}
        speed={0.3}
        opacity={0.6}
        color="#ffffff"
        position={[0, 8, -10]}
      />
      <Sparkles
        count={30}
        scale={[40, 20, 30]}
        size={3}
        speed={0.2}
        opacity={0.3}
        color="#ffe8c0"
        position={[0, 12, -5]}
      />
      {/* Soft clouds */}
      <Cloud
        position={[-15, 18, -25]}
        speed={0.1}
        opacity={0.4}
        width={12}
        depth={3}
        segments={8}
      />
      <Cloud
        position={[10, 22, -30]}
        speed={0.15}
        opacity={0.3}
        width={10}
        depth={2}
        segments={6}
      />
      <Cloud
        position={[20, 16, -20]}
        speed={0.08}
        opacity={0.35}
        width={8}
        depth={2}
        segments={6}
      />
      {/* eslint-enable react/no-unknown-property */}
    </>
  );
}
