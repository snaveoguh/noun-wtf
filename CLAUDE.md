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

- **Intro ident** (`home/Intro.tsx`, once per browser session, `?intro=1` forces it, `?intro=hold` freezes it): the canonical noggles alone, built pixel for pixel from `glasses-square-red` (16x5, `#f3322c`); never redraw them by hand. About 4.2 s, with the sound (`ident()` in `home/sound.ts`) timed to the frame build and the eyes landing.
- **Hero voice-over:** `public/home/vo-intro.mp3` (Piper, LibriTTS-R CC BY 4.0) plays once per page view on the brand slide when sound is on; the rules are in `home/voiceOver.ts`.
- **Shelf covers:** portrait posters in `public/home/covers/*.webp`, wired in `home/rows.ts`. Pages without one get generated box art (`boxArt.ts`).
- Brand lettering (hero titles, header wordmark) carries `data-keep-font` so the site font switcher can't replace Pip3 there.

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
