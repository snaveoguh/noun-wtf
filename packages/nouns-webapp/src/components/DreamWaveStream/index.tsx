/**
 * DreamWaveStream — 3D wave-stream of homepage banner content.
 *
 * Mounted at /wave as a preview route while we iterate on the visual.
 * Pulls noun seeds (V2-aware) and renders each one as a billboarded
 * pixelated plane riding a sinusoidal path toward the camera. Behind
 * each card sits a softly glowing radial-gradient sprite tinted in HSL
 * around the rainbow so the stream reads as a "dream rainbow river".
 * A starfield with twinkling brightness fills the surrounding volume.
 *
 * Cards never overlap because the path is single-file — every card has
 * a distinct `phase` along the same sinusoidal trajectory and the spacing
 * between phases is fixed. As cards pass the camera they wrap back to
 * the far end so the river is infinite.
 *
 * Performance:
 *  - One InstancedMesh for the starfield (a few thousand verts, no
 *    per-frame matrix updates — the twinkle is a fragment-shader uniform).
 *  - Each card is its own mesh + glow sprite (small N, ~24 cards) so we
 *    can tint glows independently.
 *  - dpr capped at [1, 1.5] so retina screens don't push 4× pixels.
 */
import { useMemo, useRef, useEffect } from 'react';

import { ImageDataV2, getNounDataV2 } from '@nouns/assets';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { buildSVG } from '@nouns/sdk';
import * as THREE from 'three';

// ─── Tunables ───────────────────────────────────────────────────────────
//
// The path is a horizontal stream extending from far Z (negative) toward
// the camera at Z=0. Wave amplitude controls the up/down sway; FREQ how
// many crests per unit distance.

const CARD_COUNT = 24;
/** Total length of the stream (world units) — bigger = more cards visible at once. */
const STREAM_LENGTH = 60;
/** How fast cards travel (world units per second). */
const STREAM_SPEED = 6;
/** Wave amplitude (world units of vertical sway). */
const WAVE_AMP = 1.4;
/** Wave frequency — cycles per unit distance. */
const WAVE_FREQ = 0.18;
/** Lateral sway amplitude — adds a tiny x-axis weave on top of the y wave. */
const LATERAL_AMP = 0.6;
/** How wide each card is, in world units. */
const CARD_WIDTH = 1.6;
/** Card aspect ratio (height = width × aspect). */
const CARD_ASPECT = 1.0;

// ─── Random seed deck ───────────────────────────────────────────────────
//
// We don't pull live data here — the wave is a *vibe*, not a feed. A fixed
// shuffled deck of V2 seeds drives card content so the visual is stable
// across renders. If you want to wire to live data later, swap this.

function makeSeedDeck(count: number): Array<{
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}> {
  // Cheap PRNG so the deck is stable across renders without needing
  // useState/useRef. xorshift32 seeded by index keeps it deterministic.
  function rand(seed: number) {
    let s = seed | 0;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) / 0xffffffff);
    };
  }
  const r = rand(0xC0FFEE);
  return Array.from({ length: count }, () => ({
    background: Math.floor(r() * ImageDataV2.bgcolors.length),
    body: Math.floor(r() * ImageDataV2.images.bodies.length),
    accessory: Math.floor(r() * ImageDataV2.images.accessories.length),
    head: Math.floor(r() * ImageDataV2.images.heads.length),
    glasses: Math.floor(r() * ImageDataV2.images.glasses.length),
  }));
}

function seedToSvgDataUri(seed: ReturnType<typeof makeSeedDeck>[number]): string {
  const { parts, background } = getNounDataV2(seed);
  const svg = buildSVG(parts, ImageDataV2.palette, background);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ─── Card ────────────────────────────────────────────────────────────────

function NounCard({ texture, phase, hue }: { texture: THREE.Texture; phase: number; hue: number }) {
  const groupRef = useRef<THREE.Group>(null);

  // Build the rainbow glow texture once per hue. Soft radial gradient on
  // a small canvas, multiplied through to give each card its own colored
  // ambient bloom without using post-processing.
  const glowTexture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const color = `hsl(${hue}, 90%, 65%)`;
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, `hsla(${hue}, 90%, 60%, 0.5)`);
    grad.addColorStop(1, `hsla(${hue}, 90%, 50%, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, [hue]);

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    // Each card rides the same sinusoidal path but offset by `phase`. As
    // time passes, all cards translate forward (positive phase). When a
    // card reaches the front of the stream, modulo wraps it to the back.
    const t = (clock.elapsedTime * STREAM_SPEED + phase) % STREAM_LENGTH;
    const z = -STREAM_LENGTH / 2 + t; // -30 → 30
    // Wave Y as a function of position so adjacent cards don't all bob in
    // lockstep — they trace the *path*, which is fixed in space.
    const y = Math.sin(z * WAVE_FREQ) * WAVE_AMP;
    // Slight lateral weave so the stream isn't a pure plane.
    const x = Math.cos(z * WAVE_FREQ * 0.7 + phase * 0.013) * LATERAL_AMP;
    g.position.set(x, y, z);

    // Slight billboard-ish look-at the camera but mostly face-on. Mild
    // tilt with the wave gives a sense of motion.
    g.rotation.y = Math.sin(z * WAVE_FREQ) * 0.18;
    g.rotation.z = Math.cos(z * WAVE_FREQ) * 0.06;

    // Cards become visible only after they're far enough past the back
    // wall — avoids the abrupt re-spawn pop. Same pattern at the front.
    const fadeIn = THREE.MathUtils.smoothstep(z, -STREAM_LENGTH / 2 + 2, -STREAM_LENGTH / 2 + 8);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(z, 6, 10);
    const alpha = fadeIn * fadeOut;
    g.userData.alpha = alpha;
    // Apply alpha to all materials in the group.
    g.traverse(obj => {
      const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && 'opacity' in mat) {
        (mat as THREE.MeshBasicMaterial).opacity =
          ((mat as { userData?: { baseOpacity?: number } }).userData?.baseOpacity ?? 1) * alpha;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {/* eslint-disable react/no-unknown-property */}
      {/* Glow plane — bigger than the card, behind it. */}
      <mesh position={[0, 0, -0.01]} renderOrder={0}>
        <planeGeometry args={[CARD_WIDTH * 2.6, CARD_WIDTH * 2.6 * CARD_ASPECT]} />
        <meshBasicMaterial
          map={glowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.7}
          ref={(m: THREE.MeshBasicMaterial | null) => {
            if (m) m.userData.baseOpacity = 0.7;
          }}
        />
      </mesh>
      {/* Card itself — pixelated noun SVG. */}
      <mesh renderOrder={1}>
        <planeGeometry args={[CARD_WIDTH, CARD_WIDTH * CARD_ASPECT]} />
        <meshBasicMaterial
          map={texture}
          transparent
          ref={(m: THREE.MeshBasicMaterial | null) => {
            if (m) m.userData.baseOpacity = 1;
          }}
        />
      </mesh>
      {/* eslint-enable react/no-unknown-property */}
    </group>
  );
}

// ─── Starfield ──────────────────────────────────────────────────────────
//
// A few thousand points scattered in a deep volume around the stream.
// Twinkle implemented as a per-frame sin-wave on the size attribute via a
// shader uniform, so the GPU does the work and we don't update vertex
// data per frame.

const STAR_COUNT = 1500;

function Starfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, sizes, phases } = useMemo(() => {
    const pos = new Float32Array(STAR_COUNT * 3);
    const sz = new Float32Array(STAR_COUNT);
    const ph = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Cloud volume around the stream — wide and tall, deeper than the
      // stream length so we get parallax depth.
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 2] = -STREAM_LENGTH / 2 + Math.random() * STREAM_LENGTH;
      sz[i] = 2 + Math.random() * 4;
      ph[i] = Math.random() * Math.PI * 2;
    }
    return { positions: pos, sizes: sz, phases: ph };
  }, []);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.elapsedTime;
  });

  const shaderMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
          attribute float aSize;
          attribute float aPhase;
          varying float vPhase;
          uniform float uTime;
          void main() {
            vPhase = aPhase;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            // Twinkle: brighten size with a per-star sin so they pulse
            // independently of one another.
            float twinkle = 0.5 + 0.5 * sin(uTime * 2.0 + aPhase);
            gl_PointSize = aSize * (0.5 + twinkle) * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying float vPhase;
          void main() {
            // Round soft point sprite.
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            float alpha = smoothstep(0.5, 0.0, d);
            // Slight color tint per star.
            vec3 col = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.85, 0.95), 0.5 + 0.5 * sin(vPhase));
            gl_FragColor = vec4(col, alpha * 0.8);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  // Cleanup (avoid memory leaks if the component remounts).
  useEffect(() => () => shaderMat.dispose(), [shaderMat]);

  return (
    /* eslint-disable react/no-unknown-property */
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={STAR_COUNT}
        />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} count={STAR_COUNT} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} count={STAR_COUNT} />
      </bufferGeometry>
      <primitive object={shaderMat} ref={matRef} attach="material" />
    </points>
    /* eslint-enable react/no-unknown-property */
  );
}

// ─── Texture loader ─────────────────────────────────────────────────────
//
// Loads each card's noun SVG into a texture once. Pixelated filter so the
// 32×32 nouns stay crisp at world scale.

function NounCards() {
  const seeds = useMemo(() => makeSeedDeck(CARD_COUNT), []);
  const dataUris = useMemo(() => seeds.map(seedToSvgDataUri), [seeds]);
  const textures = useLoader(THREE.TextureLoader, dataUris) as THREE.Texture[];

  useEffect(() => {
    for (const t of textures) {
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
    }
  }, [textures]);

  return (
    <>
      {textures.map((tex, i) => (
        <NounCard
          key={i}
          texture={tex}
          // Even spacing along the path so cards never overlap; phase is
          // monotonic so card 0 leads card 1 leads card 2…
          phase={(i * STREAM_LENGTH) / CARD_COUNT}
          // Hue spreads across the rainbow — adjacent cards get adjacent
          // hues, giving the stream the rainbow ribbon feel.
          hue={(i * 360) / CARD_COUNT}
        />
      ))}
    </>
  );
}

// ─── Public component ──────────────────────────────────────────────────

export interface DreamWaveStreamProps {
  /** Disable orbit controls — useful when embedding inside a page where
   *  the user shouldn't be able to spin the camera. Default false (free
   *  look enabled) so the preview is fun to play with. */
  locked?: boolean;
}

const DreamWaveStream: React.FC<DreamWaveStreamProps> = ({ locked = false }) => {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 50%, #1a0635 0%, #060015 70%, #000 100%)' }}>
      <Canvas
        camera={{ fov: 55, near: 0.1, far: 200, position: [0, 0.5, 14] }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 1);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        {/* eslint-disable react/no-unknown-property */}
        <ambientLight intensity={0.6} />
        <Starfield />
        <NounCards />
        {!locked && (
          <OrbitControls
            enablePan={false}
            enableZoom
            enableDamping
            dampingFactor={0.1}
            minDistance={6}
            maxDistance={30}
          />
        )}
        {/* eslint-enable react/no-unknown-property */}
      </Canvas>
    </div>
  );
};

export default DreamWaveStream;
