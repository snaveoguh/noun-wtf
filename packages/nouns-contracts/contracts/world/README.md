# NounWorldDrops

Items dropped in Noun World (the `/world` skate game) that players pick up
on-chain. It replaces `TreasureChest.sol`, whose `claim(dropId)` paid whoever
called it first, so a bot could take every drop without playing.

## How it works

1. **Deposit.** Anyone deposits ETH, an ERC20, an ERC721 or an ERC1155 into a
   new drop with an expiry (1 hour to 365 days). The drop gets an id
   (`dropCount`, starting at 1).
2. **Place.** The game server (`packages/nouns-webapp/netlify/functions/world-drops.ts`)
   is told where that drop sits in the world.
3. **Claim.** A player rides into the drop. The game sends the server the ride
   trace. The server checks the physics (`netlify/lib/runProof.ts`) and that
   the ride passes within 4 m of the drop. If both pass, it signs an EIP-712
   voucher `Claim(dropId, claimer, deadline)` for that player's address and
   holds the drop for them for 5 minutes. The player sends
   `claim(dropId, deadline, signature)`.
4. **Reclaim.** If nobody claims a drop before it expires, its depositor calls
   `reclaim(dropId)` to take it back. This works even while the contract is
   paused.

Security properties:

- A voucher is checked against `msg.sender`, so a voucher copied from the
  mempool doesn't work for anyone else.
- A drop pays out once: its status is set before the transfer.
- Every state-changing function is `nonReentrant`.
- ERC721 and ERC1155 payouts use `safeTransferFrom`, so a contract claimer
  must implement the receiver hook.
- ERC20 transfers use `SafeERC20`. A deposit records the amount actually
  received.
- The owner can rotate the signer, pause deposits and claims, and transfer
  ownership in two steps (`Ownable2Step`). The owner can never move deposited
  items.
- The contract is not upgradeable.
- NFTs sent straight to the contract are rejected. Use the deposit functions.
- Setting the signer to `address(0)` turns claims off.

EIP-712 domain: `name "NounWorldDrops"`, `version "1"`, the chain id, and the
contract address.
Type: `Claim(uint256 dropId,address claimer,uint256 deadline)`.

## Interface

```solidity
function depositETH(uint256 duration) payable returns (uint256 dropId)
function depositERC20(address token, uint256 amount, uint256 duration) returns (uint256)
function depositERC721(address token, uint256 tokenId, uint256 duration) returns (uint256)
function depositERC1155(address token, uint256 tokenId, uint256 amount, uint256 duration) returns (uint256)
function claim(uint256 dropId, uint256 deadline, bytes signature)
function reclaim(uint256 dropId)
function getDrop(uint256 dropId) view returns (Drop)  // depositor, expiresAt, kind, status, token, tokenId, amount, claimer
function hashClaim(uint256 dropId, address claimer, uint256 deadline) view returns (bytes32)
function setSigner(address) / pause() / unpause()     // owner only
```

`kind`: 0 ETH, 1 ERC20, 2 ERC721, 3 ERC1155.
`status`: 0 none, 1 open, 2 claimed, 3 reclaimed.

## Tests

```sh
cd packages/nouns-contracts
forge test --match-path test/foundry/world/NounWorldDrops.t.sol
```

## Deploying (owner checklist)

Nothing here has been deployed. Do these steps yourself:

1. **Make the signer key.** This key belongs only to the game server. Use a
   fresh key that holds no funds:

   ```sh
   cast wallet new          # note the address and the private key
   ```

   Keep the private key secret. It goes into Netlify only.

2. **Deploy.** `DROPS_OWNER` should be a multisig or the wallet you'll
   administer from:

   ```sh
   cd packages/nouns-contracts
   export DEPLOYER_PRIVATE_KEY=0x...      # pays gas
   export DROPS_OWNER=0x...               # can rotate the signer + pause
   export DROPS_SIGNER=0x...              # address from step 1
   export RPC_URL=https://ethereum-rpc.publicnode.com
   # dry run first
   forge script script/world/DeployNounWorldDrops.s.sol --rpc-url $RPC_URL
   # then for real
   forge script script/world/DeployNounWorldDrops.s.sol --rpc-url $RPC_URL \
     --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
   ```

   Note the logged `NounWorldDrops:` address. Try it on Sepolia first: use a
   Sepolia RPC URL and `WORLD_DROPS_CHAIN_ID=11155111` below.

3. **Configure the server** in the Netlify site settings, under environment
   variables, for Functions:

   | var | value |
   | --- | --- |
   | `WORLD_DROPS_SIGNER_KEY` | private key from step 1 (`0x` + 64 hex) |
   | `WORLD_DROPS_ADMIN_TOKEN` | a long random string (`openssl rand -hex 24`) |
   | `WORLD_DROPS_ADDRESS` | deployed contract address |
   | `WORLD_DROPS_CHAIN_ID` | `1` (default) or `11155111` |
   | `WORLD_DROPS_RPC_URL` | optional; defaults to publicnode |

   If any of the first three is missing, `GET /.netlify/functions/world-drops`
   returns `{ "enabled": false }`.

4. **Turn on the game side.** Add `VITE_WORLD_DROPS_ADDRESS: 0x...` to the
   webapp build env in `.github/workflows/netlify-deploy.yml`. `VITE_*` values
   are baked in at build time. The chain is the webapp's `VITE_CHAIN_ID`.

5. **Drop something.** For example, 0.05 ETH for 7 days:

   ```sh
   cast send $DROPS "depositETH(uint256)" 604800 --value 0.05ether --rpc-url $RPC_URL --private-key ...
   # NFT: approve first, then deposit
   cast send $NFT "approve(address,uint256)" $DROPS $ID ...
   cast send $DROPS "depositERC721(address,uint256,uint256)" $NFT $ID 604800 ...
   ```

   Read the new id with `cast call $DROPS "dropCount()(uint256)"`.

6. **Place it in the world.** The server can pick a random spot on a dirt
   track below the city, or you can give a position:

   ```sh
   curl -X POST https://noun.wtf/.netlify/functions/world-drops \
     -H "x-admin-token: $WORLD_DROPS_ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"action":"place","dropId":"1"}'
   # or {"action":"place","dropId":"1","position":{"x":10,"y":1.2,"z":20},"minDown":150,"maxDown":1200}
   # remove: {"action":"remove","dropId":"1"}
   ```

   The asset label, image and expiry are read from the contract. To set them
   yourself, pass `asset: {kind,label,image?}` and `expiresAt` (ms).

### Rotating the signer

Create a new key. Set `WORLD_DROPS_SIGNER_KEY` in Netlify and redeploy. Then
call `setSigner(newAddress)` from the owner. Vouchers signed with the old key
stop working immediately; any that were already issued last at most 5
minutes. If the key leaks, call `pause()` first.
