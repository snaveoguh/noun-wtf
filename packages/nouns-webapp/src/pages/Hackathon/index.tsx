import classes from './Hackathon.module.css';

const EXAMPLE_PROJECTS = [
  {
    name: 'Nouns Terminal',
    desc: 'GameBoy-inspired touchscreen governance client for Raspberry Pi. Pixel art studio, proposal voting, live auction bidding, candidate submissions. 480x320 display with stylus.',
    tag: 'PHYSICAL',
    tagClass: 'tagPhysical',
    version: 'v0.1',
    stack: ['React', 'ethers.js', 'RPi 3B+', 'Chromium Kiosk'],
    link: '/hackathon/NOUNS-TERMINAL-GUIDE.pdf',
    art: `┌──────────────┐
│  ⌐◨-◨  NOUN  │
│  TERMINAL    │
│  ┌────────┐  │
│  │ 32x32  │  │
│  │ STUDIO │  │
│  └────────┘  │
│  [A][B][SEL] │
└──────────────┘`,
  },
  {
    name: 'IRL Crystal Ball',
    desc: "Raspberry Pi Zero W inside a crystal ball housing. Predicts the next Noun's traits using the NounsSeeder algorithm. OLED display shows trait predictions updating each block.",
    tag: 'PHYSICAL',
    tagClass: 'tagPhysical',
    version: 'v0.1',
    stack: ['RPi Zero W', '0.96" OLED', 'Python', 'keccak256'],
    link: '/crystal-ball',
    art: `      .-""-.
    /        \\
   |  ⌐◨-◨   |
   | head:    |
   | shark    |
    \\  next  /
     '-.  .-'
      |__|`,
  },
  {
    name: 'Touchscreen Playground',
    desc: 'Full Nouns playground + proposal maker optimized for 3" touchscreen. Draw pixel art, submit as proposal candidates, vote on proposals — all from a handheld device.',
    tag: 'PHYSICAL',
    tagClass: 'tagPhysical',
    version: 'v0.1',
    stack: ['Vite', 'React', 'wagmi', 'Touch Events'],
    link: '/playground',
    art: `┌────────────────┐
│ ■ □ ■ □ ■ □ ■ │
│ □ ■ □ ■ □ ■ □ │
│ ■ ⌐◨-◨ ■ □ ■ │
│ □ ■ □ ■ □ ■ □ │
│ [PEN][FILL][OK]│
└────────────────┘`,
  },
  {
    name: 'Terminal Chat',
    desc: 'AI chat interface backed by Claude with full governance tool access. Vote, create proposals, place bids, delegate — all through natural language. 10 governance actions.',
    tag: 'LIVE',
    tagClass: 'tagLive',
    version: 'v1.0',
    stack: ['Claude AI', 'SSE', 'wagmi', 'Nouns Contracts'],
    href: 'https://noun.wtf/terminal',
    link: '/terminal',
    art: `$ noun-terminal v1.0
> vote for prop 948
preparing your vote...
support: FOR
reason: "good vibes"
[SIGN TX]`,
  },
  {
    name: 'Nouns Classic Fork',
    desc: 'noun.wtf itself — fork it, add your own features. Add content to the daily Noun, run concurrent auctions alongside the daily for your own art. Client ID 37.',
    tag: 'LIVE',
    tagClass: 'tagLive',
    version: 'v2.0',
    stack: ['Vite', 'React', 'Ponder', 'wagmi v2'],
    href: 'https://noun.wtf',
    art: `noun.wtf
├─ /studio    create art
├─ /terminal  AI chat
├─ /grants    micro-gov
├─ /feed      farcaster
├─ /settlers  agent
└─ /hackathons you are here`,
  },
  {
    name: 'Noun Grants',
    desc: 'Unaudited SmallGrantsTreasury contract — 24hr governance with no quorum. 12hr vote + 12hr timelock. A proposal passes with 1 FOR if nobody votes AGAINST. Micro-governance for the people.',
    tag: 'LIVE',
    tagClass: 'tagLive',
    version: 'v0.1 UNAUDITED',
    stack: ['Solidity', 'Governor', 'Ponder', 'React'],
    href: 'https://noun.wtf/grants',
    link: '/grants',
    art: `SmallGrantsTreasury.sol
propose() → ACTIVE
  12hr vote → SUCCEEDED
  12hr lock → QUEUED
  execute() → DONE
quorum: none (!)`,
  },
  {
    name: 'Predictions',
    desc: 'Prediction markets that resolve to onchain results of Nouns proposals. Live on mainnet. Bet on whether proposals will pass or fail, resolved by the actual vote outcome.',
    tag: 'MAINNET',
    tagClass: 'tagMainnet',
    version: 'v0.1',
    stack: ['Solidity', 'Base', 'Next.js', 'viem'],
    href: 'https://dev.pooter.world/predictions',
    art: `PREDICTIONS
┌──────────────────┐
│ Prop #948        │
│ Pass?  ■■■■░░ 67%│
│ Fail?  ■■░░░░ 33%│
│ [PREDICT] 0.01Ξ  │
└──────────────────┘`,
  },
  {
    name: 'Hackathon Guide (PDF)',
    desc: 'Everything you need to build on the noun.wtf stack: contracts, APIs, GraphQL schema, agent endpoints, local dev setup, environment variables, build ideas. 18 pages.',
    tag: 'GUIDE',
    tagClass: 'tagGuide',
    version: '2026.03',
    stack: ['PDF', '18 pages', 'CC0'],
    link: '/hackathon/noun-wtf-hackathon-guide.pdf',
    art: `noun.wtf Hackathon Guide
━━━━━━━━━━━━━━━━━━━━
1.  What Is This
2.  The Nouns Ecosystem
3.  Architecture
4.  Contracts On Chain
5.  GraphQL API
...
13. Build Ideas`,
  },
];

const BUILD_IDEAS = [
  {
    cat: 'Data',
    color: '#22d3ee',
    text: 'Voter influence graph',
    sub: 'Map who influences what with delegates + votes data',
  },
  {
    cat: 'Data',
    color: '#22d3ee',
    text: 'Proposal outcome predictor',
    sub: 'Use historical vote patterns to predict results',
  },
  {
    cat: 'Data',
    color: '#22d3ee',
    text: 'Treasury flow visualization',
    sub: 'Streams + proposal execution → where money goes',
  },
  {
    cat: 'Governance',
    color: '#4ade80',
    text: 'Delegation marketplace',
    sub: 'Help Noun holders find aligned delegates',
  },
  {
    cat: 'Governance',
    color: '#4ade80',
    text: 'Proposal diff viewer',
    sub: 'Track ProposalUpdated events, show what changed',
  },
  {
    cat: 'Governance',
    color: '#4ade80',
    text: 'Grant proposal templates',
    sub: 'Pre-built SmallGrantsTreasury proposals',
  },
  {
    cat: 'Agent',
    color: '#a78bfa',
    text: 'Custom settlement strategies',
    sub: 'Fork the trait predictor for different strategies',
  },
  {
    cat: 'Agent',
    color: '#a78bfa',
    text: 'Cross-DAO agent',
    sub: 'Extend nounirl to Lil Nouns, Purple DAO, ENS...',
  },
  {
    cat: 'Agent',
    color: '#a78bfa',
    text: 'Farcaster bot',
    sub: 'Post settlement predictions + governance activity',
  },
  {
    cat: 'Frontend',
    color: '#fbbf24',
    text: 'Mobile-first governance',
    sub: 'Native-feeling mobile app for Nouns voting',
  },
  {
    cat: 'Frontend',
    color: '#fbbf24',
    text: 'Noun trait explorer',
    sub: '3D viewer for all trait combos with rarity scores',
  },
  {
    cat: 'Onchain',
    color: '#f472b6',
    text: 'Extend SmallGrantsTreasury',
    sub: 'Recurring grants, milestone payouts, quadratic voting',
  },
  {
    cat: 'Onchain',
    color: '#f472b6',
    text: 'Noun fractionalization',
    sub: 'Split Noun voting power across multiple wallets',
  },
  {
    cat: 'Physical',
    color: '#fb923c',
    text: 'Bridge URL to IRL via good UX',
    sub: 'Raspberry Pi builds, cold storage delegate devices',
  },
  {
    cat: 'Physical',
    color: '#fb923c',
    text: 'Dot Matrix Noun Printer',
    sub: '80-col continuous feed Noun news printer',
  },
];

const LINKS = [
  { name: 'noun.wtf', url: 'https://noun.wtf', desc: 'Live site' },
  {
    name: 'GraphQL API',
    url: 'https://spirited-flexibility-production-3c30.up.railway.app/graphql',
    desc: 'Ponder API',
  },
  {
    name: 'SmallGrantsTreasury',
    url: 'https://etherscan.io/address/0xBAc9233725440c595b19d975309CC98cb259253a',
    desc: 'Etherscan',
  },
  {
    name: 'NounsToken',
    url: 'https://etherscan.io/address/0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03',
    desc: 'Etherscan',
  },
  {
    name: 'NounsDAOV4',
    url: 'https://etherscan.io/address/0x6f3E6272A167e8AcCb32072d08E0957F9c79223d',
    desc: 'Etherscan',
  },
  { name: 'Nouns Center', url: 'https://nouns.center', desc: 'Ecosystem docs' },
  { name: 'pooter.world', url: 'https://dev.pooter.world', desc: 'Predictions + more' },
];

export default function HackathonPage() {
  return (
    <div className={classes.container}>
      {/* ─── Hero ─────────────────────────────────── */}
      <div className={classes.hero}>
        <h1 className={classes.heroTitle}>World Compooter</h1>
        <p className={classes.heroSub}>A Nounish Hackathon 2026</p>
        <p className={classes.heroDesc}>
          Open source projects to copy-paste, fork, remix, and build on. Start small — if it works,
          scale it. If not, sunset it. Everything runs on Ethereum mainnet. Client ID 37.
        </p>
        <a
          href="/hackathon/noun-wtf-hackathon-guide.pdf"
          target="_blank"
          rel="noopener"
          className={classes.heroCtaFilled}
        >
          Download Hackathon Guide (PDF)
        </a>
        <a
          href="https://github.com/user/noun-wtf"
          target="_blank"
          rel="noopener noreferrer"
          className={classes.heroCta}
        >
          View Source on GitHub
        </a>
        <div className={classes.heroAscii}>{`
  pooter.world                         ⌐◨-◨
  ┌─────────────────────────┐
  │ $ noun-terminal v0.1    │    NounsDAO v4
  │ > settle --trait shark  │    proposals: 948
  │ watching block 21847293 │    treasury: $52M
  └─────────────────────────┘
        `}</div>
      </div>

      {/* ─── Example Projects ─────────────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>Example Projects</h2>
        <div className={classes.cartridgeGrid}>
          {EXAMPLE_PROJECTS.map(p => {
            const Wrapper = p.href ? 'a' : p.link ? 'a' : 'div';
            const wrapperProps = p.href
              ? { href: p.href, target: '_blank', rel: 'noopener noreferrer' }
              : p.link
                ? { href: p.link }
                : {};
            return (
              <Wrapper key={p.name} className={classes.cartridge} {...wrapperProps}>
                <div className={classes.cartridgeHeader}>
                  <span className={`${classes.cartridgeTag} ${classes[p.tagClass]}`}>{p.tag}</span>
                  <span className={classes.cartridgeVersion}>{p.version}</span>
                </div>
                <div className={classes.cartridgeScreen}>
                  <pre className={classes.cartridgeArt}>{p.art}</pre>
                </div>
                <div className={classes.cartridgeBody}>
                  <h3 className={classes.cartridgeName}>{p.name}</h3>
                  <p className={classes.cartridgeDesc}>{p.desc}</p>
                  <div className={classes.cartridgeFooter}>
                    <div className={classes.cartridgeStack}>
                      {p.stack.map(s => (
                        <span key={s} className={classes.stackChip}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Wrapper>
            );
          })}
        </div>
      </div>

      {/* ─── Physical Builds Gallery ──────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>Physical Builds</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Raspberry Pi terminals, crystal balls, silver Nouns, Duckhead prototypes and more. IRL
          compooter builds bridging URL to IRL.
        </p>
        <div className={classes.photoGrid}>
          <div className={classes.photoSlot}>
            <span>Noun Terminal — RPi 3B+</span>
            <span className={classes.photoLabel}>NT-FRAME MK.I housing assembly</span>
          </div>
          <div className={classes.photoSlot}>
            <span>Crystal Ball — RPi Zero W</span>
            <span className={classes.photoLabel}>0.96&quot; OLED trait predictor</span>
          </div>
          <div className={classes.photoSlot}>
            <span>Dot Matrix Printer</span>
            <span className={classes.photoLabel}>80col Noun news feed printer</span>
          </div>
          <div className={classes.photoSlot}>
            <span>Silver Nouns</span>
            <span className={classes.photoLabel}>Capybara, Mushroom, Wiz</span>
          </div>
          <div className={classes.photoSlot}>
            <span>Duckhead Prototypes</span>
            <span className={classes.photoLabel}>100+ prototypes and counting</span>
          </div>
          <div className={classes.photoSlot}>
            <span>More coming soon...</span>
            <span className={classes.photoLabel}>Upload your builds</span>
          </div>
        </div>
      </div>

      {/* ─── Build Ideas ──────────────────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>Build Ideas</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Concrete things you could build on this stack in a hackathon. The GraphQL API, REST
          endpoints, and agent are all live and ready to use.
        </p>
        <div className={classes.ideaGrid}>
          {BUILD_IDEAS.map((idea, i) => (
            <div key={i} className={classes.ideaCard}>
              <div className={classes.ideaCat} style={{ color: idea.color }}>
                {idea.cat}
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
        <div
          style={{
            background: '#0a0a0a',
            border: '1px solid #1e293b',
            padding: '1.25rem',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            color: '#94a3b8',
            lineHeight: 1.8,
          }}
        >
          <div>
            <span style={{ color: '#64748b' }}># Clone & install</span>
          </div>
          <div>
            <span style={{ color: '#22d3ee' }}>$</span> git clone
            https://github.com/user/noun-wtf.git
          </div>
          <div>
            <span style={{ color: '#22d3ee' }}>$</span> cd noun-wtf && pnpm install
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <span style={{ color: '#64748b' }}># Run frontend (uses production Ponder API)</span>
          </div>
          <div>
            <span style={{ color: '#22d3ee' }}>$</span> cd packages/nouns-webapp
          </div>
          <div>
            <span style={{ color: '#22d3ee' }}>$</span> CI=true pnpm dev
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <span style={{ color: '#64748b' }}># Open http://localhost:5173</span>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <span style={{ color: '#64748b' }}># Environment variables needed:</span>
          </div>
          <div>VITE_CHAIN_ID=1</div>
          <div>VITE_MAINNET_JSONRPC=https://ethereum-rpc.publicnode.com</div>
          <div>
            VITE_MAINNET_SUBGRAPH=https://spirited-flexibility-production-3c30.up.railway.app
          </div>
        </div>
      </div>

      {/* ─── Links ────────────────────────────────── */}
      <div className={classes.section}>
        <h2 className={classes.sectionTitle}>Links</h2>
        <div className={classes.linksGrid}>
          {LINKS.map(l => (
            <a
              key={l.name}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className={classes.linkRow}
            >
              <span className={classes.linkName}>{l.name}</span>
              <span className={classes.linkUrl}>{l.desc}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ─── Footer ───────────────────────────────── */}
      <div style={{ textAlign: 'center', padding: '2rem 0', color: '#334155', fontSize: '0.8rem' }}>
        <div style={{ marginBottom: '0.5rem' }}>CC0. No rights reserved. Fork everything.</div>
        <div>pooter.world — noun.wtf — Client ID 37</div>
      </div>
    </div>
  );
}
