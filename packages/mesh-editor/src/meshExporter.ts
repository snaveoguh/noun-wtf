/**
 * meshExporter — Export modified mesh as GLB via Three.js GLTFExporter.
 */
import type * as THREE from 'three';

/**
 * Export a Three.js scene/object as a binary GLB blob.
 * Lazy-loads the GLTFExporter to avoid bundling it when not needed.
 */
export async function exportToGLB(object: THREE.Object3D): Promise<Blob> {
  // @ts-expect-error — types at three/examples/jsm, runtime at three/addons
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();

  return new Promise<Blob>((resolve, reject) => {
    exporter.parse(
      object,
      (result: ArrayBuffer) => {
        resolve(new Blob([result], { type: 'model/gltf-binary' }));
      },
      (error: Error) => {
        reject(error);
      },
      { binary: true },
    );
  });
}

/**
 * Trigger a download of a Blob as a file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export a Three.js object as STL (binary, 3D-printer-ready).
 */
export async function exportToSTL(object: THREE.Object3D): Promise<Blob> {
  // @ts-expect-error — types at three/examples/jsm, runtime at three/addons
  const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
  const exporter = new STLExporter();
  const buffer = exporter.parse(object, { binary: true });
  return new Blob([buffer], { type: 'model/stl' });
}

/**
 * Export a Three.js object as OBJ.
 */
export async function exportToOBJ(object: THREE.Object3D): Promise<Blob> {
  // @ts-expect-error — types at three/examples/jsm, runtime at three/addons
  const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
  const exporter = new OBJExporter();
  const result = exporter.parse(object);
  return new Blob([result], { type: 'model/obj' });
}

/**
 * Export and download a mesh as GLB.
 */
export async function downloadAsGLB(object: THREE.Object3D, filename: string): Promise<void> {
  const blob = await exportToGLB(object);
  downloadBlob(blob, filename);
}

/**
 * Export and download a mesh as STL (3D printer ready).
 */
export async function downloadAsSTL(object: THREE.Object3D, filename: string): Promise<void> {
  const blob = await exportToSTL(object);
  downloadBlob(blob, filename);
}

/**
 * Export and download a mesh as OBJ.
 */
export async function downloadAsOBJ(object: THREE.Object3D, filename: string): Promise<void> {
  const blob = await exportToOBJ(object);
  downloadBlob(blob, filename);
}
