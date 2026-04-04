/* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
/**
 * NounParallax — 3D voxel Noun with gyro/touch/mouse tilt.
 *
 * Renders Noun as extruded voxel cubes (glasses protrude from face).
 * Three modes:
 *   - Tilt mode (default): subtle gyro/touch/mouse parallax
 *   - Interactive mode (interactive prop): full orbit/zoom/drag via OrbitControls
 *   - Editable mode (editable prop): 3D voxel editor with sculpting
 * Display mode uses unlit materials so the rendered noun matches the source
 * palette exactly instead of darkening under scene lighting.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import {
  buildGeometryFromVoxelMap,
  buildNounGeometries,
  seedToLayers,
  type EditableSceneViewState,
  type LayerVisibility,
  type Tool,
  type VoxelMap,
} from '@nouns/voxel-engine';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

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
  seed?: INounSeed;
  voxelMap?: VoxelMap;
  tiltRef: React.MutableRefObject<Tilt>;
  layerVisibility?: LayerVisibility;
  autoSpin?: boolean;
}

function TiltScene({ seed, voxelMap, tiltRef, layerVisibility, autoSpin = false }: TiltSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const currentTilt = useRef<Tilt>({ x: 0, y: 0 });
  const spinTime = useRef(0);

  const { bodyGeo, blingGeo, headGeo, glassesGeo } = useMemo(() => {
    if (voxelMap) {
      return {
        bodyGeo: buildGeometryFromVoxelMap(voxelMap),
        blingGeo: null,
        headGeo: null,
        glassesGeo: null,
      };
    }
    if (!seed) {
      return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
    }
    const layers = seedToLayers(seed, getNounData, ImageData.palette, layerVisibility);
    return buildNounGeometries(layers);
  }, [seed, layerVisibility, voxelMap]);

  useEffect(() => {
    return () => {
      bodyGeo?.dispose();
      blingGeo?.dispose();
      headGeo?.dispose();
      glassesGeo?.dispose();
    };
  }, [bodyGeo, blingGeo, glassesGeo, headGeo]);

  useEffect(() => {
    spinTime.current = 0;
  }, [seed, voxelMap, autoSpin]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    if (autoSpin) {
      // Cinematic spin: ease-in-out rotation over ~2.5s
      spinTime.current += delta;
      const t = Math.min(spinTime.current / 2.5, 1);
      // Ease-in-out cubic
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      groupRef.current.rotation.y = eased * Math.PI * 2; // full 360°
      groupRef.current.rotation.x = Math.sin(eased * Math.PI) * -8 * DEG; // subtle nod
      return;
    }

    const smoothing = 0.07;
    currentTilt.current.x = lerp(currentTilt.current.x, tiltRef.current.x, smoothing);
    currentTilt.current.y = lerp(currentTilt.current.y, tiltRef.current.y, smoothing);

    const { x, y } = currentTilt.current;
    groupRef.current.rotation.y = x * ROT_Y_DEG * DEG;
    groupRef.current.rotation.x = y * -ROT_X_DEG * DEG;
    groupRef.current.rotation.z = x * -ROT_Z_DEG * DEG;
  });

  return (
    <>
      {/* eslint-disable react/no-unknown-property */}
      <group ref={groupRef}>
        {bodyGeo && (
          <mesh geometry={bodyGeo}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </mesh>
        )}
        {blingGeo && (
          <mesh geometry={blingGeo}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </mesh>
        )}
        {headGeo && (
          <mesh geometry={headGeo}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </mesh>
        )}
        {glassesGeo && (
          <mesh geometry={glassesGeo}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </mesh>
        )}
      </group>
      {/* eslint-enable react/no-unknown-property */}
    </>
  );
}

// ─── Inner R3F scene (interactive mode — orbit + shadows) ────────────────────

interface InteractiveSceneProps {
  seed?: INounSeed;
  voxelMap?: VoxelMap;
  layerVisibility?: LayerVisibility;
  autoRotate?: boolean;
  interactionMode?: 'grab' | 'twist';
}

function InteractiveScene({
  seed,
  voxelMap,
  layerVisibility,
  autoRotate = false,
  interactionMode = 'twist',
}: InteractiveSceneProps) {
  const { bodyGeo, blingGeo, headGeo, glassesGeo } = useMemo(() => {
    if (voxelMap) {
      return {
        bodyGeo: buildGeometryFromVoxelMap(voxelMap),
        blingGeo: null,
        headGeo: null,
        glassesGeo: null,
      };
    }
    if (!seed) {
      return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
    }
    const layers = seedToLayers(seed, getNounData, ImageData.palette, layerVisibility);
    return buildNounGeometries(layers);
  }, [seed, layerVisibility, voxelMap]);

  useEffect(() => {
    return () => {
      bodyGeo?.dispose();
      blingGeo?.dispose();
      headGeo?.dispose();
      glassesGeo?.dispose();
    };
  }, [bodyGeo, blingGeo, glassesGeo, headGeo]);

  return (
    <>
      {/* eslint-disable react/no-unknown-property */}
      {bodyGeo && (
        <mesh geometry={bodyGeo}>
          <meshBasicMaterial vertexColors toneMapped={false} />
        </mesh>
      )}
      {blingGeo && (
        <mesh geometry={blingGeo}>
          <meshBasicMaterial vertexColors toneMapped={false} />
        </mesh>
      )}
      {headGeo && (
        <mesh geometry={headGeo}>
          <meshBasicMaterial vertexColors toneMapped={false} />
        </mesh>
      )}
      {glassesGeo && (
        <mesh geometry={glassesGeo}>
          <meshBasicMaterial vertexColors toneMapped={false} />
        </mesh>
      )}

      <OrbitControls
        enablePan={interactionMode === 'grab'}
        enableRotate={interactionMode === 'twist'}
        enableZoom
        enableDamping
        dampingFactor={0.12}
        autoRotate={autoRotate}
        autoRotateSpeed={1.3}
        screenSpacePanning
        panSpeed={0.9}
        minDistance={10}
        maxDistance={80}
        minPolarAngle={Math.PI * 0.05}
        maxPolarAngle={Math.PI * 0.95}
        mouseButtons={{
          LEFT: interactionMode === 'grab' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: interactionMode === 'grab' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
        }}
        touches={{
          ONE: interactionMode === 'grab' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
          TWO: interactionMode === 'grab' ? THREE.TOUCH.DOLLY_PAN : THREE.TOUCH.DOLLY_ROTATE,
        }}
      />
      {/* eslint-enable react/no-unknown-property */}
    </>
  );
}

// ─── Responsive camera ──────────────────────────────────────────────────────

function ResponsiveCamera({
  fullscreen,
  viewStateRef,
}: {
  fullscreen?: boolean;
  viewStateRef?: { current: EditableSceneViewState | null };
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const savedView = viewStateRef?.current;

    if (savedView) {
      camera.position.set(...savedView.cameraPosition);
      perspectiveCamera.zoom = savedView.zoom;
      camera.lookAt(...savedView.target);
      camera.updateProjectionMatrix();
      return;
    }

    const aspect = size.width / size.height;
    if (fullscreen === true) {
      const base = aspect > 1 ? 34 : 34 / aspect;
      perspectiveCamera.position.set(0, 0, base);
    } else {
      const dist = aspect > 1 ? 38 : 38 / aspect;
      perspectiveCamera.position.set(0, 2, dist);
    }
    camera.lookAt(0, 0, 0);
    perspectiveCamera.updateProjectionMatrix();

    if (viewStateRef) {
      viewStateRef.current = {
        cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
        target: [0, 0, 0],
        zoom: perspectiveCamera.zoom,
      };
    }
  }, [camera, fullscreen, size.height, size.width, viewStateRef]);
  return null;
}

// ─── Main component ─────────────────────────────────────────────────────────

export interface EditableConfig {
  pixels: string[][];
  initialVoxelMap?: VoxelMap | null;
  activeTool: Tool;
  activeColor: string;
  onPixelChange: (x: number, y: number, color: string) => void;
  onPixelsFill: (changes: [number, number, string][]) => void;
  onColorPick: (color: string) => void;
  voxelDepth?: number;
  interactionMode?: 'sculpt' | 'grab' | 'twist';
  visibilityMask?: boolean[][];
  displayPixels?: string[][];
  viewStateRef?: { current: EditableSceneViewState | null };
  onVoxelMapChange?: (map: VoxelMap) => void;
}

interface NounParallaxProps {
  seed?: INounSeed;
  voxelMap?: VoxelMap;
  interactive?: boolean;
  interactionMode?: 'grab' | 'twist';
  fullscreen?: boolean;
  editable?: EditableConfig;
  layerVisibility?: LayerVisibility;
  /** Auto-spin for cinematic intro (one full rotation over ~2s) */
  autoSpin?: boolean;
  autoRotate?: boolean;
  pointerEnabled?: boolean;
}

// Lazy-load EditableScene (heavy — raycasting + individual meshes)
// Lazy-load EditableScene from voxel engine
const EditableSceneComponent = React.lazy(() => import('./VoxelEditableScene'));

const NounParallax: React.FC<NounParallaxProps> = ({
  seed,
  voxelMap,
  interactive = false,
  interactionMode = 'twist',
  fullscreen = false,
  editable,
  layerVisibility,
  autoSpin = false,
  autoRotate = false,
  pointerEnabled = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<Tilt>({ x: 0, y: 0 });
  const hasGyro = useRef(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const showPermissionHint = useCallback(() => {
    setNeedsPermission(true);
  }, []);

  // ── Mouse (desktop) — tilt mode only ──
  useEffect(() => {
    if (interactive || !pointerEnabled) return;
    const container = containerRef.current;
    if (container == null) return;

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
  }, [interactive, pointerEnabled]);

  // ── Touch (mobile without gyro) — tilt mode only ──
  useEffect(() => {
    if (interactive || !pointerEnabled) return;
    const container = containerRef.current;
    if (container == null) return;

    const onTouchMove = (e: TouchEvent) => {
      if (hasGyro.current) return;
      const touch = e.touches[0];
      if (touch == null) return;
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
  }, [interactive, pointerEnabled]);

  // ── DeviceOrientation (gyroscope) — tilt mode only ──
  useEffect(() => {
    if (interactive || !pointerEnabled) return;
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
      showPermissionHint();
    } else {
      window.addEventListener('deviceorientation', onOrientation);
    }
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [interactive, pointerEnabled, showPermissionHint]);

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
      data-noun-parallax-root="true"
      className={`${classes.container} ${fullscreen ? classes.fullscreen : ''}`}
      onClick={!interactive && pointerEnabled && needsPermission ? requestPermission : undefined}
      style={{ pointerEvents: pointerEnabled ? 'auto' : 'none' }}
    >
      <Canvas
        className={classes.canvas}
        style={
          fullscreen ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : undefined
        }
        camera={{ fov: 50, near: 1, far: 200 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.NoToneMapping;
        }}
        dpr={[1, 1.5]}
        flat
        frameloop="always"
        resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
      >
        <Suspense fallback={null}>
          <ResponsiveCamera fullscreen={fullscreen} viewStateRef={editable?.viewStateRef} />
          {editable ? (
            <EditableSceneComponent
              pixels={editable.pixels}
              initialVoxelMap={editable.initialVoxelMap ?? undefined}
              activeTool={editable.activeTool}
              activeColor={editable.activeColor}
              onPixelChange={editable.onPixelChange}
              onPixelsFill={editable.onPixelsFill}
              onColorPick={editable.onColorPick}
              voxelDepth={editable.voxelDepth}
              interactionMode={editable.interactionMode}
              visibilityMask={editable.visibilityMask}
              displayPixels={editable.displayPixels}
              viewStateRef={editable.viewStateRef}
              onVoxelMapChange={editable.onVoxelMapChange}
            />
          ) : interactive ? (
            <InteractiveScene
              seed={seed}
              voxelMap={voxelMap}
              layerVisibility={layerVisibility}
              autoRotate={autoRotate}
              interactionMode={interactionMode}
            />
          ) : (
            <TiltScene
              seed={seed}
              voxelMap={voxelMap}
              tiltRef={tiltRef}
              layerVisibility={layerVisibility}
              autoSpin={autoSpin}
            />
          )}
        </Suspense>
      </Canvas>
      {!interactive && pointerEnabled && needsPermission && (
        <div className={classes.permissionHint}>Tap to enable motion</div>
      )}
    </div>
  );
};

export default NounParallax;
