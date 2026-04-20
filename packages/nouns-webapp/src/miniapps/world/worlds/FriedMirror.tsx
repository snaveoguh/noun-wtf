// ── FriedMirror — portal mirror sitting in the white room ─────────────
//
// A 2 × 4u plane with a thin black frame. Its surface is a cheap
// shaderMaterial that animates magenta/cyan noise + occasional flicker,
// suggesting a compressed city streaming through the glass.
//
// When the player is within 2.5u, a floating HTML `[E] ENTER FRIED
// WORLD` prompt appears. On `E` keypress (handled by the parent page's
// key handler) we call `useWorldStore.getState().enterWorld('fried')`
// which triggers the 3-phase swap.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';

import { useWorldStore } from '../shared/useWorldStore';

const NEAR_DISTANCE = 2.5;

const MIRROR_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Cheap procedural noise — no textures, no lookups. Magenta/cyan split
// that wobbles with time. Occasional horizontal flicker suggests a CRT
// feed from a city inside the mirror.
const MIRROR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(27.619, 57.583))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime;

    // Horizontal warp — a city panning slowly
    float warp = sin(uv.y * 8.0 + t * 0.8) * 0.02 + sin(t * 0.3) * 0.05;
    vec2 p = vec2(uv.x + warp, uv.y);

    // Two offset noise samples for chromatic split
    float nM = noise(p * 6.0 + vec2(t * 0.4, t * 0.2));
    float nC = noise(p * 6.0 + vec2(-t * 0.4 + 3.0, t * 0.2 + 1.5));

    // Bands — city skyline suggestion
    float band = smoothstep(0.35, 0.5, uv.y) * smoothstep(0.75, 0.55, uv.y);
    float lights = step(0.85, noise(vec2(uv.x * 24.0, floor(uv.y * 16.0) + t * 0.2)));
    band += lights * 0.6;

    // Flicker: occasional horizontal scanline rush
    float flicker = step(0.97, hash(vec2(floor(t * 6.0), 0.0)));
    float scan = flicker * smoothstep(0.02, 0.0, abs(uv.y - fract(t * 0.9)));

    vec3 magenta = vec3(1.0, 0.0, 0.8) * nM * 0.6;
    vec3 cyan    = vec3(0.0, 0.9, 1.0) * nC * 0.6;
    vec3 col = magenta + cyan + vec3(0.05);
    col += vec3(band) * 0.35;
    col += vec3(1.0) * scan * 0.8;

    // Edge darken — frame-like vignette
    float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x)
               * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
    col *= mix(0.25, 1.0, edge);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface FriedMirrorProps {
  /** World position in Three.js units. */
  position: [number, number, number];
  /** Tile-space player ref for proximity detection. `.x` / `.y` are tile coords. */
  playerRef: React.RefObject<{ x: number; y: number } | null>;
  /** World-scale factor applied to tile coords (typically 0.1). */
  worldScale?: number;
  rotationY?: number;
}

export function FriedMirror({
  position,
  playerRef,
  worldScale = 0.1,
  rotationY = 0,
}: FriedMirrorProps) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const [near, setNear] = useState(false);
  const current = useWorldStore(s => s.current);

  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.elapsedTime;
    // Proximity check — only matters in white world.
    const p = playerRef.current;
    if (!p) return;
    const px = p.x * worldScale;
    const pz = p.y * worldScale;
    const d = Math.hypot(px - position[0], pz - position[2]);
    const wantNear = d < NEAR_DISTANCE && current === 'white';
    setNear(prev => (prev === wantNear ? prev : wantNear));
  });

  // Keydown: E → enter fried world when near
  useEffect(() => {
    if (!near) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'e' && e.key !== 'E') return;
      // Guard against retriggering if already transitioning
      const s = useWorldStore.getState();
      if (s.current !== 'white' || s.transition !== 'idle') return;
      s.enterWorld('fried');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [near]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Black frame — slightly larger plane behind the mirror surface */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[2.2, 4.2]} />
        <meshBasicMaterial color="#050505" side={THREE.DoubleSide} />
      </mesh>
      {/* Mirror surface */}
      <mesh>
        <planeGeometry args={[2, 4]} />
        <shaderMaterial
          ref={matRef}
          uniforms={uniforms}
          vertexShader={MIRROR_VERT}
          fragmentShader={MIRROR_FRAG}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {/* Shadow disc — faint on the floor below */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.01, 0]}>
        <circleGeometry args={[1.4, 24]} />
        <meshBasicMaterial color="#cccccc" transparent opacity={0.25} />
      </mesh>
      {/* Proximity prompt */}
      {near && (
        <Html position={[0, 2.6, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: '16px',
              fontWeight: 'bold',
              color: '#111',
              background: 'rgba(255,255,255,0.85)',
              border: '1px solid #111',
              padding: '6px 10px',
              letterSpacing: '2px',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            [E] ENTER FRIED WORLD
          </div>
        </Html>
      )}
    </group>
  );
}

export default FriedMirror;
