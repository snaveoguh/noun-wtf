// ── Shader warm-up: link programs before they're first drawn ────────────
//
// three links a material's program the first time a mesh using it is
// drawn, and that draw blocks the main thread until the GPU process has
// compiled it (getProgramInfoLog / getUniforms wait on the link): 50–300
// ms per program on a Mali phone, mid-ride. Measured 2026-10-28 (?perf=1,
// weak profile): 9 first-sight links in 20 s of skating the plaza, 78 on
// walking into a room, 88 on the Big Drop, each one a dropped frame.
//
// - ShaderWarmer scans the scene about once a second for meshes whose
//   material has no program yet (streamed chunks, lazily built systems,
//   things still hidden or out of view) and issues their compile then, a
//   few at a time. The GPU process compiles them in the background, so by
//   the time they come into view the link is done.
// - warmHidden() is for a whole new set of meshes about to be revealed
//   (a room behind the door fade): it keeps the group hidden while
//   compileAsync waits on KHR_parallel_shader_compile, then shows it.
// - clearFog(): no fog without changing any program. `scene.fog = null`
//   flips the fog define on every material in view, so every one of them
//   relinks (the rider, particles, the room); FogExp2 at density 0 draws
//   exactly the same and keeps the programs.

import * as THREE from 'three';

/** Fog that isn't there: same programs as the outdoor FogExp2, factor 0. */
export function clearFog(color: THREE.ColorRepresentation = 0x000000): THREE.FogExp2 {
  return new THREE.FogExp2(color, 0);
}

type Drawable = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;

function isDrawable(o: THREE.Object3D): o is Drawable {
  const d = o as Partial<Drawable> & THREE.Object3D;
  return (
    (d as THREE.Mesh).isMesh === true ||
    (d as THREE.Points).isPoints === true ||
    (d as THREE.Line).isLine === true ||
    (d as THREE.Sprite).isSprite === true
  );
}

/** Minimal view of three's renderer internals the warmer needs. */
export interface WarmRenderer {
  properties: { get(o: object): unknown };
  compile(scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene | null): unknown;
}

/**
 * Objects under `root` with a material that has no program yet, at most
 * `max` of them (one per material: the first user of each).
 */
export function unwarmed(
  root: THREE.Object3D,
  hasProgram: (m: THREE.Material) => boolean,
  max: number,
): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse(o => {
    if (out.length >= max || !isDrawable(o)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m === undefined || m === null || seen.has(m)) continue;
      seen.add(m);
      if (!hasProgram(m)) {
        out.push(o);
        return;
      }
    }
  });
  return out;
}

/** Compile a list of objects as if they were one subtree of `scene`. */
function compileList(
  r: WarmRenderer,
  list: THREE.Object3D[],
  camera: THREE.Camera,
  scene: THREE.Scene,
) {
  // compile() only walks its first argument (traverse for materials,
  // traverseVisible for extra lights): a stand-in lists exactly these
  const stand = {
    traverse: (cb: (o: THREE.Object3D) => void) => {
      for (const o of list) cb(o);
    },
    traverseVisible: () => undefined,
  } as unknown as THREE.Object3D;
  r.compile(stand, camera, scene);
}

export class ShaderWarmer {
  /** Seconds between scans when there's nothing waiting. */
  static SCAN_S = 1;
  /** Seconds between batches while a backlog drains. */
  static BATCH_S = 0.2;
  /** Objects compiled per batch (each is ~1 ms of shader assembly). */
  static BATCH = 6;

  private t = 0.5;
  /** Programs issued so far (for ?perf=1). */
  issued = 0;

  constructor(
    private renderer: WarmRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    /** Runs the compile as the frame draws (Graphics.asDrawn: the right render target). */
    private asDrawn: <T>(fn: () => T) => T = fn => fn(),
  ) {}

  private hasProgram = (m: THREE.Material) =>
    (this.renderer.properties.get(m) as { currentProgram?: unknown }).currentProgram !== undefined;

  tick(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    const list = unwarmed(this.scene, this.hasProgram, ShaderWarmer.BATCH);
    this.t = list.length >= ShaderWarmer.BATCH ? ShaderWarmer.BATCH_S : ShaderWarmer.SCAN_S;
    if (list.length === 0) return;
    try {
      this.asDrawn(() => compileList(this.renderer, list, this.camera, this.scene));
      this.issued += list.length;
    } catch (err) {
      // Never let a warm-up break the frame: the draw will compile it anyway
      console.warn('[warm] compile failed', err);
      this.t = 10;
    }
  }
}

/**
 * Keep `group` hidden while its programs compile in the background, then
 * show it. Resolves when shown (after `timeoutMs` at the latest, so a
 * driver without KHR_parallel_shader_compile never holds it for long).
 */
export function warmHidden(
  renderer: THREE.WebGLRenderer,
  group: THREE.Object3D,
  camera: THREE.Camera,
  scene: THREE.Scene,
  asDrawn: <T>(fn: () => T) => T = fn => fn(),
  timeoutMs = 2500,
): Promise<void> {
  const was = group.visible;
  group.visible = false;
  return new Promise<void>(resolve => {
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      group.visible = was;
      resolve();
    };
    setTimeout(show, timeoutMs);
    try {
      asDrawn(() => renderer.compileAsync(group, camera, scene)).then(show, show);
    } catch {
      show();
    }
  });
}
