// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {NounTradeCoin} from "./NounTradeCoin.sol";

/// @title Noun Trade Goods
/// @notice Every Noun Trade good as an ERC-1155 token on Base, plus the claim / deposit
///         gateway between the off-chain game ledger and the chain.
///
///  Token ids (stable forever; new goods only ever append):
///      0 reserved (never minted; used as the COIN key in the cap tables)
///      1 ICECREAM  2 FRIES  3 FISH  4 DRIP  5 NOGGLES  6 PIZZA  7 WATER
///
///  CLAIM (cash out): players trade off-chain. The game server debits their ledger and
///  signs an EIP-712 `Claim` voucher; the player submits it here and the goods (and
///  NTCOIN, the ERC-20 deployed by this contract) are minted to them. Vouchers are
///  bound to the player (msg.sender must be `player`), single-use (nonce), short-lived
///  (expiry, at most MAX_VOUCHER_TTL ahead) and limited by per-address and global
///  daily caps per id. A token id is only claimable once the admin gives it a cap.
///
///  DEPOSIT (back into the game): the holder burns their own tokens here, tagged with
///  `account` (keccak256 of their game rider id); the server reads the `Deposited` event
///  from the tx receipt and credits that rider, once per tx.
///
///  ROLES
///      DEFAULT_ADMIN_ROLE  caps, metadata URIs, signer rotation, nonce cancels, unpause,
///                          role grants. Two-step transfer with a delay (OZ
///                          AccessControlDefaultAdminRules). Use a multisig.
///      SIGNER_ROLE         an address whose EIP-712 signature makes a voucher valid
///                          (the server's hot key). Holds no funds and sends no txs.
///      PAUSER_ROLE         pause claims and deposits (only the admin unpauses).
///
///  Documented trust: no address can mint except through a signed voucher. The admin can
///  grant SIGNER_ROLE (including to itself), so the admin can always issue vouchers;
///  caps bound how fast any signer, honest or compromised, can mint. Nobody can burn or
///  move a holder's tokens except the holder (or their ERC-1155 approved operator for
///  transfers). Pausing stops claims and deposits only, never transfers.
contract NounTradeGoods is ERC1155Supply, AccessControlDefaultAdminRules, Pausable, ReentrancyGuard, EIP712 {
    using Strings for uint256;

    // ── Roles / constants ──

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(address player,uint256[] ids,uint256[] amounts,uint256 coin,uint256 nonce,uint256 expiry)"
    );

    /// @notice Cap-table key for NTCOIN (token id 0 is never minted).
    uint256 public constant COIN_KEY = 0;
    /// @notice Most ids in one voucher or deposit.
    uint256 public constant MAX_BATCH = 16;
    /// @notice A voucher may not expire further than this ahead of the block it lands in.
    uint256 public constant MAX_VOUCHER_TTL = 7 days;

    string public constant name = "Noun Trade Goods";
    string public constant symbol = "NTGOODS";

    // ── State ──

    /// @notice The ERC-20 COIN, minted / burned only by this contract.
    NounTradeCoin public immutable coin;

    struct Cap {
        uint128 perAddress; // per address per UTC day
        uint128 global; // across everyone per UTC day; 0 = not claimable
    }

    struct Claim {
        address player;
        uint256[] ids;
        uint256[] amounts;
        uint256 coin;
        uint256 nonce;
        uint256 expiry;
    }

    enum NonceState {
        Unused,
        Claimed,
        Cancelled
    }

    mapping(uint256 key => Cap) public caps;
    mapping(uint256 nonce => NonceState) public nonceState;
    mapping(uint256 day => mapping(uint256 key => uint256)) public mintedOn;
    mapping(uint256 day => mapping(address who => mapping(uint256 key => uint256))) public mintedBy;
    /// @notice Running deposit counter (the `depositId` of the next deposit is this + 1).
    uint256 public depositCount;

    string private _base;
    string private _contractURI;

    // ── Events ──

    event Claimed(
        address indexed player,
        uint256 indexed nonce,
        address indexed signer,
        uint256[] ids,
        uint256[] amounts,
        uint256 coin
    );
    event Deposited(
        address indexed player,
        bytes32 indexed account,
        uint256 indexed depositId,
        uint256[] ids,
        uint256[] amounts,
        uint256 coin
    );
    event CapSet(uint256 indexed key, uint128 perAddress, uint128 global);
    event SignerRotated(address indexed oldSigner, address indexed newSigner);
    event NonceCancelled(uint256 indexed nonce);
    event BaseURISet(string base);
    event ContractURISet(string uri);

    // ── Errors ──

    error NotPlayer();
    error VoucherExpired();
    error ExpiryTooFar();
    error LengthMismatch();
    error BatchTooBig();
    error EmptyBatch();
    error ZeroAmount();
    error BadId(uint256 id);
    error NonceNotUnused(uint256 nonce);
    error BadSigner(address recovered);
    error NotClaimable(uint256 key);
    error GlobalCapExceeded(uint256 key);
    error AddressCapExceeded(uint256 key);
    error ZeroAddress();

    // ── Construction ──

    /// @param admin           DEFAULT_ADMIN_ROLE holder (use a multisig on mainnet)
    /// @param adminDelay      seconds a DEFAULT_ADMIN transfer must wait (OZ admin rules)
    /// @param signer          initial SIGNER_ROLE (server voucher key's address)
    /// @param pauser          initial PAUSER_ROLE
    /// @param baseURI         per-id metadata base, e.g. "https://noun.wtf/trade-tokens/"
    /// @param contractURI_    collection metadata URL
    /// @param capKeys         initial caps: keys (COIN_KEY = 0, goods 1..7)
    /// @param capPerAddress   ... per address per day
    /// @param capGlobal       ... global per day
    constructor(
        address admin,
        uint48 adminDelay,
        address signer,
        address pauser,
        string memory baseURI,
        string memory contractURI_,
        uint256[] memory capKeys,
        uint128[] memory capPerAddress,
        uint128[] memory capGlobal
    ) ERC1155("") AccessControlDefaultAdminRules(adminDelay, admin) EIP712("NounTradeGoods", "1") {
        if (signer == address(0) || pauser == address(0)) revert ZeroAddress();
        coin = new NounTradeCoin(address(this));
        _grantRole(SIGNER_ROLE, signer);
        _grantRole(PAUSER_ROLE, pauser);
        _base = baseURI;
        _contractURI = contractURI_;
        emit BaseURISet(baseURI);
        emit ContractURISet(contractURI_);
        if (capKeys.length != capPerAddress.length || capKeys.length != capGlobal.length) revert LengthMismatch();
        for (uint256 i; i < capKeys.length; ++i) {
            _setCap(capKeys[i], capPerAddress[i], capGlobal[i]);
        }
    }

    // ── Claim (cash out) ──

    /// @notice Mint a server-signed voucher's goods and coin to its player (the caller).
    function claim(Claim calldata c, bytes calldata signature) external nonReentrant whenNotPaused {
        if (c.player != msg.sender) revert NotPlayer();
        if (block.timestamp > c.expiry) revert VoucherExpired();
        if (c.expiry > block.timestamp + MAX_VOUCHER_TTL) revert ExpiryTooFar();
        uint256 n = c.ids.length;
        if (n != c.amounts.length) revert LengthMismatch();
        if (n > MAX_BATCH) revert BatchTooBig();
        if (n == 0 && c.coin == 0) revert EmptyBatch();
        if (nonceState[c.nonce] != NonceState.Unused) revert NonceNotUnused(c.nonce);

        address signer = ECDSA.recover(_hashTypedDataV4(hashClaim(c)), signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert BadSigner(signer);

        // Effects first: burn the nonce and book the caps before any external call.
        nonceState[c.nonce] = NonceState.Claimed;
        uint256 day = block.timestamp / 1 days;
        for (uint256 i; i < n; ++i) {
            uint256 id = c.ids[i];
            if (id == COIN_KEY) revert BadId(id);
            if (c.amounts[i] == 0) revert ZeroAmount();
            _book(day, msg.sender, id, c.amounts[i]);
        }
        if (c.coin > 0) _book(day, msg.sender, COIN_KEY, c.coin);

        emit Claimed(msg.sender, c.nonce, signer, c.ids, c.amounts, c.coin);

        // Interactions: the ERC-20 mint has no callback; the ERC-1155 mint may call the
        // player's onERC1155BatchReceived, so it goes last (and nonReentrant guards it).
        if (c.coin > 0) coin.mint(msg.sender, c.coin);
        if (n > 0) _mintBatch(msg.sender, c.ids, c.amounts, "");
    }

    /// @notice The EIP-712 struct hash of a voucher (arrays hashed as packed uint256[]).
    function hashClaim(Claim calldata c) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CLAIM_TYPEHASH,
                c.player,
                keccak256(abi.encodePacked(c.ids)),
                keccak256(abi.encodePacked(c.amounts)),
                c.coin,
                c.nonce,
                c.expiry
            )
        );
    }

    /// @notice The full EIP-712 digest a signer signs for `c` (for off-chain checks).
    function claimDigest(Claim calldata c) external view returns (bytes32) {
        return _hashTypedDataV4(hashClaim(c));
    }

    /// @notice The EIP-712 domain separator (name "NounTradeGoods", version "1").
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ── Deposit (back into the game) ──

    /// @notice Burn your own goods and/or NTCOIN to credit them to a game account.
    /// @param account keccak256(utf8(riderId)) of the game account to credit; any value
    ///                is accepted (bytes32(0) is a plain burn nobody will be credited for).
    function deposit(uint256[] calldata ids, uint256[] calldata amounts, uint256 coinAmount, bytes32 account)
        external
        nonReentrant
        whenNotPaused
    {
        uint256 n = ids.length;
        if (n != amounts.length) revert LengthMismatch();
        if (n > MAX_BATCH) revert BatchTooBig();
        if (n == 0 && coinAmount == 0) revert EmptyBatch();
        for (uint256 i; i < n; ++i) {
            if (amounts[i] == 0) revert ZeroAmount();
        }
        uint256 depositId = ++depositCount;
        if (n > 0) _burnBatch(msg.sender, ids, amounts);
        if (coinAmount > 0) coin.burnByGame(msg.sender, coinAmount);
        emit Deposited(msg.sender, account, depositId, ids, amounts, coinAmount);
    }

    // ── Admin ──

    function setCap(uint256 key, uint128 perAddress, uint128 global) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setCap(key, perAddress, global);
    }

    /// @notice Replace `oldSigner` with `newSigner` in one tx (either may be zero to only add / remove).
    function rotateSigner(address oldSigner, address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSigner != address(0)) _grantRole(SIGNER_ROLE, newSigner);
        if (oldSigner != address(0)) _revokeRole(SIGNER_ROLE, oldSigner);
        emit SignerRotated(oldSigner, newSigner);
    }

    /// @notice Invalidate issued-but-unclaimed vouchers (e.g. a leaked voucher).
    function cancelNonces(uint256[] calldata nonces) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i; i < nonces.length; ++i) {
            if (nonceState[nonces[i]] != NonceState.Unused) revert NonceNotUnused(nonces[i]);
            nonceState[nonces[i]] = NonceState.Cancelled;
            emit NonceCancelled(nonces[i]);
        }
    }

    function setBaseURI(string calldata base) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _base = base;
        emit BaseURISet(base);
    }

    function setContractURI(string calldata uri_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _contractURI = uri_;
        emit ContractURISet(uri_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ── Views ──

    /// @notice `{base}{id}.json`, decimal id (e.g. https://noun.wtf/trade-tokens/1.json).
    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(_base, id.toString(), ".json");
    }

    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    /// @notice How much more `who` (and everyone) can claim of `key` today.
    function remainingToday(address who, uint256 key) external view returns (uint256 forAddress, uint256 global) {
        uint256 day = block.timestamp / 1 days;
        Cap memory cap = caps[key];
        uint256 a = mintedBy[day][who][key];
        uint256 g = mintedOn[day][key];
        forAddress = a >= cap.perAddress ? 0 : cap.perAddress - a;
        global = g >= cap.global ? 0 : cap.global - g;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControlDefaultAdminRules)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ── Internals ──

    function _setCap(uint256 key, uint128 perAddress, uint128 global) internal {
        caps[key] = Cap(perAddress, global);
        emit CapSet(key, perAddress, global);
    }

    function _book(uint256 day, address who, uint256 key, uint256 amount) internal {
        Cap memory cap = caps[key];
        if (cap.global == 0) revert NotClaimable(key);
        uint256 g = mintedOn[day][key] + amount;
        if (g > cap.global) revert GlobalCapExceeded(key);
        uint256 a = mintedBy[day][who][key] + amount;
        if (a > cap.perAddress) revert AddressCapExceeded(key);
        mintedOn[day][key] = g;
        mintedBy[day][who][key] = a;
    }
}
