import { formatEther } from 'viem';
import { useBalance } from 'wagmi';

import { SMALL_GRANTS_TREASURY_ADDRESS } from '@/contracts/small-grants-treasury';

import classes from './Hackathon.module.css';

const TREASURY_ADDRESS = SMALL_GRANTS_TREASURY_ADDRESS;

const CONTRACTS = [
  {
    name: 'NounV2Token',
    address: '0xb1d6bdf9326dd09183c2e9d25af5e22c637293b9',
    chain: 'Ethereum',
    desc: 'ERC-721 for the NounV2 fork launched 2026-04-24. Starts at #0, no nounder reward, shares the mainnet Nouns art pipeline. seeds(), balanceOf(), getPriorVotes().',
    caption: 'Build a physical device that mints, bids on, or just tracks NounV2 — the concurrent no-reserve auction alongside mainnet.',
    tag: 'NOUNV2',
    tagClass: 'tagTarget',
    etherscan: 'https://etherscan.io/address/0xb1d6bdf9326dd09183c2e9d25af5e22c637293b9',
  },
  {
    name: 'NounV2AuctionHouse',
    address: '0x9a6ddb16e23967d5482e5bfd7444a04a5d5145fc',
    chain: 'Ethereum',
    desc: 'The NounV2 daily auction. 24hr, no reserve (0.001 ETH floor), 2% min bid increment. Proceeds route to NounV2Treasury. auction(), createBid(), settleCurrentAndCreateNewAuction().',
    caption: 'Build a public bid buzzer that fires when NounV2 goes below mainnet reserve, or a settle bot racing for the perfect seed.',
    tag: 'NOUNV2',
    tagClass: 'tagTarget',
    etherscan: 'https://etherscan.io/address/0x9a6ddb16e23967d5482e5bfd7444a04a5d5145fc',
  },
  {
    name: 'NounV2Treasury',
    address: '0x2cdeb0d251674710840d9fa990d1de138dfe7c00',
    chain: 'Ethereum',
    desc: 'Single-contract governor + treasury for NounV2. 1-noun proposal threshold, 12hr vote, 12hr timelock, admin veto. propose(), castVote(), queue(), execute().',
    caption: 'Small DAO, small hack. Build a single-noun proposal bot or a real-time proposal-outcome display.',
    tag: 'NOUNV2',
    tagClass: 'tagTarget',
    etherscan: 'https://etherscan.io/address/0x2cdeb0d251674710840d9fa990d1de138dfe7c00',
  },
  {
    name: 'SmallGrantsTreasury',
    address: '0xBAc9233725440c595b19d975309CC98cb259253a',
    chain: 'Ethereum',
    desc: 'The original grants target. 12hr vote, 12hr lock, no quorum. 1 Noun vote passes a prop. propose(), castVote(), queue(), execute().',
    caption: 'Build a physical device that submits proposals or casts votes. A one-button grant machine.',
    tag: 'TARGET',
    tagClass: 'tagTarget',
    etherscan: 'https://etherscan.io/address/0xBAc9233725440c595b19d975309CC98cb259253a',
  },
  {
    name: 'NounsToken',
    address: '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03',
    chain: 'Ethereum',
    desc: 'ERC-721 governance token. 1 Noun = 1 vote. balanceOf(), delegates(), votesToDelegate(). Used by the treasury for voting power.',
    caption: 'Build a delegation kiosk. Show who holds power and let people delegate from a physical terminal.',
    tag: 'CORE',
    tagClass: 'tagCore',
    etherscan: 'https://etherscan.io/address/0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03',
  },
  {
    name: 'NounsDAOV4',
    address: '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d',
    chain: 'Ethereum',
    desc: 'Main DAO governor. proposals(), state(), castVote(). The big treasury ($52M+).',
    caption: 'Build a proposal ticker or governance dashboard that runs on an e-ink display or Raspberry Pi.',
    tag: 'CORE',
    tagClass: 'tagCore',
    etherscan: 'https://etherscan.io/address/0x6f3E6272A167e8AcCb32072d08E0957F9c79223d',
  },
  {
    name: 'NounsAuctionHouseV2',
    address: '0x830BD73E4184ceF73443C15111a1DF14e495C706',
    chain: 'Ethereum',
    desc: 'Daily auctions. One Noun per day. settleCurrentAndCreateNewAuction(), createBid(). The heartbeat of Nouns.',
    caption: 'Build an auction alert device — a bell, buzzer, or light that goes off when bids land or auctions end.',
    tag: 'CORE',
    tagClass: 'tagCore',
    etherscan: 'https://etherscan.io/address/0x830BD73E4184ceF73443C15111a1DF14e495C706',
  },
  {
    name: 'MoralityPredictionMarket',
    address: '0x2ea7502C4db5B8cfB329d8a9866EB6705b036608',
    chain: 'Ethereum',
    desc: 'Bet on whether Nouns proposals pass or fail. Parimutuel pools. stake(), claim(), resolve(). Auto-creates markets on first bet.',
    caption: 'Build a physical voting booth where people predict proposal outcomes with real ETH at stake.',
    tag: 'MARKET',
    tagClass: 'tagMarket',
    etherscan: 'https://etherscan.io/address/0x2ea7502C4db5B8cfB329d8a9866EB6705b036608',
  },
  {
    name: 'PooterEditions',
    address: '0x06d7c7d70c685d58686FF6E0b0DB388209fCCC6e',
    chain: 'Base',
    desc: 'Daily newspaper NFTs (ERC-721). One edition per day since March 2026. mint(), mintFor(). On Base L2.',
    caption: 'Build a dot matrix printer that prints the daily Pooter edition as a physical newspaper every morning.',
    tag: 'NFT',
    tagClass: 'tagNft',
    etherscan: 'https://basescan.org/address/0x06d7c7d70c685d58686FF6E0b0DB388209fCCC6e',
  },
];

const APIS = [
  {
    name: 'GraphQL API (Ponder)',
    url: 'https://spirited-flexibility-production-3c30.up.railway.app/graphql',
    desc: 'Nouns indexer. Auctions, proposals, grants, delegates, transfers. Full GraphQL.',
  },
  {
    name: 'NounV2 Auctions (REST)',
    url: 'https://spirited-flexibility-production-3c30.up.railway.app/api/nounv2-auctions',
    desc: 'All NounV2 auctions since launch. Current auction + full bid history. JSON REST.',
  },
  {
    name: 'NounV2 Proposals (REST)',
    url: 'https://spirited-flexibility-production-3c30.up.railway.app/api/nounv2-proposals',
    desc: 'NounV2 treasury proposals with vote tallies + execution status. JSON REST.',
  },
  {
    name: 'Governance Feed',
    url: 'https://pooter.world/api/governance',
    desc: 'Live proposals from Nouns, Lil Nouns + US Congress. Filter by ?filter=live|controversial|all. JSON REST.',
  },
  {
    name: 'Agent Hub (Free LLM)',
    url: 'https://heartfelt-flow-production-d872.up.railway.app/health',
    desc: 'Free LLM (Claude via Anthropic, Groq, Together fallback). POST /v1/generate with {"user":"your prompt","task":"chat"}. No API key needed.',
  },
  {
    name: 'News Feed',
    url: 'https://pooter.world/api/feed',
    desc: 'Aggregated RSS feed with bias analysis. Filter by ?category=Business&tag=crypto. JSON REST.',
  },
  {
    name: 'Sentiment & Signals',
    url: 'https://pooter.world/api/sentiment',
    desc: 'Real-time sentiment scores for BTC, ETH, SOL + more. Bias analysis, source diversity, contradiction detection.',
  },
];

const TOOLS = [
  {
    name: 'Terminal',
    path: '/terminal',
    desc: 'AI chat with governance tool access. Vote, propose, bid, delegate — all through natural language.',
    art: `$ noun-terminal v1.0
> vote for prop 948
preparing your vote...
support: FOR
[SIGN TX]`,
  },
  {
    name: 'Crystal Ball',
    path: '/crystal-ball',
    desc: "Predict the next Noun's traits using the NounsSeeder algorithm. keccak256 pseudorandomness.",
    art: `    .-""-.
  /  ⌐◨-◨  \\
 | head:    |
 | shark    |
  \\  next  /
   '-..-'`,
  },
  {
    name: 'Grants',
    path: '/grants',
    desc: 'Propose and vote on SmallGrantsTreasury proposals. The front door to Hack the Treasury.',
    art: `propose() → ACTIVE
 12hr vote → SUCCEEDED
 12hr lock → QUEUED
 execute() → DONE
quorum: none (!)`,
  },
  {
    name: 'Predictions',
    path: 'https://pooter.world/predictions',
    external: true,
    desc: 'Bet on whether Nouns proposals will pass or fail. Resolved by onchain governor state.',
    art: `┌──────────────────┐
│ Prop #948        │
│ Pass?  ■■■■░░ 67%│
│ Fail?  ■■░░░░ 33%│
│ [PREDICT] 0.01Ξ  │
└──────────────────┘`,
  },
  {
    name: 'Studio',
    path: '/studio',
    desc: 'Draw pixel art using Nouns traits. Save, propose, remix. Full trait library.',
    art: `┌────────────────┐
│ ■ □ ■ □ ■ □ ■ │
│ □ ⌐◨-◨ □ ■ □ │
│ ■ □ ■ □ ■ □ ■ │
│ [PEN][FILL][OK]│
└────────────────┘`,
  },
];

const PHYSICAL_IDEAS = [
  {
    text: 'Raspberry Pi governance terminal',
    sub: 'Touchscreen for voting, bidding, proposing. Kiosk mode. Could run noun.wtf or a custom UI.',
  },
  {
    text: 'OLED trait predictor',
    sub: 'RPi Zero W + 0.96" OLED. Shows predicted traits for the next Noun, updating each block.',
  },
  {
    text: 'Dot matrix Noun printer',
    sub: '80-column continuous feed. Print proposals, auction results, governance events as they happen.',
  },
  {
    text: 'Hardware delegation device',
    sub: 'Cold storage signer that auto-delegates to specified addresses. Physical governance key.',
  },
  {
    text: 'Auction notification bell',
    sub: 'Physical bell/buzzer that rings when an auction is about to end or when you get outbid.',
  },
  {
    text: 'Treasury balance display',
    sub: 'E-ink or LED display showing live treasury balance. Wall-mountable. Reads from chain.',
  },
];

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function HackathonPage() {
  const { data: balance } = useBalance({ address: TREASURY_ADDRESS });

  return (
    <div className={classes.container}>
      {/* ─── Hero ─────────────────────────────────── */}
      <div className={classes.hero}>
        <h1 className={classes.heroTitle}>Hack the Treasury</h1>
        <p className={classes.heroSub}>
          {balance ? `${parseFloat(formatEther(balance.value)).toFixed(4)} ETH` : '0.42 ETH'}{' '}
          permissionless grants
        </p>
        <p className={classes.heroDesc}>
          0.42 ETH sitting in a SmallGrantsTreasury contract on Ethereum mainnet.
          No quorum. 1 Noun vote passes a proposal. 12hr vote + 12hr lock = funds in 24hrs.
          Build something physical that interacts with a Nouns contract — or find a vulnerability
          and hack the treasury. Permissionless. The ETH is for someone's taking.
        </p>

        <div className={classes.treasuryBadge}>
          <a
            href={`https://etherscan.io/address/${TREASURY_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className={classes.treasuryAddr}
          >
            {shortAddr(TREASURY_ADDRESS)}
          </a>
          <span className={classes.treasuryBal}>
            {balance ? `${parseFloat(formatEther(balance.value)).toFixed(4)} ETH` : '...'}
          </span>
        </div>

        <div className={classes.heroCtas}>
          <a href="/grants" className={classes.heroCtaFilled}>
            Submit a Proposal
          </a>
          <a
            href={`https://etherscan.io/address/${TREASURY_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className={classes.heroCta}
          >
            View on Etherscan
          </a>
        </div>

        <div className={classes.heroAscii}>{`
  SmallGrantsTreasury.sol          ⌐◨-◨
  ┌─────────────────────────┐
  │ propose()  → 12hr vote  │    no quorum
  │ queue()    → 12hr lock  │    1 noun = 1 vote
  │ execute()  → get paid   │    permissionless
  └─────────────────────────┘
        `}</div>
      </div>

      {/* ─── Rules ────────────────────────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>How It Works</h2>
        <div className={classes.rulesGrid}>
          <div className={classes.ruleCard}>
            <div className={classes.ruleNum}>1</div>
            <div className={classes.ruleText}>
              <strong>Build something physical</strong> that interacts with at least one Nouns
              smart contract. A Pi terminal, a printer, a display, a button — anything IRL that
              talks to the chain.
            </div>
          </div>
          <div className={classes.ruleCard}>
            <div className={classes.ruleNum}>2</div>
            <div className={classes.ruleText}>
              <strong>OR hack the treasury.</strong> Find a vulnerability in the SmallGrantsTreasury
              contract and drain it. Permissionless security audit with a bounty.
            </div>
          </div>
          <div className={classes.ruleCard}>
            <div className={classes.ruleNum}>3</div>
            <div className={classes.ruleText}>
              <strong>Submit a proposal</strong> to the treasury at{' '}
              <a href="/grants">noun.wtf/grants</a>. Describe what you built, link proof.
              Anyone can propose — no Noun ownership required to submit.
            </div>
          </div>
          <div className={classes.ruleCard}>
            <div className={classes.ruleNum}>4</div>
            <div className={classes.ruleText}>
              <strong>1 vote passes.</strong> Nouns holders vote (1 Noun = 1 vote). No quorum
              means a single FOR vote with no opposition passes the prop. 12hr vote window,
              12hr timelock, funds in 24hrs.
            </div>
          </div>
        </div>
      </div>

      {/* ─── Contracts ────────────────────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>Contracts</h2>
        <p className={classes.sectionDesc}>
          Deployed and verified. No source code needed — just addresses and ABIs on Etherscan.
        </p>
        <div className={classes.contractGrid}>
          {CONTRACTS.map(c => (
            <a
              key={c.name}
              href={c.etherscan}
              target="_blank"
              rel="noopener noreferrer"
              className={classes.contractCard}
            >
              <div className={classes.contractHeader}>
                <span className={`${classes.contractTag} ${classes[c.tagClass]}`}>{c.tag}</span>
                <h3 className={classes.contractName}>{c.name}</h3>
                <code className={classes.contractAddr}>{shortAddr(c.address)}</code>
                <span className={classes.contractChain}>{c.chain}</span>
              </div>
              <p className={classes.contractDesc}>{c.desc}</p>
              <p className={classes.contractCaption}>{c.caption}</p>
            </a>
          ))}
        </div>
      </div>

      {/* ─── APIs ─────────────────────────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>APIs & Endpoints</h2>
        <p className={classes.sectionDesc}>
          Live URLs. Hit them. All return JSON. No API keys required.
        </p>
        <div className={classes.linksGrid}>
          {APIS.map(a => (
            <a
              key={a.name}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className={classes.linkRow}
            >
              <div>
                <span className={classes.linkName}>{a.name}</span>
                <span className={classes.linkDesc}>{a.desc}</span>
              </div>
              <span className={classes.linkUrl}>{new URL(a.url).hostname}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ─── Tools ────────────────────────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>Tools</h2>
        <p className={classes.sectionDesc}>
          Live on noun.wtf and pooter.world. Use them as-is or build on top.
        </p>
        <div className={classes.cartridgeGrid}>
          {TOOLS.map(t => {
            const isExternal = 'external' in t && t.external;
            return (
              <a
                key={t.name}
                href={t.path}
                {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className={classes.cartridge}
              >
                <div className={classes.cartridgeScreen}>
                  <pre className={classes.cartridgeArt}>{t.art}</pre>
                </div>
                <div className={classes.cartridgeBody}>
                  <h3 className={classes.cartridgeName}>{t.name}</h3>
                  <p className={classes.cartridgeDesc}>{t.desc}</p>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* ─── Physical Build Ideas ─────────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>Physical Build Ideas</h2>
        <p className={classes.sectionDesc}>
          The only requirement is that it's physical and it talks to a Nouns contract.
          Here are some starting points.
        </p>
        <div className={classes.ideaGrid}>
          {PHYSICAL_IDEAS.map((idea, i) => (
            <div key={i} className={classes.ideaCard}>
              <div className={classes.ideaCat} style={{ color: '#fb923c' }}>
                Physical
              </div>
              <div className={classes.ideaText}>{idea.text}</div>
              <div className={classes.ideaSub}>{idea.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Quick Start ──────────────────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>Quick Start</h2>
        <div className={classes.codeBlock}>
          <div><span className={classes.comment}># The treasury contract is live on Ethereum mainnet</span></div>
          <div><span className={classes.comment}># Read it, poke it, propose to it</span></div>
          <div style={{ marginTop: '0.5rem' }}>
            <span className={classes.prompt}>$</span> cast call 0xBAc9233725440c595b19d975309CC98cb259253a "proposalCount()(uint256)" --rpc-url https://ethereum-rpc.publicnode.com
          </div>
          <div style={{ marginTop: '1rem' }}>
            <span className={classes.comment}># Or use the noun.wtf stack</span>
          </div>
          <div><span className={classes.prompt}>$</span> git clone https://github.com/snaveoguh/noun-wtf.git</div>
          <div><span className={classes.prompt}>$</span> cd noun-wtf && pnpm install</div>
          <div><span className={classes.prompt}>$</span> cd packages/nouns-webapp && CI=true pnpm dev</div>
          <div style={{ marginTop: '0.5rem' }}>
            <span className={classes.comment}># GraphQL API (no setup needed)</span>
          </div>
          <div>
            <span className={classes.prompt}>$</span> curl -s 'https://spirited-flexibility-production-3c30.up.railway.app/graphql' -H 'Content-Type: application/json' -d '&#123;"query":"&#123; nouns(limit:1) &#123; items &#123; id &#125; &#125; &#125;"&#125;'
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <span className={classes.comment}># Free LLM (no API key)</span>
          </div>
          <div>
            <span className={classes.prompt}>$</span> curl -X POST https://heartfelt-flow-production-d872.up.railway.app/v1/generate -H 'Content-Type: application/json' -d '&#123;"user":"What should I build for Nouns?","task":"chat"&#125;'
          </div>
        </div>
      </div>

      {/* ─── Footer ───────────────────────────────── */}
      <div className={classes.footer}>
        <div>CC0. No rights reserved. Fork everything.</div>
        <div style={{ marginTop: '0.25rem' }}>
          <a href="https://noun.wtf">noun.wtf</a> · <a href="https://pooter.world">pooter.world</a> · Client ID 37
        </div>
      </div>
    </div>
  );
}
