/**
 * DreamWaveStream — multi-lane 3D wave-stream of homepage banner content.
 *
 * Standalone preview at /wave. Renders five concurrent wave streams stacked
 * vertically — each pulls from a different homepage banner data source
 * (DREAMS, NOUNS WORLD, NOUNDRY, PROPS, PROPDATES) so the full page reads
 * as a layered dream river of everything happening on noun.wtf.
 *
 *   stream y     content                                source
 *   ────────    ──────────────────────────              ────────────────────
 *   +3.0  high   PROPDATES (mock noun cards)            placeholder seeds
 *   +1.5         PROPS     (mock noun cards)            placeholder seeds
 *    0.0  mid    DREAMS    (V2 noun SVGs)               local seed deck
 *   -1.5         NOUNDRY   (single trait icons)         ImageDataV2 traits
 *   -3.0  low    NOUNS WORLD (real lifestyle photos)    NOUNS_WORLD_STORIES
 *
 * Each stream has its own card count, speed, wave amplitude/phase and hue
 * range so they don't move in lockstep. Cards along a single stream never
 * overlap — they share one sinusoidal path with fixed phase spacing. Cards
 * across streams sit in their own y lanes so vertical separation is
 * permanent. Cards fade in at the back of the stream and fade out as they
 * pass the camera so the recycle never pops.
 *
 * Behind every card sits a softly-bloomed radial gradient sprite tinted
 * across the rainbow (HSL spread per card index) — gives the river the
 * "dream rainbow" feel the brief asked for. ~1500 twinkling stars fill
 * the surrounding volume via a fragment-shader uniform so the GPU does
 * the per-frame work.
 *
 * Performance:
 *  - dpr capped at [1, 1.5] so retina displays don't push 4× pixels.
 *  - Each card is its own group so glow tints can vary independently;
 *    star twinkle is a single ShaderMaterial.
 *  - Texture loading is suspended through React Suspense so the parent
 *    page can show a loading fallback instead of a partial scene.
 */
import { useMemo, useRef, useEffect, FC } from 'react';

import { ImageDataV2, getNounDataV2 } from '@nouns/assets';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { buildSVG } from '@nouns/sdk';
import * as THREE from 'three';

import { NOUNS_WORLD_STORIES } from '@/components/NounsWorldBanner';

// ─── Tunables ───────────────────────────────────────────────────────────

/** World-units length of each stream from spawn (back) to despawn (front). */
const STREAM_LENGTH = 70;
/** Card edge length in world units (square cards across all streams). */
const CARD_WIDTH = 1.6;

// ─── Stream config ──────────────────────────────────────────────────────

interface StreamConfig {
  /** Human-readable id, used in keys + debug. */
  key: string;
  /** Vertical offset of the stream's centerline. */
  yOffset: number;
  /** Slight z-offset so adjacent streams sit at slightly different depths,
   *  giving the camera some parallax even when y separation collapses near
   *  the viewer. */
  zOffset: number;
  /** Number of cards on the stream. Spaced evenly along STREAM_LENGTH. */
  cardCount: number;
  /** Forward speed (world units / sec). Mix slow + fast so streams don't
   *  visually sync up. */
  speed: number;
  /** Amplitude of the y-axis sine wave (in addition to yOffset). */
  waveAmp: number;
  /** Wave frequency — cycles per unit of stream distance. */
  waveFreq: number;
  /** Lateral x-axis weave amplitude (a small sideways sway on top of the
   *  y wave so the stream feels 3D, not flat). */
  lateralAmp: number;
  /** HSL hue start + span (degrees). Cards on this stream get hues spread
   *  evenly between [start, start+span]. */
  hueStart: number;
  hueSpan: number;
  /** Phase offset along the path (fraction of STREAM_LENGTH, 0..1) so
   *  streams don't all spawn aligned. */
  phaseOffset: number;
}

const STREAMS: StreamConfig[] = [
  {
    key: 'propdates',
    yOffset: 3.0,
    zOffset: -2,
    cardCount: 14,
    speed: 5.4,
    waveAmp: 0.9,
    waveFreq: 0.15,
    lateralAmp: 0.4,
    hueStart: 0,
    hueSpan: 60, // reds → yellows
    phaseOffset: 0,
  },
  {
    key: 'props',
    yOffset: 1.5,
    zOffset: 0,
    cardCount: 16,
    speed: 6.2,
    waveAmp: 1.0,
    waveFreq: 0.18,
    lateralAmp: 0.5,
    hueStart: 60,
    hueSpan: 80, // yellows → greens
    phaseOffset: 0.15,
  },
  {
    key: 'dreams',
    yOffset: 0.0,
    zOffset: 0,
    cardCount: 22,
    speed: 7.0,
    waveAmp: 1.2,
    waveFreq: 0.2,
    lateralAmp: 0.6,
    hueStart: 140,
    hueSpan: 100, // greens → cyans → blues
    phaseOffset: 0.3,
  },
  {
    key: 'noundry',
    yOffset: -1.5,
    zOffset: 0,
    cardCount: 18,
    speed: 5.8,
    waveAmp: 1.0,
    waveFreq: 0.16,
    lateralAmp: 0.5,
    hueStart: 240,
    hueSpan: 60, // blues → violets
    phaseOffset: 0.5,
  },
  {
    key: 'world',
    yOffset: -3.0,
    zOffset: -1,
    cardCount: 10,
    speed: 4.6,
    waveAmp: 0.8,
    waveFreq: 0.13,
    lateralAmp: 0.35,
    hueStart: 300,
    hueSpan: 80, // violets → magentas → reds
    phaseOffset: 0.7,
  },
];

// ─── Random V2 seed deck ────────────────────────────────────────────────
//
// Deterministic xorshift32 — same seed always produces the same deck so
// the visual is stable across renders without needing useRef storage.
function makeSeedDeck(seedValue: number, count: number) {
  let s = seedValue | 0;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff);
  };
  return Array.from({ length: count }, () => ({
    background: Math.floor(rand() * ImageDataV2.bgcolors.length),
    body: Math.floor(rand() * ImageDataV2.images.bodies.length),
    accessory: Math.floor(rand() * ImageDataV2.images.accessories.length),
    head: Math.floor(rand() * ImageDataV2.images.heads.length),
    glasses: Math.floor(rand() * ImageDataV2.images.glasses.length),
  }));
}

function seedToSvgDataUri(seed: ReturnType<typeof makeSeedDeck>[number]): string {
  const { parts, background } = getNounDataV2(seed);
  const svg = buildSVG(parts, ImageDataV2.palette, background);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// Single-trait SVG (transparent bg) — used for the NOUNDRY stream.
function singleTraitSvgDataUri(category: 'heads' | 'bodies' | 'accessories' | 'glasses', idx: number): string {
  const item = ImageDataV2.images[category][idx];
  if (!item) return seedToSvgDataUri({ background: 0, body: 0, accessory: 0, head: 0, glasses: 0 });
  const svg = buildSVG([item], ImageDataV2.palette, undefined);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ─── Per-stream content sourcing ────────────────────────────────────────
//
// Returns the array of texture URLs for a given stream key. Mostly
// data: URIs (no network) except for NOUNS_WORLD which loads real
// photos from explore.nouns.world.

function sourcesForStream(key: string, count: number): string[] {
  switch (key) {
    case 'dreams':
      return makeSeedDeck(0xC0FFEE, count).map(seedToSvgDataUri);
    case 'props':
      // TODO: wire useCurrentProps when the data is easy to thread without
      // coupling. For now use a different seed deck so the cards look
      // distinct from the dreams stream.
      return makeSeedDeck(0xBADF00D, count).map(seedToSvgDataUri);
    case 'propdates':
      return makeSeedDeck(0x1337BEEF, count).map(seedToSvgDataUri);
    case 'noundry': {
      // Cycle through head/body/accessory/glasses for visual variety.
      const cats = ['heads', 'bodies', 'accessories', 'glasses'] as const;
      return Array.from({ length: count }, (_, i) => {
        const cat = cats[i % cats.length];
        const arr = ImageDataV2.images[cat];
        return singleTraitSvgDataUri(cat, i % arr.length);
      });
    }
    case 'world':
      // Real lifestyle photos from explore.nouns.world. Truncate / wrap
      // if cardCount exceeds the bundled count.
      return Array.from({ length: count }, (_, i) =>
        NOUNS_WORLD_STORIES[i % NOUNS_WORLD_STORIES.length].image,
      );
    default:
      return makeSeedDeck(0xDEADBEEF, count).map(seedToSvgDataUri);
  }
}

// ─── Card ────────────────────────────────────────────────────────────────

interface CardProps {
  texture: THREE.Texture;
  /** Phase along the stream (in world units, 0..STREAM_LENGTH). */
  phase: number;
  hue: number;
  config: StreamConfig;
}

function NounCard({ texture, phase, hue, config }: CardProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Per-card glow texture. Built once per hue. Soft radial gradient on a
  // small canvas; multiplied through additive blending so it bloom-tints
  // the area behind the card without darkening it.
  const glowTexture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `hsla(${hue}, 95%, 65%, 1)`);
    grad.addColorStop(0.45, `hsla(${hue}, 95%, 60%, 0.55)`);
    grad.addColorStop(1, `hsla(${hue}, 95%, 50%, 0)`);
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
    // Each card rides the same path but offset by `phase`. As time passes
    // all cards advance forward and modulo wraps back to the spawn end.
    const t = (clock.elapsedTime * config.speed + phase) % STREAM_LENGTH;
    const z = -STREAM_LENGTH / 2 + t + config.zOffset;
    const y = config.yOffset + Math.sin(z * config.waveFreq + phase * 0.05) * config.waveAmp;
    const x = Math.cos(z * config.waveFreq * 0.7 + phase * 0.013) * config.lateralAmp;
    g.position.set(x, y, z);
    // Mild rotation tied to the wave so cards don't read as flat planes
    // when the wave peaks. Cap angles small so the texture stays legible.
    g.rotation.y = Math.sin(z * config.waveFreq) * 0.2;
    g.rotation.z = Math.cos(z * config.waveFreq) * 0.07;

    // Smooth fade-in at the back, fade-out as cards pass the camera.
    // Avoids the recycle pop and gives a misty entry/exit.
    const fadeIn = THREE.MathUtils.smoothstep(z, -STREAM_LENGTH / 2 + 2, -STREAM_LENGTH / 2 + 8);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(z, 6, 11);
    const alpha = Math.max(0, Math.min(1, fadeIn * fadeOut));
    g.traverse(obj => {
      const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
      if (!mat || !('opacity' in mat)) return;
      const baseOpacity = (mat as { userData?: { baseOpacity?: number } }).userData?.baseOpacity ?? 1;
      (mat as THREE.MeshBasicMaterial).opacity = baseOpacity * alpha;
    });
  });

  return (
    <group ref={groupRef}>
      {/* eslint-disable react/no-unknown-property */}
      {/* Glow plane sits a touch behind the card so the bloom reads as
          ambient light rather than a halo painted on top. */}
      <mesh position={[0, 0, -0.02]} renderOrder={0}>
        <planeGeometry args={[CARD_WIDTH * 2.6, CARD_WIDTH * 2.6]} />
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
      {/* Card itself. Pixelated nearest-neighbour to keep the noun art
          crisp at world scale; for photo-content streams (NOUNS_WORLD)
          we override the filter on the texture loader (see below). */}
      <mesh renderOrder={1}>
        <planeGeometry args={[CARD_WIDTH, CARD_WIDTH]} />
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

// ─── Stream ─────────────────────────────────────────────────────────────

function Stream({ config }: { config: StreamConfig }) {
  const sources = useMemo(
    () => sourcesForStream(config.key, config.cardCount),
    [config.key, config.cardCount],
  );
  const textures = useLoader(THREE.TextureLoader, sources) as THREE.Texture[];

  useEffect(() => {
    for (const t of textures) {
      // Photo-content streams look better with linear filtering; pixel-art
      // streams need nearest. Detect by source type — data: URIs from our
      // svg pipeline are pixel art, http(s) URLs are photos.
      const isPhoto = !(t.image as HTMLImageElement | undefined)?.src?.startsWith('data:');
      t.minFilter = isPhoto ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
      t.magFilter = isPhoto ? THREE.LinearFilter : THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
    }
  }, [textures]);

  const phaseSpacing = STREAM_LENGTH / config.cardCount;
  const phaseShift = config.phaseOffset * STREAM_LENGTH;

  return (
    <>
      {textures.map((tex, i) => (
        <NounCard
          key={i}
          texture={tex}
          phase={(i * phaseSpacing + phaseShift) % STREAM_LENGTH}
          hue={config.hueStart + (i * config.hueSpan) / config.cardCount}
          config={config}
        />
      ))}
    </>
  );
}

// ─── Starfield ──────────────────────────────────────────────────────────

const STAR_COUNT = 1500;

function Starfield() {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, sizes, phases } = useMemo(() => {
    const pos = new Float32Array(STAR_COUNT * 3);
    const sz = new Float32Array(STAR_COUNT);
    const ph = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 28;
      pos[i * 3 + 2] = -STREAM_LENGTH / 2 + Math.random() * STREAM_LENGTH;
      sz[i] = 2 + Math.random() * 5;
      ph[i] = Math.random() * Math.PI * 2;
    }
    return { positions: pos, sizes: sz, phases: ph };
  }, []);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.elapsedTime;
  });

  // Twinkle on the GPU so we don't update vertex data each frame.
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
            float twinkle = 0.5 + 0.5 * sin(uTime * 2.0 + aPhase);
            gl_PointSize = aSize * (0.5 + twinkle) * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying float vPhase;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            float alpha = smoothstep(0.5, 0.0, d);
            vec3 col = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.85, 0.95), 0.5 + 0.5 * sin(vPhase));
            gl_FragColor = vec4(col, alpha * 0.85);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(() => () => shaderMat.dispose(), [shaderMat]);

  return (
    /* eslint-disable react/no-unknown-property */
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={STAR_COUNT} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} count={STAR_COUNT} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} count={STAR_COUNT} />
      </bufferGeometry>
      <primitive object={shaderMat} ref={matRef} attach="material" />
    </points>
    /* eslint-enable react/no-unknown-property */
  );
}

// ─── Public component ──────────────────────────────────────────────────

export interface DreamWaveStreamProps {
  /** Lock OrbitControls — useful when embedding inside a page where the
   *  user shouldn't be able to spin the camera. Default false (free look). */
  locked?: boolean;
}

const DreamWaveStream: FC<DreamWaveStreamProps> = ({ locked = false }) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'radial-gradient(ellipse at 50% 50%, #1a0635 0%, #060015 70%, #000 100%)',
      }}
    >
      <Canvas
        camera={{ fov: 60, near: 0.1, far: 220, position: [0, 0.5, 16] }}
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
        <ambientLight intensity={0.7} />
        <Starfield />
        {STREAMS.map(s => (
          <Stream key={s.key} config={s} />
        ))}
        {!locked && (
          <OrbitControls
            enablePan={false}
            enableZoom
            enableDamping
            dampingFactor={0.1}
            minDistance={6}
            maxDistance={40}
          />
        )}
        {/* eslint-enable react/no-unknown-property */}
      </Canvas>
    </div>
  );
};

export default DreamWaveStream;
