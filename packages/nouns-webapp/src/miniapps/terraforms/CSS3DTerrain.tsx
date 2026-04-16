/**
 * CSS3DTerrain — Renders live animated tokenHTML iframes in 3D space
 * using Three.js CSS3DRenderer, synced with the R3F WebGL camera.
 *
 * This layer overlays the WebGL terrain atlas, showing the actual
 * onchain animated art for the nearest parcels. Perfect rendering —
 * real HTML, real fonts, real animation.
 *
 * Usage: Mount as a sibling to the R3F Canvas, passing the same
 * container ref and camera state.
 */
import { FC, useEffect, useRef } from 'react';

import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ParcelData {
  tokenId: number;
  level: number;
  x: number;
  y: number;
  elevation: number;
  sx: number;
  sy: number;
  sz: number;
  zoneName: string;
  color: string;
}

interface TerrainData {
  v: number;
  count: number;
  tokens: Record<string, [string, string[], string, Record<string, string>]>;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_CSS3D_PARCELS = 6;
const CSS3D_DISTANCE = 20;
const PARCEL_SCALE = 0.003; // scale down the 388px iframe to fit parcel size (~1.2 units)

const rpcClient = createPublicClient({
  chain: mainnet,
  transport: http(import.meta.env.VITE_MAINNET_JSONRPC || 'https://ethereum-rpc.publicnode.com'),
});

const TF_ADDR = '0x4E1f41613c9084FdB9E34E11fAE9412427480e56' as const;
const TF_HTML_ABI = [{
  name: 'tokenHTML', type: 'function', stateMutability: 'view' as const,
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'string' }],
}] as const;

// ─── HTML cache ────────────────────────────────────────────────────────────

const htmlCache = new Map<number, string>();

async function getTokenHTML(tokenId: number): Promise<string | null> {
  if (htmlCache.has(tokenId)) return htmlCache.get(tokenId)!;
  try {
    const html = await rpcClient.readContract({
      address: TF_ADDR, abi: TF_HTML_ABI,
      functionName: 'tokenHTML', args: [BigInt(tokenId)],
    });
    htmlCache.set(tokenId, html);
    // Keep cache bounded
    if (htmlCache.size > 30) {
      const oldest = htmlCache.keys().next().value;
      if (oldest !== undefined) htmlCache.delete(oldest);
    }
    return html;
  } catch {
    return null;
  }
}

// ─── CSS3D Layer Component ─────────────────────────────────────────────────

export const CSS3DTerrainLayer: FC<{
  containerRef: React.RefObject<HTMLDivElement | null>;
  camera: THREE.Camera | null;
  parcels: ParcelData[];
  terrainData: TerrainData | null;
  normalization: { cx: number; cy: number; cz: number; scale: number };
}> = ({ containerRef, camera, parcels, terrainData, normalization }) => {
  const rendererRef = useRef<CSS3DRenderer | null>(null);
  const sceneRef = useRef(new THREE.Scene());
  const objectsRef = useRef(new Map<number, CSS3DObject>());
  const nearRef = useRef<number[]>([]);
  const rafRef = useRef<number>(0);

  // Initialize CSS3DRenderer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new CSS3DRenderer();
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.pointerEvents = 'none';
    renderer.domElement.style.zIndex = '1';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Handle resize
    const ro = new ResizeObserver(() => {
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      container.removeChild(renderer.domElement);
      rendererRef.current = null;
      // Clean up all CSS3D objects
      objectsRef.current.forEach((obj) => {
        sceneRef.current.remove(obj);
        obj.element.remove();
      });
      objectsRef.current.clear();
    };
  }, [containerRef]);

  // Animation loop: sync CSS3D with WebGL camera + manage near parcels
  useEffect(() => {
    if (!camera || !rendererRef.current) return;

    const { cx, cy, cz, scale } = normalization;

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const renderer = rendererRef.current;
      if (!renderer || !camera) return;

      // Render the CSS3D scene with the same camera
      renderer.render(sceneRef.current, camera);

      // Find nearest parcels
      const camPos = camera.position;
      const scored: [ParcelData, number][] = [];
      for (const p of parcels) {
        if (!terrainData?.tokens[p.tokenId]) continue;
        const px = (p.sx - cx) * scale;
        const py = (p.sy - cy) * scale;
        const pz = (p.sz - cz) * scale;
        const dist = Math.sqrt(
          (camPos.x - px) ** 2 + (camPos.y - py) ** 2 + (camPos.z - pz) ** 2,
        );
        if (dist < CSS3D_DISTANCE) scored.push([p, dist]);
      }
      scored.sort((a, b) => a[1] - b[1]);
      const nearest = scored.length >= 3
        ? scored.slice(0, MAX_CSS3D_PARCELS).map(s => s[0])
        : [];

      const nearIds = nearest.map(p => p.tokenId);
      const prevIds = nearRef.current;

      // Only update if the set changed
      if (nearIds.join(',') !== prevIds.join(',')) {
        nearRef.current = nearIds;

        // Remove parcels no longer near
        for (const id of prevIds) {
          if (!nearIds.includes(id) && objectsRef.current.has(id)) {
            const obj = objectsRef.current.get(id)!;
            sceneRef.current.remove(obj);
            obj.element.remove();
            objectsRef.current.delete(id);
          }
        }

        // Add new near parcels
        for (const p of nearest) {
          if (objectsRef.current.has(p.tokenId)) continue;
          // Create iframe for this parcel
          createParcelCSS3D(p, normalization).then(obj => {
            if (!obj) return;
            // Check it's still needed
            if (!nearRef.current.includes(p.tokenId)) {
              obj.element.remove();
              return;
            }
            objectsRef.current.set(p.tokenId, obj);
            sceneRef.current.add(obj);
          });
        }
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [camera, parcels, terrainData, normalization]);

  return null; // Renders via CSS3DRenderer, not React DOM
};

// ─── Create CSS3D iframe for one parcel ────────────────────────────────────

async function createParcelCSS3D(
  parcel: ParcelData,
  normalization: { cx: number; cy: number; cz: number; scale: number },
): Promise<CSS3DObject | null> {
  const html = await getTokenHTML(parcel.tokenId);
  if (!html) return null;

  const { cx, cy, cz, scale } = normalization;
  const px = (parcel.sx - cx) * scale;
  const py = (parcel.sy - cy) * scale;
  const pz = (parcel.sz - cz) * scale;

  // Create iframe element
  const iframe = document.createElement('iframe');
  iframe.style.width = '388px';
  iframe.style.height = '388px'; // square crop
  iframe.style.border = 'none';
  iframe.style.overflow = 'hidden';
  iframe.style.background = 'transparent';
  iframe.style.pointerEvents = 'none';
  iframe.sandbox.add('allow-scripts', 'allow-same-origin');
  iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;overflow:hidden;background:transparent;width:100%;height:100%}
    .r{background-color:transparent !important}
  </style></head><body>${html}</body></html>`;

  // Wrap in CSS3DObject
  const obj = new CSS3DObject(iframe);
  obj.position.set(px, py + 0.05, pz);
  obj.rotation.set(-Math.PI / 2, 0, 0); // face up
  obj.scale.setScalar(PARCEL_SCALE); // scale 388px down to ~1.2 scene units

  return obj;
}

export default CSS3DTerrainLayer;
