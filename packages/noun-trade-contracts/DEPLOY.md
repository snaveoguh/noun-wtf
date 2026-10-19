# Deploying Noun Trade tokens to Base mainnet

You run every step here yourself, with your own wallet. Nothing in this repo holds or
generates a key that controls the contracts. One deploy creates both contracts:
`NounTradeGoods` (ERC-1155, the claim/deposit gateway), which deploys `NounTradeCoin`
(NTCOIN, ERC-20) inside its constructor. The supply rules are in [SUPPLY.md](SUPPLY.md).

Expected cost: about 7.5M gas, which is well under 0.001 ETH at Base's usual fees.

## 0. What you need

| what | why |
| --- | --- |
| [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`) | to build, deploy and verify |
| A **Safe** on Base | becomes `OWNER_ADDRESS` (`DEFAULT_ADMIN_ROLE`): it can lower caps, rotate the signer, unpause. Make one at app.safe.global on Base. |
| A **deployer wallet** with a little ETH on Base | pays gas only; it gets **no role**. A Ledger, Trezor or a Foundry keystore. |
| A **new signer key** for the game server | its *address* gets `SIGNER_ROLE`; its *private key* goes only into Netlify |
| An Etherscan API key (v2, multichain) | for `--verify` on Basescan |

## 1. Make the server's signer key

Run this on your own machine, not in a chat or a CI log:

```sh
cast wallet new
```

- Put the **private key** in Netlify only: Site configuration → Environment variables →
  `TRADE_SIGNER_KEY`. Don't put it anywhere else.
- Keep the **address**. It's `SIGNER_ADDRESS` below.

The signer holds no funds and sends no transactions. It only signs cash-out vouchers. If
it ever leaks, the Safe calls `rotateSigner(old, new)` (step 6).

## 2. Set up the shell

```sh
cd packages/noun-trade-contracts
export BASE_RPC=https://mainnet.base.org      # or your own Base RPC
export ETHERSCAN_API_KEY=<your etherscan v2 key>
export OWNER_ADDRESS=<your Safe on Base>
export SIGNER_ADDRESS=<address from step 1>
# optional: export PAUSER_ADDRESS=<an ops wallet that can pause in an emergency>  (default: the Safe)
forge build && forge test     # 51 tests
```

`DeployBase` refuses to run if `OWNER_ADDRESS` isn't a contract (a Safe). To use a
plain wallet as owner anyway, add `ALLOW_EOA_OWNER=true`; a Safe is recommended. It also
refuses to make the signer the owner or the pauser.

## 3. Dry run (simulates against real Base, sends nothing)

With a Ledger:

```sh
forge script script/DeployBase.s.sol:DeployBase --rpc-url base \
  --ledger --sender <your Ledger address>
```

or with a Foundry keystore (`cast wallet import deployer --interactive` once first):

```sh
forge script script/DeployBase.s.sol:DeployBase --rpc-url base \
  --account deployer --sender <deployer address>
```

Check the printed `NounTradeGoods`, `NounTradeCoin`, `admin`, `signer`, `pauser` and
`launchDay`.

## 4. Deploy

Use the same command as the dry run, plus `--broadcast --verify`:

```sh
forge script script/DeployBase.s.sol:DeployBase --rpc-url base \
  --ledger --sender <your Ledger address> \
  --broadcast --verify
```

This writes `deployments/8453.json` (`goods`, `coin`, `admin`, `signer`, `pauser`,
`launchDay`, `block`). Commit that file.

## 5. Check it on-chain

```sh
G=$(jq -r .goods deployments/8453.json)
cast call $G "caps(uint256)(uint128,uint128)" 0 --rpc-url base          # 5000, 500000
cast call $G "maxSupply(uint256)(uint256)" 0 --rpc-url base             # 210000000
cast call $G "caps(uint256)(uint128,uint128)" 1 --rpc-url base          # 0, 0 (ice cream melts)
cast call $G "hasRole(bytes32,address)(bool)" \
  $(cast keccak "SIGNER_ROLE") $SIGNER_ADDRESS --rpc-url base           # true
cast call $G "launchDay()(uint256)" --rpc-url base
```

## 6. Turn it on in the game

**Netlify** (Site configuration → Environment variables). These are server-side and
never go in the repo:

| var | value |
| --- | --- |
| `TRADE_ONCHAIN` | `on` |
| `TRADE_CHAIN_ID` | `8453` |
| `TRADE_GOODS_ADDRESS` | `goods` from `deployments/8453.json` |
| `TRADE_SIGNER_KEY` | the private key from step 1 |
| `TRADE_LAUNCH_DAY` | `launchDay` from `deployments/8453.json` |

**Webapp build** (`.github/workflows/netlify-deploy.yml`: `VITE_*` values are baked in at
build time and are public):

```yaml
VITE_TRADE_ONCHAIN: 'true'
VITE_TRADE_CHAIN_ID: '8453'
VITE_TRADE_GOODS_ADDRESS: '<goods address>'
```

Then push to `staging` and test on dev-noun-wtf.netlify.app:
1. Open a town market and go to the **Base ⛓** tab.
2. Connect a wallet.
3. Cash out a few FRIES and some earned coin.
4. Check them in the wallet.
5. Deposit one back.

Once that works, merge to `main`.

## Day-two operations (from the Safe)

| situation | call |
| --- | --- |
| Signer key leaked or rotated | `rotateSigner(oldSigner, newSigner)`, then update `TRADE_SIGNER_KEY` in Netlify. Old vouchers stop working immediately. |
| Something's wrong, stop the bleeding | `pause()` (the pauser or the Safe): claims and deposits stop, transfers keep working. Only the Safe can `unpause()`. |
| Bots farming the game | `setCap(key, perAddress, global)`: caps can only be lowered |
| Reduce a token's lifetime supply | `lowerMaxSupply(key, newMax)`: never below what's already minted |
| Add a new good (id 8, 9, …) | `launchGood(id, perAddress, global, maxSupply)`: once per id, then add `public/trade-tokens/<id>.json` |
| A voucher leaked before use | `cancelNonces([nonce])` |
| Hand the Safe role to a new Safe | `beginDefaultAdminTransfer(newSafe)`, then after 2 days `acceptDefaultAdminTransfer()` from the new one |

Test first on Base Sepolia: use `script/Deploy.s.sol:Deploy` with `--rpc-url base_sepolia`
and `ADMIN_ADDRESS` instead of `OWNER_ADDRESS`. That script also accepts a
`PRIVATE_KEY` for throwaway testnet keys.
