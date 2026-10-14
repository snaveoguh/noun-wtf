---
name: world-browser-test
description: Drive the noun.wtf webapp (Noun World / Noun Hoops / Noun Warfare, the NounOS homescreen) in headless Chromium to see a change working, take screenshots or measure things in the live scene. Use whenever you need to check a game or UI change in a real browser, reproduce a visual bug from a user screenshot, capture game shots, or verify something tests can't (rendering, sizes, layout on phone vs desktop).
---

# Testing noun.wtf in a real browser (cloud container)

Unit tests (`npx vitest run <path>` in `packages/nouns-webapp`) cover logic. Anything visual (sizes, layout, HUD overlap, models) needs a browser. This is the recipe that works here.

## 1. Dev server: vite with no HMR, on its own port

HMR and file watching make Playwright pages reload mid-test. Put a config in the scratchpad:

```js
// /tmp/.../vitecfg/nohmr.config.mjs
import base from '/home/user/noun-wtf/packages/nouns-webapp/vite.config.ts';
export default async env => {
  const cfg = typeof base === 'function' ? await base(env) : base;
  return { ...cfg, root: '/home/user/noun-wtf/packages/nouns-webapp',
    server: { ...(cfg.server ?? {}), hmr: false, watch: null, port: 5196, strictPort: true, host: '127.0.0.1' } };
};
```

Start it from `packages/nouns-webapp` with `npx vite --config <cfg>` as a **background** command, then poll `curl -s http://127.0.0.1:5196/` until it answers before driving the page.

- **No watcher means edits aren't picked up, new files in `public/` included.** Restart the server after every change.
- **Restarting:** `for p in $(pgrep -f "[n]ohmr5196"); do kill $p; done`. Never use `pkill -f <pattern>`: the pattern matches your own shell's command line and kills it (exit 144). Same for `pgrep -f` without the `[x]yz` bracket trick.
- **Background time limit:** background tasks stop at their time limit. Restart the server if it's gone. Never report results you didn't get.
- **Worktrees:** a worktree needs its own config, with `root` pointed at the worktree's `packages/nouns-webapp`, and a different port.

## 2. Chromium

```js
const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });               // desktop
// phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
```

- **Rendering is software (SwiftShader).** That means about 10 fps, 2–5 minutes for the world's first load, and screenshots can take a minute.
- **Long scripts:** run them in the background with a log file and big timeouts (`timeout: 300000`+ on `goto` and `waitForFunction`).
- **One run at a time:** two heavy runs at once starve each other and time out.

## 3. URLs and flags (never touch the live room)

- **Noun World:** `http://127.0.0.1:5196/world?offline=1&skip=1&q=low&bday=0`
  - `offline=1` is mandatory, so the run never joins the live PartyKit room or posts stats.
  - `skip=1` skips intros, `q=low|high` sets quality, `bday=0` turns off birthday balloons.
  - Then click `PRESS START`: `p.getByText('PRESS START').first().click({ force: true })`.
- **Noun Hoops:** add `&play=hoops&mode=1|2|3|5` (spawns on the Noun Jersey court, lobby opens).
- **Noun Warfare:** `/warfare`. Dev builds and webdriver stay offline unless `?online=1` or `VITE_PARTYKIT_HOST` is set.
- **Homescreen:** `/`. The game deck is `.nos-poster-card`, the chips are `.nos-game-tabs`.

## 4. Dev handles: step the game yourself

Real time is useless at 10 fps. Freeze the loop and step it:

```js
await p.waitForFunction(() => window.__w2 && window.__w2.me, null, { timeout: 600000 });
await p.evaluate(() => { const g = window.__w2; g.running = false; for (let i = 0; i < 120; i++) g.step(1 / 60); });
```

`window.__w2` exists only in dev builds. Useful members:
- `g.player`: `pos`, `vel`, `fwd`, `speed`, `state`.
- `g.me`: the rider's `NounCharacter`, with `head`, `root`, `seed`.
- `g.setSeed({background, body, accessory, head, glasses})`: try any head (wait about 8 s for the GLB).
- `g.cycleTimeOfDay()`.
- `g.hoops` (`reader.touch.courtX/courtZ/shoot`, `ui.phase`).
- `g.crew` (Jersey NPCs).
- `g.stats`.

Warfare uses `window.__warfare`:
- `manual(true)`, `noLock(true)`, `step(n, input)`, `hold(input|null)`;
- `game.startMatch({mode, map, teamSize, difficulty, name, look, weapons, seed})`, `game.toggleView()`;
- `sim.state`.

Three.js classes aren't importable from page scripts. Borrow them from live objects instead, e.g. `const V = obj.position.constructor` for `Vector3`. To call a module directly: `await import('/src/miniapps/world2/character/NounAppearance.ts')` (vite serves source paths).

## 5. Clean shots and measurements

- **Hide the HUD:**
  - `await p.keyboard.press('h')` hides the controls panel;
  - for HUD-free stills, inject `body *{visibility:hidden!important}` and then set `visibility:visible` on each `canvas` and its ancestors.
- **Animated elements** (the homescreen cards float) fail Playwright's "stable" check. Use `locator.dispatchEvent('click')`.
- **Measure, don't eyeball:** walk meshes and apply `matrixWorld` to `geometry.boundingBox` corners, then compare with a known-good case (e.g. head 0 is about 1.3 m wide on a character).
- **Viewing results:** make contact sheets with PIL (`Image.new` + `paste`) so you can Read many frames at once.

## 6. Before you report

- State what you actually saw: a screenshot path, the numbers.
- Run a regression test against the old code when you can. Copy the old file in with `git show HEAD:path > path`, run the test, then restore it.
- Typecheck with `npx tsc --noEmit -p .` in `packages/nouns-webapp`.
