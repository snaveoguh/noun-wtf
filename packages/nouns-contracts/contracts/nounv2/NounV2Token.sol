// SPDX-License-Identifier: GPL-3.0

/// @title NounV2 ERC-721 token — fork of NounsToken with nounder reward removed.
/// @notice Same descriptor/seeder pattern as mainnet Nouns. Supply starts at #0. Minter controlled.

pragma solidity ^0.8.6;

import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol';
import { ERC721Checkpointable } from '../base/ERC721Checkpointable.sol';
import { INounsDescriptorMinimal } from '../interfaces/INounsDescriptorMinimal.sol';
import { INounsSeeder } from '../interfaces/INounsSeeder.sol';
import { INounsToken } from '../interfaces/INounsToken.sol';
import { ERC721 } from '../base/ERC721.sol';
import { IERC721 } from '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import { IProxyRegistry } from '../external/opensea/IProxyRegistry.sol';

contract NounV2Token is INounsToken, Ownable, ERC721Checkpointable {
    address public minter;
    INounsDescriptorMinimal public descriptor;
    INounsSeeder public seeder;

    bool public isMinterLocked;
    bool public isDescriptorLocked;
    bool public isSeederLocked;

    mapping(uint256 => INounsSeeder.Seed) public seeds;
    uint256 private _currentNounId;

    string private _contractURIHash = '';

    IProxyRegistry public immutable proxyRegistry;

    modifier whenMinterNotLocked() {
        require(!isMinterLocked, 'Minter is locked');
        _;
    }

    modifier whenDescriptorNotLocked() {
        require(!isDescriptorLocked, 'Descriptor is locked');
        _;
    }

    modifier whenSeederNotLocked() {
        require(!isSeederLocked, 'Seeder is locked');
        _;
    }

    modifier onlyMinter() {
        require(msg.sender == minter, 'Sender is not the minter');
        _;
    }

    constructor(
        address _minter,
        INounsDescriptorMinimal _descriptor,
        INounsSeeder _seeder,
        IProxyRegistry _proxyRegistry
    ) ERC721('NounV2', 'NOUNV2') {
        minter = _minter;
        descriptor = _descriptor;
        seeder = _seeder;
        proxyRegistry = _proxyRegistry;
    }

    function contractURI() public view returns (string memory) {
        return string(abi.encodePacked('ipfs://', _contractURIHash));
    }

    function setContractURIHash(string memory newContractURIHash) external onlyOwner {
        _contractURIHash = newContractURIHash;
    }

    function isApprovedForAll(address owner, address operator) public view override(IERC721, ERC721) returns (bool) {
        if (proxyRegistry.proxies(owner) == operator) {
            return true;
        }
        return super.isApprovedForAll(owner, operator);
    }

    /// @notice Mint the next Noun to the minter. No nounder reward.
    function mint() public override onlyMinter returns (uint256) {
        return _mintTo(minter, _currentNounId++);
    }

    function burn(uint256 nounId) public override onlyMinter {
        _burn(nounId);
        emit NounBurned(nounId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), 'NounV2Token: URI query for nonexistent token');
        return descriptor.tokenURI(tokenId, seeds[tokenId]);
    }

    function dataURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), 'NounV2Token: URI query for nonexistent token');
        return descriptor.dataURI(tokenId, seeds[tokenId]);
    }

    function setMinter(address _minter) external override onlyOwner whenMinterNotLocked {
        minter = _minter;
        emit MinterUpdated(_minter);
    }

    function lockMinter() external override onlyOwner whenMinterNotLocked {
        isMinterLocked = true;
        emit MinterLocked();
    }

    function setDescriptor(INounsDescriptorMinimal _descriptor) external override onlyOwner whenDescriptorNotLocked {
        descriptor = _descriptor;
        emit DescriptorUpdated(_descriptor);
    }

    function lockDescriptor() external override onlyOwner whenDescriptorNotLocked {
        isDescriptorLocked = true;
        emit DescriptorLocked();
    }

    function setSeeder(INounsSeeder _seeder) external override onlyOwner whenSeederNotLocked {
        seeder = _seeder;
        emit SeederUpdated(_seeder);
    }

    function lockSeeder() external override onlyOwner whenSeederNotLocked {
        isSeederLocked = true;
        emit SeederLocked();
    }

    function _mintTo(address to, uint256 nounId) internal returns (uint256) {
        INounsSeeder.Seed memory seed = seeds[nounId] = seeder.generateSeed(nounId, descriptor);

        _mint(owner(), to, nounId);
        emit NounCreated(nounId, seed);

        return nounId;
    }
}
