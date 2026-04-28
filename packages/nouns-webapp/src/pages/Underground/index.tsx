import { useState } from 'react';
import { Link } from 'react-router';

import styles from './Underground.module.css';

const API = 'https://spirited-flexibility-production-3c30.up.railway.app';
const TREASURY = '0xBAc9233725440c595b19d975309CC98cb259253a';

// ── sections ────────────────────────────────────────────────────────────

const sections = [
  'WHAT IS NOUNS',
  'ARCHITECTURE',
  'CONTRACTS',
  'GRAPHQL',
  'REST API',
  'AGENT NOUNIRL',
  'SMALL GRANTS',
  'TERMINAL',
  'LOCAL DEV',
  'ENV VARS',
  'BUILD IDEAS',
] as const;

type Section = (typeof sections)[number];

// ── component ───────────────────────────────────────────────────────────

export default function UndergroundPage() {
  const [open, setOpen] = useState<Set<Section>>(new Set());

  function toggle(s: Section) {
    setOpen(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  const isOpen = (s: Section) => open.has(s);

  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        {/* header */}
        <pre className={styles.ascii}>{`
 _   _ _   _
| \\ | | | | |
|  \\| | | | |
| . \` | |_| |
|_|\\__|\\___/
        `.trim()}</pre>
        <h1 className={styles.title}>NOUNS UNDERGROUND</h1>
        <p className={styles.sub}>
          Everything you need to build on the noun.wtf stack.
          <br />
          Contracts, APIs, indexer, autonomous agent. Client ID 37.
        </p>
        <p className={styles.hint}>Click a section to expand.</p>

        {/* ── WHAT IS NOUNS ────────────────────────────────────── */}
        <Heading s="WHAT IS NOUNS" isOpen={isOpen} toggle={toggle} />
        {isOpen('WHAT IS NOUNS') && (
          <div className={styles.section}>
            <p>One Noun is auctioned every 24 hours, forever. Proceeds go to the DAO treasury (~$50M+). Noun holders (1 NFT = 1 vote) govern the treasury through onchain proposals.</p>

            <Table headers={['Concept', 'What It Means']} rows={[
              ['Noun', 'ERC-721 NFT with procedurally generated pixel art (5 traits: background, body, accessory, head, glasses)'],
              ['Auction', '24hr English auction for each new Noun. Winner gets the NFT + 1 governance vote'],
              ['Proposal', 'Onchain executable code (send ETH, call contracts) requiring majority vote to pass'],
              ['Candidate', 'Offchain proposal draft that needs sponsor signatures before going onchain'],
              ['Delegation', 'Noun holders can delegate their votes to another address'],
              ['Stream', 'Continuous payment stream from treasury to a recipient over time'],
              ['Client Incentive', 'Protocol rewards for frontends that facilitate votes/bids (identified by client ID)'],
            ]} />

            <h4>Key Addresses</h4>
            <Code>{`NounsToken:          0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03
NounsAuctionHouseV2: 0x830BD73E4184ceF73443C15111a1DF14e495C706
NounsDAOV4:          0x6f3E6272A167e8AcCb32072d08E0957F9c79223d
NounsDAOData:        0xf790A5f59678dd733fb3De93493A91f472ca1365
StreamFactory:       0x0fd206FC7A7dBcD5661157eDCb1FFDD0D02A61ff
SmallGrantsTreasury: ${TREASURY}`}</Code>
          </div>
        )}

        {/* ── ARCHITECTURE ─────────────────────────────────────── */}
        <Heading s="ARCHITECTURE" isOpen={isOpen} toggle={toggle} />
        {isOpen('ARCHITECTURE') && (
          <div className={styles.section}>
            <Code>{`                    +------------------+
                    |   noun.wtf SPA   |  Vite + React + wagmi
                    |   (Netlify CDN)  |
                    +--------+---------+
                             |
                +------------+------------+
                |                         |
       +--------v--------+       +-------v----------+
       | Ponder GraphQL  |       | Ethereum Mainnet |
       | (Railway)        |       | (via Infura RPC) |
       +--------+--------+       +------------------+
                |
       +--------v--------+
       | PostgreSQL 5GB  |
       | (Railway)        |
       +-----------------+`}</Code>
            <p>The frontend is a pure client-side SPA. It talks to:</p>
            <ul>
              <li><strong>Ponder API</strong> — indexed historical data (proposals, votes, auctions, etc.)</li>
              <li><strong>Ethereum RPC</strong> — live reads + write transactions via wagmi/viem in the browser</li>
            </ul>
            <p>Ponder watches the chain via Infura, indexes events into Postgres, and exposes GraphQL automatically from the schema.</p>

            <Table headers={['Layer', 'Stack']} rows={[
              ['Frontend', 'Vite 6, React 19, wagmi v2, viem, RainbowKit, Jotai, Tailwind'],
              ['Indexer', 'Ponder v0.16, Hono, Drizzle ORM, PostgreSQL'],
              ['Agent', 'Anthropic SDK (Claude), ethers for settlement, Neynar for Farcaster'],
              ['Contracts', 'Solidity 0.8.24, Foundry'],
            ]} />
          </div>
        )}

        {/* ── CONTRACTS ────────────────────────────────────────── */}
        <Heading s="CONTRACTS" isOpen={isOpen} toggle={toggle} />
        {isOpen('CONTRACTS') && (
          <div className={styles.section}>
            <h4>Mainnet — Indexed by Ponder</h4>
            <Table headers={['Contract', 'Address', 'Start Block', 'Events']} rows={[
              ['NounsAuctionHouseV2', '0x830BD73E...', '12,985,451', 'AuctionCreated, AuctionBid, AuctionSettled'],
              ['NounsToken', '0x9C8fF314...', '12,985,438', 'NounCreated, Transfer, DelegateChanged, DelegateVotesChanged'],
              ['NounsDAOV4', '0x6f3E6272...', '12,985,453', 'ProposalCreated, VoteCast, ProposalQueued/Executed/Canceled/Vetoed'],
              ['NounsDAOData', '0xf790A5f5...', '17,812,145', 'CandidateCreated/Updated/Canceled, SignatureAdded, FeedbackSent'],
              ['StreamFactory', '0x0fd206FC...', '16,576,500', 'StreamCreated'],
              ['Stream', '(factory children)', '16,576,500', 'TokensWithdrawn, StreamCancelled, StreamConcluded'],
              ['SmallGrantsTreasury', '0xBAc92337...', '24,650,190', 'ProposalCreated, VoteCast, Queued/Executed/Canceled'],
            ]} />

            <h4>Sepolia Testnet</h4>
            <Code>{`NounsToken:          0x4C4674bb72a096855496a7204962297bd7e12b85
NounsAuctionHouseV2: 0x488609b7113FCf3B761A05956300d605E8f6BcAf
NounsDAOV4:          0x35d2670d7C8931AACdd37C89Ddcb0638c3c44A57
NounsDAOData:        0x9040f720AA8A693f950b9cF94764b4b06079D002
StreamFactory:       0xb78ccF3BD015f209fb9B2d3d132FD8784Df78DF5`}</Code>
          </div>
        )}

        {/* ── GRAPHQL ──────────────────────────────────────────── */}
        <Heading s="GRAPHQL" isOpen={isOpen} toggle={toggle} />
        {isOpen('GRAPHQL') && (
          <div className={styles.section}>
            <p>
              <strong>Endpoint:</strong>{' '}
              <a href={`${API}/graphql`} target="_blank" rel="noreferrer" className={styles.link}>{API}/graphql</a>
            </p>
            <p>POST JSON <code>{`{ "query": "..." }`}</code>. Full Ponder GraphQL with filtering, ordering, pagination.</p>
            <p className={styles.warn}>All plural queries return <code>{`{ items: [...] }`}</code> — this is Ponder v0.12+ convention.</p>

            <h4>Nouns</h4>
            <Code>{`{
  nouns(orderBy: "id", orderDirection: "desc", limit: 10) {
    items {
      id owner head body accessory glasses background
      createdAt createdAtBlock
    }
  }
}`}</Code>

            <h4>Proposals</h4>
            <Code>{`{
  proposals(orderBy: "id", orderDirection: "desc", limit: 20) {
    items {
      id proposer description
      status           # PENDING | ACTIVE | CANCELLED | VETOED | QUEUED | EXECUTED
      forVotes againstVotes abstainVotes
      startBlock endBlock executionETA
      clientId         # 37 = noun.wtf
    }
  }
}`}</Code>

            <h4>Votes</h4>
            <Code>{`{
  votes(where: { proposalId: "123" }, orderBy: "createdAtBlock", orderDirection: "desc") {
    items {
      voter proposalId
      support          # 0=AGAINST, 1=FOR, 2=ABSTAIN
      votes reason clientId
    }
  }
}`}</Code>

            <h4>Auctions + Bids</h4>
            <Code>{`{
  auctions(orderBy: "nounId", orderDirection: "desc", limit: 10) {
    items { nounId startTime endTime settled winner amount clientId }
  }
  bids(where: { nounId: "1234" }, orderBy: "value", orderDirection: "desc") {
    items { nounId bidder value clientId }
  }
}`}</Code>

            <h4>Delegates</h4>
            <Code>{`{
  delegates(orderBy: "delegatedVotes", orderDirection: "desc", limit: 50) {
    items { id delegatedVotes }
  }
}`}</Code>

            <h4>Streams</h4>
            <Code>{`{
  streams(orderBy: "startTime", orderDirection: "desc") {
    items {
      streamAddress proposalId status
      creator payer recipient
      tokenAmount withdrawnAmount startTime stopTime
    }
  }
}`}</Code>

            <h4>Candidates + Signatures</h4>
            <Code>{`{
  candidates(orderBy: "createdAt", orderDirection: "desc", limit: 20) {
    items { id slug proposer canceled versionsCount description createdAt }
  }
}`}</Code>

            <h4>Grants + Grant Votes</h4>
            <Code>{`{
  grants(orderBy: "id", orderDirection: "desc") {
    items {
      id proposer description status
      forVotes againstVotes abstainVotes
      startBlock endBlock executionETA
    }
  }
  grantVotes(where: { grantId: "1" }) {
    items { voter grantId support votes reason }
  }
}`}</Code>

            <h4>Single Item Lookup</h4>
            <Code>{`{ proposal(id: "123") { id status description forVotes againstVotes } }
{ grant(id: "1") { id proposer status forVotes } }
{ noun(id: "500") { id owner head body accessory glasses } }`}</Code>

            <h4>Filtering</h4>
            <Code>{`{
  votes(where: { voter: "0x1234...", support: 1 }) {
    items { proposalId votes reason }
  }
}`}</Code>
          </div>
        )}

        {/* ── REST API ─────────────────────────────────────────── */}
        <Heading s="REST API" isOpen={isOpen} toggle={toggle} />
        {isOpen('REST API') && (
          <div className={styles.section}>
            <p><strong>Base URL:</strong> <a href={API} target="_blank" rel="noreferrer" className={styles.link}>{API}</a></p>

            <h4>Activity Feed</h4>
            <Code>{`GET /api/activity?type=VOTE&limit=50&before=12345678`}</Code>
            <p>Types: <code>VOTE</code>, <code>AUCTION_BID</code>, <code>AUCTION_SETTLED</code>, <code>PROPOSAL_CREATED</code>, <code>PROPOSAL_STATUS_CHANGE</code>, <code>DELEGATION</code>, <code>TRANSFER</code>, <code>STREAM_CREATED</code>, <code>CANDIDATE_CREATED</code>, <code>CANDIDATE_UPDATED</code>, <code>CANDIDATE_CANCELED</code>, <code>SIGNATURE_ADDED</code>, <code>FEEDBACK_SENT</code>, <code>GRANT_CREATED</code>, <code>GRANT_VOTE</code>, <code>GRANT_QUEUED</code>, <code>GRANT_EXECUTED</code>, <code>GRANT_CANCELED</code></p>
            <p>Omit <code>type</code> for all events mixed.</p>
            <Code>{`// Response
{
  "events": [
    {
      "type": "VOTE",
      "blockNumber": 12345678,
      "timestamp": "2026-03-13T...",
      "txHash": "0x...",
      "data": { "voter": "0x...", "proposalId": 123, "support": 1, "votes": 4 }
    }
  ],
  "hasMore": true,
  "oldestBlock": 12345000
}`}</Code>

            <h4>Other Endpoints</h4>
            <Table headers={['Endpoint', 'Method', 'Description']} rows={[
              ['/api/feed/:channel', 'GET', 'Farcaster feed (/nouns, /noc) via Neynar'],
              ['/api/ens?address=0x...', 'GET', 'ENS name resolution (forward + reverse)'],
              ['/api/noun-holders', 'GET', 'Noun holder leaderboard with ENS'],
              ['/api/ascii-image?nounId=123', 'GET', 'ASCII art of a Noun'],
              ['/api/og/proposal/:id', 'GET', 'Open Graph image for social sharing'],
              ['/api/treasury/flows', 'GET', 'Treasury payment flow data'],
              ['/api/sketch/latest', 'GET', 'User-created noun sketches'],
              ['/api/health', 'GET', 'Health check'],
            ]} />
          </div>
        )}

        {/* ── AGENT NOUNIRL ────────────────────────────────────── */}
        <Heading s="AGENT NOUNIRL" isOpen={isOpen} toggle={toggle} />
        {isOpen('AGENT NOUNIRL') && (
          <div className={styles.section}>
            <p><code>nounirl.eth</code> — an autonomous onchain agent that settles Nouns auctions when specific traits appear.</p>

            <h4>How It Works</h4>
            <ol>
              <li>Tip {'>'}= 0.002 ETH to nounirl.eth (Ethereum, Base, Optimism, Arbitrum, or Zora)</li>
              <li>Specify desired traits: "shark head AND blue noggles"</li>
              <li>Agent monitors every block, predicts next Noun traits via NounsSeeder algorithm</li>
              <li>Automatically settles auction when match found + auction ended</li>
            </ol>

            <h4>Trait Counts</h4>
            <Code>{`background:  2  (cool, warm)
body:       31
accessory: 144
head:      258
glasses:    24`}</Code>

            <h4>Agent Endpoints</h4>
            <Table headers={['Endpoint', 'Method', 'Description']} rows={[
              ['/api/agent/status', 'GET', 'Running state, block, predictions, balance'],
              ['/api/agent/predict', 'GET', 'Predicted traits for next Noun'],
              ['/api/agent/reserve', 'POST', 'Create trait reservation (tip tx hash required)'],
              ['/api/agent/reservations', 'GET', 'List reservations (?wallet=0x...)'],
              ['/api/agent/cancel/:id', 'POST', 'Cancel a reservation'],
              ['/api/agent/check', 'POST', 'Force manual block check'],
              ['/api/agent/traits/:category', 'GET', 'Trait names for category'],
              ['/api/agent/parse-traits', 'POST', 'Natural language to structured traits'],
              ['/api/agent/settlements', 'GET', 'Settlement history'],
              ['/api/agent/deploys', 'GET', 'Autonomous deploy history'],
              ['/api/agent/deploy', 'POST', 'Trigger code deploy (>= 4 Nouns required)'],
            ]} />
          </div>
        )}

        {/* ── SMALL GRANTS ─────────────────────────────────────── */}
        <Heading s="SMALL GRANTS" isOpen={isOpen} toggle={toggle} />
        {isOpen('SMALL GRANTS') && (
          <div className={styles.section}>
            <p>
              <strong>Contract:</strong>{' '}
              <a href={`https://etherscan.io/address/${TREASURY}`} target="_blank" rel="noreferrer" className={styles.link}>{TREASURY}</a>
            </p>
            <p>noun.wtf-exclusive micro-governance. Combined governor + treasury, single contract.</p>

            <Table headers={['Parameter', 'Value']} rows={[
              ['Voting delay', '0 blocks (immediate)'],
              ['Voting period', '3,600 blocks (~12 hours)'],
              ['Timelock', '43,200 seconds (12 hours)'],
              ['Grace period', '604,800 seconds (7 days)'],
              ['Max operations', '10 per proposal'],
              ['Quorum', 'NONE. 1 FOR / 0 AGAINST passes.'],
            ]} />

            <h4>Lifecycle</h4>
            <Code>{`propose() -> ACTIVE (12hr vote) -> SUCCEEDED -> queue() -> QUEUED (12hr) -> execute()
                                 -> DEFEATED (for <= against)`}</Code>

            <h4>Functions</h4>
            <Code>{`propose(targets[], values[], signatures[], calldatas[], description) -> proposalId
castVote(proposalId, support)        // 0=against, 1=for, 2=abstain
castVoteWithReason(proposalId, support, reason)
queue(proposalId)
execute(proposalId)
cancel(proposalId)
state(proposalId) -> ProposalState`}</Code>

            <p>Voting power reads from <code>NounsToken.getPriorVotes(account, snapshotBlock)</code>. Fund the treasury by sending ETH directly to the contract.</p>
            <p><Link to="/grants" className={styles.link}>Go to Grants page &rarr;</Link></p>
          </div>
        )}

        {/* ── TERMINAL ─────────────────────────────────────────── */}
        <Heading s="TERMINAL" isOpen={isOpen} toggle={toggle} />
        {isOpen('TERMINAL') && (
          <div className={styles.section}>
            <p>The terminal (now consolidated into the homepage feed at <Link to="/" className={styles.link}>noun.wtf</Link> in terminal mode) provides AI chat backed by Claude with governance tool access.</p>

            <h4>POST /api/chat</h4>
            <Code>{`{
  "message": "vote for prop 948",
  "wallet": "0xae4705dc...",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}`}</Code>

            <p>When the agent wants to execute governance, it returns a <code>pending_action</code>:</p>
            <Code>{`{
  "message": "prepared your vote...",
  "pending_action": {
    "type": "GRANT_VOTE",
    "grantId": 1,
    "support": 1,
    "reason": "testing"
  }
}`}</Code>

            <h4>Action Types</h4>
            <Table headers={['Type', 'What It Does']} rows={[
              ['VOTE', 'Vote on DAO proposal (gas refunded via client ID 37)'],
              ['PROPOSAL_FEEDBACK', 'Signal on a proposal'],
              ['CANDIDATE_FEEDBACK', 'Signal on a candidate'],
              ['CREATE_CANDIDATE', 'Create proposal candidate'],
              ['SPONSOR', 'EIP-712 sponsor signature for a candidate'],
              ['PROMOTE', 'Promote candidate to onchain proposal'],
              ['BID', 'Bid on current Noun auction'],
              ['GRANT_VOTE', 'Vote on Small Grants proposal'],
              ['GRANT_PROPOSAL', 'Create Small Grants proposal'],
            ]} />

            <p>Rate limits: 10 msg/min, 50 msg/day per wallet.</p>
          </div>
        )}

        {/* ── LOCAL DEV ────────────────────────────────────────── */}
        <Heading s="LOCAL DEV" isOpen={isOpen} toggle={toggle} />
        {isOpen('LOCAL DEV') && (
          <div className={styles.section}>
            <h4>Prerequisites</h4>
            <ul>
              <li>Node.js {'>'}= 18</li>
              <li>pnpm 10.x</li>
              <li>PostgreSQL (for Ponder) or use the production API</li>
              <li>Infura API key (free tier works, just slow)</li>
            </ul>

            <h4>Frontend</h4>
            <Code>{`git clone <repo>
cd noun-wtf && pnpm install
cd packages/nouns-webapp

cat > .env << 'EOF'
VITE_CHAIN_ID=1
VITE_MAINNET_JSONRPC=https://ethereum-rpc.publicnode.com
VITE_MAINNET_SUBGRAPH=https://spirited-flexibility-production-3c30.up.railway.app
EOF

CI=true pnpm dev    # runs at localhost:5173`}</Code>

            <h4>Ponder Indexer</h4>
            <Code>{`cd packages/nouns-api

cat > .env.local << 'EOF'
PONDER_RPC_URL_1=https://mainnet.infura.io/v3/YOUR_KEY
DATABASE_URL=postgresql://user:pass@localhost:5432/nouns
EOF

pnpm dev    # GraphQL at localhost:42069/graphql`}</Code>

            <p className={styles.warn}>Full sync from block 12,985,438 takes ~8-12 hours at 2 RPS. Data is queryable immediately during backfill.</p>
            <p className={styles.warn}>Do NOT add free public RPCs to Ponder. Stream factory (38+ addresses) crashes free providers.</p>

            <h4>Monorepo Structure</h4>
            <Code>{`packages/
  nouns-webapp/     Vite + React frontend
  nouns-api/        Ponder indexer + API + Agent
  nouns-sdk/        Shared SDK utilities
  nouns-assets/     Trait image assets
  nouns-contracts/  Solidity contracts`}</Code>
          </div>
        )}

        {/* ── ENV VARS ─────────────────────────────────────────── */}
        <Heading s="ENV VARS" isOpen={isOpen} toggle={toggle} />
        {isOpen('ENV VARS') && (
          <div className={styles.section}>
            <h4>Frontend</h4>
            <Table headers={['Variable', 'Required', 'Description']} rows={[
              ['VITE_CHAIN_ID', 'Yes', '1 (mainnet) or 11155111 (Sepolia)'],
              ['VITE_MAINNET_JSONRPC', 'Yes', 'Ethereum RPC URL'],
              ['VITE_MAINNET_SUBGRAPH', 'Yes', 'Ponder API URL'],
              ['VITE_WALLET_CONNECT_V2_PROJECT_ID', 'No', 'WalletConnect project ID'],
              ['VITE_ETHERSCAN_API_KEY', 'No', 'For wagmi codegen (skipped in CI)'],
            ]} />

            <h4>Ponder API</h4>
            <Table headers={['Variable', 'Required', 'Description']} rows={[
              ['PONDER_RPC_URL_1', 'Yes', 'Infura mainnet RPC'],
              ['DATABASE_URL', 'No', 'Postgres (defaults to SQLite)'],
              ['PONDER_CHAIN', 'No', 'mainnet or sepolia'],
              ['ANTHROPIC_API_KEY', 'No', 'Claude API key for terminal chat'],
              ['NOUNIRL_ADDRESS', 'No', 'Agent wallet (enables agent endpoints)'],
              ['NOUNIRL_PRIVATE_KEY', 'No', 'Agent signer (enables settlement)'],
            ]} />
          </div>
        )}

        {/* ── BUILD IDEAS ──────────────────────────────────────── */}
        <Heading s="BUILD IDEAS" isOpen={isOpen} toggle={toggle} />
        {isOpen('BUILD IDEAS') && (
          <div className={styles.section}>
            <h4>Data / Analytics</h4>
            <ul>
              <li><strong>Voter influence graph</strong> — map delegates + votes to visualize who influences what</li>
              <li><strong>Client ID leaderboard</strong> — track which frontends drive the most governance activity</li>
              <li><strong>Proposal outcome predictor</strong> — historical vote patterns to predict active proposals</li>
              <li><strong>Treasury flow viz</strong> — streams + executions = where the money goes</li>
            </ul>

            <h4>Governance Tools</h4>
            <ul>
              <li><strong>Delegation marketplace</strong> — match holders with aligned delegates via vote history</li>
              <li><strong>Proposal diff viewer</strong> — track ProposalUpdated events, show what changed</li>
              <li><strong>Grant templates</strong> — pre-built SmallGrantsTreasury proposals for common requests</li>
              <li><strong>Multi-sig voting</strong> — coordinated voting across multiple Noun holders</li>
            </ul>

            <h4>Agent Extensions</h4>
            <ul>
              <li><strong>Custom settlement strategies</strong> — fork the trait predictor for different goals</li>
              <li><strong>Cross-DAO agent</strong> — extend nounirl to Lil Nouns, Purple, etc.</li>
              <li><strong>Farcaster/Telegram bot</strong> — pipe terminal chat into social</li>
            </ul>

            <h4>Onchain</h4>
            <ul>
              <li><strong>Extend SmallGrantsTreasury</strong> — recurring grants, milestones, quadratic voting</li>
              <li><strong>Sponsorship market</strong> — candidates need signatures; build a matching market</li>
              <li><strong>Noun fractionalization</strong> — split voting power across wallets</li>
            </ul>
          </div>
        )}

        {/* footer */}
        <div className={styles.footer}>
          <span>noun.wtf — client 37</span>
          <a href="https://etherscan.io/address/0xBAc9233725440c595b19d975309CC98cb259253a" target="_blank" rel="noreferrer" className={styles.link}>SmallGrantsTreasury</a>
          <Link to="/" className={styles.link}>home</Link>
        </div>
      </div>
    </div>
  );
}

// ── sub-components ──────────────────────────────────────────────────────

function Heading({ s, isOpen, toggle }: { s: Section; isOpen: (s: Section) => boolean; toggle: (s: Section) => void }) {
  return (
    <button className={styles.heading} onClick={() => toggle(s)}>
      <span className={styles.caret}>{isOpen(s) ? '[-]' : '[+]'}</span>
      {s}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return <pre className={styles.code}>{children}</pre>;
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
