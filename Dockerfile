FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pnpm
RUN npm i -g pnpm@10

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc* ./
COPY packages/nouns-api/package.json ./packages/nouns-api/
COPY packages/nouns-sdk/package.json ./packages/nouns-sdk/
COPY packages/nouns-contracts/package.json ./packages/nouns-contracts/
COPY packages/vote-permit/package.json ./packages/vote-permit/

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source files
COPY packages/nouns-sdk/ ./packages/nouns-sdk/
COPY packages/nouns-api/ ./packages/nouns-api/
COPY packages/nouns-contracts/ ./packages/nouns-contracts/
COPY packages/vote-permit/ ./packages/vote-permit/

# Build SDK (dependency of API)
RUN pnpm build --filter=@nouns/sdk

EXPOSE 8080

# Start ponder - use shell form so $RAILWAY_DEPLOYMENT_ID is expanded
CMD pnpm --filter @nouns/api -- start --schema $RAILWAY_DEPLOYMENT_ID
