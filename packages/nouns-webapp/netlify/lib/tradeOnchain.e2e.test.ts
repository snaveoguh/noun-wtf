// @vitest-environment node
//
// End-to-end on a local anvil chain (skipped unless TRADE_E2E=1):
//   deploy (forge script) → server debits ledger + signs voucher → player claims (mint)
//   → player burns via deposit → server verifies the receipt and credits the ledger,
//   plus replay refusal and an expired-voucher refund.
//
//   cd packages/nouns-webapp && TRADE_E2E=1 npx vitest run netlify/lib/tradeOnchain.e2e.test.ts
//
// Needs Foundry (anvil + forge on PATH, or FOUNDRY_BIN=~/.foundry/bin). Every key here
// is either anvil's public dev mnemonic (funded only on this throwaway local chain) or
// generated fresh in-run; nothing touches a real network.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, mnemonicToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  NOUN_TRADE_COIN_ABI,
  NOUN_TRADE_GOODS_ABI,
  riderTag,
  voucherFromWire,
  type SignedClaim,
} from '../../src/miniapps/world2/trade/onchain/tokens';

import { blobLedger, claimService, type KV } from './tradeClaim';
import { depositService } from './tradeDeposit';
import { signerFromKey, viemChainPort, type TradeChainConfig } from './tradeOnchain';

const RUN = process.env.TRADE_E2E === '1';
const CONTRACTS = resolve(__dirname, '../../../noun-trade-contracts');
const BIN = process.env.FOUNDRY_BIN ?? join(homedir(), '.foundry', 'bin');
const tool = (name: string) => (existsSync(join(BIN, name)) ? join(BIN, name) : name);
const PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;

// anvil's default dev mnemonic: public, local-only accounts.
const DEV_MNEMONIC = 'test test test test test test test test test test test junk';
const deployer = mnemonicToAccount(DEV_MNEMONIC, { addressIndex: 0 });
const admin = mnemonicToAccount(DEV_MNEMONIC, { addressIndex: 1 });
const player = mnemonicToAccount(DEV_MNEMONIC, { addressIndex: 2 });
// The voucher signer: a fresh key made for this run, never funded.
const SIGNER_KEY = generatePrivateKey();

/** In-memory Netlify Blobs stand-in (etag CAS), as in the unit tests. */
function memoryKV(): KV {
  const m = new Map<string, { v: string; etag: string }>();
  let n = 0;
  return {
    async get(k) {
      const b = m.get(k);
      return b ? JSON.parse(b.v) : null;
    },
    async getWithMetadata(k) {
      const b = m.get(k);
      return b ? { data: JSON.parse(b.v), etag: b.etag } : null;
    },
    async setJSON(k, v, o = {}) {
      const b = m.get(k);
      if (o.onlyIfNew === true && b !== undefined) return { modified: false };
      if (o.onlyIfMatch !== undefined && b?.etag !== o.onlyIfMatch) return { modified: false };
      m.set(k, { v: JSON.stringify(v), etag: `e${++n}` });
      return { modified: true };
    },
    async delete(k) {
      m.delete(k);
    },
  };
}

let anvil: ChildProcess | null = null;
let pub: PublicClient;
const log = (...a: unknown[]) => console.log('[e2e]', ...a);

async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return ((await res.json()) as { result: unknown }).result;
}

describe.skipIf(!RUN)('Noun Trade on anvil: deploy → claim → burn → credit', () => {
  let goods: Address;
  let coin: Address;
  const out: Record<string, unknown> = {};

  beforeAll(async () => {
    anvil = spawn(tool('anvil'), ['--port', String(PORT), '--chain-id', '31337', '--silent'], {
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await rpc('eth_chainId')) !== undefined) break;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    pub = createPublicClient({ chain: foundry, transport: http(RPC) }) as PublicClient;

    const signerAddr = signerFromKey(SIGNER_KEY)!.address;
    const r = spawnSync(
      tool('forge'),
      ['script', 'script/Deploy.s.sol:Deploy', '--rpc-url', RPC, '--broadcast'],
      {
        cwd: CONTRACTS,
        encoding: 'utf8',
        env: {
          ...process.env,
          PRIVATE_KEY: `0x${Buffer.from(deployer.getHdKey().privateKey!).toString('hex')}`,
          ADMIN_ADDRESS: admin.address,
          SIGNER_ADDRESS: signerAddr,
        },
      },
    );
    if (r.status !== 0) throw new Error(`forge script failed:\n${r.stdout}\n${r.stderr}`);
    const dep = JSON.parse(readFileSync(join(CONTRACTS, 'deployments', '31337.json'), 'utf8'));
    goods = dep.goods;
    coin = dep.coin;
    out.contracts = {
      NounTradeGoods: goods,
      NounTradeCoin: coin,
      admin: admin.address,
      signer: signerAddr,
    };
    log('deployed', out.contracts);
  }, 120_000);

  afterAll(() => {
    anvil?.kill();
    if (RUN)
      log(
        'summary',
        JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
      );
  });

  it('runs the whole loop', async () => {
    const kv = memoryKV();
    const ledger = blobLedger(kv);
    const cfg: TradeChainConfig = {
      enabled: true,
      chainId: 31337,
      goods,
      rpc: RPC,
      ttlS: 1800,
      confirmations: 2,
    };
    const chain = viemChainPort(cfg);
    // The server clock follows the chain clock (anvil time jumps below).
    let chainNow = Number((await pub.getBlock()).timestamp) * 1000;
    const now = () => chainNow;
    const claims = claimService({
      store: kv,
      ledger,
      signer: signerFromKey(SIGNER_KEY),
      chain,
      cfg,
      now,
    });
    const deposits = depositService({ store: kv, ledger, chain, cfg, now });
    const wallet = createWalletClient({ account: player, chain: foundry, transport: http(RPC) });
    const RIDER = 'rider-e2e-1';

    // The game ledger starts with some van stock.
    await ledger.credit(RIDER, { goods: { ICECREAM: 10, FISH: 4 }, coin: 500 }, 'seed');

    // 1. server: debit + sign
    const c = await claims.claim({
      rider: RIDER,
      address: player.address,
      goods: { ICECREAM: 3, FISH: 4 },
      coin: 120,
    });
    expect(c.status).toBe(200);
    const signed = c.body.claim as SignedClaim;
    out.voucher = signed;
    out.ledgerAfterCashOut = (c.body.state as object) ?? null;
    log('voucher', signed.voucher, 'ledger now', c.body.state);

    // 2. player: claim on-chain
    const claimData = encodeFunctionData({
      abi: NOUN_TRADE_GOODS_ABI,
      functionName: 'claim',
      args: [voucherFromWire(signed.voucher), signed.signature],
    });
    const claimTx = await wallet.sendTransaction({ to: goods, data: claimData });
    const claimRc = await pub.waitForTransactionReceipt({ hash: claimTx });
    expect(claimRc.status).toBe('success');
    out.claimTx = { hash: claimTx, gasUsed: claimRc.gasUsed };

    const bal = await pub.readContract({
      address: goods,
      abi: NOUN_TRADE_GOODS_ABI,
      functionName: 'balanceOfBatch',
      args: [
        [player.address, player.address],
        [1n, 3n],
      ],
    });
    const coinBal = await pub.readContract({
      address: coin,
      abi: NOUN_TRADE_COIN_ABI,
      functionName: 'balanceOf',
      args: [player.address],
    });
    expect(bal).toEqual([3n, 4n]);
    expect(coinBal).toBe(120n);
    out.onchainAfterClaim = { ICECREAM: bal[0], FISH: bal[1], NTCOIN: coinBal };

    // replaying the same voucher reverts
    await expect(
      pub.call({ account: player.address, to: goods, data: claimData }),
    ).rejects.toThrow();
    out.replay = 'reverted (NonceNotUnused)';

    // pending clears once the chain shows the nonce claimed
    expect((await claims.pending(RIDER)).body.pending).toBeNull();

    // 3. player: burn 2 ICECREAM + 50 NTCOIN back into the game
    const depData = encodeFunctionData({
      abi: NOUN_TRADE_GOODS_ABI,
      functionName: 'deposit',
      args: [[1n], [2n], 50n, riderTag(RIDER)],
    });
    const depTx = await wallet.sendTransaction({ to: goods, data: depData });
    const depRc = await pub.waitForTransactionReceipt({ hash: depTx });
    expect(depRc.status).toBe('success');
    out.depositTx = { hash: depTx, gasUsed: depRc.gasUsed };

    // not deep enough yet → retry; one more block → credited
    const early = await deposits.verify(RIDER, depTx);
    expect(early.status).toBe(202);
    await rpc('evm_mine');
    const credit = await deposits.verify(RIDER, depTx);
    expect(credit.status).toBe(200);
    expect(credit.body.credited).toEqual({ goods: { ICECREAM: 2 }, coin: 50 });
    out.depositCredit = credit.body;
    const again = await deposits.verify(RIDER, depTx);
    expect(again.body.already).toBe(true);
    // another rider cannot redeem it
    expect((await deposits.verify('someone-else', depTx)).status).toBe(403);

    // 4. an unused voucher is refunded once it has expired on-chain
    const c2 = await claims.claim({
      rider: RIDER,
      address: player.address,
      goods: { ICECREAM: 1 },
      coin: 0,
    });
    expect(c2.status).toBe(200);
    await rpc('evm_increaseTime', [1800 + 120]);
    await rpc('evm_mine');
    chainNow += (1800 + 120) * 1000;
    const p = await claims.pending(RIDER);
    expect(p.body.refunded).toEqual({ goods: { ICECREAM: 1 }, coin: 0 });
    // and that expired voucher can no longer be used on-chain
    const v2 = c2.body.claim as SignedClaim;
    await expect(
      pub.call({
        account: player.address,
        to: goods,
        data: encodeFunctionData({
          abi: NOUN_TRADE_GOODS_ABI,
          functionName: 'claim',
          args: [voucherFromWire(v2.voucher), v2.signature],
        }),
      }),
    ).rejects.toThrow();
    out.expiredVoucher = 'refunded to ledger; on-chain claim reverts (VoucherExpired)';

    // Final books: game ledger + on-chain supply.
    const final = await kv.get(`ledger/${RIDER}`, { type: 'json' });
    const supply = await pub.readContract({
      address: goods,
      abi: [
        {
          type: 'function',
          name: 'totalSupply',
          stateMutability: 'view',
          inputs: [{ name: 'id', type: 'uint256' }],
          outputs: [{ type: 'uint256' }],
        },
      ] as const,
      functionName: 'totalSupply',
      args: [1n],
    });
    out.finalLedger = (final as { state: unknown }).state;
    out.icecreamSupply = supply;
    // 10 - 3 cashed out + 2 deposited (the refunded 1 went out and came back) = 9
    expect(
      (final as { state: { cargo: Record<string, number>; coin: number } }).state,
    ).toMatchObject({
      coin: 500 - 120 + 50,
      cargo: { ICECREAM: 9 },
    });
    expect(supply).toBe(1n);
  }, 120_000);
});

