// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Noun Trade Coin (NTCOIN)
/// @notice The ERC-20 twin of Noun Trade's in-game COIN. 0 decimals: one token is one
///         coin in the game, exactly as the game shows it.
/// @dev There is no owner, no admin and no mint role. The only address that can mint
///      or burn is `game`, fixed at construction: the NounTradeGoods contract that deploys
///      this one. Goods mints only against a valid server-signed voucher (`claim`) and
///      burns only the caller's own balance (`deposit`), so the supply moves exactly when
///      the goods supply does.
contract NounTradeCoin is ERC20 {
    /// @notice The NounTradeGoods contract: the sole minter / burner.
    address public immutable game;

    error OnlyGame();

    constructor(address game_) ERC20("Noun Trade Coin", "NTCOIN") {
        game = game_;
    }

    modifier onlyGame() {
        if (msg.sender != game) revert OnlyGame();
        _;
    }

    /// @notice 1 token = 1 in-game coin.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /// @notice Mint for a claimed voucher. Only the game contract can call this.
    function mint(address to, uint256 amount) external onlyGame {
        _mint(to, amount);
    }

    /// @notice Burn for a deposit back into the game. Only the game contract can call
    ///         this, and it only ever passes `from == msg.sender` of its own `deposit`.
    function burnByGame(address from, uint256 amount) external onlyGame {
        _burn(from, amount);
    }
}
