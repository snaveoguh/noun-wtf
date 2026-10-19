// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Launch configuration shared by the deploy scripts and the tests.
/// @dev Keep in sync with packages/nouns-webapp/src/miniapps/world2/trade/onchain/tokens.ts
///      (TRADE_TOKEN_IDS and CLAIM_CAPS): the server refuses claims over these before the
///      chain would.
library TradeConfig {
    // Token ids (stable; append only).
    uint256 internal constant COIN_KEY = 0;
    uint256 internal constant ICECREAM = 1;
    uint256 internal constant FRIES = 2;
    uint256 internal constant FISH = 3;
    uint256 internal constant DRIP = 4;
    uint256 internal constant NOGGLES = 5;
    uint256 internal constant PIZZA = 6;
    uint256 internal constant WATER = 7;
    uint256 internal constant GOOD_COUNT = 7;

    // Supply (SUPPLY.md; regenerate its tables with scripts/supply-sim.ts after a change).
    // Daily caps are per UTC day; the global ones halve every 180 days after launch (4x
    // at most). Goods are units; COIN is whole coins (0 decimals). No premine: nothing
    // exists until a player cashes out what they earned in the game.
    uint128 internal constant GOOD_CAP_PER_ADDRESS = 200;
    uint128 internal constant GOOD_CAP_GLOBAL = 20_000;
    uint256 internal constant GOOD_MAX_SUPPLY = 20_000_000;
    uint128 internal constant COIN_CAP_PER_ADDRESS = 5_000;
    uint128 internal constant COIN_CAP_GLOBAL = 500_000;
    uint256 internal constant COIN_MAX_SUPPLY = 210_000_000;

    /// @notice Two days before an admin hand-over completes (OZ AccessControlDefaultAdminRules).
    uint48 internal constant ADMIN_DELAY = 2 days;

    string internal constant BASE_URI = "https://noun.wtf/trade-tokens/";
    string internal constant CONTRACT_URI = "https://noun.wtf/trade-tokens/collection.json";

    /// @notice Launch caps. ICECREAM gets none (and no supply): it melts, so it stays in the game.
    function caps()
        internal
        pure
        returns (
            uint256[] memory keys,
            uint128[] memory perAddress,
            uint128[] memory global,
            uint256[] memory maxSupply
        )
    {
        keys = new uint256[](GOOD_COUNT + 1);
        perAddress = new uint128[](GOOD_COUNT + 1);
        global = new uint128[](GOOD_COUNT + 1);
        maxSupply = new uint256[](GOOD_COUNT + 1);
        keys[0] = COIN_KEY;
        perAddress[0] = COIN_CAP_PER_ADDRESS;
        global[0] = COIN_CAP_GLOBAL;
        maxSupply[0] = COIN_MAX_SUPPLY;
        for (uint256 i = 1; i <= GOOD_COUNT; ++i) {
            keys[i] = i;
            if (i == ICECREAM) continue;
            perAddress[i] = GOOD_CAP_PER_ADDRESS;
            global[i] = GOOD_CAP_GLOBAL;
            maxSupply[i] = GOOD_MAX_SUPPLY;
        }
    }
}
