// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import 'forge-std/Script.sol';
import { NounsRepurchase } from '../contracts/repurchase/NounsRepurchase.sol';
import { INounsRepurchase } from '../contracts/interfaces/INounsRepurchase.sol';
import { IEthConverter } from '../contracts/interfaces/IEthConverter.sol';
import {
    OneToOneConverter,
    WstETHConverter,
    RETHConverter,
    METHConverter,
    IWstETH,
    IRocketTokenRETH,
    IMantleStaking
} from '../contracts/repurchase/EthConverters.sol';
import { IChainalysisSanctionsList } from '../contracts/external/chainalysis/IChainalysisSanctionsList.sol';
import { NounsAuctionHouseV3 } from '../contracts/NounsAuctionHouseV3.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { IERC721Enumerable } from '@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol';

/// @title Deploy NounsRepurchase + LST converters on mainnet
/// @notice Ownership goes to the DAO Executor in the constructor, so the deployer never controls the program.
///         Funding (Executor.sendETH) and the bylaws amendment happen in the DAO proposal itself.
///         The sanctions oracle is read from the live auction house so both contracts screen identically.
///
///   forge script script/DeployNounsRepurchase.s.sol --rpc-url $MAINNET_RPC --broadcast --verify
///
/// Env overrides (all optional): SPREAD_BPS, MAX_PER_TICK, TICK_DURATION, LIABILITY_RESERVE_WEI, KYC_ATTESTOR.
contract DeployNounsRepurchase is Script {
    // Nouns DAO (from the DUNA bylaws §1.3 Code table)
    address constant NOUNS_TOKEN = 0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03;
    address constant NOUNS_EXECUTOR = 0xb1a32FC9F9D8b2cf86C068Cae13108809547ef71;
    address constant NOUNS_EXECUTOR_V1 = 0x0BC3807Ec262cB779b38D65b38158acC3bfedE10;
    address constant AUCTION_HOUSE_PROXY = 0x830BD73E4184ceF73443C15111a1DF14e495C706;

    // Mainnet infra
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant RETH = 0xae78736Cd615f374D3085123A210448E74Fc6393;
    address constant METH = 0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa;
    address constant MANTLE_STAKING = 0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f;

    function run() external returns (NounsRepurchase repurchase) {
        uint16 spreadBps = uint16(vm.envOr('SPREAD_BPS', uint256(300)));
        uint16 maxPerTick = uint16(vm.envOr('MAX_PER_TICK', uint256(1)));
        uint32 tickDuration = uint32(vm.envOr('TICK_DURATION', uint256(1 days)));
        uint256 liabilityReserve = vm.envOr('LIABILITY_RESERVE_WEI', uint256(0));
        address kycAttestor = vm.envOr('KYC_ATTESTOR', address(0));

        IChainalysisSanctionsList sanctionsOracle = NounsAuctionHouseV3(AUCTION_HOUSE_PROXY).sanctionsOracle();
        require(address(sanctionsOracle) != address(0), 'auction house has no sanctions oracle');

        vm.startBroadcast();

        IEthConverter oneToOne = new OneToOneConverter();
        IEthConverter wstEth = new WstETHConverter(IWstETH(WSTETH));
        IEthConverter rEth = new RETHConverter(IRocketTokenRETH(RETH));
        IEthConverter mEth = new METHConverter(IMantleStaking(MANTLE_STAKING));

        INounsRepurchase.Asset[] memory assets = new INounsRepurchase.Asset[](5);
        assets[0] = INounsRepurchase.Asset({ token: IERC20(WETH), converter: oneToOne });
        assets[1] = INounsRepurchase.Asset({ token: IERC20(STETH), converter: oneToOne });
        assets[2] = INounsRepurchase.Asset({ token: IERC20(WSTETH), converter: wstEth });
        assets[3] = INounsRepurchase.Asset({ token: IERC20(RETH), converter: rEth });
        assets[4] = INounsRepurchase.Asset({ token: IERC20(METH), converter: mEth });

        // Nouns held here are DAO-controlled, not membership interests: the Noun on auction and the legacy treasury.
        address[] memory excluded = new address[](2);
        excluded[0] = AUCTION_HOUSE_PROXY;
        excluded[1] = NOUNS_EXECUTOR_V1;

        repurchase = new NounsRepurchase(
            IERC721Enumerable(NOUNS_TOKEN),
            NOUNS_EXECUTOR,
            WETH,
            sanctionsOracle,
            kycAttestor,
            spreadBps,
            maxPerTick,
            tickDuration,
            liabilityReserve,
            assets,
            excluded
        );

        vm.stopBroadcast();

        console.log('NounsRepurchase:', address(repurchase));
        console.log('owner:', repurchase.owner());
        console.log('sanctions oracle:', address(sanctionsOracle));
        console.log('NAV per Noun (wei):', repurchase.navPerNoun());
        console.log('repurchase price (wei):', repurchase.repurchasePrice());
    }
}
