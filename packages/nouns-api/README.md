# Nouns API

A [ponder.sh](https://ponder.sh) based API for Nouns. Intended as a replacement for `nouns-subgraph`

## Getting started

Install dependencies

```bash
pnpm i
```

Create a .env file and fill in with your Ethereum node endpoints:

```env
# .env
# At least one of them should be provided.
PONDER_RPC_URL_1="https://<json-rpc-url>"
# A websockets endpoint offers better performance.
PONDER_WS_URL_1="wss://<websockets-url>"
```

Fetch a ponder snapshot for faster historical sync

```bash
pnpm ponder:restore-snapshot
```

Run dev server

```bash
pnpm dev
```

## Sepolia

to run on sepolia, add on .env:

```env
# .env
PONDER_CHAIN=sepolia
PONDER_RPC_URL_11155111="https://<json-rpc-url>"
PONDER_WS_URL_11155111="wss://<websockets-url>"
```

Then start the dev server

```bash
pnpm dev
```

`pnpm ponder:restore-snapshot` also speeds up the sepolia historical sync

## NounV2 fork indexing

The indexer also watches the NounV2 fork (auction house + treasury). Addresses
are read from env vars — when unset they default to the zero address so Ponder
no-ops until the real deploy lands.

```env
# .env
# NounV2 fork (see packages/nouns-contracts/contracts/nounv2/*)
NOUNV2_AUCTION_HOUSE_ADDRESS="0x0000000000000000000000000000000000000000"
NOUNV2_TREASURY_ADDRESS="0x0000000000000000000000000000000000000000"
# Block number to start indexing from, or the literal "latest" (default).
# Use the NounV2 deploy block once known to avoid scanning historical logs.
NOUNV2_START_BLOCK="latest"
```

REST endpoints exposed by the API:

- `GET /api/nounv2-proposals` — list with derived status
- `GET /api/nounv2-proposals/:id` — single proposal with votes + actions + status changes
- `GET /api/nounv2-auctions` — full auction history from the indexer (with bids)
- `GET /api/nounv2-auction/current` — live on-chain auction state (direct RPC)

## Deploying

Deploy on railway.app following the guide on https://ponder.sh/docs/production/railway

you can use [railway.json](./railway.json) for the service configs
