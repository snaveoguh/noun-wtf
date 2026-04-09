/**
 * SceneEnvironment — Holographic foil card background.
 * Dark base with iridescent rainbow orbs, shimmering dust, cosmic mist.
 * Reactive to camera angle (gyro on mobile = holographic card effect).
 */
import { useEffect, useMemo, useRef } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { Sparkles } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ─── Holographic Foil Sky ──────────────────────────────────────────

function HoloSky() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, transparent: true,
    uniforms: { uTime: { value: 0 } },
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
      varying vec3 vPos;
      varying vec3 vViewDir;

      vec3 holo(float t) {
        return vec3(0.5) + vec3(0.5) * cos(6.283 * (t + vec3(0.0, 0.33, 0.67)));
      }

      void main() {
        vec3 n = normalize(vPos);
        float fresnel = dot(vViewDir, n);

        // Chrome mirror base — shifts between silver and warm
        float chromeShift = sin(fresnel * 4.0 + n.x * 2.0 + uTime * 0.08) * 0.5 + 0.5;
        vec3 base = mix(vec3(0.85, 0.83, 0.88), vec3(0.92, 0.88, 0.82), chromeShift);

        // Holographic rainbow shimmer — shifts with view angle
        float holoT = fresnel * 3.0 + n.x * 1.5 + n.y * 0.8 + uTime * 0.04;
        vec3 rainbow = holo(holoT);

        // Mix rainbow in subtly — more at edges (fresnel)
        float edgeFactor = pow(1.0 - abs(fresnel), 1.5);
        vec3 color = mix(base, rainbow, edgeFactor * 0.2 + 0.08);

        // Add subtle sparkle noise
        float sparkle = fract(sin(dot(n.xy * 400.0, vec2(12.9898, 78.233))) * 43758.5453);
        sparkle = pow(sparkle, 20.0) * 0.4;
        color += vec3(sparkle) * rainbow;

        // Fade to transparent at top
        float topFade = smoothstep(0.15, 0.55, n.y);
        gl_FragColor = vec4(color, 1.0 - topFade);
      }`,
  }), []);

  return (
    <mesh material={mat} renderOrder={-1}
      onBeforeRender={() => { mat.uniforms.uTime.value = performance.now() / 1000; }}>
      <sphereGeometry args={[110, 48, 48]} />
    </mesh>
  );
}

// ─── Iridescent Orbs (the big colored spheres from the reference) ──

function HoloOrbs() {
  const ref = useRef<THREE.Group>(null);
  const orbs = useMemo(() => Array.from({ length: 120 }, () => {
    // Neon orange heavy like holo card — no purple/pink
    const hueBucket = Math.random();
    let hue: number;
    if (hueBucket < 0.50) hue = 0.04 + Math.random() * 0.06;       // neon orange
    else if (hueBucket < 0.70) hue = 0.10 + Math.random() * 0.06;  // amber/gold
    else if (hueBucket < 0.82) hue = 0.50 + Math.random() * 0.08;  // cyan
    else if (hueBucket < 0.92) hue = 0.56 + Math.random() * 0.08;  // blue
    else hue = 0.30 + Math.random() * 0.06;                          // green
    return {
      pos: [
        (Math.random() - 0.5) * 160,
        (Math.random() - 0.5) * 80,
        -15 - Math.random() * 60,
      ] as [number, number, number],
      size: 0.1 + Math.random() * 2.0,
      hue,
      speed: 0.05 + Math.random() * 0.2,
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.3 + Math.random() * 1.0,
    };
  }), []);

  useFrame(({ clock, camera }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    // Camera direction drives hue shift — tilting phone shifts all orb colors
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const hueShift = camDir.x * 0.3 + camDir.y * 0.2;

    ref.current.children.forEach((child, i) => {
      const o = orbs[i]; if (!o) return;
      child.position.y = o.pos[1] + Math.sin(t * o.speed + o.phase) * 2;
      child.position.x = o.pos[0] + Math.cos(t * o.speed * 0.7 + o.phase) * 1.5;
      const pulse = 0.35 + Math.sin(t * o.pulseSpeed + o.phase) * 0.2;

      // Shift hue based on camera angle
      const shiftedHue = (o.hue + hueShift + t * 0.005) % 1.0;
      const newColor = new THREE.Color().setHSL(shiftedHue, 0.9, 0.55);
      if (!child.children || child.children.length < 4) return;
      // Core stays white, body/edge/glow get shifted color
      const bodyMat = (child.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      const edgeMat = (child.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      const glowMat = (child.children[3] as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (bodyMat) { bodyMat.color.copy(newColor); bodyMat.opacity = 0.6 + pulse * 0.2; }
      if (edgeMat) { edgeMat.color.copy(newColor); edgeMat.opacity = 0.2 + pulse * 0.1; }
      if (glowMat) { glowMat.color.copy(newColor); }
    });
  });

  return (
    <group ref={ref}>
      {orbs.map((o, i) => {
        const color = new THREE.Color().setHSL(o.hue, 0.9, 0.55);
        return (
          <group key={i} position={o.pos}>
            {/* eslint-disable react/no-unknown-property */}
            {/* Bright core */}
            <mesh>
              <sphereGeometry args={[o.size * 0.35, 10, 10]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.9} toneMapped={false} />
            </mesh>
            {/* Main color body */}
            <mesh>
              <sphereGeometry args={[o.size * 0.7, 10, 10]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
            </mesh>
            {/* Dark edge ring */}
            <mesh>
              <sphereGeometry args={[o.size, 10, 10]} />
              <meshBasicMaterial color={color} transparent opacity={0.25} toneMapped={false} />
            </mesh>
            {/* Outer glow */}
            <mesh>
              <sphereGeometry args={[o.size * 1.8, 8, 8]} />
              <meshBasicMaterial color={color} transparent opacity={0.06} toneMapped={false} side={THREE.BackSide} />
            </mesh>
            {/* eslint-enable react/no-unknown-property */}
          </group>
        );
      })}
    </group>
  );
}

// ─── Mist Rings ────────────────────────────────────────────────────

function MistRings() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.children.forEach((child, i) => {
      child.rotation.z = clock.getElapsedTime() * (0.02 + i * 0.005) * (i % 2 ? 1 : -1);
    });
  });

  return (
    <group ref={ref} position={[0, 0, -35]}>
      {[18, 25, 33, 42].map((radius, i) => (
        /* eslint-disable react/no-unknown-property */
        <mesh key={i} rotation={[Math.PI / 2 + (i - 2) * 0.15, 0, 0]}>
          <torusGeometry args={[radius, 1.5 + i * 0.5, 8, 48]} />
          <meshBasicMaterial
            color={['#4466ff', '#ff44aa', '#44ffaa', '#ffaa44'][i]}
            transparent opacity={0.04} toneMapped={false} side={THREE.DoubleSide}
          />
        </mesh>
        /* eslint-enable react/no-unknown-property */
      ))}
    </group>
  );
}

// ─── Distant Planet (pushed way back, blurred via small size) ──────

const PR = 8;
const PP: [number, number, number] = [15, -12, -65];

function Planet() {
  const cloudRef = useRef<THREE.Mesh>(null);
  useFrame(() => { if (cloudRef.current) cloudRef.current.rotation.y += 0.0005; });

  const cols = useMemo(() => {
    const c = ['#ff6b1a','#ff4488','#44dd22','#ffcc00','#ff3355','#22cc88','#ff8800',
      '#88dd00','#ff2266','#44bb44','#ffaa22','#33cc66'];
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
      {/* eslint-disable react/no-unknown-property */}
      <mesh position={PP}><sphereGeometry args={[PR, 24, 24]} /><meshLambertMaterial color="#338833" /></mesh>
      <mesh ref={cloudRef} position={PP}><sphereGeometry args={[PR*1.04, 16, 16]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.12} toneMapped={false} /></mesh>
      <mesh position={PP}><sphereGeometry args={[PR*1.15, 16, 16]} /><meshBasicMaterial color="#66bbff" transparent opacity={0.08} side={THREE.BackSide} toneMapped={false} /></mesh>
      <mesh position={PP}><sphereGeometry args={[PR*1.3, 16, 16]} /><meshBasicMaterial color="#88ccff" transparent opacity={0.04} side={THREE.BackSide} toneMapped={false} /></mesh>
      {cols.map((c, i) => {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(c.x,c.y,c.z));
        return (
          <group key={i} position={[PP[0]+c.x*PR, PP[1]+c.y*PR, PP[2]+c.z*PR]} quaternion={q}>
            <mesh position={[0,c.h/2,0]}><cylinderGeometry args={[c.r*0.7,c.r,c.h,6]} /><meshLambertMaterial color={c.color} /></mesh>
            <mesh position={[0,c.h,0]}><sphereGeometry args={[c.r*0.7,6,4,0,Math.PI*2,0,Math.PI/2]} /><meshLambertMaterial color={c.color} /></mesh>
          </group>
        );
      })}
      {/* eslint-enable react/no-unknown-property */}
    </group>
  );
}

// ─── Noun Sprites ──────────────────────────────────────────────────

function NounSprite({ orbitAngle, orbitSpeed }: { orbitAngle: number; orbitSpeed: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => ({
    background: 0,
    body: Math.floor(Math.random() * ImageData.images.bodies.length),
    accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
    head: Math.floor(Math.random() * ImageData.images.heads.length),
    glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
  }), []);

  useEffect(() => {
    try {
      const { parts } = getNounData(seed);
      let svg = buildSVG(parts, ImageData.palette, '');
      svg = svg.replace(/<rect[^>]*\/?>/g, '');
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
        if (meshRef.current) {
          const m = meshRef.current.material as THREE.MeshBasicMaterial;
          m.map = tex; m.transparent = true; m.needsUpdate = true;
        }
      };
      img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {}
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
      {/* eslint-disable react/no-unknown-property */}
      <planeGeometry args={[1.2, 1.2]} />
      <meshBasicMaterial transparent toneMapped={false} side={THREE.DoubleSide} />
      {/* eslint-enable react/no-unknown-property */}
    </mesh>
  );
}

// ─── Cigar Spaceships ──────────────────────────────────────────────

function Spaceships() {
  const ships = useMemo(() => Array.from({ length: 4 }, (_, i) => ({
    speed: 0.2 + Math.random() * 0.3, y: -5 + Math.random() * 20,
    z: -50 - Math.random() * 25, phase: Math.random() * 200,
    size: 0.3 + Math.random() * 0.4,
    color: ['#cc4444','#4466cc','#44aa44','#cc8844'][i],
  })), []);
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.children.forEach((ship, i) => {
      const s = ships[i]; if (!s) return;
      ship.position.set(((t * s.speed + s.phase) % 100) - 50, s.y + Math.sin(t * 0.15 + s.phase) * 1, s.z);
    });
  });
  return (
    <group ref={ref}>
      {ships.map((s, i) => (
        <group key={i} rotation={[0, 0, Math.PI / 2]}>
          {/* eslint-disable react/no-unknown-property */}
          <mesh><capsuleGeometry args={[s.size*0.3, s.size*2.5, 6, 8]} /><meshLambertMaterial color={s.color} /></mesh>
          <mesh position={[0, s.size, s.size*0.25]}><sphereGeometry args={[s.size*0.2, 6, 6]} /><meshBasicMaterial color="#88ddff" toneMapped={false} /></mesh>
          <mesh position={[0, -s.size*1.5, 0]}><sphereGeometry args={[s.size*0.2, 6, 6]} /><meshBasicMaterial color="#ffaa44" transparent opacity={0.6} toneMapped={false} /></mesh>
          {/* eslint-enable react/no-unknown-property */}
        </group>
      ))}
    </group>
  );
}

// ─── Export ─────────────────────────────────────────────────────────

export default function SceneEnvironment() {
  return (
    <>
      <HoloSky />
      <HoloOrbs />
      <MistRings />
      <Planet />
      {Array.from({ length: 5 }, (_, i) => (
        <NounSprite key={i} orbitAngle={(i / 5) * Math.PI * 2} orbitSpeed={0.05 + i * 0.01} />
      ))}
      <Spaceships />

      {/* eslint-disable react/no-unknown-property */}
      {/* Multi-color holographic dust */}
      <Sparkles count={100} scale={[50, 30, 40]} size={1.5} speed={0.12} opacity={0.25} color="#ffffff" position={[0, 3, -20]} />
      <Sparkles count={60} scale={[45, 25, 35]} size={1} speed={0.2} opacity={0.2} color="#aaccff" position={[0, 0, -15]} />
      <Sparkles count={40} scale={[55, 30, 45]} size={2.5} speed={0.05} opacity={0.12} color="#ffccaa" position={[0, 5, -25]} />
      <Sparkles count={80} scale={[35, 20, 30]} size={0.6} speed={0.35} opacity={0.3} color="#ffffff" position={[0, 2, -12]} />
      {/* eslint-enable react/no-unknown-property */}
    </>
  );
}
