# @nouns/webapp

This package contains the source for the Nouns webapp at [nouns.wtf](https://nouns.wtf).

## Quickstart

_From the base of the `nouns-monorepo`_

In the first shell:

```sh
# Install all dependencies and build contract artifacts
pnpm install
# Switch to nouns-contracts
cd packages/nouns-contracts
# Start local simnet
pnpm task:run-local
```

In the second shell:

```sh
# Switch to nouns-webapp
cd packages/nouns-webapp
# Copy local example environment file
cp .env.example.local .env
# Start local development
pnpm start
```

### MetaMask

Interact with the local simnet by importing the following private key into MetaMask. _Do not use this private key anywhere else_

```
Private Key:
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Then add an RPC provider to MetaMask to point to your local simnet.

1.  Navigate to settings
2.  Select `Networks`
3.  Click `Add Network`
4.  Enter the following:

         Network Name: Hardhat
         New RPC URL: http://localhost:8545
         Chain ID: 31337

Select the network and connect to your local Nouns webapp to interact with simnet

## Farcaster mini app (Noun World)

`noun.wtf/world` runs as a Farcaster mini app. What's in the repo:

- **Manifest:** `public/.well-known/farcaster.json` (name, icon, splash, home URL `https://noun.wtf/world`, category `games`). The images in `public/fc/` are drawn by `netlify/lib/fcAssets.ts`; `WRITE_FC=1 npx vitest run netlify/lib/fcAssets.test.ts` redraws them.
- **Embeds:** `/world` and every play-as link (`/world?seed=<key>`) carry `fc:miniapp` (and the older `fc:frame`) meta, added by `netlify/functions/og-proposal.ts`. A cast with the link shows the rider card and a **PLAY AS ME** button that opens the game in place.
- **Runtime:** `src/miniapps/world2/share/miniApp.ts` loads the SDK from esm.sh only inside a Farcaster client, applies the host's safe areas to the HUD (`--w2-safe-*`), and calls `sdk.actions.ready()` so the splash goes away. In-game SHARE opens a cast there.
- **Framing:** Farcaster's web client opens mini apps in an iframe, so `/world` (served by og-proposal) sends `frame-ancestors 'self' https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com`. Every other page keeps `'self'` only.

### What the owner must do (once)

The manifest's `accountAssociation` is empty: it proves noun.wtf belongs to a Farcaster account, and only that account can sign it.

1. On a phone, in the Farcaster app, open **Settings → Developer** (turn on Developer mode first if it isn't there), then **Domains** / the [Mini App manifest tool](https://farcaster.xyz/~/developers/mini-apps/manifest).
2. Enter the domain `noun.wtf` (no `https://`, no path) and generate the account association. It's signed with your FID's custody key.
3. Copy the `header`, `payload` and `signature` it gives you into `accountAssociation` in `public/.well-known/farcaster.json`. Commit, push to `staging`, check, then `main`.
4. Check it: open `https://noun.wtf/.well-known/farcaster.json` (it must be served as JSON, not the SPA), then paste `https://noun.wtf/world?seed=0-13-60-120-15` into the [embed tool](https://farcaster.xyz/~/developers/mini-apps/embed): it should show the card with PLAY AS ME and launch the game.
5. Optional: `curl -sI https://noun.wtf/world | grep -i -E "content-security|x-frame"` should show the Farcaster `frame-ancestors` and no `X-Frame-Options: SAMEORIGIN` (if Netlify adds the site-wide `_headers` on top of the function's own headers, the web client can't frame it: then move the site-wide frame headers off `/world`).

The signed association is tied to the domain: the dev site (`dev-noun-wtf.netlify.app`) needs its own if you want to test it as a mini app there.
