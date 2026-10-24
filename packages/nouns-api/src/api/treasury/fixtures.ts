// Test fixtures for the treasury flow builder / decoder.
//
// PROPOSAL_TXS are verbatim rows from the indexer's `transaction` table
// (fetched from the Ponder GraphQL, 2026-10-24). All are from EXECUTED mainnet
// proposals except `stethTransfer` (prop 352 was cancelled; no stETH transfer
// has executed yet, but the decoder must read one).
// BUILD_INPUT marks them executed and adds synthetic rows (ids ≥ 9000,
// addresses 0xbbbb…/0xcccc…/…) to exercise refunds, forks, conversions and
// exclusions: it tests the arithmetic, not history.

import type { BuildInput, TransactionRow } from './buildFlows.js';
import type { RawProposalTx } from './decode.js';

import { encodeAbiParameters } from 'viem';

export const PROPOSAL_TXS = {
  /** Prop 1 (Donate 5 ETH each to 6 Charities) — the first 5 ETH. */
  eth: {
    target: '0x0e09ceb98492715ec5b080d2b95b5004ddf43947',
    value: 5000000000000000000n,
    signature: '',
    calldata: '0x',
  },
  /** Prop 192 (Verbs 6 Month Extension) — 450,000 USDC via the Payer. */
  payer: {
    target: '0xd97bcd9f47cee35c0a9ec1dc40c1269afc9e8e1d',
    value: 0n,
    signature: 'sendOrRegisterDebt(address,uint256)',
    calldata:
      '0x00000000000000000000000079095391743e0f017a16c388de6a6a3f175a5cd500000000000000000000000000000000000000000000000000000068c6171400',
  },
  /** Prop 271 (The Nominal Hero) — 25 WETH stream, May → Nov 2023. */
  stream: {
    target: '0x0fd206fc7a7dbcd5661157edcb1ffdd0d02a61ff',
    value: 0n,
    signature: 'createStream(address,uint256,address,uint256,uint256,uint8,address)',
    calldata:
      '0x0000000000000000000000007e787d4c26924fd35d8e119ea04a4e0a071113700000000000000000000000000000000000000000000000015af1d78b58c40000000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000006452f5800000000000000000000000000000000000000000000000000000000065458980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000033aac6e8a5a2e0a5d7df7d4ac96bc2fb5b3b764b',
  },
  /** Prop 352 (cancelled) — 4,800 stETH. */
  stethTransfer: {
    target: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
    value: 0n,
    signature: 'transfer(address,uint256)',
    calldata:
      '0x0000000000000000000000000260ba2dae8b85b5a1bd492829738bdcc7956f350000000000000000000000000000000000000000000001043561a88293000000',
  },
  /** Prop 402 (Gift Noun 542 to Bob Burnquist) — Noun 542 out of nouns.eth. */
  nounSafeTransfer: {
    target: '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03',
    value: 0n,
    signature: 'safeTransferFrom(address,address,uint256)',
    calldata:
      '0x000000000000000000000000b1a32fc9f9d8b2cf86c068cae13108809547ef710000000000000000000000003dfd76a87cf769275e5bc8c4ab77e47d50ecda49000000000000000000000000000000000000000000000000000000000000021e',
  },
  /** Prop 17 — wrap 53.1 ETH. */
  wethDeposit: {
    target: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    value: 53100000000000000000n,
    signature: 'deposit()',
    calldata: '0x',
  },
  /** Prop 18 — stake 1 ETH with Lido. */
  lidoSubmit: {
    target: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
    value: 1000000000000000000n,
    signature: 'submit(address)',
    calldata: '0x0000000000000000000000000000000000000000000000000000000000000000',
  },
  /** Prop 356 — Timelock V1 → nouns.eth migration, 2,500 ETH (internal). */
  migration: {
    target: '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71',
    value: 2500000000000000000000n,
    signature: '',
    calldata: '0x',
  },
  /** Prop 347 — a Token Buyer setter (no money moves). */
  setter: {
    target: '0x4f2acdc74f6941390d9b1804fabc3e780388cfe5',
    value: 0n,
    signature: 'setBaselinePaymentTokenAmount(uint256)',
    calldata: '0x0000000000000000000000000000000000000000000000000000002e90edd000',
  },
} satisfies Record<string, RawProposalTx>;

// ── Synthetic actors ──
export const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // cancelled-stream recipient
export const C = '0xcccccccccccccccccccccccccccccccccccccccc'; // contract that sold us something
export const F = '0xffffffffffffffffffffffffffffffffffffffff'; // fork treasury
export const S2 = '0x5555555555555555555555555555555555555555'; // the cancelled stream
const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';

const addrUint = (a: string, n: bigint) =>
  encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [a as `0x${string}`, n]);

const tx = (proposalId: number, index: number, t: RawProposalTx): TransactionRow => ({
  proposalId: BigInt(proposalId),
  index,
  ...t,
});

const executed = (id: number, t: number) => ({
  proposalId: BigInt(id),
  createdAt: new Date(t), // the indexer stores seconds in the Date
  createdAtTransaction: `0xexec${id}`,
});

const prop = (id: number, status = 'EXECUTED') => ({
  id: BigInt(id),
  proposer: W1,
  description: `# Prop ${id} title\n\nbody`,
  status,
  createdAt: new Date(1_640_000_000),
});

export const NOW = 1_700_000_000; // after prop 271's stream stopped

export const BUILD_INPUT: BuildInput = {
  now: NOW,
  proposals: [1, 17, 192, 271, 352, 356, 402, 9001, 9002, 9003]
    .map(id => prop(id))
    .concat([prop(247, 'CANCELLED')]),
  transactions: [
    tx(1, 0, PROPOSAL_TXS.eth),
    tx(17, 0, PROPOSAL_TXS.wethDeposit),
    tx(192, 0, PROPOSAL_TXS.payer),
    tx(271, 0, PROPOSAL_TXS.stream),
    // prop 271 action 2 (verbatim): the WETH that funds its stream — must not count twice
    tx(271, 2, {
      target: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      value: 0n,
      signature: 'transfer(address,uint256)',
      calldata:
        '0x00000000000000000000000033aac6e8a5a2e0a5d7df7d4ac96bc2fb5b3b764b0000000000000000000000000000000000000000000000015af1d78b58c40000',
    }),
    tx(352, 0, PROPOSAL_TXS.stethTransfer),
    tx(356, 0, PROPOSAL_TXS.migration),
    tx(402, 0, PROPOSAL_TXS.nounSafeTransfer),
    // 9001: 100 ETH to the Token Buyer (ETH → USDC, not spending)
    tx(9001, 0, {
      target: '0x4f2acdc74f6941390d9b1804fabc3e780388cfe5',
      value: 100n * 10n ** 18n,
      signature: '',
      calldata: '0x',
    }),
    // 9002: a 120k USDC stream, funded through the Payer, later cancelled
    tx(9002, 0, {
      target: '0x0fd206fc7a7dbcd5661157edcb1ffdd0d02a61ff',
      value: 0n,
      signature: 'createStream(address,uint256,address,uint256,uint256,uint8,address)',
      calldata: encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint8' },
          { type: 'address' },
        ],
        [
          B,
          120_000_000000n,
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          1_690_000_000n,
          1_710_000_000n,
          0,
          S2,
        ],
      ),
    }),
    tx(9002, 1, {
      target: '0xd97bcd9f47cee35c0a9ec1dc40c1269afc9e8e1d',
      value: 0n,
      signature: 'sendOrRegisterDebt(address,uint256)',
      calldata: addrUint(S2, 120_000_000000n),
    }),
    // 9003: 2 ETH sent with a contract call
    tx(9003, 0, {
      target: C,
      value: 2n * 10n ** 18n,
      signature: 'buy(uint256)',
      calldata: encodeAbiParameters([{ type: 'uint256' }], [1n]),
    }),
    // a cancelled proposal's action never counts
    tx(247, 0, PROPOSAL_TXS.eth),
  ],
  executions: [
    executed(1, 1_630_000_000), // 2021
    executed(17, 1_635_000_000),
    executed(192, 1_665_000_000), // 2022
    executed(271, 1_683_000_000), // 2023
    executed(352, 1_690_000_000),
    executed(356, 1_690_500_000),
    executed(402, 1_691_000_000),
    executed(9001, 1_692_000_000),
    executed(9002, 1_689_000_000),
    executed(9003, 1_693_000_000),
  ],
  auctions: [
    a(1, W1, 10n, 1_629_000_000),
    a(2, W2, 20n, 1_629_100_000),
    a(3, W1, 30n, 1_660_000_000),
    { ...a(4, null, 0n, 1_660_100_000), burned: true },
    a(5, null, 0n, 1_660_200_000), // V4: no bid → treasury
    { ...a(6, W2, 99n, 1_660_300_000), settled: false }, // live auction
  ].map((x, i) => (i === 1 ? { ...x, amount: 20_500000000000000000n } : x)),
  nouns: [
    // nounder rewards: 0 and 10; 1 and 11 went to auction
    { id: 0n },
    { id: 1n },
    { id: 10n },
    { id: 11n },
  ],
  streams: [
    stream(
      '0x33aac6e8a5a2e0a5d7df7d4ac96bc2fb5b3b764b',
      271,
      '0x7e787d4c26924fd35d8e119ea04a4e0a07111370',
      25n * 10n ** 18n,
      10n * 10n ** 18n,
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      1_683_158_400,
      1_699_056_000,
    ),
    // withdrawnAmount 30k = 20k withdrawn + 10k paid out by the cancel itself
    {
      ...stream(
        S2,
        9002,
        B,
        120_000_000000n,
        30_000_000000n,
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        1_690_000_000,
        1_710_000_000,
      ),
      status: 'cancelled',
    },
    // someone else's stream from the same factory — not the treasury's
    {
      ...stream(
        '0x6666666666666666666666666666666666666666',
        null,
        W2,
        5n,
        0n,
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        1,
        2,
      ),
      creator: W1,
      payer: W1,
    },
  ],
  streamCancels: [
    { streamAddress: S2, amount: 10_000_000000n, createdAt: new Date(1_695_000_000) },
  ],
  forkSends: [
    {
      to: F,
      token: null,
      amount: 1000n * 10n ** 18n,
      createdAt: new Date(1_694_000_000),
      createdAtTransaction: '0xfork',
    },
  ],
  forks: [{ forkId: 0, forkTreasury: F }],
  code: {
    '0x0e09ceb98492715ec5b080d2b95b5004ddf43947': 'contract',
    '0x79095391743e0f017a16c388de6a6a3f175a5cd5': 'safe',
    '0x7e787d4c26924fd35d8e119ea04a4e0a07111370': 'eoa',
    '0x0260ba2dae8b85b5a1bd492829738bdcc7956f35': 'safe',
    [B]: 'eoa',
    [C]: 'contract',
    // 0x3dfd… deliberately missing → person, codeUnknown
  },
  ens: { [W1]: 'whale.eth', '0x0260ba2dae8b85b5a1bd492829738bdcc7956f35': 'grants.nouns.eth' },
  indexing: { complete: true, block: 1, timestamp: 1 },
};

function a(nounId: number, winner: string | null, eth: bigint, t: number) {
  return {
    nounId: BigInt(nounId),
    winner,
    amount: eth * 10n ** 18n,
    settled: true,
    burned: false,
    endTime: new Date(t),
    settledAt: new Date(t + 60),
    settledAtTransaction: `0xsettle${nounId}`,
  };
}

function stream(
  streamAddress: string,
  proposalId: number | null,
  recipient: string,
  tokenAmount: bigint,
  withdrawnAmount: bigint,
  tokenAddress: string,
  start: number,
  stop: number,
) {
  return {
    streamAddress,
    proposalId: proposalId === null ? null : BigInt(proposalId),
    creator: '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71',
    payer: '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71',
    recipient,
    tokenAmount,
    withdrawnAmount,
    tokenAddress,
    startTime: new Date(start),
    stopTime: new Date(stop),
    status: 'active',
    createdAt: new Date(start - 100),
    createdAtTransaction: `0xstream${streamAddress.slice(2, 6)}`,
  };
}
