/**
 * EditableMeshScene — R3F scene for painting directly on GLB mesh geometry.
 *
 * Replaces the voxel EditableScene when a curated GLB head is available.
 * Loads the actual GLB model, builds a face adjacency graph, and lets users
 * paint vertex colors by clicking/dragging on mesh faces.
 */
import type { EditableSceneViewState, FaceAdjacencyGraph, MeshEditState, Tool } from '../types';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OrbitControls } from '@react-three/drei';
import { type ThreeEvent, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { buildAdjacencyGraph, expandBrush } from '../meshGraph';
import {
  type MeshHistoryState,
  createHistory,
  pushSnapshot,
  undo as historyUndo,
  redo as historyRedo,
} from '../meshHistory';
import {
  applyDeltas,
  computeBuildPosition,
  deleteBrush,
  eyedropFace,
  floodFillMesh,
  hexToLinear,
  initEditState,
  paintBrush,
  placeVoxelBlock,
  removeVoxel,
  parseVoxelKey,
} from '../meshOps';
import { loadFromLocalStorage, saveToLocalStorage } from '../meshPersistence';
import { HEAD_OFFSET } from '../types';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface EditableMeshSceneProps {
  /** Path to the GLB head model */
  glbPath: string;
  /** Glasses trait index for texture swap */
  glassesIndex: number;
  /** Current tool */
  activeTool: Tool;
  /** Current paint color (hex string) */
  activeColor: string;
  /** Brush size in face-hops (1 = single face) */
  brushSize: number;
  /** Interaction mode for orbit controls */
  interactionMode: 'sculpt' | 'grab' | 'twist';
  /** Callback when eyedropper picks a color */
  onColorPick: (color: string) => void;
  /** Camera state persistence */
  viewStateRef?: { current: EditableSceneViewState | null };
  /** Callback when mesh state changes (for auto-save) */
  onStateChange?: () => void;
  /** Persistence key for localStorage (usually head trait name) */
  persistenceKey?: string;
  /** Undo callback (called from parent keyboard shortcuts) */
  undoRef?: React.MutableRefObject<(() => void) | null>;
  /** Redo callback */
  redoRef?: React.MutableRefObject<(() => void) | null>;
  /** Called with the front Z of the head mesh after loading (for glasses positioning) */
  onFrontZ?: (z: number) => void;
  /** Whether the head mesh is visible (layer toggle) */
  headVisible?: boolean;
  /** Whether the GLB's built-in glasses mesh is visible (layer toggle) */
  glassesVisible?: boolean;
  /** Ref to expose the loaded scene for export */
  sceneRef?: React.MutableRefObject<THREE.Object3D | null>;
  /** Per-head offset override (replaces HEAD_OFFSET when provided) */
  headOffset?: [number, number, number];
  /** Ref exposing a snapshot function — returns PNG data URL of the current render */
  snapshotRef?: React.MutableRefObject<(() => string | null) | null>;
}

// ─── Hover Highlight ────────────────────────────────────────────────────────

const HIGHLIGHT_OPACITY = 0.45;
const HIGHLIGHT_COLOR = new THREE.Color(0xffffff);

function BrushHighlight({
  geometry,
  hoveredFaces,
  adjacency,
}: {
  geometry: THREE.BufferGeometry | null;
  hoveredFaces: Set<number> | null;
  adjacency: FaceAdjacencyGraph | null;
}) {
  const highlightGeo = useMemo(() => {
    if (!geometry || !hoveredFaces || hoveredFaces.size === 0) return null;

    const index = geometry.index;
    const positions = geometry.attributes.position;
    if (!index || !positions) return null;

    // Extract triangles for hovered faces
    const indices: number[] = [];
    for (const fi of hoveredFaces) {
      indices.push(index.array[fi * 3], index.array[fi * 3 + 1], index.array[fi * 3 + 2]);
    }

    const hlGeo = new THREE.BufferGeometry();
    hlGeo.setAttribute('position', positions.clone());
    hlGeo.setIndex(indices);
    hlGeo.computeVertexNormals();
    return hlGeo;
  }, [geometry, hoveredFaces, adjacency]);

  useEffect(() => {
    return () => {
      highlightGeo?.dispose();
    };
  }, [highlightGeo]);

  if (!highlightGeo) return null;

  return (
    <mesh geometry={highlightGeo} renderOrder={2}>
      <meshBasicMaterial
        color={HIGHLIGHT_COLOR}
        transparent
        opacity={HIGHLIGHT_OPACITY}
        depthTest
        depthWrite={false}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}

// ─── Orbit Controls ─────────────────────────────────────────────────────────

function EditOrbitControls({
  interactionMode,
  viewStateRef,
}: {
  interactionMode: 'sculpt' | 'grab' | 'twist';
  viewStateRef?: { current: EditableSceneViewState | null };
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();

  // Save camera state on change
  const onEnd = useCallback(() => {
    if (!viewStateRef) return;
    const c = camera as THREE.PerspectiveCamera;
    viewStateRef.current = {
      cameraPosition: [c.position.x, c.position.y, c.position.z],
      target: controlsRef.current
        ? [controlsRef.current.target.x, controlsRef.current.target.y, controlsRef.current.target.z]
        : [0, 0, 0],
      zoom: c.zoom,
    };
  }, [camera, viewStateRef]);

  // Determine what left mouse / single touch does based on mode
  const enablePan = interactionMode === 'grab';
  const enableRotate = interactionMode !== 'sculpt';

  // In sculpt mode: left click is for painting, orbit on right click only
  const mouseButtons = useMemo(() => {
    if (interactionMode === 'sculpt') {
      return {
        LEFT: undefined as unknown as THREE.MOUSE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    }
    if (interactionMode === 'grab') {
      return {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    }
    // twist
    return {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
  }, [interactionMode]);

  const touches = useMemo(() => {
    if (interactionMode === 'sculpt') {
      return {
        ONE: undefined as unknown as THREE.TOUCH,
        TWO: THREE.TOUCH.DOLLY_ROTATE,
      };
    }
    if (interactionMode === 'grab') {
      return {
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_PAN,
      };
    }
    return {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };
  }, [interactionMode]);

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={enablePan}
      enableRotate={enableRotate}
      enableZoom
      enableDamping
      dampingFactor={0.12}
      minDistance={10}
      maxDistance={80}
      minPolarAngle={Math.PI * 0.05}
      maxPolarAngle={Math.PI * 0.95}
      mouseButtons={mouseButtons}
      touches={touches}
      onEnd={onEnd}
    />
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function EditableMeshScene({
  glbPath,
  glassesIndex,
  activeTool,
  activeColor,
  brushSize,
  interactionMode,
  onColorPick,
  viewStateRef,
  onStateChange,
  persistenceKey,
  undoRef,
  redoRef,
  headVisible = true,
  glassesVisible = true,
  sceneRef,
  headOffset,
  snapshotRef,
}: EditableMeshSceneProps) {
  // Loading state
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [editableGeometry, setEditableGeometry] = useState<THREE.BufferGeometry | null>(null);

  // Edit state (stored in ref for pointer handler performance)
  const editStateRef = useRef<MeshEditState | null>(null);
  const historyRef = useRef<MeshHistoryState>(createHistory());

  // Pointer tracking
  const isPointerDown = useRef(false);
  const lastPaintedFace = useRef(-1);
  const [hoveredFaces, setHoveredFaces] = useState<Set<number> | null>(null);

  // Auto-save debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tool/color refs for use in pointer handlers (avoid stale closures)
  const toolRef = useRef(activeTool);
  const colorRef = useRef(activeColor);
  const brushRef = useRef(brushSize);
  toolRef.current = activeTool;
  colorRef.current = activeColor;
  brushRef.current = brushSize;

  // ─── Load GLB ───────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(glbPath);
        if (cancelled) return;

        const loadedScene = gltf.scene;

        // Swap glasses texture to match the noun's glasses trait (same as CuratedHead).
        // The GLB's built-in GlassesUV mesh is the correct one — it's already positioned
        // at the front of the head. The background body's voxel glasses are hidden in mesh mode.
        const isHipRose = glassesIndex === 0;
        if (isHipRose) {
          // Hip-rose has a unique thicker shape the GLB can't represent — hide GLB glasses
          loadedScene.traverse(child => {
            if (child.name === 'GlassesUV' || child.name.toLowerCase().includes('glasses')) {
              child.visible = false;
            }
          });
        } else {
          const glassesTexUrl = `/models/heads/glasses-textures/${glassesIndex}.png`;
          const texLoader = new THREE.TextureLoader();
          const glassesTex = await texLoader.loadAsync(glassesTexUrl);
          glassesTex.magFilter = THREE.NearestFilter;
          glassesTex.minFilter = THREE.NearestFilter;
          glassesTex.colorSpace = THREE.SRGBColorSpace;
          loadedScene.traverse(child => {
            if (child.name === 'GlassesUV' || child.name.toLowerCase().includes('glasses')) {
              const mesh = child as THREE.Mesh;
              const mat = mesh.material as THREE.MeshStandardMaterial;
              if (mat?.map) {
                glassesTex.flipY = mat.map.flipY;
                mat.map.dispose();
                mat.map = glassesTex;
                mat.side = THREE.FrontSide;
                mat.depthWrite = true;
                mat.polygonOffset = true;
                mat.polygonOffsetFactor = -4;
                mat.polygonOffsetUnits = -4;
                mat.needsUpdate = true;
              }
              mesh.renderOrder = 1;
              mesh.position.z += 0.08;
            }
          });
        }

        // Apply head offset — use per-head nudge when provided, else fixed base
        const off = headOffset ?? HEAD_OFFSET;
        const matrix = new THREE.Matrix4();
        matrix.makeTranslation(off[0], off[1], off[2]);

        // Find the main head mesh for editing
        let headMesh: THREE.Mesh | null = null;

        loadedScene.traverse(child => {
          if ((child as THREE.Mesh).isMesh && child.visible) {
            const mesh = child as THREE.Mesh;
            mesh.geometry?.applyMatrix4(matrix);

            const isGlasses =
              mesh.name === 'GlassesUV' || mesh.name.toLowerCase().includes('glasses');

            // The head mesh is the largest non-glasses mesh
            if (!headMesh && !isGlasses) {
              headMesh = mesh;
            }
          }
        });

        loadedScene.position.set(0, 0, 0);
        loadedScene.scale.set(1, 1, 1);
        loadedScene.updateMatrixWorld(true);

        if (cancelled) return;

        if (headMesh) {
          const geo = (headMesh as THREE.Mesh).geometry;

          // Bake texture colors into vertex colors for painting
          const headMat = (headMesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (!geo.attributes.color && headMat.map && geo.attributes.uv) {
            // Sample the texture at each vertex's UV coordinate
            const map = headMat.map;
            const uv = geo.attributes.uv;
            const count = geo.attributes.position.count;
            const colors = new Float32Array(count * 3);

            // Draw texture to a canvas for pixel sampling
            const img = map.image as HTMLImageElement;
            const texCanvas = document.createElement('canvas');
            const texW = img.width || img.naturalWidth || 32;
            const texH = img.height || img.naturalHeight || 32;
            texCanvas.width = texW;
            texCanvas.height = texH;
            const ctx = texCanvas.getContext('2d')!;
            ctx.drawImage(img as CanvasImageSource, 0, 0, texW, texH);
            const imgData = ctx.getImageData(0, 0, texW, texH);

            for (let i = 0; i < count; i++) {
              const u = uv.getX(i);
              const v = uv.getY(i);
              // UV to pixel coords — respect texture flipY setting
              const px = Math.min(Math.max(Math.floor(u * texW), 0), texW - 1);
              // GLB textures have flipY=false by default (origin at top-left)
              const py = map.flipY
                ? Math.min(Math.max(Math.floor((1 - v) * texH), 0), texH - 1)
                : Math.min(Math.max(Math.floor(v * texH), 0), texH - 1);
              const idx = (py * texW + px) * 4;
              // sRGB to linear
              const r = imgData.data[idx] / 255;
              const g = imgData.data[idx + 1] / 255;
              const b = imgData.data[idx + 2] / 255;
              colors[i * 3] = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
              colors[i * 3 + 1] = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
              colors[i * 3 + 2] = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
            }

            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          } else if (!geo.attributes.color) {
            // No texture and no vertex colors — fill white
            const count = geo.attributes.position.count;
            const colors = new Float32Array(count * 3);
            colors.fill(1.0);
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          }

          // Ensure index exists (needed for adjacency graph)
          if (!geo.index) {
            // Non-indexed geometry — create trivial index
            const count = geo.attributes.position.count;
            const indices = new Uint32Array(count);
            for (let i = 0; i < count; i++) indices[i] = i;
            geo.setIndex(new THREE.BufferAttribute(indices, 1));
          }

          // Build adjacency graph
          const adjacency = buildAdjacencyGraph(geo);

          // Initialize edit state
          const state = initEditState(geo, adjacency);

          // Load saved deltas
          if (persistenceKey) {
            const savedDeltas = loadFromLocalStorage(persistenceKey);
            if (savedDeltas) {
              applyDeltas(state, savedDeltas);
            }
          }

          // Add per-vertex visibility attribute (for face deletion)
          const visArr = new Float32Array(geo.attributes.position.count);
          visArr.fill(1.0);
          geo.setAttribute('visible', new THREE.BufferAttribute(visArr, 1));

          editStateRef.current = state;
          setEditableGeometry(geo);

          // Switch material to meshLambertMaterial with vertex colors + visibility discard
          const editMat = new THREE.MeshLambertMaterial({ vertexColors: true });
          editMat.onBeforeCompile = shader => {
            // Inject per-vertex visibility into the shader
            shader.vertexShader = shader.vertexShader.replace(
              'void main() {',
              'attribute float visible;\nvarying float vVisible;\nvoid main() {\n  vVisible = visible;',
            );
            shader.fragmentShader = shader.fragmentShader.replace(
              'void main() {',
              'varying float vVisible;\nvoid main() {\n  if (vVisible < 0.5) discard;',
            );
          };
          (headMesh as THREE.Mesh).material = editMat;
        }

        setScene(loadedScene);
        if (sceneRef) sceneRef.current = loadedScene;
      } catch (err) {
        console.error('[EditableMeshScene] Failed to load GLB:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [glbPath, glassesIndex, persistenceKey]);

  // ─── Glasses visibility toggle ──────────────────────────────────────────
  // Hip-rose (index 0) keeps GLB glasses hidden regardless — voxel glasses in
  // EditableBackgroundBody handle that trait.
  useEffect(() => {
    if (!scene) return;
    const isHipRose = glassesIndex === 0;
    scene.traverse(child => {
      if (child.name === 'GlassesUV' || child.name.toLowerCase().includes('glasses')) {
        child.visible = !isHipRose && glassesVisible;
      }
    });
  }, [scene, glassesVisible, glassesIndex]);

  // ─── Undo/Redo Handlers ─────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    const state = editStateRef.current;
    if (!state) return;
    const result = historyUndo(historyRef.current, state);
    if (result) {
      historyRef.current = result;
      onStateChange?.();
      scheduleSave();
    }
  }, [onStateChange]);

  const handleRedo = useCallback(() => {
    const state = editStateRef.current;
    if (!state) return;
    const result = historyRedo(historyRef.current, state);
    if (result) {
      historyRef.current = result;
      onStateChange?.();
      scheduleSave();
    }
  }, [onStateChange]);

  // Expose undo/redo to parent via refs
  useEffect(() => {
    if (undoRef) undoRef.current = handleUndo;
    if (redoRef) redoRef.current = handleRedo;
    return () => {
      if (undoRef) undoRef.current = null;
      if (redoRef) redoRef.current = null;
    };
  }, [handleUndo, handleRedo, undoRef, redoRef]);

  // ─── Auto-Save ──────────────────────────────────────────────────────────

  const scheduleSave = useCallback(() => {
    if (!persistenceKey) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const state = editStateRef.current;
      if (state) {
        saveToLocalStorage(persistenceKey, glbPath, state);
      }
    }, 500);
  }, [persistenceKey, glbPath]);

  // ─── Paint Operation ────────────────────────────────────────────────────

  const doPaint = useCallback(
    (
      faceIndex: number,
      hitPoint?: THREE.Vector3,
      faceNormal?: THREE.Vector3,
      isVoxelHit?: boolean,
    ) => {
      const state = editStateRef.current;
      if (!state) return;

      const tool = toolRef.current;
      const color = colorRef.current;
      const size = brushRef.current;

      // Push undo snapshot before first paint stroke
      if (lastPaintedFace.current === -1) {
        historyRef.current = pushSnapshot(historyRef.current, state);
      }

      // If we hit a placed voxel, eraser removes it
      if (isVoxelHit && tool === 'eraser' && hitPoint) {
        const vx = Math.round(hitPoint.x);
        const vy = Math.round(hitPoint.y);
        const vz = Math.round(hitPoint.z);
        removeVoxel(state, [vx, vy, vz]);
        setBuildVersion(v => v + 1);
        lastPaintedFace.current = faceIndex;
        onStateChange?.();
        scheduleSave();
        return;
      }

      // Build tool: place voxel on mesh surface
      if (tool === 'build' && hitPoint && faceNormal) {
        const pos = computeBuildPosition(state, faceIndex, hitPoint, faceNormal);
        placeVoxelBlock(state, pos, size, color);
        setBuildVersion(v => v + 1);
        lastPaintedFace.current = faceIndex;
        onStateChange?.();
        scheduleSave();
        return;
      }

      // Mesh face operations
      if (faceIndex < 0 || faceIndex >= state.faceCount) return;

      switch (tool) {
        case 'pencil': {
          const linearColor = hexToLinear(color);
          paintBrush(state, faceIndex, size, linearColor);
          state.geometry.attributes.color.needsUpdate = true;
          break;
        }
        case 'eraser': {
          deleteBrush(state, faceIndex, size);
          state.geometry.attributes.visible.needsUpdate = true;
          break;
        }
        case 'fill': {
          const linearColor = hexToLinear(color);
          floodFillMesh(state, faceIndex, linearColor);
          state.geometry.attributes.color.needsUpdate = true;
          break;
        }
        case 'eyedropper': {
          const hex = eyedropFace(state, faceIndex);
          onColorPick(hex);
          return;
        }
      }

      lastPaintedFace.current = faceIndex;
      onStateChange?.();
      scheduleSave();
    },
    [onColorPick, onStateChange, scheduleSave],
  );

  // ─── Pointer Handlers ───────────────────────────────────────────────────

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (interactionMode !== 'sculpt') return;
      e.stopPropagation();

      const worldNormal = e.face?.normal
        ? e.face.normal.clone().transformDirection(e.object.matrixWorld).normalize()
        : undefined;

      // Right-click = build shortcut (regardless of current tool)
      if (e.button === 2 && e.point && worldNormal && e.faceIndex != null) {
        const state = editStateRef.current;
        if (state) {
          historyRef.current = pushSnapshot(historyRef.current, state);
          const pos = computeBuildPosition(state, e.faceIndex, e.point, worldNormal);
          placeVoxelBlock(state, pos, brushRef.current, colorRef.current);
          setBuildVersion(v => v + 1);
          onStateChange?.();
          scheduleSave();
        }
        return;
      }

      if (e.button !== 0) return; // left click only

      isPointerDown.current = true;
      lastPaintedFace.current = -1; // reset for new stroke

      if (e.faceIndex != null) {
        doPaint(e.faceIndex, e.point, worldNormal);
      }
    },
    [interactionMode, doPaint, onStateChange, scheduleSave],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // Hover highlight
      if (e.faceIndex != null && editStateRef.current) {
        const faces = expandBrush(e.faceIndex, brushRef.current, editStateRef.current.adjacency);
        setHoveredFaces(faces);
      }

      // Drag painting
      if (isPointerDown.current && interactionMode === 'sculpt') {
        if (e.faceIndex != null && e.faceIndex !== lastPaintedFace.current) {
          doPaint(e.faceIndex);
        }
      }
    },
    [interactionMode, doPaint],
  );

  const onPointerUp = useCallback(() => {
    isPointerDown.current = false;
    lastPaintedFace.current = -1;
  }, []);

  const onPointerLeave = useCallback(() => {
    setHoveredFaces(null);
    if (isPointerDown.current) {
      isPointerDown.current = false;
      lastPaintedFace.current = -1;
    }
  }, []);

  // ─── Global pointer up (in case pointer leaves the canvas) ──────────────

  useEffect(() => {
    const handleGlobalUp = () => {
      isPointerDown.current = false;
      lastPaintedFace.current = -1;
    };
    window.addEventListener('pointerup', handleGlobalUp);
    return () => window.removeEventListener('pointerup', handleGlobalUp);
  }, []);

  // ─── Build Voxels State ──────────────────────────────────────────────────

  const [buildVersion, setBuildVersion] = useState(0);

  const buildVoxelEntries = useMemo(() => {
    const state = editStateRef.current;
    if (!state || state.buildVoxels.size === 0) return [];
    return Array.from(state.buildVoxels.entries()).map(([key, hex]) => {
      const [x, y, z] = parseVoxelKey(key);
      const linear = hexToLinear(hex);
      return { x, y, z, r: linear[0], g: linear[1], b: linear[2] };
    });
  }, [buildVersion]); // buildVersion triggers recompute when voxels change

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!scene) return null;

  return (
    <>
      <EditOrbitControls interactionMode={interactionMode} viewStateRef={viewStateRef} />

      <group
        visible={headVisible}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        <primitive object={scene} />
      </group>

      {/* Placed voxel cubes */}
      {buildVoxelEntries.length > 0 && <BuildVoxelsMesh entries={buildVoxelEntries} />}

      {interactionMode === 'sculpt' && (
        <BrushHighlight
          geometry={editableGeometry}
          hoveredFaces={hoveredFaces}
          adjacency={editStateRef.current?.adjacency ?? null}
        />
      )}

      {snapshotRef && <SnapshotExporter snapshotRef={snapshotRef} />}
    </>
  );
}

// ─── Snapshot Exporter ─────────────────────────────────────────────────────

function SnapshotExporter({
  snapshotRef,
}: {
  snapshotRef: React.MutableRefObject<(() => string | null) | null>;
}) {
  const { gl, scene: threeScene, camera } = useThree();

  useEffect(() => {
    snapshotRef.current = () => {
      try {
        gl.render(threeScene, camera);
        return gl.domElement.toDataURL('image/png');
      } catch {
        return null;
      }
    };
    return () => {
      snapshotRef.current = null;
    };
  }, [gl, threeScene, camera, snapshotRef]);

  return null;
}

// ─── Build Voxels Renderer ────────────────────────────────────────────────

const BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

function BuildVoxelsMesh({
  entries,
}: {
  entries: { x: number; y: number; z: number; r: number; g: number; b: number }[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const color = new THREE.Color();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      dummy.position.set(e.x, e.y, e.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.setRGB(e.r, e.g, e.b);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [entries, dummy]);

  return (
    <instancedMesh ref={meshRef} args={[BOX_GEO, undefined, Math.max(entries.length, 1)]}>
      <meshLambertMaterial vertexColors={false} />
    </instancedMesh>
  );
}
