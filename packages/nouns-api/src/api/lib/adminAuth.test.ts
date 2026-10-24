/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises the runner awaits */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { Hono } from 'hono';
import { privateKeyToAccount } from 'viem/accounts';

import { expect } from '../treasury/testExpect.js';

import {
  _resetDeployNonces,
  checkDeploySignature,
  deployMessage,
  isAdminRequest,
  makeSignatureVerifier,
  newDeployNonce,
  requireAdmin,
} from './adminAuth.js';

// Hardhat's well-known dev key #0 (also in CLAUDE.md) — never holds anything.
const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const other = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const verify = makeSignatureVerifier(); // EOA only; no RPC in tests

const SECRET = 'test-secret-value';
const NOW = 1_800_000_000_000;

function gatedApp() {
  const app = new Hono();
  app.post('/ops', requireAdmin, c => c.json({ ok: true }));
  return app;
}

describe('requireAdmin', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.AGENT_ADMIN_SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AGENT_ADMIN_SECRET;
    else process.env.AGENT_ADMIN_SECRET = saved;
  });

  it('fails closed (403) when AGENT_ADMIN_SECRET is unset, even with a header or localhost', async () => {
    delete process.env.AGENT_ADMIN_SECRET;
    const res = await gatedApp().request('http://localhost/ops', {
      method: 'POST',
      headers: { 'x-agent-secret': '', host: 'localhost' },
    });
    expect(res.status).toBe(403);
    const res2 = await gatedApp().request('/ops', {
      method: 'POST',
      headers: { 'x-agent-secret': 'anything' },
    });
    expect(res2.status).toBe(403);
  });

  it('401 without the header, 403 with a wrong one, 200 with the right one', async () => {
    process.env.AGENT_ADMIN_SECRET = SECRET;
    const app = gatedApp();
    expect((await app.request('/ops', { method: 'POST' })).status).toBe(401);
    const wrong = await app.request('/ops', {
      method: 'POST',
      headers: { 'x-agent-secret': SECRET + 'x' },
    });
    expect(wrong.status).toBe(403);
    const right = await app.request('/ops', {
      method: 'POST',
      headers: { 'x-agent-secret': SECRET },
    });
    expect(right.status).toBe(200);
    expect(isAdminRequest({ req: { header: () => SECRET } })).toBe(true);
  });
});

describe('admin routes are gated', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const agent = src('../routes/agent.ts');
  for (const path of ['learn', 'self-learn', 'people/build', 'backfill-tip-amounts', 'check']) {
    it(`POST /api/agent/${path} uses requireAdmin`, () => {
      expect(agent.includes(`app.post('/api/agent/${path}', requireAdmin,`)).toBe(true);
    });
  }
  it('POST /api/dream-nouns/import uses requireAdmin', () => {
    expect(src('../dreams.ts').includes("app.post('/api/dream-nouns/import', requireAdmin,")).toBe(
      true,
    );
  });
  it('the deploy route verifies the signature before reading the Noun balance', () => {
    const route = agent.slice(agent.indexOf("app.post('/api/agent/deploy'"));
    const sig = route.indexOf('checkDeploySignature(');
    const bal = route.indexOf('getNounBalance(');
    expect(sig > 0 && bal > sig).toBe(true);
  });
});

describe('checkDeploySignature', () => {
  beforeEach(() => _resetDeployNonces());

  async function signed(over: Record<string, unknown> = {}, signer = account) {
    const fields = {
      wallet: account.address,
      description: 'Make the header red\nand bold',
      reason: 'testing',
      nonce: newDeployNonce(),
      expires: NOW + 5 * 60_000,
      ...over,
    } as Parameters<typeof deployMessage>[0];
    const signature = await signer.signMessage({ message: deployMessage(fields) });
    return { ...fields, signature } as Record<string, unknown>;
  }

  it('accepts a fresh signature from the wallet, once', async () => {
    const body = await signed();
    const ok = await checkDeploySignature(body, verify, NOW);
    expect(ok).toEqual({ wallet: account.address });
    const replay = await checkDeploySignature(body, verify, NOW);
    expect(replay).toMatchObject({ status: 409 });
  });

  it('rejects a bare wallet field (no signature)', async () => {
    const res = await checkDeploySignature(
      { wallet: account.address, description: 'x', nonce: newDeployNonce(), expires: NOW + 1000 },
      verify,
      NOW,
    );
    expect(res).toMatchObject({ status: 401 });
  });

  it("rejects someone else's signature for the whale's address", async () => {
    const body = await signed({}, other);
    expect(await checkDeploySignature(body, verify, NOW)).toMatchObject({ status: 401 });
  });

  it('rejects a description or reason changed after signing', async () => {
    const body = await signed();
    expect(
      await checkDeploySignature({ ...body, description: 'rm -rf' }, verify, NOW),
    ).toMatchObject({ status: 401 });
    expect(await checkDeploySignature({ ...body, reason: 'other' }, verify, NOW)).toMatchObject({
      status: 401,
    });
  });

  it('rejects expired and too-far-future expiries', async () => {
    const old = await signed({ expires: NOW - 1 });
    expect(await checkDeploySignature(old, verify, NOW)).toMatchObject({ status: 401 });
    const far = await signed({ expires: NOW + 60 * 60_000 });
    expect(await checkDeploySignature(far, verify, NOW)).toMatchObject({ status: 400 });
  });
});
