// ── Noun Trade supply model: 12 months of NTCOIN + goods on Base ──────────
//
//   node --experimental-strip-types scripts/supply-sim.ts            (markdown tables)
//   node --experimental-strip-types scripts/supply-sim.ts --json     (raw numbers)
//
// Pure arithmetic, no chain. It replays the rules the contracts enforce
// (script/TradeConfig.sol, src/NounTradeGoods.sol) against assumed player
// behaviour, so SUPPLY.md's tables can be regenerated whenever a number moves.
// Keep the constants below in sync with TradeConfig.sol.

// ── Contract rules (TradeConfig.sol) ──

const HALVING_DAYS = 180;
const MAX_HALVINGS = 4;

const COIN = {
  maxSupply: 210_000_000,
  globalPerDay: 500_000, // halves every HALVING_DAYS
  perAddressPerDay: 5_000,
};
const GOOD = {
  // per tradeable good id (FRIES, FISH, DRIP, NOGGLES, PIZZA, WATER); ICECREAM is 0
  maxSupply: 20_000_000,
  globalPerDay: 20_000,
  perAddressPerDay: 200,
};
const TRADEABLE_GOODS = 6;

/** Global cap on `day` (days since launch): halves every HALVING_DAYS, 4 times at most. */
export const capOn = (base: number, day: number) =>
  Math.floor(base / 2 ** Math.min(MAX_HALVINGS, Math.floor(day / HALVING_DAYS)));

// ── Player behaviour (assumptions, not rules) ──

interface Scenario {
  name: string;
  /** Daily active players on launch day, and monthly growth. */
  dau0: number;
  growth: number;
}

const SCENARIOS: Scenario[] = [
  { name: 'small (100 DAU, flat)', dau0: 100, growth: 0 },
  { name: 'steady (1,000 DAU, +10%/mo)', dau0: 1_000, growth: 0.1 },
  { name: 'breakout (10,000 DAU, +25%/mo)', dau0: 10_000, growth: 0.25 },
];

const BEHAVIOUR = {
  /** COIN profit a player earns per active day by driving trade routes (after the starter purse). */
  coinPerDay: 600,
  /** Goods units a player ends a day holding that could leave the game. */
  goodsPerDay: 30,
  /** Share of a day's earnings that gets cashed out to Base. */
  cashOut: 0.3,
  /** Share of on-chain holdings deposited (burned) back into the game each day. */
  depositPerDay: 0.01,
  /** Share of cashing-out players who'd hit the per-address cap anyway (whales). */
  whaleShare: 0.02,
  whaleCoinPerDay: 50_000,
};

interface Month {
  month: number;
  dau: number;
  coinMinted: number;
  coinBurned: number;
  coinSupply: number;
  coinCapBound: boolean;
  goodsMinted: number;
  goodsBurned: number;
  goodsSupply: number;
}

export function simulate(s: Scenario, days = 360): Month[] {
  const months: Month[] = [];
  let coinMintedTotal = 0;
  let coinSupply = 0;
  let goodsMintedTotal = 0;
  let goodsSupply = 0;
  let m: Month | null = null;
  for (let day = 0; day < days; day++) {
    const month = Math.floor(day / 30);
    if (m === null || m.month !== month + 1) {
      if (m !== null) months.push(m);
      m = {
        month: month + 1,
        dau: 0,
        coinMinted: 0,
        coinBurned: 0,
        coinSupply: 0,
        coinCapBound: false,
        goodsMinted: 0,
        goodsBurned: 0,
        goodsSupply: 0,
      };
    }
    const dau = Math.round(s.dau0 * (1 + s.growth) ** (day / 30));
    m.dau = dau;

    // NTCOIN: what players ask for, clipped per address, then by the day's global cap
    // and the lifetime max supply.
    const whales = Math.round(dau * BEHAVIOUR.whaleShare);
    const regular = dau - whales;
    const perAddr = (x: number) => Math.min(COIN.perAddressPerDay, x);
    const askCoin =
      regular * perAddr(BEHAVIOUR.coinPerDay * BEHAVIOUR.cashOut) +
      whales * perAddr(BEHAVIOUR.whaleCoinPerDay);
    const coinRoom = Math.min(capOn(COIN.globalPerDay, day), COIN.maxSupply - coinMintedTotal);
    const coinMint = Math.max(0, Math.min(askCoin, coinRoom));
    if (askCoin > coinRoom) m.coinCapBound = true;
    const coinBurn = Math.floor(coinSupply * BEHAVIOUR.depositPerDay);
    coinMintedTotal += coinMint;
    coinSupply += coinMint - coinBurn;
    m.coinMinted += coinMint;
    m.coinBurned += coinBurn;
    m.coinSupply = coinSupply;

    // Goods (all six tradeable ids together)
    const askGoods =
      dau * Math.min(GOOD.perAddressPerDay, BEHAVIOUR.goodsPerDay * BEHAVIOUR.cashOut);
    const goodsRoom = Math.min(
      capOn(GOOD.globalPerDay, day) * TRADEABLE_GOODS,
      GOOD.maxSupply * TRADEABLE_GOODS - goodsMintedTotal,
    );
    const goodsMint = Math.max(0, Math.min(askGoods, goodsRoom));
    const goodsBurn = Math.floor(goodsSupply * BEHAVIOUR.depositPerDay);
    goodsMintedTotal += goodsMint;
    goodsSupply += goodsMint - goodsBurn;
    m.goodsMinted += goodsMint;
    m.goodsBurned += goodsBurn;
    m.goodsSupply = goodsSupply;
  }
  if (m !== null) months.push(m);
  return months;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function table(s: Scenario): string {
  const rows = simulate(s);
  const head =
    '| month | DAU | NTCOIN minted | NTCOIN burned | NTCOIN supply | daily cap hit | goods minted | goods supply |\n' +
    '| ---: | ---: | ---: | ---: | ---: | :---: | ---: | ---: |';
  const body = rows
    .map(
      r =>
        `| ${r.month} | ${fmt(r.dau)} | ${fmt(r.coinMinted)} | ${fmt(r.coinBurned)} | ${fmt(r.coinSupply)} | ${r.coinCapBound ? 'yes' : ''} | ${fmt(r.goodsMinted)} | ${fmt(r.goodsSupply)} |`,
    )
    .join('\n');
  return `#### ${s.name}\n\n${head}\n${body}\n`;
}

const isMain = process.argv[1]?.endsWith('supply-sim.ts') === true;
if (isMain) {
  if (process.argv.includes('--json'))
    console.log(JSON.stringify(SCENARIOS.map(s => ({ ...s, months: simulate(s) })), null, 2));
  else console.log(SCENARIOS.map(table).join('\n'));
}
