# @nouns/graffiti

A cross-platform spray-paint engine. Runs inside any React + Three.js scene on the web today; the core types are pure TypeScript so visionOS/Swift can re-implement the same protocol and render identically.

Headline brushes: **spray** (gaussian falloff + drips-on-hold), **marker** (feathered fat line), **skinny** (precision outline).

## Quick start (R3F)

```tsx
import { Canvas } from '@react-three/fiber';
import { Paintable } from '@nouns/graffiti/r3f';
import { PaintHUD } from '@nouns/graffiti/ui';
import { handleIncoming, sendSnapshot } from '@nouns/graffiti';

function MyScene() {
  return (
    <>
      <Canvas>
        <ambientLight />
        <Paintable
          surfaceId="wall-01"
          width={4}
          height={3}
          position={[0, 2, -3]}
          authorId={myWallet}
          onStrokeEnd={() => sendSnapshot(ws, 'wall-01', myWallet)}
        />
      </Canvas>
      <PaintHUD open={paintOpen} onClose={() => setPaintOpen(false)} />
    </>
  );
}

// On any incoming WS message:
ws.addEventListener('message', e => handleIncoming(e.data));
```

Surfaces are registered in a global registry keyed by `surfaceId`. Pointer events on the plane are converted to UVs, fed into `paintSession.addPoint()`, and rasterized with the active brush. A `THREE.CanvasTexture` flushes at most once per frame via `useFrame` so you never burn perf on redundant uploads.

## Architecture

```
src/
  core/          — pure TS: types, Stroke, Surface, registry, store, protocol
  brushes/       — pure functions (applySpray, applyMarker, applySkinny)
  adapters/r3f/  — Paintable, PaintCursor, usePaintSession, useSurface
  ui/            — ColorWheel, BrushTray, PaintHUD
  persistence/   — partykit (WS adapter), snapshot (PNG export)
  demo/          — StandaloneDemoScene + StandaloneDemoHUD
```

Import from specific subpaths to keep DOM/Three.js out of your non-UI code:

| import | pulls in |
| --- | --- |
| `@nouns/graffiti` | core + persistence (needs DOM Canvas) |
| `@nouns/graffiti/core` | **pure TS, zero deps** |
| `@nouns/graffiti/brushes` | DOM Canvas only |
| `@nouns/graffiti/r3f` | React, Three.js, @react-three/fiber |
| `@nouns/graffiti/ui` | React |

## The Stroke primitive

```ts
interface Stroke {
  id: string;
  surfaceId: string;
  brush: 'spray' | 'marker' | 'skinny';
  color: string;     // hex
  size: number;      // surface-space radius
  points: Array<{ u: number; v: number; pressure: number; t: number }>;
  authorId?: string;
  startedAt: number; // epoch ms
}
```

A stroke is the replayable unit. `applyStroke(stroke, ctx, w, h)` produces identical pixels anywhere it runs (brushes use a PRNG seeded from the stroke id). **Sync ships strokes, not pixels.**

## Wire protocol

All messages are JSON.

```ts
// Live multiplayer
{ type: 'graffiti:stroke', stroke: Stroke }
{ type: 'graffiti:stroke:batch', surfaceId: string, strokes: Stroke[] }

// Cold-start loading / compaction
{ type: 'graffiti:snapshot:request', surfaceId: string, sinceWatermark?: string }
{ type: 'graffiti:snapshot',
  surfaceId: string,
  pngBase64: string,       // baked baseline
  strokesSince?: Stroke[], // strokes applied on top, not yet baked
  watermark?: string }
```

Legacy shapes `world:graffiti:save`, `world:graffiti:load`, `world:graffiti:tags` are still accepted and promoted into snapshots automatically via `handleIncoming`. Outgoing writes use `snapshotToLegacySave` so current servers stay working without changes.

## visionOS contract

Swift must implement, per surface:

1. **Ray → UV**: intersect the hand-pinch ray with the textured plane, yield `(u, v)` in 0..1.
2. **StrokePoint emission**: emit `StrokePoint { u, v, pressure, t }` at ≥60Hz while pinch is held. Pressure can be derived from pinch-strength or defaulted to 1.
3. **Rasterize** the stroke to a `MTLTexture` / `CGImage` using the same brush math (`brushes/spray.ts` is ~110 LOC and translates directly to Core Graphics; the gaussian droplet emission + drip-on-hold heuristic are the only two non-trivial steps).
4. **Send** `{ type: 'graffiti:stroke', stroke }` on the shared WS channel.
5. **Receive** `graffiti:stroke` / `graffiti:snapshot` and apply identically.

All wire shapes live in `src/core/protocol.ts` with no DOM references, and all brush math lives in `src/brushes/*` with no closures or external state — straightforward to port.

## Surfaces, layering, undo

- `surfaces.getOrCreate(id, w, h)` returns a `Surface` whose `canvas` is an `HTMLCanvasElement`.
- Strokes composite on top (`globalCompositeOperation` defaults to `source-over`), so existing tags are preserved.
- `surface.undoLast(rasterize)` pops the newest stroke and replays the baseline + remaining strokes into a cleared canvas.
- `surface.applyBaseline(pngUrl)` sets a server-side baked image and keeps in-flight strokes on top.

## Why a canvas (not DataTexture)

`THREE.CanvasTexture` uploads only when `needsUpdate = true`, and the browser optimizes `getContext('2d')` heavily. `DataTexture` would need a per-pixel RGBA buffer we'd have to repopulate manually for every paint tick. Tests showed 4–6× overhead vs. CanvasTexture.

## Performance notes

- Spray brush resamples between points to fill gaps (up to `0.35 × size` per step).
- Textures flush at most once per `useFrame` tick (~16ms at 60Hz).
- Marker/skinny repaint the full path each point since bezier smoothing must be continuous — cheap because they're a single `stroke()` call.
- Default texture sizes: `1024×512` wide, `512×1024` tall, `512×512` square — configurable.

## License

Same as the rest of the repo.
