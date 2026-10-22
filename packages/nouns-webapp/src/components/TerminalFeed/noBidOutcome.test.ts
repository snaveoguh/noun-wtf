import { ContractFunctionRevertedError, HttpRequestError, parseAbi } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { noBidFlags } from './noBidOutcome';

const TOKEN = '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03';
const ZERO = '0x0000000000000000000000000000000000000000';
const BIDDER = '0x850c65cb63fdEfAa4a687756A1311B920294FC5c';

const clientWith = (readContract: () => Promise<unknown>) =>
  ({ readContract: vi.fn(readContract) }) as unknown as Parameters<typeof noBidFlags>[0];

describe('noBidFlags', () => {
  it('leaves a won auction alone without an RPC call', async () => {
    const client = clientWith(async () => BIDDER);
    expect(await noBidFlags(client, TOKEN, 1n, BIDDER, 50n)).toEqual({});
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it('marks a no-bid noun that still has an owner as treasury', async () => {
    const client = clientWith(async () => '0xb1a32FC9F9D8b2cf86C068Cae13108809547ef71');
    expect(await noBidFlags(client, TOKEN, 2052n, ZERO, 0n)).toEqual({ treasury: true });
  });

  it('marks a no-bid noun as burned only when ownerOf reverts', async () => {
    const client = clientWith(async () => {
      throw new ContractFunctionRevertedError({
        abi: parseAbi(['function ownerOf(uint256) view returns (address)']),
        functionName: 'ownerOf',
      });
    });
    expect(await noBidFlags(client, TOKEN, 1n, ZERO, 0n)).toEqual({ burned: true });
  });

  it('does not call an RPC failure a burn', async () => {
    const client = clientWith(async () => {
      throw new HttpRequestError({ url: 'https://rpc.example', status: 429 });
    });
    expect(await noBidFlags(client, TOKEN, 2052n, ZERO, 0n)).toEqual({ treasury: true });
  });
});
