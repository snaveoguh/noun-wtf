# noun-trade-contracts

Noun Trade's goods and coin as tokens on Base. Players trade off-chain in Noun World's
ice cream van game. To cash out, the game server signs a voucher and the player mints
the tokens with it. To deposit, the player burns tokens and the server credits the game.

| Contract | Standard | Name / symbol | Notes |
| --- | --- | --- | --- |
| `NounTradeGoods` | ERC-1155 | Noun Trade Goods / `NTGOODS` | One id per good, claim + deposit gateway, roles, caps |
| `NounTradeCoin` | ERC-20, 0 decimals | Noun Trade Coin / `NTCOIN` | Deployed by `NounTradeGoods`, which is its only minter and burner |

## Token ids

These ids never change. New goods are added at the end (8, 9, …) by giving the new id
a cap with `setCap` and adding its metadata JSON.

| id | good | metadata |
| --- | --- | --- |
| 0 | *(reserved: never minted; the NTCOIN key in the cap tables)* | |
| 1 | ICECREAM | `https://noun.wtf/trade-tokens/1.json` |
| 2 | FRIES | `…/2.json` |
| 3 | FISH | `…/3.json` |
| 4 | DRIP | `…/4.json` |
| 5 | NOGGLES | `…/5.json` |
| 6 | PIZZA | `…/6.json` |
| 7 | WATER | `…/7.json` |

`uri(id)` returns `{base}{id}.json` with a decimal id. Collection metadata is at
`contractURI()` = `https://noun.wtf/trade-tokens/collection.json`. The coin's metadata is
at `/trade-tokens/coin.json`. The files are in
`packages/nouns-webapp/public/trade-tokens/`.

**Why NTCOIN?** `COIN` is Coinbase's stock ticker and is too generic, and `NTC` is
already used by several tokens. `NTCOIN` puts the game's name (Noun Trade) in front, so
it shouldn't clash with a well-known token. It has 0 decimals, so 1 token equals 1 coin
in the game and wallets show the same number the game does.

## How it works

**Claim (cash out).**
1. `POST /.netlify/functions/world-trade-claim` with `{action:'claim', rider, address, goods, coin}`.
2. The server takes the goods and coin out of the rider's ledger. It signs the EIP-712 voucher only after that succeeds:

```
Claim(address player,uint256[] ids,uint256[] amounts,uint256 coin,uint256 nonce,uint256 expiry)
domain: name "NounTradeGoods", version "1", chainId, verifyingContract = NounTradeGoods
```

3. The player calls `claim(voucher, signature)` from `player`. The contract checks, in order:
   - `msg.sender == player`, so a voucher seen in the mempool can't be stolen
   - not expired, and expiry no more than 7 days ahead
   - the nonce is unused
   - the signer holds `SIGNER_ROLE`
   - the per-address and global daily caps for each id

   Then it records the nonce as used and mints.

**Deposit.**
1. The holder calls `deposit(ids, amounts, coin, keccak256(riderId))`. This burns their own tokens and emits `Deposited(player, account, depositId, ids, amounts, coin)`.
2. `POST /.netlify/functions/world-trade-deposit` with `{rider, tx}`.
3. The server reads the receipt from Base. It needs the tx to have succeeded and to be `TRADE_DEPOSIT_CONFIRMATIONS` deep, and it only counts logs from our contract that are tagged with this rider.
4. It credits the ledger once per tx.

**Refunds.** A voucher that was never used is refunded to the ledger once chain time is
past its expiry plus 60 s. After that point the contract can never accept it.

## Roles and trust

| Role | Can | Recommended holder |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | set caps, set URIs, `rotateSigner`, `cancelNonces`, `unpause`, grant/revoke roles. The hand-over takes two steps and waits `ADMIN_DELAY` (2 days). | A Safe multisig |
| `SIGNER_ROLE` | make vouchers valid by signing them. It sends no txs and needs no ETH. | The server's `TRADE_SIGNER_KEY` address |
| `PAUSER_ROLE` | pause claims and deposits (it cannot unpause) | The admin, or an ops key |

What each party can and can't do:
- **Minting.** Nothing mints except `claim` with a valid voucher. There's no owner mint and no mint role on the coin.
- **The admin.** The admin can grant `SIGNER_ROLE` (to itself too), so the admin can always issue vouchers. The daily caps limit how fast any signer can mint, honest or compromised.
- **Holders' tokens.** No one can burn or move a holder's tokens except the holder (or an operator they approved for transfers).
- **Pausing.** Pausing stops `claim` and `deposit` only. Transfers keep working.
- **A leaked signer key.** Call `rotateSigner(old, new)`. Vouchers signed by the old key fail straight away. Then set the new key in Netlify.
- **A leaked voucher.** `cancelNonces([nonce])`. The server refunds a cancelled voucher after its expiry.

Launch caps (UTC day, set in the constructor from `script/TradeConfig.sol`):

| key | per address / day | global / day |
| --- | --- | --- |
| each good (ids 1–7) | 500 | 50,000 |
| NTCOIN (key 0) | 50,000 | 5,000,000 |

The server enforces the same caps in `src/miniapps/world2/trade/onchain/tokens.ts`
(`CLAIM_CAPS`). If you change a cap on-chain with `setCap`, change it there too.

## Develop

Dependencies are vendored in `lib/` (OpenZeppelin Contracts v5.1.0 and forge-std v1.9.4,
installed with `forge install --no-git` and cut down to their sources), so you only need
Foundry:

```sh
cd packages/noun-trade-contracts
forge build
forge test            # 42 tests: unit, fuzz, invariant (supply only moves via vouchers/burns)
forge test --gas-report
```

To run it end to end on a local anvil chain (deploy → voucher → claim → burn → credit → refund):

```sh
cd packages/nouns-webapp
TRADE_E2E=1 npx vitest run netlify/lib/tradeOnchain.e2e.test.ts
```

## Deploy (the owner runs this; nothing in the repo holds a key)

### 0. Prepare three addresses

- **Deployer.** Any funded EOA. It only pays gas and gets no role. You need about 0.0001 ETH on Base, where the deploy costs about 5.3M gas.
- **Admin.** Your Safe on Base mainnet. On Sepolia it can be your own EOA.
- **Signer.** Generate a **new** key just for this, and keep it offline. It needs no funds.

  ```sh
  cast wallet new          # copy the private key into your password manager → TRADE_SIGNER_KEY
  ```

  The signer must not be the same address as the admin. The deploy script refuses if it is.

### 1. Base Sepolia (84532)

```sh
cd packages/noun-trade-contracts
export BASE_SEPOLIA_RPC=https://sepolia.base.org
export ETHERSCAN_API_KEY=...            # an Etherscan v2 key (works for Basescan)
export PRIVATE_KEY=0x...                # deployer (gas only)
export ADMIN_ADDRESS=0x...
export SIGNER_ADDRESS=0x...             # ADDRESS of TRADE_SIGNER_KEY
# optional: export PAUSER_ADDRESS=0x...  (defaults to ADMIN_ADDRESS)

forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify
```

The script prints the addresses and writes `deployments/84532.json`. If `NounTradeCoin`
(created by the goods constructor) doesn't show as verified on Basescan, verify it by
hand:

```sh
forge verify-contract <COIN_ADDRESS> src/NounTradeCoin.sol:NounTradeCoin \
  --chain 84532 --constructor-args $(cast abi-encode "constructor(address)" <GOODS_ADDRESS>)
```

### 2. Base mainnet (8453)

```sh
export BASE_RPC=https://mainnet.base.org
export CONFIRM_MAINNET=yes              # the script refuses mainnet without it
export ADMIN_ADDRESS=0x<your Safe>
forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC --broadcast --verify
```

Unset `PRIVATE_KEY` afterwards. If you'd rather not export it at all, use a Foundry
keystore: run `cast wallet import deployer --interactive`, leave `PRIVATE_KEY` unset, and
add `--account deployer --sender <deployer address>` to the `forge script` command.

### 3. Paste back

Commit `deployments/<chainId>.json`, or paste the **NounTradeGoods** and **NounTradeCoin**
addresses and the chain id.

**Netlify env** (Site configuration → Environment variables; never in the repo):

| var | value |
| --- | --- |
| `TRADE_ONCHAIN` | `on` |
| `TRADE_SIGNER_KEY` | the signer's private key (0x…) |
| `TRADE_GOODS_ADDRESS` | NounTradeGoods address |
| `TRADE_CHAIN_ID` | `84532` (Sepolia) or `8453` |
| `TRADE_RPC` | optional, defaults to the public Base RPC |
| `TRADE_VOUCHER_TTL_S` | optional, default `1800` |
| `TRADE_DEPOSIT_CONFIRMATIONS` | optional, default `3` |

**Webapp build env** (these are hardcoded in `.github/workflows/netlify-deploy.yml`):
`VITE_TRADE_ONCHAIN=true`, `VITE_TRADE_CHAIN_ID`, `VITE_TRADE_GOODS_ADDRESS`. The panel
stays hidden until they're set.
