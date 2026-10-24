/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises the runner awaits */
import { describe, it } from 'node:test';

import { decodeProposalTx, normalizeSignature } from './decode.js';
import { PROPOSAL_TXS } from './fixtures.js';
import { expect } from './testExpect.js';

// Real actions from mainnet proposals (fixtures.ts says which, and which executed).

describe('decodeProposalTx', () => {
  it('plain ETH send (prop 1)', () => {
    expect(decodeProposalTx(PROPOSAL_TXS.eth)).toEqual({
      type: 'eth',
      to: '0x0e09ceb98492715ec5b080d2b95b5004ddf43947',
      wei: 5_000000000000000000n,
    });
  });

  it('USDC via the Payer (prop 192)', () => {
    expect(decodeProposalTx(PROPOSAL_TXS.payer)).toEqual({
      type: 'payer',
      to: '0x79095391743e0f017a16c388de6a6a3f175a5cd5',
      raw: 450_000_000000n, // 450,000 USDC (6 decimals)
    });
  });

  it('createStream with a predicted address (prop 271)', () => {
    expect(decodeProposalTx(PROPOSAL_TXS.stream)).toEqual({
      type: 'stream',
      recipient: '0x7e787d4c26924fd35d8e119ea04a4e0a07111370',
      raw: 25_000000000000000000n,
      token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      start: 1683158400,
      stop: 1699056000,
      predicted: '0x33aac6e8a5a2e0a5d7df7d4ac96bc2fb5b3b764b',
    });
  });

  it('stETH transfer (prop 352, cancelled)', () => {
    expect(decodeProposalTx(PROPOSAL_TXS.stethTransfer)).toEqual({
      type: 'token',
      token: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
      to: '0x0260ba2dae8b85b5a1bd492829738bdcc7956f35',
      raw: 4800_000000000000000000n,
    });
  });

  it('a Noun leaving the treasury (prop 402, Noun 542)', () => {
    expect(decodeProposalTx(PROPOSAL_TXS.nounSafeTransfer)).toEqual({
      type: 'noun',
      from: '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71',
      to: '0x3dfd76a87cf769275e5bc8c4ab77e47d50ecda49',
      nounId: 542,
    });
  });

  it('WETH deposit and Lido submit are conversions, not spending (props 17, 18)', () => {
    expect(decodeProposalTx(PROPOSAL_TXS.wethDeposit)).toMatchObject({
      type: 'conversion',
      wei: 53_100000000000000000n,
    });
    expect(decodeProposalTx(PROPOSAL_TXS.lidoSubmit)).toMatchObject({
      type: 'conversion',
      wei: 1_000000000000000000n,
    });
  });

  it('non-transfer calls keep their function name and ETH value', () => {
    expect(decodeProposalTx(PROPOSAL_TXS.setter)).toEqual({
      type: 'call',
      target: '0x4f2acdc74f6941390d9b1804fabc3e780388cfe5',
      wei: 0n,
      fn: 'setBaselinePaymentTokenAmount',
    });
  });

  it('reads raw calldata (selector + args) when the signature is empty', () => {
    const { calldata } = PROPOSAL_TXS.stethTransfer;
    const withSelector = {
      ...PROPOSAL_TXS.stethTransfer,
      signature: '',
      calldata: `0xa9059cbb${calldata.slice(2)}`,
    };
    expect(decodeProposalTx(withSelector)).toMatchObject({
      type: 'token',
      raw: 4800_000000000000000000n,
    });
  });

  it('garbage calldata degrades to a call, never throws', () => {
    expect(
      decodeProposalTx({
        target: '0xd97bcd9f47cee35c0a9ec1dc40c1269afc9e8e1d',
        value: 0n,
        signature: 'sendOrRegisterDebt(address,uint256)',
        calldata: '0x1234',
      }),
    ).toMatchObject({ type: 'call', fn: 'sendOrRegisterDebt' });
  });
});

describe('normalizeSignature', () => {
  it('drops names and spaces', () => {
    expect(normalizeSignature('transfer(address to, uint256 amount)')).toBe(
      'transfer(address,uint256)',
    );
    expect(normalizeSignature('deposit( )')).toBe('deposit()');
  });
});
