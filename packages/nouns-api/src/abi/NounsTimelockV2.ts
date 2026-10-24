// The two NounsDAOExecutorV2 (nouns.eth) events that move treasury funds
// outside a proposal: `sendETH` / `sendERC20` are admin-only (the governor)
// and only called by the fork paths (executeFork, joinFork). See
// packages/nouns-contracts/contracts/governance/NounsDAOExecutorV2.sol.
export const nounsTimelockV2Abi = [
  {
    type: 'event',
    name: 'ETHSent',
    inputs: [
      { name: 'to', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ERC20Sent',
    inputs: [
      { name: 'to', type: 'address', indexed: true, internalType: 'address' },
      { name: 'erc20Token', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
] as const;
