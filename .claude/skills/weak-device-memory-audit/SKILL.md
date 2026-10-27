---
name: weak-device-memory-audit
description: Find out why a web game / 3D page crashes or reloads on cheap phones (4 GB Android, Mali-G52 class) by emulating the device headless, measuring JS heap, GPU texture and geometry memory, and comparing builds side by side (old vs new via a git worktree). Use when a user says the site crashed on their phone, before blaming the newest feature.
---

# Weak-device memory audit

A tab that dies on a phone is usually out of memory. Don't guess which feature did it: measure the build before and after.

## 1. Two builds side by side

```bash
git worktree add --detach $SCRATCH/old-main <commit-before>
ln -s $REPO/packages/app/node_modules $SCRATCH/old-main/packages/app/node_modules
ln -s $REPO/node_modules $SCRATCH/old-main/node_modules
```

Then give each its own vite config (root + port) and dev server.

## 2. Emulate the phone

Playwright context:
- `viewport {412, 915}`, `deviceScaleFactor 2.6`, `isMobile`, `hasTouch`;
- an Android user agent naming the model (e.g. `moto g06`), so the app's device-tier code takes its weak path;
- Chromium args `--enable-precise-memory-info --js-flags=--expose-gc`.

## 3. Measure after the scene settles

Step the game a few hundred frames, wait, `gc()`, then read:
- `performance.memory.usedJSHeapSize`;
- the renderer's `info.memory` (geometries, textures);
- traverse the scene for unique geometries: sum attribute and index `byteLength`, triangles, mesh count;
- unique textures: `w × h × 4 × 1.33` (mips);
- the quality tier and weak flag the app actually chose.

Run it for the old build, the new build, and the specific mode the user opened (e.g. `?play=hideseek`).

## 4. Read it

- **On 2026-10-27:**

  | | JS heap | Textures | Meshes |
  |---|---|---|---|
  | Old build | 266 MB | 134 MB | 1,157 |
  | New build | 280 MB | 137 MB | 1,245 |
  | Hide & seek open | 284 MB | 137 MB | 1,312 |

  The new batch only added ~5%: the world itself was too heavy for 4 GB. Report that honestly rather than reverting the latest feature.
- **The usual big holders:**
  - full-size textures kept even on weak devices;
  - CPU copies of images after upload;
  - per-instance cloned materials / textures;
  - big models (a 63 MB TTS voice) loaded eagerly;
  - decoded audio up front.

## 5. The fix pattern that worked (texture diet)

- Weak device only:
  - cap uploads at 512 px;
  - shrink static textures to 256 px on the CPU before upload;
  - smaller env map and shadow map;
  - one video texture, not many;
  - reload once on a lost WebGL context.
- A dev-only budget warning so a future feature can't silently double it.
- Desktop and normal phones are untouched.
- Measured result: GL textures ~130 → ~36 MB on the emulated Moto G06.

Big investigations like this go to their own cloud session (see `cloud-session-fanout`) with the measured numbers pasted in the brief.
