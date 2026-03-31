/**
 * NounParallax — 3D voxel Noun with gyro/touch/mouse tilt.
 *
 * Renders Noun as extruded voxel cubes (glasses protrude from face).
 * Three modes:
 *   - Tilt mode (default): subtle gyro/touch/mouse parallax
 *   - Interactive mode (interactive prop): full orbit/zoom/drag via OrbitControls
 *   - Editable mode (editable prop): 3D voxel editor with sculpting
 * All modes use meshStandardMaterial with proper lighting and shadows.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import {
  buildNounGeometries,
  seedToLayers,
  type LayerVisibility,
  type VoxelMap,
  type Tool,
} from '@nouns/voxel-engine';


import { INounSeed } from '@/wrappers/nounToken';

import classes from './NounParallax.module.css';

// ─── Tilt config ────────────────────────────────────────────────────────────

interface Tilt {
  x: number;
  y: number;
}

const ROT_Y_DEG = 8;
const ROT_X_DEG = 5;
const ROT_Z_DEG = 2.5;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
const DEG = Math.PI / 180;

// ─── Inner R3F scene (tilt mode — parallax with proper lighting) ────────────

interface TiltSceneProps {
  seed: INounSeed;
  tiltRef: React.MutableRefObject<Tilt>;
  layerVisibility?: LayerVisibility;
}

function TiltScene({ seed, tiltRef, layerVisibility }: TiltSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const currentTilt = useRef<Tilt>({ x: 0, y: 0 });

  const { bodyGeo, blingGeo, glassesGeo } = useMemo(() => {
    const layers = seedToLayers(seed, getNounData, ImageData.palette, layerVisibility);
    return buildNounGeometries(layers);
  }, [seed, layerVisibility]);

  useEffect(() => {
    return () => {
      bodyGeo?.dispose();
      blingGeo?.dispose();
      glassesGeo?.dispose();
    };
  }, [bodyGeo, blingGeo, glassesGeo]);

  useFrame(() => {
    if (!groupRef.current) return;
    const smoothing = 0.07;
    currentTilt.current.x = lerp(currentTilt.current.x, tiltRef.current.x, smoothing);
    currentTilt.current.y = lerp(currentTilt.current.y, tiltRef.current.y, smoothing);

    const { x, y } = currentTilt.current;
    groupRef.current.rotation.y = x * ROT_Y_DEG * DEG;
    groupRef.current.rotation.x = y * -ROT_X_DEG * DEG;
    groupRef.current.rotation.z = x * -ROT_Z_DEG * DEG;
  });

  return (
    <group ref={groupRef}>
      {/* eslint-disable react/no-unknown-property */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[15, 25, 30]}
        intensity={1.6}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.005}
      />
      <directionalLight position={[-10, -5, -15]} intensity={0.15} />
      <directionalLight position={[-5, 10, -20]} intensity={0.25} />

      {bodyGeo && (
        <mesh geometry={bodyGeo} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.7} metalness={0.0} />
        </mesh>
      )}
      {blingGeo && (
        <mesh geometry={blingGeo} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.5} metalness={0.05} />
        </mesh>
      )}
      {glassesGeo && (
        <mesh geometry={glassesGeo} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.5} metalness={0.08} />
        </mesh>
      )}
      {/* eslint-enable react/no-unknown-property */}
    </group>
  );
}

// ─── Inner R3F scene (interactive mode — orbit + shadows) ────────────────────

interface InteractiveSceneProps {
  seed: INounSeed;
  layerVisibility?: LayerVisibility;
}

function InteractiveScene({ seed, layerVisibility }: InteractiveSceneProps) {
  const { bodyGeo, blingGeo, glassesGeo } = useMemo(() => {
    const layers = seedToLayers(seed, getNounData, ImageData.palette, layerVisibility);
    return buildNounGeometries(layers);
  }, [seed, layerVisibility]);

  useEffect(() => {
    return () => {
      bodyGeo?.dispose();
      blingGeo?.dispose();
      glassesGeo?.dispose();
    };
  }, [bodyGeo, blingGeo, glassesGeo]);

  return (
    <>
      {/* eslint-disable react/no-unknown-property */}
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[15, 25, 30]}
        intensity={1.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.005}
      />
      <directionalLight position={[-10, -5, -15]} intensity={0.15} />
      <directionalLight position={[-5, 10, -20]} intensity={0.25} />

      {bodyGeo && (
        <mesh geometry={bodyGeo} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.7} metalness={0.0} />
        </mesh>
      )}
      {blingGeo && (
        <mesh geometry={blingGeo} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.5} metalness={0.05} />
        </mesh>
      )}
      {glassesGeo && (
        <mesh geometry={glassesGeo} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.5} metalness={0.08} />
        </mesh>
      )}

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.12}
        minDistance={10}
        maxDistance={80}
        minPolarAngle={Math.PI * 0.05}
        maxPolarAngle={Math.PI * 0.95}
      />
      {/* eslint-enable react/no-unknown-property */}
    </>
  );
}

// ─── Responsive camera ──────────────────────────────────────────────────────

function ResponsiveCamera({ fullscreen }: { fullscreen?: boolean }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    if (fullscreen) {
      const base = aspect > 1 ? 34 : 34 / aspect;
      (camera as THREE.PerspectiveCamera).position.set(0, 0, base);
    } else {
      const dist = aspect > 1 ? 38 : 38 / aspect;
      (camera as THREE.PerspectiveCamera).position.set(0, 2, dist);
    }
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, fullscreen]);
  return null;
}

// ─── Main component ─────────────────────────────────────────────────────────

export interface EditableConfig {
  pixels: string[][];
  activeTool: Tool;
  activeColor: string;
  onPixelChange: (x: number, y: number, color: string) => void;
  onPixelsFill: (changes: [number, number, string][]) => void;
  onColorPick: (color: string) => void;
  voxelDepth?: number;
  onVoxelMapChange?: (map: VoxelMap) => void;
}

interface NounParallaxProps {
  seed: INounSeed;
  interactive?: boolean;
  fullscreen?: boolean;
  editable?: EditableConfig;
  layerVisibility?: LayerVisibility;
}

// Lazy-load EditableScene (heavy — raycasting + individual meshes)
// Lazy-load EditableScene from voxel engine
const EditableSceneComponent = React.lazy(() => import('./VoxelEditableScene'));

const NounParallax: React.FC<NounParallaxProps> = ({ seed, interactive = false, fullscreen = false, editable, layerVisibility }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<Tilt>({ x: 0, y: 0 });
  const hasGyro = useRef(false);
  const [needsPermission, setNeedsPermission] = useState(false);

  // ── Mouse (desktop) — tilt mode only ──
  useEffect(() => {
    if (interactive) return;
    const container = containerRef.current;
    if (!container) return;

    const onMouseMove = (e: MouseEvent) => {
      if (hasGyro.current) return;
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      tiltRef.current = {
        x: clamp((e.clientX - cx) / (rect.width / 2), -1, 1),
        y: clamp((e.clientY - cy) / (rect.height / 2), -1, 1),
      };
    };
    const onMouseLeave = () => {
      if (hasGyro.current) return;
      tiltRef.current = { x: 0, y: 0 };
    };

    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseleave', onMouseLeave);
    return () => {
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [interactive]);

  // ── Touch (mobile without gyro) — tilt mode only ──
  useEffect(() => {
    if (interactive) return;
    const container = containerRef.current;
    if (!container) return;

    const onTouchMove = (e: TouchEvent) => {
      if (hasGyro.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      tiltRef.current = {
        x: clamp((touch.clientX - cx) / (rect.width / 2), -1, 1),
        y: clamp((touch.clientY - cy) / (rect.height / 2), -1, 1),
      };
    };
    const onTouchEnd = () => {
      if (hasGyro.current) return;
      tiltRef.current = { x: 0, y: 0 };
    };

    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    return () => {
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [interactive]);

  // ── DeviceOrientation (gyroscope) — tilt mode only ──
  useEffect(() => {
    if (interactive) return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      hasGyro.current = true;
      tiltRef.current = {
        x: clamp(e.gamma / 30, -1, 1),
        y: clamp((e.beta - 45) / 30, -1, 1),
      };
    };

    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission === 'function') {
      setNeedsPermission(true);
    } else {
      window.addEventListener('deviceorientation', onOrientation);
    }
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [interactive]);

  const requestPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission: () => Promise<string>;
    };
    try {
      const result = await DOE.requestPermission();
      if (result === 'granted') {
        setNeedsPermission(false);
        window.addEventListener('deviceorientation', (e: DeviceOrientationEvent) => {
          if (e.gamma == null || e.beta == null) return;
          hasGyro.current = true;
          tiltRef.current = {
            x: clamp(e.gamma / 30, -1, 1),
            y: clamp((e.beta - 45) / 30, -1, 1),
          };
        });
      }
    } catch {
      // denied — touch/mouse fallback still works
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={`${classes.container} ${fullscreen ? classes.fullscreen : ''}`}
      onClick={!interactive && needsPermission ? requestPermission : undefined}
    >
      <Canvas
        className={classes.canvas}
        style={fullscreen ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : undefined}
        camera={{ fov: 50, near: 1, far: 200 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }}
        dpr={[1, 2]}
        frameloop="always"
        shadows
        resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
      >
        <Suspense fallback={null}>
          <ResponsiveCamera fullscreen={fullscreen} />
          {editable ? (
            <EditableSceneComponent
              pixels={editable.pixels}
              activeTool={editable.activeTool}
              activeColor={editable.activeColor}
              onPixelChange={editable.onPixelChange}
              onPixelsFill={editable.onPixelsFill}
              onColorPick={editable.onColorPick}
              voxelDepth={editable.voxelDepth}
              onVoxelMapChange={editable.onVoxelMapChange}
            />
          ) : interactive ? (
            <InteractiveScene seed={seed} layerVisibility={layerVisibility} />
          ) : (
            <TiltScene seed={seed} tiltRef={tiltRef} layerVisibility={layerVisibility} />
          )}
        </Suspense>
      </Canvas>
      {!interactive && needsPermission && (
        <div className={classes.permissionHint}>Tap to enable motion</div>
      )}
      {interactive && (
        <div className={classes.interactiveHint}>Drag to rotate &middot; Pinch to zoom</div>
      )}
    </div>
  );
};

export default NounParallax;
