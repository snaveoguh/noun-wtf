# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment Rules

`noun.wtf` uses `snaveoguh/noun-wtf` as the canonical source repo.

- Production branch: `main`
- Dev branch: `staging`
- Production site: `noun.wtf`
- Dev site: `https://dev-noun-wtf.netlify.app/`

Netlify's site metadata is legacy/manual-ish, so treat GitHub as the source of truth and deploy through the branch flow:

1. Push to `staging` to update dev
2. Review on `dev-noun-wtf.netlify.app`
3. Push or merge to `main` to update production

GitHub Actions handles publishing to the existing Netlify sites. Do not create duplicate Netlify sites.

**API deploys are separate.** The Ponder indexer/API lives on Railway project `spirited-flexibility` and does **not** auto-deploy on git push. After any change under `packages/nouns-api/`, run `railway up` **from the repo root** (`/Users/hugo/noun-wtf`) — NOT from `packages/nouns-api`. The service builds from the root `Dockerfile`, which `COPY`s `packages/nouns-api`, `packages/nouns-sdk`, and `packages/nouns-contracts` into the image. Running `railway up` from `packages/nouns-api` uploads a context with no Dockerfile and the build dies with `couldn't locate the dockerfile at path Dockerfile` (hit 2026-05-30). The repo root is linked to `spirited-flexibility / production / spirited-flexibility`; the live service uses the root `railway.json` (healthcheck `/health`) — the `packages/nouns-api/railway.json` (healthcheck `/ready`) is stale/unused. Pushing to GitHub only updates Netlify (the webapp), never Railway. The indexer reads mainnet through `PONDER_RPC_URL_1` (optional; dRPC's free plan froze it in October 2026 and was removed) plus the fallbacks hardcoded in `packages/nouns-api/ponder.config.ts` (Tenderly's public gateway, MEV Blocker; publicnode can't serve its historical `eth_getLogs`). An in-process watchdog (`src/syncWatchdog.ts`) restarts it if the sync stalls.

`VITE_*` env vars for the webapp are baked at build time and are hardcoded in `.github/workflows/netlify-deploy.yml`, not in the Netlify UI. Edit the workflow to change bundled values.

Remote notes:
- `nounwtf` = your fork (`snaveoguh/noun-wtf`)
- `origin` = upstream Nouns DAO monorepo

Safety:
- Do not run `npm`, `pnpm`, `npx`, or `netlify` inside random downloaded repos. These tools can execute project scripts and config, so untrusted repos can run code on the machine.
- Prefer `main` and `staging` for deployment work. Treat `master` as legacy.

## Project Architecture

This is a monorepo for Nouns DAO, a generative avatar art collective run by crypto misfits. The project uses:
- **pnpm** as the package manager (required version 10.10.0+)
- **Turbo** for monorepo build orchestration
- **TypeScript** throughout the codebase
- **Node.js** 16.x or higher

## Package Structure

Six main packages with interdependencies:

1. **nouns-assets** - PNG and run-length encoded Noun image data
2. **nouns-contracts** - Solidity smart contracts for Nouns DAO (uses Hardhat + Foundry)
3. **nouns-sdk** - Contract addresses, ABIs, instances, and image utilities
4. **nouns-webapp** - React frontend (Vite + Tailwind + i18n)
5. **nouns-subgraph** - The Graph subgraph manifests
6. **nouns-docs** - Next.js 15 documentation site with Nextra 4

Build dependencies: webapp depends on assets → contracts → sdk.

## Essential Commands

### Development
```bash
pnpm install          # Install all dependencies
pnpm dev              # Start development servers (builds dependencies first)
pnpm build            # Build all packages
pnpm test             # Run tests across all packages
```

### Code Quality
```bash
pnpm -w lint          # ESLint with caching (workspace level, provide file paths)
pnpm format           # Prettier formatting
```

### Package-Specific Work
```bash
# Work in specific package
cd packages/nouns-webapp
pnpm dev              # Start webapp dev server
pnpm test             # Run package tests
pnpm build            # Build package
```

## Smart Contract Development

Located in `packages/nouns-contracts/`:
- Uses both **Hardhat** and **Foundry** for testing/deployment
- Tests in `test/` (TypeScript) and `test/foundry/` (Solidity)
- Deployment scripts in `script/`
- Generated TypeChain types in `typechain/`

Key contracts:
- `NounsToken` - ERC721 for Noun NFTs
- `NounsAuctionHouse` - Auction mechanism
- `governance/` - DAO governance contracts
- `NounsDescriptor` - SVG generation and metadata

## Frontend Architecture (nouns-webapp)

Located in `packages/nouns-webapp/` - React web application built with Vite, TypeScript, and Wagmi.

### Tech Stack
- **React 18** with **Vite** build tool
- **Tailwind CSS** + **shadcn/ui** for styling (migrating from CSS Modules + react-bootstrap)
- **wagmi** for Ethereum interactions
- **TanStack Query** for server state (replacing Redux + Apollo Client)
- **Lingui** for internationalization
- **GraphQL Codegen** for type-safe subgraph queries

### State Management (In Migration)
- **Redux Toolkit**: Legacy global state with slices (being phased out)
- **TanStack Query**: Modern async state management for server state
- **Wagmi**: Ethereum wallet connection and contract interactions

Key state slices: `account`, `auction`, `candidates`, `onDisplayAuction`

### Data Sources
- **The Graph**: Subgraph queries via TanStack Query + GraphQL Codegen
- **Direct RPC**: Real-time contract calls via Wagmi
- **IPFS**: Proposal metadata storage

Pattern: Use `useQuery` with `execute()` function from GraphQL Codegen (see `src/index.tsx:202-205`)

### Key Directories
- `src/components/` - Reusable UI components
- `src/pages/` - Page components
- `src/wrappers/` - Contract interaction wrappers
- `src/hooks/` - Custom React hooks
- `src/utils/` - Utility functions
- `src/contracts/` - Auto-generated contract types via Wagmi CLI

### Webapp-Specific Commands
```bash
# From packages/nouns-webapp directory
cp .env.example.local .env    # Setup environment
pnpm dev                      # Start dev server on port 3000
pnpm test:watch               # Run tests in watch mode
pnpm test:coverage            # Run tests with coverage
pnpm graphql-codegen          # Generate GraphQL types
pnpm i18n:extract             # Extract translation strings
pnpm i18n:compile             # Compile translations
```

### Routing Structure

Routes are split into V1 (legacy NounsToken) and V2 (NounV2Token, launched 2026-04-24) namespaces — see `nounwtf_v2_launch_dayone.md` memory for the day-one rationale. No `?dao=` query param, no localStorage toggle.

V1 (default namespace):
- `/` - Current V1 auction
- `/noun/:id` - Specific V1 noun
- `/vote`, `/vote/:id` - V1 governance proposals
- `/candidates/:id` - V1 proposal candidates

V2:
- `/v2` - Current V2 auction
- `/v2/noun/:id` - Specific V2 noun
- `/v2/vote`, `/v2/vote/:id`, `/v2/candidates/:id` - V2 governance

Shared:
- `/playground` - Noun trait playground (2D editor; has a "Save as Dream" backlog item)
- `/fork/:id` - Fork-specific pages
- `/explore/wallet`, `/explore/wallet/:identity` - Wallet explorer (Nouns held + delegated, governance activity, transfer history)

### AuctionHouse + Indexer Notes

V4 AuctionHouse went live 2026-05-25 (Prop 968). Behavioural change vs V3: when an auction settles with **no bid**, the noun is **routed to the nouns.eth treasury** rather than burned. The indexer in `nouns-api/` distinguishes the two cases by calling `ownerOf` after settlement — only `0x000…dead` (or a true burn) sets `burned=true`; a treasury-routed noun is left owned by `nouns.eth`.

The webapp's `BurnedNounContent` currently only knows the burn copy; it should not render for treasury-routed nouns (the indexer guards this), but a "held by Nouns DAO Treasury" branch is on the followups list as belt-and-braces.

V4 + auto-settler context lives in `nounwtf_v4_disco_ship_2026-05-25.md` and `nounirl_settlement_bot.md` memories.

### Terminal draft payloads

Pasting a JSON object `{title, body, transactions:[{address,value,signature,calldata}]}` into the terminal prompt opens the draft window with the actions attached (`detectDraftPayload` in `TerminalPrompt.tsx`). Function-call actions in the draft's Add Action modal resolve ABIs from `src/lib/knownAbis.ts` first (Nouns contracts + Client Rewards proxy, no Etherscan key needed) and parse args by ABI type. Prop 1000 (client 37 incentives approval, 2026-09-28) was submitted this way; the payload is `proposal-client-37-draft.json` at the repo root.

Lil Nouns drafts: `/draft lil` (or `/lil draft`, "open a lil nouns proposal window", a bare `/draft` on a `?dao=lil` page, or `"dao": "lil-nouns"` in the JSON payload) opens a separate draft window that submits to the Lil Nouns governor (`0x5d2C…4039`) via the 5-arg `propose` (no client id). Lil transfers are plain ERC20 `transfer`s (USDC / stETH / WETH) or ETH straight from the Lil treasury (read via the governor's `timelock()`); there's no payer or stream factory. The panel shows live Lil treasury balances vs what the draft requests, and warns + asks for confirmation when a payout exceeds the balance (the Lil treasury holds very little raw ETH). Transfer calldata is args-only: the timelock prepends the `signature` selector itself, so `encodeFunctionData` (selector included) makes the action revert; `hasDuplicatedSelector` in `src/lib/lilNounsTreasury.ts` flags that for both DAOs.

### Terminal / Disco Default

The terminal feed's 🪩 disco mode (animated rainbow rows; CSS architecture documented in `nounwtf_v4_disco_ship_2026-05-25.md`) is **off by default** as of 2026-09-20 — it was a photosensitivity hazard on by default. Visitors opt in with the 🪩 toggle; the choice persists under `noun-wtf-disco-v2`.

### Multiplayer (packages/nouns-party)

Hosted PartyKit shut down on 2026-10-23. The same rooms (Noun World, the hoops relay, `noun-warfare`) now run as a PartyServer worker on Cloudflare Durable Objects, `noun-wtf-party.hugoevans92.workers.dev`, at the same `/parties/main/<room>` paths. The webapp's default host lives in `src/miniapps/world/engine/types.ts` (`PARTYKIT_HOST`) and `src/miniapps/warfare/net/partyTransport.ts`; `VITE_PARTYKIT_HOST` overrides both. The worker does not deploy on push: `cd packages/nouns-party && npx wrangler deploy` (the user runs it, logged into their Cloudflare account).

### Homepage (NounOS home)

- **Intro ident** (`home/Intro.tsx`, once per browser session, `?intro=1` forces it, `?intro=hold` freezes it): the canonical noggles alone, built pixel for pixel from `glasses-square-red.png` (16x6, `#f3322c`; a test checks it against the PNG); never redraw them by hand. About 4.2 s, with the sound (`ident()` in `home/sound.ts`) timed to the frame build and the eyes landing. It's drawn on one canvas from one clock (`home/introScene.ts`, the timeline is pure and tested), not CSS-animated divs: those froze half built on real machines. The clock advances at most 50 ms a frame, so a busy page slows it rather than skipping, and it only ends after its last frame is drawn.
- **Sound** is on by default (a mute is remembered). Browsers keep audio locked until a gesture, so the hero shows "click anywhere for sound" until the first click or key.
- **Hero voice-over:** `public/home/vo-intro.mp3` (owner-supplied, voice and spooky bed mixed, 26.3 s, cut right after "...Welcome to Noun.") plays once per page view on the brand slide when sound is on; the rules are in `home/voiceOver.ts`. While it plays, the slide's clip restarts and slows to end with it (`syncRate`, `VO_SECONDS`), holding its last frame; a clip too short to stretch that far (under 0.75 × the VO, `stretches`) just keeps looping. Replacing the file means updating `VO_SECONDS`. `hero-sizzle.mp4/.webm` was stretched to 26.3 s (motion-interpolated, ~0.64×) so it plays once, exactly under the VO.
- **Carousel:** a clip slide moves on when its clip ends (one clean play-through, `once`/`onEnded` on `ClipVideo`); hovering holds it and the clip loops until you leave. Each slide's `ms` in `rows.ts` is its clip's length (the progress pip, plus a fallback timer).
- **Game reels:** `hero-big-drop`, `hero-breaks`, `hero-exchange` (1920×1080, webm + mp4 + poster, each under 4 MB) are real gameplay rendered frame by frame in headless Chromium by `packages/nouns-webapp/scripts/sizzle/` (README + SHOTLIST there). Re-cut a reel, then set its slide's `ms` to the new length. `edits/sizzle.json` is a future gameplay main sizzle cut on the VO's pauses, with placeholder cuts for cars / pool / hide & seek / parkour. It isn't wired yet.
- **Shelf covers:** portrait posters in `public/home/covers/*.webp`, wired in `home/rows.ts`. Pages without one get generated box art (`boxArt.ts`).
- Brand lettering (hero titles, header wordmark) carries `data-keep-font` so the site font switcher can't replace Pip3 there.

### Plaza ring infill

The baked plaza left a 4.5 m dead-end slot between neighbouring blocks on each side of the ring, and on two sides a 1 m notch behind it; from a roof you looked straight down to the street. `world/infill.ts` finds those slots from the seated COL_Buildings roofs (`findInfills`, pure) and fills each with a narrow building: roof flush with the block behind, parapet + windowed wall on the plaza side, solid colliders (`COL_BuildingsInfill`). `world/infill.test.ts` ray-casts down along every seam on the facade line (render and collision) and fails on any hole. NORTH ROOFS used the north slot as its alley jump; it now runs across the infill roof and up block A's wall off the sill.

### Noun World on weak phones (texture diet)

A weak device (`render/deviceTier.ts` `isWeakDevice`, e.g. a 4 GB Mali-G52 Android) goes on the texture diet (`render/textureDiet.ts`, `textureDiet.on`): every upload is capped at 512 px, static textures are shrunk to 256 px on the CPU before upload (`shrinkTexture`: the plaza GLB's materials, nature, skyline; shirts and heads paint smaller), the env map bakes at 64 px, the shadow map is 512, only the mural plays a Giphy video, and a lost WebGL context reloads once. New features that add textures should shrink them under `textureDiet.on` too; dev builds warn when the weak-device estimate passes 50 MB (`checkTextureBudget`). Desktop and normal phones never diet. Measured 2026-10-27 (emulated Moto G06, production build): GL textures ~130 → ~36 MB.

### Noun World performance (?perf=1, shader warm-up, adaptive quality)

- **Measure first:** `?perf=1` (overlay) or `?perf=quiet` (scripts) turns on `world2/perf/PerfProbe.ts`. Game brackets each frame and laps each system (`perf.lap('name')`); you get frame p50/p95/p99, hitches over 50 ms, ms per system, draw calls / triangles / programs and heap, and `window.__w2perf.snapshot()` returns the same. The headless before/after harness and the 2026-10-28 numbers are in `.claude/perf-shots/README.md`. Headless WebGL is SwiftShader: its frame intervals are GPU-bound, so compare CPU ms, draws, programs and hitches, not fps.
- **Shaders:** precompile through `gfx.asDrawn(() => renderer.compile(...))`. The composer draws into a linear buffer and three keys programs by output colour space, so a compile with no target built sRGB variants the frame never used (programs 92 → 53, and every material still linked on first sight). `render/shaderWarm.ts`:
  - `ShaderWarmer` issues compiles for streamed or hidden materials about once a second;
  - `warmHidden` keeps a new set (a room) hidden while it links;
  - `clearFog()` (FogExp2 at density 0) replaces `scene.fog = null`, which relinks every program in view.
- **Adaptive quality:** `render/qualityController.ts` (pure, tested) steps on median / p95 frame times.
  - Phones: render scale → shadows → ink pass.
  - Desktop: render scale only, never under 1.25 on Retina.
  - It steps back up only across scale rungs; dropping shadows or post relinks every lit material, one long hitch. An explicit Low (Settings / `?q=low`) stays as chosen.
- **Desktop heat (2026-10-28, `.claude/perf-shots/desktop/README.md`):**
  - `render/framePacer.ts` caps `Game.frame` at 60 fps by default (Settings → Frame rate 30 / 60 / max). It drops to 30 while the window is blurred or a menu covers the game (`game.coverGame(reason, opaque)`; an opaque one sets `gfx.hold`). The sim still steps on the interval since the last run frame: a capped 144 Hz screen plays like a 60 Hz one.
  - High draws at 1.5 on Retina (`bootScale`). Settings → Sharp restores 2. The ink thickness follows the render scale.
  - Desktop rungs: scale → SMAA off → 2048 shadow map, judged against the cap (`pacedTuning`).
  - Billboard videos pause when far, paused or hidden. The minimap redraws at 30 fps. The NounOS parallax sleeps while the game is up.
  - Anything new with its own rAF loop should pace itself and stop while `game.paused`.
- **Phones (low):**
  - mountain dressing is drawn within 300 m (`LOW_DRESSING_VIEW`);
  - dressing and the nature showcase don't cast shadows;
  - remote riders' name tags only touch the DOM when they change.
- **Rooms:** the z-fight pass (`interiors/zfight.ts`) keys by number, not string (same output, ~2× faster), and the floor above is built in `goIn` behind the fade, not 0.4 s after it.
- **Big Drop:** `peak.enter()` starts three systems; the rest start one a frame (`START_NOW`).
- **Site tray:** on touch screens (and anything ≤ 760 px wide) it sits bottom-left in the game, as brand + DESK chips (`NounOS/styles.ts`), clear of the touch buttons.

### Noun World audio

- **Radio stations** (`world2/audio/GameRadio.ts`): COMMUNITY RADIO (the shared ice-cream-van station: real music from `public/fm/playlist.json` plus jingles), NOUN BEATS (generated hip hop, an AudioWorklet) and optional live streams. The site-wide player outside the game is NOUN FM (`src/components/NounFm`).
- **Rider callouts** (`world2/audio/voice/callouts.ts`): at least 30 s between any two lines, and lines inside that gap are dropped. The rider uses one fixed deep male Piper voice (`RIDER_VOICE` in `ttsVoice.ts`); each sentence is synthesised separately so "Who's the goat?... Me." keeps its pause.
- **Voice Booth** (`src/miniapps/world2/booth/VoiceBooth.tsx`, logic in `src/miniapps/world2/audio/voice/booth/`): players record their rider's callout lines, from Settings → 🎙 VOICE BOOTH or the standalone `/world/voice` page. It uses the live mic only (MediaRecorder: webm/opus, mp4/AAC on Safari); there is no file upload.
  - **Clips.** Keyed `<event>.<index>[.c]` (`.c` = the clean alternative). Max 4 s and 64 KB, 40 per player. They're kept unre-encoded in IndexedDB (`noun-world-voice`); the silence trim and level are stored as `t0/t1/gain` and applied at playback.
  - **Sharing.** Only after a consent checkbox (`shareRecordings`). Clips go to `netlify/functions/world-voice.ts` (Netlify Blobs store `world-voice`) under a public tag, `sha256('voice:'+riderId)[0..24]`. The private rider id is never shared.
  - **Multiplayer.** Optional pose-blob keys: `vo` (tag), `co` (callout event + line index, never audio) and `cv` (voiced-chat clip ref). Older clients ignore them. Remote clips are fetched lazily and panned. "Hear other players' voices" off, or a muted/reported player, falls back to their TTS.
  - **Moderation.** POST `report` (anyone, by tag), then `admin-reports` / `admin-hide` (a clip or a whole player) / `admin-delete`. These need the `X-World-Admin: $WORLD_ADMIN_TOKEN` header, as in community-submissions and world-stats. Hidden clips are never served.
  - **Voice sources.** `VoiceSource = 'recording' | 'local-model' | 'tts'`, in fallback order (`pickSource` in `booth/clips.ts`). The own rider's `tts` is `RIDER_VOICE`; remote riders fall back to their seed voice. The local model and voiced chat use the same sentence-split synthesis and pauses as `RIDER_VOICE` (`MODEL_VOICE`). A future server-side cloning backend slots in as another source without migrating stored clips.
  - **Train my voice.** 100 original sentences, local only. The booth exports an LJSpeech zip (22050 Hz mono 16-bit WAVs + `metadata.csv` + a free Piper/Colab README) via a store-only zip writer (`booth/zip.ts`).
  - **My voice model.** Load `.onnx` + `.onnx.json` (validated in `booth/piperConfig.ts`, kept in IndexedDB, never uploaded). A second `TtsEngine` runs it (`init-bytes`). Two switches, both off by default: `modelVoice` (callouts without a recording, and typed chat, in the player's voice) and `modelShare`. With `modelShare` on, chat lines become ephemeral clips: 8 s max, 1 per 5 s, 60/h, served for 10 min.

### Noun Breaks (breakdance battles, plaza)

A rhythm-game cypher at the plaza (0, −15): VS CPU, 1v1 online, 2v2/3v3 crews (CPU fill), WATCH. Contract `world2/breakdance/contract.ts`; three parts like hoops/:
- `sim/` pure + deterministic: 24 moves (`moves.ts`, key patterns on the beat), freestyle recognition (`recognise.ts`), 3 judges (technique / musicality / originality / power, `scoring.ts`), CPU dancers that answer back (`planner.ts`). Prompts lead a beginner to a full set ending on a last-beat freeze.
- `view/` procedural breaking on the Noun rig (`pose.ts` → `rig.ts`, no clips: the rig has none), the cypher + crowd + DJ + judges, battle camera, HUD (`BreakHud.tsx`), break beat locked to the battle clock. The crowd builds one Noun a frame (a build is a hitch). Dev: `window.__w2.breakDev()`.
- `net/` cypher spot, menus, lobby, `BreakMode` (Game hook), host-authoritative sync (`sync.ts`: host clock, ping/pong offset, sim judged 0.15 s behind, ~10 Hz snapshots), `break:*` messages relayed by `packages/nouns-party/src/breakRelay.ts` (online battles need the worker redeployed). `factory.ts` picks the real sim/view (stubs stand in until the view chunk loads).
- Results report `break_win` / `break_loss` to respect.
- **Freestyle anywhere** (`breakdance/freestyle/`, `game.freestyle`): `,` (comma; every letter is taken) or the 🕺 button breakdances on the spot, anywhere outside (not inside, on the Big Drop, in hoops / a battle, the van or the dragon). It auto-dances a flowing set (`planner.ts`); battle key patterns (`keys.ts`, the sim's MOVE_LIST) cut in on the next beat. The beat is NOUN BEATS' generated song's when it's on (`GameRadio.beatsSong`), else 95 bpm, with an optional quiet break loop when nothing else plays. Others see it through the pose blob's `fs: [move, seq, beat, n, bpm]` (`wire.ts`, WIRE_MOVES is append-only). Leave with `,`, Esc, holding a direction or the stick. The pose code (`dance.ts`) is its own chunk.

### Parkour (on foot) + NOUN PARKOUR

`world2/parkour/` runs the rider on foot whenever a move is on; walking, jumping, the wall climb and the vault stay in `skate/Player.ts` (the engine starts them and animates them). Contract in `parkour/contract.ts` (tuning `PK`, anim codes `ANIM`, append-only).
- **sim/** pure, no three.js: world queries through `PkWorld` (`world.ts` wraps CollisionWorld), detection from the real collision in `detect.ts` (side / front walls, lips + sills, thin poles, low obstacles, gaps, narrow tops; nothing is tagged), the state machine `motor.ts` (wall run + wall jump, run up a wall + tic-tac, ledge hang / shimmy / leap / pull-up, poles with swing + launch + a pole-to-pole aim sweep, slide, roll, stumble, auto vault, gap jump, standing precision jump + a landing assist onto narrow tops), landing rules `landing.ts`, route timing + ghosts `route.ts`. Tests: `npx vitest run src/miniapps/world2/parkour`.
- **Hook:** `player.parkour` (Player.ts) runs first in every on-foot step; while it returns true the Player's own walking / climbing is skipped. `ParkourSystem.frame` runs after `updateMyCharacter`. Off on the Big Drop.
- **view/** every move as a PoseSpec on the rig through breakdance's `PoseDriver` (`poses.ts`; the old climb's walk cycle is replaced by a hand-over-hand climb). The Noun's arms are ~0.42 m and its head a 0.85 m deep cube, so wall distances in `PK` put the face on the wall when the hands reach. Dev pose sheet: `parkour/view/preview.ts`.
- **Net:** optional `pk: [code, phase, side, amt]` in the pose blob (`net/pk.ts`); remote riders pose from it, older clients ignore it. No worker deploy.
- **Controls:** Q / gamepad B / touch STOP (relabelled DUCK / SLIDE / DROP / ROLL on foot) = duck; touch PUSH = RUN on foot; K on foot opens the route menu.
- **NOUN PARKOUR** (`parkour/game/`): routes in `routes.ts` (THE GAUNTLET, NORTH ROOFS, LAMP LINE) with course props that exist only while a route runs (collider id `parkour-course`); `ParkourCourse` (countdown, checkpoints, splits, R restarts, falls go back to the last gate, board off), `ParkourUi` (menu, timer, results). Bests + ghosts are local only (`noun-parkour-v1:<route>`): a time trial has no physics proof for the stats server. `/world?play=parkour` opens the menu; homepage tile `parkour` (`rows.ts`, cover `public/world2/parkour-cover.webp`, card `public/home/covers/parkour.webp`).

### Noun Pool (8-ball: bar tables + the pool hall)

8-ball on any bar's pool table (interiors call `game.pool.playAt(tablePos, yaw)` or `playAt({x,y,z,yaw,length,width})`, y = the floor) and as its own game (`/world?play=pool`: a pool hall floating over the plaza, the world hidden). VS CPU (easy / normal / hard / pro), 1v1 with someone in the same room, WATCH. Contract `world2/pool/contract.ts`; three parts like hoops/:
- `sim/` pure + deterministic: physics (`physics.ts`, spin, cushions, pockets), 8-ball rules (`rules.ts`: break, open table / groups, fouls → ball in hand, call the 8), rack, CPU (`cpu.ts`, a generator so it thinks over frames).
- `view/` the table drawn over the bar prop (a touch taller, so its clutter hides), balls, cue, the two players (the one the camera is inside isn't drawn), cameras (cue / top / follow / orbit), aim guide, sound, the hall.
- `net/` `PoolMode` (Game hook, owns the frame while `active`), `PoolUi` (menu, HUD: drag to aim, pull the power bar, spin ball), lockstep sync (`session.ts`: only shots travel, every client plays them with the same sim, the host judges and sends the rounded state), `pool:*` relayed by `packages/nouns-party/src/poolRelay.ts` (online play needs the worker redeployed; an old worker drops `pool:*`, so VS CPU still works).
- Gamepad: stick aims, RT pull-and-release, right stick spin, RB + stick ball in hand. Wins add respect.

### Seeing each other indoors

A room is built 4 km over its door (`POCKET_Y`, origin `(door.x, POCKET_Y, door.z)`), the same on every client, so positions inside are already a shared frame. The pose blob carries `in: [doorId, level, seat]` only while inside (`interiors/roomNet.ts`). `Game.updateNetwork` draws only riders in the same space (`sameSpace`): street riders in the street, and riders in the same room and on the same floor indoors, with their name tags (`data-room` gets past `[data-away]`). A seated rider is put on their seat by `InteriorSystem.poseRemote`. A window's view of the street shows only street riders. Older clients ignore `in`, so they still draw indoor riders 4 km up. No worker change is needed.

### CAMP (first spawn)

NOUNS CAMP is a condemned penthouse on top of the tallest tower (Skyline `TOWERS[0]`, 150 m, plaza north side), and every plain `/world` load wakes up in it (`world/camp/`).
- **Who spawns there:** `firstSpawn.ts` (pure, tested). `?play=`, `?drop=`, `?mode=`, `?spot=`, `?megaramp=`, `?town=`, `?dressing=` keep their own spawn; `?spawn=plaza` keeps the old one (the perf harness passes it so its numbers stay comparable). World2Page calls `game.camp.spawnInside()` once per page load: on foot, at one of 8 spread-out spots, facing the window, time of day set to sunset (`golden`, `Game.setTimeOfDay`). R / falling out still go to the plaza home spots.
- **Built in place, not a pocket room:** the tower's plaza face runs flush all the way up and its top storey is a hollow shell round a glassless window (`site.ts` `campShellBoxes`, used by Skyline for render + colliders). `CampSystem.build(level)` runs in `Game.start` before the level is toonified and its collision built, so CAMP is static level geometry. The room is the interiors kit (`interiors/kit.ts`, `buildItem`), merged per material: ~4 draws + 1 for the stair.
- **Inside** (`layout.ts`, pure, tested: inside the room, solids don't overlap, every spawn can walk out of the window, the mini ramp is clear): wrecked sofa, coffee table with stacked and open MEME VALUE copies (the book's own page images, `art.ts` atlas, 1024 px / 512 on the texture diet), more copies open on the floor, empty ice cream tubs, the ice cream van plans on a whiteboard, a sunset poster, a boarded door with a CONDEMNED notice, a NOUNS CAMP tag, a flickering bulb, a fallen ceiling tile, a pool table (`game.pool.playAt`) and a 1 m mini ramp across the back (`miniramp.ts`, its own skateable collision; a real-Player ride is tested). E or tap at the coffee table opens `/books/meme-value` (World2Page wires `camp.onRead` to the router); E at the table plays pool.
- **Light:** the low sun only gets in at the window, so CAMP's solid and art materials get a small warm emissive after the time-of-day scan (`CampSystem.selfLight`): no extra lights, so no relink.
- **The way out is the window:** a scissor fire escape (`facades/escape.ts` `planTowerEscape`, two lanes, alternating flights, a landing at every turn, ~3.6 m per flight, 36 flights) hangs off the plaza face from the window's walkway down to the ring roof east of the tower, then an exit deck and a bridge over the parapet (`probeWorld` reads the roof and parapet off the level collision). `towerEscape.test.ts` walks it all with the real Player. Or jump: `drop.test.ts` checks a 146 m fall lands (no tunnelling); on foot it's the parkour hard landing (roll with a timed duck), on a board a bail you get up from where you landed, plus a `SENT IT · N M` toast.
- **Camera:** SkateCamera's "keep above the ground" probe ignores a hit more than 1.5 m over the rider's head (it used to find CAMP's roof and lift the camera through the ceiling).
- **Controls card:** never opens by default; the help icon pulses with an H until it's been opened once (`RingHud` `helpHint`).

### Respect

One score for how you act (`world2/respect/`, contract in `interiors/contract.ts` `RespectApi`, on `game.respect`). Rules in `respect/rules.ts` (pure, shared with `netlify/functions/world-respect.ts`): gifts, eating/thanks, buying local, helping, clean big combos, graffiti pieces, serving, hoops/break wins up; stealing, bailing into people, tagging homes, refusing food, overstaying down. Per-kind rate limits + ±minute caps; tiers outcast / stranger / local (50) / regular (200) / legend (600) with hysteresis; slow drift above the tier floor. The client sends events only; the server re-scores them (Blobs store `noun-world-respect`). HUD meter top-right, tier banners, legend noggles badge on name labels.

### House voice

Every rider's default voice is the owner's own trained Piper model, `public/world2/voices/house.onnx` (+ `.onnx.json`, 63.5 MB), loaded by `PlayerVoices.house()`; recordings and a player's own model still win, and the LibriTTS-R `RIDER_VOICE` covers while it loads. Replacing the files means bumping `HOUSE_REV` in `ttsVoice.ts` (the TTS worker caches by URL).

### The Big Drop (snow peak behind the deepest door)

The Noggle Bowl's deepest door (it used to open the Upside Down) opens onto a 1,000 km snow peak, a per-player dimension. Nothing done there counts: stats are suspended. The homepage card (`BIG_DROP_CARD` / `BIG_DROP_COVER` in `home/rows.ts`) is locked until `doorUnlocked()` (`missions/unlocks.ts`). Unlocked, `/world?drop=1` launches straight onto the summit.
- **Dimension** (`missions/peak.ts`):
  - swaps the player's and the collision world's terrain;
  - 40% gravity, 15% air drag;
  - hides and pauses the city;
  - floating origin: everything recentres every 3 km, 20 km above the city's coordinates (`Player.shift`, `SkateCamera.shift`, `CollisionWorld.shiftDynamic`);
  - terrain: a near grid every frame plus a far grid in slices (`peakGrid.ts`).
- **Shape:** `peakTerrain.ts` (`peakHeight`; tested, including the ray marcher's `PEAK_LIPSCHITZ`).
- **Everything else** is a PeakSystem in `missions/bigdrop/` (contract and coordinate rules in `contract.ts`, registry in `systems.ts`):
  - the race line `track.ts` (`s` = peak z; sections, features, `kickerShape`, `loopBase`, sized by expected speed in `trackSpeed.ts`), carved by `terrainCarve.ts`, with snow colours and surfaces in `surface.ts` and gates, km boards and poles in `trackDressing.ts`;
  - rideable loops: `loops.ts` / `loopPath.ts` / `loopMesh.ts` (`Player.ride` hook, `SkateCamera.rig`);
  - sky, sun, cloud sea, ranges, giant Noun, forests and creatures: `scenery/` (`journey.ts` maps depth to time of day: storm, blue, golden, sunset, aurora);
  - NPC hoverboarders: `riders.ts` / `riderSim.ts`; built Nouns are kept between visits, because a build is a hitch;
  - snow spray, wind streaks and sonic booms: `spray.ts` / `sprayRules.ts`.
- **The SSX course** (the first ~5 km of the track; `bigdrop/courseSpec.ts` is the layout in track terms, s = peak z):
  - START gate (s 40) → DROP-IN, S-CURVES, BIG AIR, ICE CAVE, THE SPLIT, RAIL YARD, FINAL DROP → FINISH (s 4980), four checkpoints; then the random track as before. About 3 min.
  - **Governed:** on the course's snow a grounded board is held to `courseCap(s)` (94 → 195 km/h, ×1.45 boosting; the excess bleeds off, `governSpeed`). `trackSpeed.ts` integrates the same cap, so `designKicker` cuts the course's kickers for the real speed (snappier: `hangK` 0.7). Change the cap and the kickers follow.
  - **THE SPLIT:** the main (safe) line bulges round the shortcut (`courseBulge`); the shortcut is a second lane carved in `terrainCarve.ts` (`withBranch`: lane, rock-bore trough, gap kicker `branchKicker()`, crevasse). Trees stay clear (`courseClearLat`).
  - **Props** (`courseProps.ts`, built in ~2 ms slices): arches, gates, boost pads, rails in the game's RailSet (local coordinates, re-added on rebase), the caves (mesh + `ctx.setCollider`), rock arches, signs.
  - **Play** (`course.ts`): boost meter (`boostMeter.ts`; Tab / gamepad X / a touch button, `InputFrame.boostPressed`), magnet rails, the timed run + splits + a local best (`courseRun.ts`, `noun-bigdrop-ssx-v1`), DOM HUD (`courseHud.ts`), `SkateCamera.fovKick`. Nothing counts (stats stay suspended).
  - Tests: `course.test.ts` (layout, the split, caves, flights clear of props at 0.75–1.45× speed), `boostMeter.test.ts`, `courseRun.test.ts`; `kickerFlight.ts` flies a kicker like the board does. Browser shots: `.claude/ssx-shots/`.
- In dev: `window.__w2.missions.enterUpsideDown()` / `leaveUpsideDown()`.

### Books (Meme Value)

`/books/meme-value` (alias `/memevalue`) is "MEME VALUE" by LIL 67 (the site owner's own book) as a flipbook, with an ART / CULTURE card (`public/home/covers/meme-value.webp`).
- **Pages:** `public/books/meme-value/p001.webp…p252.webp` (1400 px, ~25 MB) plus `sm/` (700 px, for phones) and `pages.json` (page count + each page's text, for search, alt text and the TEXT panel). The PDF's covers and spreads are cropped to the trim and split, so the book is 252 square pages.
- **Re-render:** get the PDF from memevalue.pinit.eth.limo (88 MB, never hosted here) and run `python3 scripts/books/render-meme-value.py <pdf>` from `packages/nouns-webapp` (needs poppler + Pillow).
- **Reader:** `src/pages/Books/`. `bookMath.ts` is the pure part (views/spreads, the fold geometry, search) and is tested. `Flipbook.tsx` draws the page curl with nested transformed boxes only, no dependencies; reduced motion falls back to a fade. `?p=N` deep-links a page.
- **License:** the book's Viral Public License stays in the book as page 2. The About panel credits it as printed ("LIL 67", "written and illustrated by 67 unless specified otherwise") and links the original and its PDF.

### CC0 library

- **Route:** `/cc0` ("CC0 LIBRARY", `src/pages/Cc0Library/`), opened in the NounOS navigator; catalog entry on the ART / CULTURE shelf, poster `public/home/covers/cc0-library.webp`.
- **Sources** (`assets.ts` merges them; `useCc0Assets.ts` loads each on its own and tolerates failures):
  - the curated archive: `public/cc0-archive/index.json` + `creators/*.json`, loaded by `src/cc0-archive` only when the page opens (~2.8 MB);
  - cc0-lib.wtf's API (best-effort; its domain lapsed in Oct 2026, so it shows "offline");
  - approved community uploads.
- **Uploads** (`netlify/functions/cc0-uploads.ts`, rules shared with the form in `uploadRules.ts`):
  - png / jpg / gif / webp / svg, mp3 / wav / ogg, glb / gltf; ≤ 10 MB, sent in 3 MB parts (`begin` → `part` → `finish`).
  - Checks: magic bytes; SVGs with scripts, handlers, outside refs or DOCTYPEs are refused; a .gltf must embed its buffers. JPEG EXIF and PNG text chunks are stripped (WebP metadata is not).
  - The CC0 consent box must be `true`. Rate limits are per IP hash. Stored in the Netlify Blobs store `cc0-uploads`.
- **Serving:** `netlify/functions/cc0-file.ts` (streaming; `?id=`, `&dl=1` to download) serves only approved, visible files: a year of browser cache, 10 min at the CDN, Range supported.
- **Moderation:**
  - Uploads stay pending until an admin approves them. POST `admin-pending` lists pending and reported uploads. POST `admin-decide {id, approve: true|false}` publishes or deletes; `{id, hidden: true|false}` hides or unhides.
  - Both need `X-World-Admin: $WORLD_ADMIN_TOKEN`; the same header lets an admin preview a pending file from `cc0-file`.
  - Anyone can POST `report {id, reason}` on an approved upload (the detail panel's report button).

### Nonsense (treasury flows)

`/nonsense` (`src/components/TreasuryFlow/`) shows what Nouns DAO holds now, where the money came from and where it went, from `GET /api/treasury/flows` (version 2). The route (`nouns-api/src/api/routes/treasury.ts`) only reads tables; the logic is the pure builder `src/api/treasury/buildFlows.ts` and decoder `decode.ts` (tests: `cd packages/nouns-api && npx tsx --test src/api/treasury/*.test.ts`, real proposal calldata in `fixtures.ts`).
- **Data.** In = winning auction bids (`nounsAuctionHouseV2` table). Out = executed proposals' actions decoded from the `transaction` table (ETH, ERC-20 `transfer`, USDC Payer `sendOrRegisterDebt`, Stream Factory `createStream`, Nouns transfers, ETH sent with a call) plus fork payouts from the `treasury_send` table (nouns.eth `ETHSent`/`ERC20Sent`; only the fork paths can call them). Streams count once (createStream minus what a cancel returned; the funding transfer is skipped). Timelock V1 ↔ nouns.eth moves, wraps/stakes/Token Buyer swaps (`convertedEth`), Payer top-ups and zero-value calls are not "out". USDC is never added to ETH; net = in − ETH out − ETH sent to the Token Buyer.
- **Types (by rule, never from proposal text):** `treasury` (both timelocks), `nounders`, `subdao` (fork treasuries from `ExecuteFork`, known sub-DAOs, or a forward-verified `*.nouns.eth` primary name), `contract` (DAO contracts, or recipient code that isn't a Safe), `multisig` (Safe proxy code), `person` (no code; EIP-7702 counts as no code), `bidder` (auction winners who never got paid). `eth_getCode` is cached a day; ENS via `ReverseRecords.getNames`.
- **Known addresses** live in one sourced table: `nouns-api/src/api/treasury/knownAddresses.ts`. nouns.eth is Timelock V2 `0xb1a3…ef71`; `0x0bc3…de10` is the legacy Timelock V1. Nounder rewards are counted with NounsToken's rule (id ≤ 1820, id % 10 == 0): `noun.mintedTo` always holds a treasury because the ERC721 mint goes 0x0 → owner → recipient.
- **Holdings (`holdings`, live).** `treasury/readHoldings.ts` reads everything in one Multicall3 call, cached 5 min in the route (a failed read keeps the last good one; the page loads without it). Holders (`HOLDERS` in `holdings.ts`): nouns.eth, Timelock V1, the Governor `0x6f3e…223d` (ETH for vote-gas refunds), USDC Payer, Token Buyer. Tokens: ETH, WETH, stETH, wstETH, rETH, mETH, USDC, ENS. Valued in ETH at on-chain rates: stETH/WETH 1:1, wstETH `stEthPerToken()`, rETH `getExchangeRate()`, mETH `mETHToETH(1e18)` on Mantle's staking contract `0xe3cb…8e8f` (= `mETH.stakingContract()`). USDC stays in dollars, never added to ETH; `usdInEth` is a reference at Chainlink ETH/USD `0x5f4e…8419`. ENS is listed, not valued. Dust (< 0.001 ETH, < $1) isn't listed. Check live: `npx tsx scripts/treasury-holdings-live.ts`.
- **Reconciliation (`reconciliation`, pure `reconcile()` in `holdings.ts`).** auction proceeds − paid out (ETH/WETH/stETH, `outEth` minus forks) − ETH sold for USDC (`ethToUsdc`) − fork payouts (`byKind.fork.eth`) − staked tokens paid out (`otherTokens` wstETH/rETH/mETH at TODAY's rate, an estimate) + **staking yield & other (derived)** = treasury now (`holdings.totalEth`). The residual is the balancing item, not counted: mostly staking yield, plus refunds, other income and unpriced bits. USDC held is outside the ETH total. On 2026-10-24: 55,486 − 20,026 − 13,352 − 20,228 − 443 = 1,437; now 4,117 ETH + $574k USDC, so +2,680 derived.
- **Page:** TREASURY NOW (holdings per holder) → WHERE IT CAME FROM / WHERE IT WENT (the reconciliation as a waterfall, `waterfallSteps` in `model.ts`) → WHAT WAS SPENT (IN / OUT / SOLD FOR USDC tiles, by-kind Sankey, years, recipients). The vote page's Treasury card and the `/stats` corridor HUD link here.
- The 3D view (`Explore3D.tsx`) is an optional explore mode; `Scene.tsx` is the wallet explorer's renderer, not this page's.

### Grand Exchange (3D floor, /exchange and under the Noggles Fountain)

`src/miniapps/exchange3d/`: the order book is `netlify/functions/world-exchange.ts` (in-game COIN only, engine in `src/miniapps/exchange/engine/`).
- **WALK** (default camera, `render/walkMode.ts`): you on foot as your Noun World rider (`ui/me.ts` reads the character select's save; under the fountain the game passes its rider). WASD / arrows, Shift runs, a thumb stick on phones (`ui/Stick.tsx`); the camera pulls in at walls (`fitInHall`). V toggles VAST and back.
- **Multiplayer** (`net/`): its own room `noun-world-v2-exchange` on the PartyServer worker, plain `world:move` packets with the extras in the `state` blob (`gx: 1` marks an Exchange walker, `gt` = public exchange tag, `go: [seq, toTag]` = "I just sent you an offer, look now"). No worker change. `?offline=1` stays off the room unless `?mp=1`; `VITE_PARTYKIT_HOST` points it at a local `wrangler dev`.
- **Trading** (`ui/TradePanel.tsx`, logic `sim/tradeForm.ts`): click / tap a player, rider or bot for a direct deal (`engine/deals.ts`: offer / accept / decline, 90 s); a simulated trader gets a limit order on the real book. Targets are masked tags only; the server resolves a tag to its account when offered (`toOwner`, never sent out) and only that account can accept. Accounts are opened (`join`) only once another player is in the room or you trade.
- **Crowd**: instanced low-poly Nouns with swinging legs; trouser / shoe colours come from Noun World's `outfitFromSeed` (`sim/outfit.ts` `outfitFor`), the outfit a rig dresses itself in, so the LOD swap never changes clothes. A far LOD (one trouser block) in VAST and the hall copies. Your rider wears your saved outfit and sends it to other players as `of` (Net.ts's key).

### Security headers

`public/_headers` sets `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`, not `DENY`. noun.wtf frames its own pages (the ice cream van page embeds `/icecreamvan-scene/`); other sites still can't frame it.

## Image System

The image generation system spans multiple packages:
- `nouns-assets` contains PNG files and encoded data
- `nouns-sdk` provides SVG building utilities
- Image encoding scripts in `nouns-assets/scripts/`

## Environment Variables

Required for webapp development (prefix with `VITE_`):
- `VITE_CHAIN_ID`: Target blockchain (1 for mainnet, 11155111 for sepolia)
- `VITE_MAINNET_SUBGRAPH`: The Graph endpoint for mainnet
- `VITE_SEPOLIA_SUBGRAPH`: The Graph endpoint for sepolia
- `VITE_ETHERSCAN_API_KEY`: For contract verification
- `VITE_WALLET_CONNECT_V2_PROJECT_ID`: WalletConnect integration

Optional:
- `VITE_MAINNET_JSONRPC` / `VITE_MAINNET_WSRPC`: Override the default RPC. When unset, the webapp uses free public endpoints — primary is `https://ethereum-rpc.publicnode.com` (`src/config.ts:48-56`), with a wagmi-level fallback chain through `1rpc.io` and `eth.merkle.io`. No Infura key is used or required (the free Infura tier started 402'ing under wallet-explorer traffic; see commit `b6a25cee2`). `VITE_INFURA_KEY` is dead and can be removed from GitHub Actions secrets when convenient.
- `VITE_ENABLE_HISTORY`: Enable proposal history features
- `VITE_ENABLE_REDUX_LOGGER`: Enable Redux action logging in dev

### TanStack QueryClient defaults

The root `QueryClient` (`src/index.tsx:64-75`) is tuned for free public RPCs:
- `staleTime: 30_000` — survives tab/route remounts without refetching
- `retry: 1`, exponential backoff capped at 8s
- `refetchOnWindowFocus: false`, `refetchOnReconnect: false`

These exist because the TanStack defaults (staleTime 0, 3 retries, refocus refetch on) were amplifying single 429s from publicnode into 30-call cascades. Per-hook overrides still win — e.g. immutable settled-auction data uses `staleTime: Infinity`.

The root `ErrorBoundary` also swallows RPC-shape render errors (Chrome's `reading 'data'` and Safari's `evaluating '...data'`) so transient RPC failures don't tombstone the whole app.

## Testing

Each package has its own test setup:
- **Assets/SDK**: Node.js with standard test runners
- **Contracts**: Hardhat (TypeScript) + Foundry (Solidity)
- **Webapp**: Vitest + React Testing Library
- **Subgraph**: Matchstick framework

Run `pnpm test` from root to test all packages, or `cd` into specific package for targeted testing.

## Active Migrations (nouns-webapp)

The webapp is undergoing modernization efforts:

### State Management Migration
**From**: Redux Toolkit + Apollo Client  
**To**: TanStack Query for server state, minimal Redux for UI state  
**Guidance**: Prefer TanStack Query for new data fetching, use Redux only for truly global UI state

### Styling Migration  
**From**: CSS Modules + react-bootstrap  
**To**: Tailwind CSS + shadcn/ui  
**Guidance**: Use Tailwind classes and shadcn/ui components for new features

### GraphQL Migration
**From**: Apollo Client with manual queries  
**To**: TanStack Query + GraphQL Codegen with typed `execute()` function  
**Guidance**: New GraphQL queries should use the codegen'd `execute()` pattern

## Code Generation Dependencies

The build process depends on:
1. **Contract ABIs**: Generated from Etherscan via Wagmi CLI
2. **GraphQL Types**: Generated from subgraph schema via GraphQL Codegen
3. **i18n Strings**: Extracted via Lingui macro processing

Always run code generation after:
- Adding new contract interactions
- Modifying GraphQL queries
- Adding new translatable strings

## Feature Flags (nouns-webapp)

Feature toggles in `src/config.ts`:
- `daoGteV3`: DAO v3+ features
- `proposeOnV1`: Legacy proposal creation
- `candidates`: Proposal candidates system
- `fork`: Fork-related functionality

## Documentation Site (nouns-docs)

Located in `packages/nouns-docs/` - Next.js 15 documentation site built with Nextra 4.

### Tech Stack
- **Next.js 15** with App Router
- **Nextra 4** for documentation site generation
- **nextra-theme-docs** for the documentation theme
- **Pagefind** for search functionality
- **Lucide Icons** for UI components

### File Structure
- `app/layout.tsx` - Root layout with Nextra theme configuration
- `app/[[...mdxPath]]/page.tsx` - Dynamic MDX page handler using Nextra's importPage
- `content/` - MDX documentation files (content/index.mdx is the homepage)
- `mdx-components.js` - MDX component configuration merging theme components
- `public/images/` - Static assets including logo and icon
- `public/_pagefind/` - Generated search index (created during build)

### Key Features
- **Pagefind Search**: Automatically generates search index during build via postbuild script
- **Dynamic MDX Pages**: Uses catch-all routing with generateStaticParams for MDX files
- **Theme Configuration**: Custom navbar with logo, footer with copyright, and banner

### Docs-Specific Commands
```bash
# From packages/nouns-docs directory
pnpm dev       # Start development server
pnpm build     # Build application (includes Pagefind search index generation)
pnpm start     # Start production server
```

### Build Process
1. `next build` generates the Next.js application
2. `pagefind --site .next/server/app --output-path public/_pagefind` creates search index

## Local Development with Contracts

For full local development:
1. Start local blockchain: `cd packages/nouns-contracts && pnpm task:run-local`
2. Use hardhat chain ID (31337) in environment
3. Import development private key to MetaMask: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
