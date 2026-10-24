import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Link } from 'react-router';

import { CATALOG } from '@/components/NounOS/catalog';
import { NOGGLES } from '@/components/NounOS/home/introScene';
import { DEFAULT_API_BASE as API } from '@/lib/api';

import { API_GROUPS, ALL_ROUTES, type ApiRoute } from './apiRoutes';
import styles from './Underground.module.css';

const SMALL_GRANTS = '0xBAc9233725440c595b19d975309CC98cb259253a';
const PARTY_HOST = 'noun-wtf-party.hugoevans92.workers.dev';
const etherscan = (a: string) => `https://etherscan.io/address/${a}`;

// ── the directory tree (nav + section order) ────────────────────────────

const DIRS = [
  ['surface', 'what nouns is'],
  ['pipes', 'how it’s wired'],
  ['contracts', 'addresses'],
  ['graphql', 'query the index'],
  ['api', `${ALL_ROUTES.length} rest routes`],
  ['agent', 'nounirl.eth'],
  ['grants', 'small grants'],
  ['terminal', 'chat + drafts'],
  ['functions', 'netlify'],
  ['multiplayer', 'durable objects'],
  ['dev', 'run it locally'],
  ['build', 'ideas'],
  ['apps', 'everything we made'],
] as const;

type Dir = (typeof DIRS)[number][0];

// ── page ────────────────────────────────────────────────────────────────

export default function UndergroundPage() {
  return (
    <div className={styles.root} data-keep-font>
      <div className={styles.crt} aria-hidden />
      <div className={styles.inner}>
        <Boot />
        <StatusBar />
        <Nav />

        <Sec dir="surface" n={1} title="SURFACE">
          <p>
            One Noun is auctioned every 24 hours, forever. The ETH goes to the treasury; holders
            govern it, one Noun one vote, through onchain proposals. Everything is CC0. noun.wtf is
            client <b>37</b>: votes and bids placed here earn the DAO’s client rewards.
          </p>
          <Table
            headers={['Thing', 'What it is']}
            rows={[
              [
                'Noun',
                'ERC-721, 32×32 pixel art from 5 traits: background, body, accessory, head, glasses',
              ],
              [
                'Auction',
                '24h English auction. Winner gets the Noun and its vote. Settling starts the next one',
              ],
              [
                'V4 auction house',
                'Live since 2026-05-25 (Prop 968). No bid → the Noun goes to the treasury, not burned',
              ],
              ['Proposal', 'Executable onchain actions (send ETH, call contracts) passed by vote'],
              ['Candidate', 'An offchain draft that becomes a proposal once enough holders sign'],
              ['Stream', 'Treasury money paid out by the second over a period'],
              [
                'NounV2',
                'The second DAO (launched 2026-04-24): its own token, auction and treasury at /v2',
              ],
            ]}
          />
          <p className={styles.dim}>
            Where the money actually went: <Link to="/nonsense">/nonsense</Link> (holdings,
            reconciliation, every payout).
          </p>
        </Sec>

        <Sec dir="pipes" n={2} title="PIPES">
          <Code>{`  browser ── noun.wtf SPA ──────────────── Netlify CDN
     │       Vite · React 19 · wagmi/viem      └─ /.netlify/functions/*  (Blobs)
     │
     ├── reads/writes ──► Ethereum mainnet
     │                    publicnode → 1rpc → merkle (wagmi fallback, no keys)
     │
     ├── history ──────► Ponder API ─── Postgres          Railway
     │                    GraphQL + ${ALL_ROUTES.length} REST routes
     │                    indexer RPC: Tenderly gateway + MEV Blocker
     │                    syncWatchdog restarts it if the sync stalls
     │
     └── multiplayer ──► PartyServer on Cloudflare Durable Objects
                          ${PARTY_HOST}`}</Code>
          <Table
            headers={['Layer', 'Stack']}
            rows={[
              ['Frontend', 'Vite 6, React 19, wagmi + viem, TanStack Query, Tailwind, Lingui'],
              [
                'Indexer / API',
                'Ponder 0.16, Hono, Drizzle, Postgres. New schema per deploy, re-syncs from scratch',
              ],
              [
                'Serverless',
                'Netlify Functions + Netlify Blobs (uploads, Noun World saves, voice clips)',
              ],
              ['Agent', 'Claude via the Anthropic SDK, viem for settling, Neynar for Farcaster'],
              ['Multiplayer', 'PartyServer (Cloudflare Workers + Durable Objects)'],
              ['Contracts', 'Solidity, Foundry + Hardhat'],
            ]}
          />
          <h4>Shipping</h4>
          <Code>{`push staging   →  dev-noun-wtf.netlify.app      (GitHub Actions)
push main      →  noun.wtf                      (GitHub Actions)
railway up     →  the API   — by hand, from the REPO ROOT (root Dockerfile)
wrangler deploy → multiplayer — by hand, from packages/nouns-party`}</Code>
          <p className={styles.warn}>
            Pushing never deploys the API. Run <code>railway up</code> from the repo root; a{' '}
            <code>.railwayignore</code> keeps the upload to the API’s ~11 MB.
          </p>
        </Sec>

        <Sec dir="contracts" n={3} title="CONTRACTS">
          <h4>Nouns DAO · mainnet</h4>
          <Addrs
            rows={[
              ['NounsToken', '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03'],
              ['Auction house (proxy, V4)', '0x830BD73E4184ceF73443C15111a1DF14e495C706'],
              ['Governor (DAO V4)', '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d'],
              ['nouns.eth (Timelock V2)', '0xb1a32FC9F9D8b2cf86C068Cae13108809547ef71'],
              ['Timelock V1 (legacy)', '0x0BC3807Ec262cB779b38D65b38158acC3bfedE10'],
              ['NounsDAOData (candidates)', '0xf790A5f59678dd733fb3De93493A91f472ca1365'],
              ['Descriptor', '0x33A9c445fb4FB21f2c030A6b2d3e2F12D017BFAC'],
              ['Stream factory', '0x0fd206FC7A7dBcD5661157eDCb1FFDD0D02A61ff'],
              ['USDC payer', '0xd97Bcd9f47cEe35c0a9ec1dc40C1269afc9E8E1D'],
              ['Token buyer', '0x4f2aCdc74f6941390d9b1804faBc3E780388cfe5'],
              ['Client rewards (proxy)', '0x883860178F95d0C82413eDc1D6De530cB4771d55'],
              ['nounders.eth', '0x2573C60a6D127755aA2DC85e342F7da2378a0Cc5'],
            ]}
          />
          <h4>NounV2 · mainnet</h4>
          <Addrs
            rows={[
              ['NounV2Token', '0xb1d6bdf9326dd09183c2e9d25af5e22c637293b9'],
              ['NounV2 auction house', '0x9a6ddb16e23967d5482e5bfd7444a04a5d5145fc'],
              ['NounV2 treasury + governor', '0x2cdeb0d251674710840d9fa990d1de138dfe7c00'],
            ]}
          />
          <h4>Ours + friends</h4>
          <Addrs
            rows={[
              ['SmallGrantsTreasury (noun.wtf)', SMALL_GRANTS],
              ['Lil Nouns governor', '0x5d2C31ce16924C2a71D317e5BbFd5ce387854039'],
            ]}
          />
          <h4>What the indexer watches</h4>
          <Table
            headers={['Source', 'Events']}
            rows={[
              ['NounsToken', 'NounCreated, Transfer, DelegateChanged, DelegateVotesChanged'],
              [
                'Auction house',
                'AuctionCreated, AuctionBid, AuctionSettled (+ ownerOf after settle: burned vs treasury)',
              ],
              ['Governor', 'Proposals, votes, status changes, forks, config'],
              ['NounsDAOData', 'Candidates, signatures, feedback'],
              ['Stream factory + streams', 'StreamCreated, withdrawals, cancels'],
              ['nouns.eth', 'ETHSent / ERC20Sent (fork payouts)'],
              ['SmallGrantsTreasury', 'Grants, votes, status changes'],
              ['NounV2 auction + treasury', 'Auctions, bids, proposals, votes'],
              ['Punks, Toadz, ENS', 'Recent history only, for the homepage chain feed'],
            ]}
          />
          <h4>Sepolia</h4>
          <Code>{`NounsToken          0x4C4674bb72a096855496a7204962297bd7e12b85
Auction house       0x488609b7113FCf3B761A05956300d605E8f6BcAf
Governor            0x35d2670d7C8931AACdd37C89Ddcb0638c3c44A57
NounsDAOData        0x9040f720AA8A693f950b9cF94764b4b06079D002
Stream factory      0xb78ccF3BD015f209fb9B2d3d132FD8784Df78DF5`}</Code>
        </Sec>

        <Sec dir="graphql" n={4} title="GRAPHQL">
          <p>
            <b>POST</b>{' '}
            <a href={`${API}/graphql`} target="_blank" rel="noreferrer">
              {API}/graphql
            </a>{' '}
            with <code>{'{ "query": "…" }'}</code>. Open it in a browser for the GraphiQL explorer.
          </p>
          <p className={styles.warn}>
            Plural queries return <code>{'{ items: [...] }'}</code>. Big integers come back as
            strings.
          </p>
          <Code>{`# latest nouns + auctions
{
  nouns(orderBy: "id", orderDirection: "desc", limit: 5) {
    items { id owner head body accessory glasses background }
  }
  auctions(orderBy: "nounId", orderDirection: "desc", limit: 5) {
    items { nounId amount winner settled burned settler clientId }
  }
}

# a proposal and how it went
{
  proposal(id: "1000") { id status description forVotes againstVotes clientId }
  votes(where: { proposalId: "1000" }, orderBy: "votes", orderDirection: "desc") {
    items { voter support votes reason clientId }
  }
}

# NounV2
{
  nounV2Auctions(orderBy: "nounId", orderDirection: "desc", limit: 5) {
    items { nounId amount winner settled }
  }
  nounV2Proposals(orderBy: "id", orderDirection: "desc", limit: 5) {
    items { id status description }
  }
}

# money out
{
  streams(orderBy: "startTime", orderDirection: "desc", limit: 5) {
    items { streamAddress proposalId recipient tokenAmount startTime stopTime }
  }
  treasurySends(orderBy: "createdAtBlock", orderDirection: "desc", limit: 5) {
    items { to token amount createdAt }
  }
}`}</Code>
          <p className={styles.dim}>
            Also: delegates, candidates, candidateSignatures, proposalFeedback, grants, grantVotes,
            nounTransfers, delegationEvents, forkEvents, onchainEvents. The schema lives in{' '}
            <code>packages/nouns-api/ponder.schema.ts</code>.
          </p>
        </Sec>

        <Sec dir="api" n={5} title="REST API">
          <p>
            <b>Base</b>{' '}
            <a href={API} target="_blank" rel="noreferrer">
              {API}
            </a>
            . Plus Ponder’s own <code>/health</code>, <code>/ready</code> (503 while backfilling)
            and <code>/status</code>.
          </p>
          <ApiBrowser />
        </Sec>

        <Sec dir="agent" n={6} title="AGENT NOUNIRL">
          <p>
            <code>nounirl.eth</code> watches every block, predicts the next Noun with the seeder’s
            own algorithm and settles the auction when the Noun someone asked for is up next.
          </p>
          <ol>
            <li>
              Tip at least 0.002 ETH to nounirl.eth on Ethereum, Base, Optimism, Arbitrum or Zora.
            </li>
            <li>Say what you want: “shark head and blue noggles”.</li>
            <li>When the predicted Noun matches and the auction has ended, it settles.</li>
          </ol>
          <p>
            Same engine as the <Link to="/crystal-ball">CRYSTAL BALL</Link>. Its endpoints are under{' '}
            <a href="#api">AGENT NOUNIRL</a> in the API list.
          </p>
        </Sec>

        <Sec dir="grants" n={7} title="SMALL GRANTS">
          <p>
            noun.wtf’s own micro-DAO: governor and treasury in one contract,{' '}
            <a href={etherscan(SMALL_GRANTS)} target="_blank" rel="noreferrer">
              {SMALL_GRANTS}
            </a>
            . Voting power is your Nouns (<code>getPriorVotes</code> at the snapshot). Fund it by
            sending ETH.
          </p>
          <Table
            headers={['Rule', 'Value']}
            rows={[
              ['Voting delay', '0 blocks'],
              ['Voting period', '3,600 blocks (~12 h)'],
              ['Timelock', '12 h'],
              ['Grace period', '7 days'],
              ['Max actions', '10 per proposal'],
              ['Quorum', 'None. 1 FOR, 0 AGAINST passes'],
            ]}
          />
          <Code>{`propose(targets[], values[], signatures[], calldatas[], description)
castVote(id, support)            // 0 against · 1 for · 2 abstain
castVoteWithReason(id, support, reason)
queue(id)  →  12h  →  execute(id)        cancel(id)   state(id)`}</Code>
          <p>
            <Link to="/grants">/grants →</Link>
          </p>
        </Sec>

        <Sec dir="terminal" n={8} title="TERMINAL">
          <p>
            The homepage feed is a terminal. Type to Claude (<code>POST /api/chat</code>, wallet
            connected, 10 a minute, 50 a day). When it wants to act it returns a{' '}
            <code>pending_action</code> for your wallet to sign:
          </p>
          <Table
            headers={['Action', 'Does']}
            rows={[
              ['VOTE', 'Vote on a proposal (gas refunded, client 37)'],
              ['PROPOSAL_FEEDBACK / CANDIDATE_FEEDBACK', 'Signal without voting'],
              ['CREATE_CANDIDATE · SPONSOR · PROMOTE', 'Draft, sign for and promote candidates'],
              ['BID', 'Bid on the current auction'],
              ['GRANT_VOTE · GRANT_PROPOSAL', 'Small Grants'],
            ]}
          />
          <h4>Paste a proposal</h4>
          <p>
            Paste this JSON into the prompt and the draft window opens with the actions attached:
          </p>
          <Code>{`{
  "title": "…",
  "body": "…markdown…",
  "transactions": [
    { "address": "0x…", "value": "0", "signature": "transfer(address,uint256)", "calldata": "0x…" }
  ]
}`}</Code>
          <p className={styles.dim}>
            ABIs resolve from <code>src/lib/knownAbis.ts</code> first, no Etherscan key needed. Prop
            1000 went onchain this way. Add <code>{'"dao": "lil-nouns"'}</code> (or type{' '}
            <code>/draft lil</code>) to submit to the Lil Nouns governor instead. Its calldata is
            args only: the timelock adds the selector itself.
          </p>
        </Sec>

        <Sec dir="functions" n={9} title="NETLIFY FUNCTIONS">
          <p>
            Served from noun.wtf at <code>/.netlify/functions/&lt;name&gt;</code>, stored in Netlify
            Blobs. Admin actions need <code>X-World-Admin</code>.
          </p>
          <Table
            headers={['Function', 'What it does']}
            rows={[
              [
                'cc0-uploads · cc0-file',
                'CC0 Library uploads (≤ 10 MB, checked, moderated) and serving them',
              ],
              ['community-submissions', 'Suggest a game / page / tool for the homescreen'],
              ['world-voice', 'Voice Booth clips: share, report, moderate'],
              ['world-stats', 'Noun World records + totals (ride-proof checked)'],
              ['world-graffiti', 'Tags that stay up'],
              ['world-decks · world-drops', 'Board shop decks per wallet · drop-party items'],
              ['world-trade · -claim · -deposit', 'Noun Trade ledger, cash-out and deposit (Base)'],
              ['world-exchange', 'The Grand Exchange order books (in-game coin)'],
              [
                'world-fm-library · fm-dj · fm-dj-update',
                'NOUN FM: shared DJ sets and the 12-hourly DJ update',
              ],
              ['og-proposal', 'Share unfurls for /vote/:id and /candidates/:id'],
              [
                'noun-links · derivatives · noun-day-drafts',
                'Link previews, IPFS pinning, studio drafts',
              ],
            ]}
          />
        </Sec>

        <Sec dir="multiplayer" n={10} title="MULTIPLAYER">
          <p>
            Noun World, the hoops relay and Noun Warfare share one PartyServer worker on Cloudflare
            Durable Objects (hosted PartyKit shut down on 2026-10-23).
          </p>
          <Code>{`wss://${PARTY_HOST}/parties/main/<room>

override:  VITE_PARTYKIT_HOST
deploy:    cd packages/nouns-party && npx wrangler deploy`}</Code>
          <p className={styles.dim}>
            Pose blobs can carry voice refs (<code>vo</code>, <code>co</code>, <code>cv</code>);
            older clients ignore them. Records are checked against ride traces before they’re saved.
          </p>
        </Sec>

        <Sec dir="dev" n={11} title="LOCAL DEV">
          <Code>{`git clone https://github.com/snaveoguh/noun-wtf && cd noun-wtf
pnpm install                     # pnpm 10, node 22

# webapp — no keys needed, it uses free public RPCs + the live API
cd packages/nouns-webapp
pnpm dev                         # http://localhost:5173

# your own indexer
cd packages/nouns-api
echo 'DATABASE_URL=postgresql://localhost:5432/nouns' > .env.local
pnpm dev                         # GraphQL on http://localhost:42069`}</Code>
          <p className={styles.warn}>
            The indexer falls back to Tenderly + MEV Blocker; <code>PONDER_RPC_URL_1</code> is
            optional. Most free RPCs can’t serve its historical <code>eth_getLogs</code> (publicnode
            403s, 1rpc caps at 50 blocks). A full backfill takes hours; data is queryable while it
            runs.
          </p>
          <h4>Env</h4>
          <Table
            headers={['Variable', 'Where', 'What']}
            rows={[
              ['VITE_CHAIN_ID', 'webapp', '1 mainnet · 11155111 sepolia'],
              ['VITE_MAINNET_SUBGRAPH', 'webapp', 'API base (defaults to the live one)'],
              ['VITE_MAINNET_JSONRPC', 'webapp', 'Optional RPC override'],
              ['VITE_PARTYKIT_HOST', 'webapp', 'Optional multiplayer host'],
              ['VITE_WALLET_CONNECT_V2_PROJECT_ID', 'webapp', 'WalletConnect'],
              ['DATABASE_URL', 'api', 'Postgres'],
              ['PONDER_RPC_URL_1', 'api', 'Optional primary RPC (comma-separated)'],
              ['ANTHROPIC_API_KEY', 'api', 'Terminal chat + agent'],
              ['NOUNIRL_PRIVATE_KEY', 'api', 'Lets the agent settle'],
            ]}
          />
          <p className={styles.dim}>
            Webapp <code>VITE_*</code> values for the real sites are baked in at build time in{' '}
            <code>.github/workflows/netlify-deploy.yml</code>.
          </p>
        </Sec>

        <Sec dir="build" n={12} title="BUILD IDEAS">
          <ul className={styles.todo}>
            <Todo done to="/nonsense">
              Treasury flow viz: where the money goes
            </Todo>
            <Todo done to="/explore/wallet">
              Wallet explorer: who holds, who votes how
            </Todo>
            <Todo done to="/crystal-ball">
              Next-noun predictor + settle-on-match
            </Todo>
            <Todo done to="/gas">
              Settler gas leaderboard
            </Todo>
            <Todo done to="/predictions">
              Prediction markets on governance
            </Todo>
            <Todo done to="/cc0">
              Open CC0 asset library with uploads
            </Todo>
            <Todo>Client ID leaderboard: which frontends drive votes and bids</Todo>
            <Todo>Voter influence graph from delegations + votes</Todo>
            <Todo>Proposal diff viewer across candidate / proposal versions</Todo>
            <Todo>Sponsorship market: candidates find signers</Todo>
            <Todo>Small Grants v2: milestones, recurring grants</Todo>
            <Todo>NounIRL for Lil Nouns</Todo>
          </ul>
          <p className={styles.dim}>
            Got one? <Link to="/grants">Ask Small Grants for money</Link> or pitch it in the
            terminal.
          </p>
        </Sec>

        <Sec dir="apps" n={13} title="APPS">
          <p className={styles.dim}>Everything on noun.wtf, straight from the NounOS catalog.</p>
          {CATALOG.map(section => (
            <div key={section.id} className={styles.ls}>
              <div className={styles.lsHead}>
                <span className={styles.prompt}>$</span> ls /apps/{section.id}{' '}
                <span className={styles.dim}># {section.tag}</span>
              </div>
              {section.entries.map(e => (
                <Link key={e.path} to={e.path} className={styles.lsRow}>
                  <span className={styles.perm}>drwxr-xr-x</span>
                  <span className={styles.lsName}>{e.name}</span>
                  <span className={styles.lsBlurb}>{e.blurb}</span>
                </Link>
              ))}
            </div>
          ))}
        </Sec>

        <footer className={styles.footer}>
          <span>noun.wtf · client 37 · cc0</span>
          <a href="https://github.com/snaveoguh/noun-wtf" target="_blank" rel="noreferrer">
            source
          </a>
          <Link to="/">exit</Link>
        </footer>
      </div>
    </div>
  );
}

// ── boot ────────────────────────────────────────────────────────────────

const BOOT_LINES = [
  'mounting /dev/nouns ............ ok',
  'loading 1 auction/day .......... forever',
  'checking cc0 license ........... public domain',
  'opening the basement ........... ok',
];

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function Boot() {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? BOOT_LINES.length : 0));

  useEffect(() => {
    if (shown >= BOOT_LINES.length) return;
    const t = setTimeout(() => setShown(s => s + 1), 140);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <header className={styles.boot}>
      <pre className={styles.bootLog} aria-hidden>
        {BOOT_LINES.slice(0, shown).join('\n')}
        {shown < BOOT_LINES.length && <span className={styles.cursor}>█</span>}
      </pre>
      <Noggles />
      <h1 className={styles.title}>
        NOUNS<span className={styles.titleCut}>UNDERGROUND</span>
      </h1>
      <p className={styles.sub}>
        The noun.wtf stack, all of it: contracts, indexer, {ALL_ROUTES.length} public API routes,
        the agent, the functions, the multiplayer worker, and every app built on top. Take what you
        need. It’s CC0.
      </p>
    </header>
  );
}

/** The canonical noggles (NOGGLES, checked against the trait PNG) as square pixels. */
function Noggles() {
  const colour = { R: styles.nogR, W: styles.nogW, B: styles.nogB } as const;
  return (
    <div className={styles.noggles} role="img" aria-label="Noggles">
      {NOGGLES.flatMap((row, y) =>
        [...row].map((k, x) => (
          <span
            key={`${x}-${y}`}
            className={k === '.' ? undefined : colour[k as keyof typeof colour]}
          />
        )),
      )}
    </div>
  );
}

// ── live status ─────────────────────────────────────────────────────────

interface Status {
  online: boolean;
  block?: number;
  synced: boolean;
}

function StatusBar() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const [s, ready] = await Promise.all([
          fetch(`${API}/status`).then(r => r.json()),
          fetch(`${API}/ready`).then(r => r.ok),
        ]);
        if (alive) setStatus({ online: true, block: s?.mainnet?.block?.number, synced: ready });
      } catch {
        if (alive) setStatus({ online: false, synced: false });
      }
    }
    check();
    const id = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const dot = !status
    ? styles.dotWait
    : status.online
      ? status.synced
        ? styles.dotOk
        : styles.dotWarn
      : styles.dotBad;
  return (
    <div className={styles.status} role="status">
      <span className={`${styles.dot} ${dot}`} />
      {!status && 'pinging api…'}
      {status && !status.online && 'api unreachable'}
      {status?.online === true && (
        <>
          api online
          {status.block != null && <> · indexed to block {status.block.toLocaleString('en-US')}</>}
          {' · '}
          {status.synced ? 'synced' : 'backfilling'}
        </>
      )}
    </div>
  );
}

// ── nav ─────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav className={styles.nav} aria-label="Sections">
      <div className={styles.navPrompt}>
        <span className={styles.prompt}>anon@noun.wtf:~/underground$</span> ls
      </div>
      <div className={styles.navDirs}>
        {DIRS.map(([dir, note]) => (
          <a key={dir} href={`#${dir}`} className={styles.navDir} title={note}>
            {dir}/
          </a>
        ))}
      </div>
    </nav>
  );
}

// ── API browser ─────────────────────────────────────────────────────────

function ApiBrowser() {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      API_GROUPS.map(g => ({
        ...g,
        routes: needle
          ? g.routes.filter(r =>
              `${r.method} ${r.path} ${r.desc} ${g.title}`.toLowerCase().includes(needle),
            )
          : g.routes,
      })).filter(g => g.routes.length > 0),
    [needle],
  );
  const count = groups.reduce((n, g) => n + g.routes.length, 0);

  return (
    <div>
      <label className={styles.grep}>
        <span className={styles.prompt}>$ grep -i</span>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="wallet, treasury, agent…"
          spellCheck={false}
          aria-label="Filter API routes"
        />
        <span className={styles.dim}>
          {count}/{ALL_ROUTES.length}
        </span>
      </label>
      {groups.map(g => (
        <div key={g.id} className={styles.group}>
          <div className={styles.groupTitle}>## {g.title}</div>
          {g.routes.map(r => (
            <RouteRow key={`${r.method} ${r.path}`} route={r} />
          ))}
        </div>
      ))}
      {count === 0 && <p className={styles.dim}>grep: no match</p>}
    </div>
  );
}

const PREVIEW_LINES = 40;

function RouteRow({ route }: { route: ApiRoute }) {
  const [out, setOut] = useState<{ text: string; meta: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    if (!route.try) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    const t0 = performance.now();
    try {
      const res = await fetch(`${API}${route.try}`, { signal: ctrl.signal });
      const raw = await res.text();
      let text = raw;
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // not JSON (ASCII art, say): show as is
      }
      const lines = text.split('\n');
      const cut = lines.length > PREVIEW_LINES;
      setOut({
        text:
          lines.slice(0, PREVIEW_LINES).join('\n') +
          (cut ? `\n… ${lines.length - PREVIEW_LINES} more lines` : ''),
        meta: `HTTP ${res.status} · ${fmtBytes(raw.length)} · ${Math.round(performance.now() - t0)} ms`,
      });
    } catch (e) {
      if (!ctrl.signal.aborted) setOut({ text: String(e), meta: 'failed' });
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className={styles.route}>
      <div className={styles.routeLine}>
        <span className={route.method === 'GET' ? styles.get : styles.post}>{route.method}</span>
        <code className={styles.path}>{route.path}</code>
        <span className={styles.desc}>
          {route.desc}
          {route.auth && <span className={styles.auth}>[{route.auth}]</span>}
        </span>
        {route.try && (
          <button
            type="button"
            className={styles.run}
            onClick={out && !busy ? () => setOut(null) : run}
            disabled={busy}
          >
            {busy ? '…' : out ? 'close' : '▶ run'}
          </button>
        )}
      </div>
      {out && (
        <div className={styles.out}>
          <div className={styles.outHead}>
            $ curl {API.replace(/^https:\/\//, '')}
            {route.try} <span className={styles.dim}># {out.meta}</span>
          </div>
          <pre>{out.text}</pre>
        </div>
      )}
    </div>
  );
}

function fmtBytes(n: number) {
  return n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── building blocks ─────────────────────────────────────────────────────

function Sec({
  dir,
  n,
  title,
  children,
}: {
  dir: Dir;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={dir} className={styles.section}>
      <h2 className={styles.secHead}>
        <span className={styles.secNum}>{String(n).padStart(2, '0')}</span>
        <span className={styles.secTitle}>{title}</span>
        <span className={styles.secRule} aria-hidden />
        <span className={styles.secCd}>cd {dir}/</span>
      </h2>
      <div className={styles.secBody}>{children}</div>
    </section>
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
          <tr>
            {headers.map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row[0]}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Addrs({ rows }: { rows: [string, string][] }) {
  return (
    <div className={styles.addrs}>
      {rows.map(([name, addr]) => (
        <div key={addr} className={styles.addr}>
          <span className={styles.addrName}>{name}</span>
          <a href={etherscan(addr)} target="_blank" rel="noreferrer" className={styles.addrHex}>
            {addr}
          </a>
        </div>
      ))}
    </div>
  );
}

function Todo({
  done = false,
  to,
  children,
}: {
  done?: boolean;
  to?: string;
  children: ReactNode;
}) {
  return (
    <li className={done ? styles.done : undefined}>
      <span className={styles.box}>{done ? '[x]' : '[ ]'}</span> {children}
      {to && (
        <>
          {' '}
          <Link to={to}>→ {to}</Link>
        </>
      )}
    </li>
  );
}
