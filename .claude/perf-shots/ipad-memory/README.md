# iPad black screens + crashes, and the desktop "freezes on the book", 2026-11-02 (branch `claude/tablet-stalls`, after #246)

Two owner reports:
- **iPad:** "keeps turning all things black and removing heads just noggles, and crashes on ipad frequently".
- **Mac, Brave:** the CAMP intro "consistently freezes on the book". In the screenshot the B&W grade is still on, the book's pages are white, and the HUD and spray panel still work.

## Method

- **`glmem.js`** is injected before any page script. It wraps `texImage2D` / `texStorage2D` / `copyTexImage2D` / `renderbufferStorage(Multisample)` / `bufferData` and the matching deletes, and keeps a live table of every GL allocation in true bytes (format × size, + ⅓ for mips, × samples).
  - It also counts live canvases (WeakRef census, grouped by size and creator) and ImageBitmaps.
  - `__glattrib()` names each texture or render target by the shortest path to it from `window.__w2` (e.g. `game.camp.built.art.texture`).
- **`mem.cjs`** drives the browser:
  - `session`: Playwright WebKit as an iPad (1180×820 @2, iPadOS UA, touch). The real first load (CAMP intro + reading), the plaza, 16 riders, 3 rooms in and out, the mountain, mural mode, the plaza again. GL, canvas and bitmap bytes, `renderer.info` and the web process RSS at every step; the biggest allocations by name at the end.
  - `roomdiff`: what outlives three rooms.
  - `loss`: `WEBGL_lose_context` lose → restore at the plaza, with screenshots.
  - `ENGINE=chromium` runs desktop Retina (1440×900 @2).
- **`intro.cjs`** runs the real intro in desktop Chromium with real frames. It logs page errors and whether the canvas keeps drawing. `INJECT=n` makes the book's `hold()` throw after n seconds.

## What was wrong

1. **A lost WebGL context had no handler on iPad** (only weak phones reloaded). three restores what it can, but sources already shrunk or freed can't be re-uploaded.
   - Forced loss + restore at the plaza (`shots/base-loss-before.jpg` → `base-loss-restored.jpg`): the facades lose their colours and the rider's head texture changes. On a real iPad that's the black world with heads gone; iOS then kills the tab.
   - Chromium shows a blank canvas while the context is lost (`shots/chromium-context-lost.jpg`), not a frozen picture.
2. **Too much resident for an iPad tab.** The iPad tier held:
   - **GPU:** 211 MB GL at the plaza, 274 MB after a session.
   - **Canvases:** 68 → 129 MB, which on iOS are IOSurfaces too.
   - **ImageBitmaps:** 59 MB.

   The biggest items: the door-sign atlas, 2048² (28 MB GL + a 16 MB canvas kept forever); CAMP's art atlas, 2048×1792 (25 MB + 14 MB canvas); a 768×1024 half-float env map (6 + 3 MB). Every room left a few MB behind, and every Noun keeps a 512² body canvas + 576×256 head canvas (1.6 MB).
3. **Desktop freeze: an exception in a frame froze the canvas for good.** `Game.frame` asks for the next frame before it steps, so a throw repeats every frame: nothing draws again, the canvas keeps its last picture and React keeps going. A throw injected into the reading shot reproduces the owner's screenshot exactly: frames stuck at 127, intro stuck, HUD alive (`shots/intro-throw-before.jpg`).
   - The real intro in desktop Chromium through the reading ran clean (no error, frames kept coming), so Brave's specific trigger isn't known.
   - It isn't a context loss: Chromium blanks a lost canvas rather than freezing it.
   - It isn't a leak: the TripPass's feedback targets are freed when the trip ends.
   - Desktop Retina does hold a lot: 609 MB of GL at boot, 637 MB at the reading shot, ~680 MB by the second room (2048² lightmaps ×3, the two atlases, 2160×1350 half-float composer buffers, normal / SMAA / shadow targets).

## Changes

- **Context loss on every device** (`render/textureDiet.ts` `watchContextLoss`, from `Game` for all devices):
  - A notice ("Graphics memory ran out. Reloading lighter…"), then one reload.
  - The next page boots lighter (`bootsAfterLoss`, for 30 min): a phone / tablet takes the weak path (full texture diet, 0.75 scale, 512 shadow map); a desktop goes from High to Medium.
  - A second loss within 2 min shows a RELOAD button instead of looping (`lossAction`).
  - Never a black world.
- **The light diet** (`textureDiet.light`): every phone and tablet on auto `low` that isn't weak.
  - Uploads are capped at 1024 (`LIGHT_CAP`), and the env map bakes at 128.
  - CAMP's art atlas paints at half size.
  - The door-sign atlas's canvas is freed once uploaded (`releaseAfterUpload`).
  - Desktop is unchanged.
- **A frame that throws no longer freezes** (`core/frameGuard.ts`, `Game.frameFailed`): the error is caught, reported once per message (`perf.extra.frameError`), and the frame is still drawn. The first error also ends the CAMP intro (`CampSystem.abortIntro`: grade out, camera back, even if ending it throws).

## Before / after (iPad, WebKit, 2×)

| step | GL before → after (MB) | canvases before → after (MB) |
|---|---|---|
| boot | 155 → 147 | 70 → 47 |
| CAMP intro + reading | 210 → **160** | 68 → **45** |
| plaza | 211 → **161** | 68 → **45** |
| 16 riders | 212 → 168 | 94 → 71 |
| after 3 rooms | 270 → **201** | 127 → 100 |
| end of session | 274 → **213** | 129 → **97** |

The biggest items after: three 1024² lightmaps (7 MB each), the sign atlas at 1024² (7 MB, canvas freed), CAMP art at 1024×896 (6 MB), the shadow map (8 MB).

**Context loss at the plaza:**
- **Before:** three restores in place; facades and heads come back wrong; 1 page load.
- **After:** notice, reload (2 loads), boots `low (weak) (after a lost context)` with a 512 shadow map, ~49 MB GL a few seconds into the reload.

**Intro throw (desktop Chromium, `INJECT=2`):**
- **Before:** frames stuck at 127 for good, intro stuck.
- **After:** 1 error caught, the intro ends, frames keep coming (150 → 581 over 21 s; `shots/intro-throw-after.jpg`).

Desktop memory isn't changed in this pass (data in `data/mem-desk-base.json`).

## Re-running

```bash
S=<scratch>; M=.claude/perf-shots/ipad-memory
node .claude/perf-shots/harness/serve.cjs $S/build 5302 &
node $M/mem.cjs http://127.0.0.1:5302 $S/mem.json                    # iPad session
URLX="&camintro=0&spawn=plaza" SHOTS=$S node $M/mem.cjs http://127.0.0.1:5302 $S/loss.json loss
node $M/mem.cjs http://127.0.0.1:5302 $S/rooms.json roomdiff
ENGINE=chromium node $M/mem.cjs http://127.0.0.1:5302 $S/desk.json  # desktop Retina
INJECT=2 SECS=24 node $M/intro.cjs http://127.0.0.1:5302              # a throw in the intro
```

WebKit setup is in `../tablet/README.md`. Software GL keeps its copies in process memory, so RSS here isn't an iPad number; the GL table is.

## Next

- **A real iPad run** with Web Inspector's memory timeline, to see the real per-tab limit.
- **Every Noun keeps its body + head canvases** (~1.6 MB each) for possible re-uploads. With reload-on-loss these could be freed too, if the shared head cache stops disposing textures it might hand out again.
- **Desktop High** at Retina is ~640 MB of GL at the intro. Halving the 2048² lightmaps on Medium, or capping the composer at half-float only on High, would cut it.
- **Brave's own trigger** is still unknown. The game now reports it (`perf.extra.frameError`, console) instead of freezing; a `?perf=1` screenshot from the owner would name it.
